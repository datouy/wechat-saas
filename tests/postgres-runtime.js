/**
 * 真实 PostgreSQL 运行时验收。
 * 默认启动临时 embedded-postgres 实例；设置 TEST_DATABASE_URL 可复用隔离测试库。
 * 覆盖迁移、应用启动、并发扣库存、Outbox 双 worker 抢占、审计追加写与备份恢复。
 */
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(os.tmpdir(), 'wechat-saas-pg-' + Date.now());
let embedded;
let pg;
let saas;
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message || '断言失败');
}

async function test(name, fn) {
  try {
    await fn();
    console.log('  ✅ ' + name);
    passed += 1;
  } catch (error) {
    console.log('  ❌ ' + name + ' -> ' + error.message);
    failed += 1;
  }
}

function portFree(port) {
  return new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

async function availablePort() {
  for (let port = 55432; port < 55532; port += 1) {
    if (await portFree(port)) return port;
  }
  throw new Error('没有可用的 PostgreSQL 测试端口');
}

(async () => {
  console.log('\n===== PostgreSQL 运行时验收 =====\n');
  const port = await availablePort();
  process.env.PGDATABASE = 'postgres';
  if (!process.env.TEST_DATABASE_URL) {
    const EmbeddedPostgresModule = require('embedded-postgres');
    const EmbeddedPostgres = EmbeddedPostgresModule.default || EmbeddedPostgresModule;
    const databaseDir = path.join(root, 'cluster');
    pg = new EmbeddedPostgres({
      databaseDir,
      user: 'postgres',
      password: 'pgtest123',
      port,
      persistent: true,
      onLog: () => {},
      onError: error => console.error('[embedded-postgres] ' + error)
    });
    await pg.initialise();
    await pg.start();
    await pg.createDatabase('wechat_saas_test');
    await pg.createDatabase('wechat_saas_restore');
    embedded = true;
  }

  const databaseUrl = process.env.TEST_DATABASE_URL ||
    ('postgresql://postgres:pgtest123@127.0.0.1:' + port + '/wechat_saas_test');
  const restoreUrl = process.env.TEST_RESTORE_DATABASE_URL ||
    ('postgresql://postgres:pgtest123@127.0.0.1:' + port + '/wechat_saas_restore');

  process.env.NODE_ENV = 'development';
  process.env.DATA_STORE = 'postgres';
  process.env.DATABASE_URL = databaseUrl;
  process.env.DATABASE_SSL = 'false';
  process.env.AUTH_SECRET = 'postgres-runtime-secret';
  process.env.DATA_DIR = path.join(root, 'data');
  process.env.UPLOAD_DIR = path.join(root, 'uploads');
  process.env.AUDIT_ARCHIVE_DIR = path.join(root, 'archive');
  process.env.BACKUP_DIR = path.join(root, 'backups');
  process.env.OUTBOX_WORKER_ENABLED = 'false';
  process.env.AUDIT_ARCHIVE_WORKER_ENABLED = 'false';
  process.env.BACKUP_ENCRYPTION_KEY = 'postgres-backup-test-key';

  console.log('[迁移] 应用 001-003');
  execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'migrate.js')], {
    cwd: path.join(__dirname, '..'),
    env: process.env,
    stdio: 'inherit'
  });

  const WechatSaas = require('../src/index');
  const PgStore = require('../src/store/PgStore');
  const OutboxService = require('../src/core/OutboxService');
  const BackupService = require('../src/core/BackupService');
  const config = require('../config/default');

  saas = new WechatSaas();
  await saas.initialize();
  await new Promise(resolve => { saas.server = saas.app.listen(0, '127.0.0.1', resolve); });
  const base = 'http://127.0.0.1:' + saas.server.address().port;

  await test('应用在 PostgreSQL 上启动并通过健康与就绪检查', async () => {
    const health = await fetch(base + '/healthz');
    const ready = await fetch(base + '/readyz');
    assert(health.status === 200 && ready.status === 200);
    const readyJson = await ready.json();
    assert(readyJson.status === 'ok');
  });

  await test('默认管理员登录并读取种子商品', async () => {
    const login = await fetch(base + '/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    });
    const json = await login.json();
    assert(login.status === 200 && json.data.token);
    const products = await fetch(base + '/api/admin/products?pageSize=3', {
      headers: { Authorization: 'Bearer ' + json.data.token }
    });
    const data = await products.json();
    assert(products.status === 200 && data.data.total >= 6);
  });

  await test('60 路并发扣减恰好成功 50 次且库存归零', async () => {
    await saas.store.insert('products', {
      id: 'pg-concurrent-product',
      tenantId: 't-default',
      name: 'PostgreSQL 并发库存',
      price: 100,
      stock: 50,
      onSale: true,
      createdAt: new Date().toISOString()
    });
    const outcomes = await Promise.all(Array.from({ length: 60 }, () =>
      saas.productManager.deductStock('pg-concurrent-product', 1).catch(() => false)
    ));
    assert(outcomes.filter(Boolean).length === 50, '成功扣减次数应为 50');
    const product = await saas.productManager.get('pg-concurrent-product');
    assert(product.stock === 0, '最终库存应为 0');
  });

  await test('两个 Outbox worker 并发抢占时只发送一次', async () => {
    const storeA = new PgStore({ connectionString: databaseUrl });
    const storeB = new PgStore({ connectionString: databaseUrl });
    await storeA.initialize();
    await storeB.initialize();
    let sends = 0;
    const wechat = {
      async sendSubscribeMessage() {
        sends += 1;
        await new Promise(resolve => setTimeout(resolve, 30));
        return { errcode: 0, errmsg: 'ok', mock: true };
      }
    };
    const outboxConfig = { enabled: false, workerEnabled: false, maxAttempts: 3, batchSize: 20, leaseMs: 30000 };
    const workerA = new OutboxService(storeA, wechat, outboxConfig);
    const workerB = new OutboxService(storeB, wechat, outboxConfig);
    const now = new Date().toISOString();
    await storeA.insert('notifications', {
      id: 'pg-outbox-claim-test',
      tenantId: 't-default',
      memberId: 'pg-member',
      openid: 'pg-openid',
      event: 'orderPaid',
      title: '支付成功',
      templateId: 'tmpl-pg',
      payload: {},
      status: 'queued',
      attempts: 0,
      maxAttempts: 3,
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now
    });
    try {
      await Promise.all([workerA.processDue(), workerB.processDue()]);
      assert(sends === 1, '实际发送次数应为 1，实际 ' + sends);
      const record = await storeA.findById('notifications', 'pg-outbox-claim-test');
      assert(['mocked', 'sent'].includes(record.status));
    } finally {
      await storeA.shutdown();
      await storeB.shutdown();
    }
  });

  await test('审计记录更新和删除被数据库触发器拒绝', async () => {
    await saas.store.insert('auditLogs', {
      id: 'pg-audit-trigger-test',
      tenantId: 't-default',
      sequence: 999999,
      action: 'trigger.test',
      hash: 'sealed-hash',
      previousHash: 'previous-hash',
      createdAt: new Date().toISOString()
    });
    let updateRejected = false;
    let deleteRejected = false;
    try {
      await saas.store.update('auditLogs', 'pg-audit-trigger-test', { action: 'tampered' });
    } catch (error) {
      updateRejected = /append-only/i.test(error.message);
    }
    try {
      await saas.store.remove('auditLogs', 'pg-audit-trigger-test');
    } catch (error) {
      deleteRejected = /append-only/i.test(error.message);
    }
    assert(updateRejected, '更新已封存审计记录应被拒绝');
    assert(deleteRejected, '删除审计记录应被拒绝');
  });

  await test('PostgreSQL 加密备份与独立数据库恢复', async () => {
    await fs.promises.mkdir(process.env.UPLOAD_DIR, { recursive: true });
    await fs.promises.writeFile(path.join(process.env.UPLOAD_DIR, 'brand-restore-test.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const service = new BackupService(config);
    const backup = await service.create(path.join(root, 'pg-backups'), {
      backend: 'postgres',
      databaseUrl,
      uploadDir: process.env.UPLOAD_DIR,
      encryptionKey: process.env.BACKUP_ENCRYPTION_KEY
    });
    assert(backup.encrypted);

    const staleStore = new PgStore({ connectionString: restoreUrl });
    await staleStore.initialize();
    try {
      await staleStore.insert('tenants', { id: 'pg-stale-restore', name: '应被完整恢复清除' });
      await staleStore.insert('staleOnly', { id: 'pg-stale-collection', name: '旧集合' });
    } finally {
      await staleStore.shutdown();
    }

    const restored = await service.restore(backup.file, {
      databaseUrl: restoreUrl,
      allowOverwrite: true,
      uploadDir: path.join(root, 'restored-uploads'),
      encryptionKey: process.env.BACKUP_ENCRYPTION_KEY
    });
    assert(restored.collections > 0);
    const restoredStore = new PgStore({ connectionString: restoreUrl });
    await restoredStore.initialize();
    try {
      const tenant = await restoredStore.findById('tenants', 't-default');
      assert(tenant && tenant.id === 't-default');
      assert(!(await restoredStore.findById('tenants', 'pg-stale-restore')), '恢复应清除目标库旧租户文档');
      assert((await restoredStore.find('staleOnly', () => true)).length === 0, '恢复应清除目标库旧集合');
      const products = await restoredStore.find('products', item => item.tenantId === 't-default');
      assert(products.length >= 6);
    } finally {
      await restoredStore.shutdown();
    }
    assert(
      fs.existsSync(path.join(root, 'restored-uploads', 'brand-restore-test.png')),
      'PostgreSQL 恢复应同步恢复上传素材'
    );
  });

  if (saas) await saas.shutdown();
  if (pg && embedded) await pg.stop();

  console.log('\n===== PostgreSQL 验收结果 =====');
  console.log('通过: ' + passed + ' | 失败: ' + failed);
  process.exitCode = failed > 0 ? 1 : 0;
})().catch(async error => {
  console.error('[PostgreSQL 验收失败] ' + error.stack);
  if (saas) await saas.shutdown().catch(() => {});
  if (pg && embedded) await pg.stop().catch(() => {});
  process.exitCode = 1;
});
