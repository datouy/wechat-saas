/**
 * 隔离灾备演练。默认验证 JSON 与 SQLite；传入 PostgreSQL 测试库可追加验证。
 * 用法:
 *   node scripts/dr-drill.js [--report=docs/reports/dr-drill.json]
 *   DRILL_DATABASE_URL=... DRILL_RESTORE_DATABASE_URL=... node scripts/dr-drill.js
 */
require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('../config/default');
const BackupService = require('../src/core/BackupService');
const PgStore = require('../src/store/PgStore');
const SqliteStore = require('../src/store/SqliteStore');

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

function arg(name, fallback) {
  const prefix = '--' + name + '=';
  const found = process.argv.find(value => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function digest(value) {
  return sha256(Buffer.from(JSON.stringify(value), 'utf8'));
}

async function assetVerified(root) {
  try {
    return (await fs.promises.readFile(path.join(root, 'brand.bin'), 'utf8')) === 'verified-brand-asset';
  } catch (error) {
    return false;
  }
}

async function prepareJson(source, uploads) {
  const fixtures = {
    tenants: [{ id: 'dr-tenant', name: '灾备演练租户', status: 'active' }],
    products: Array.from({ length: 50 }, (_, index) => ({
      id: 'p-' + index, tenantId: 'dr-tenant', name: '商品' + index, stock: index
    })),
    orders: [{ id: 'o-1', tenantId: 'dr-tenant', status: 'paid', payAmount: 9900 }]
  };
  await fs.promises.mkdir(source, { recursive: true });
  await fs.promises.mkdir(uploads, { recursive: true });
  for (const [name, docs] of Object.entries(fixtures)) {
    await fs.promises.writeFile(path.join(source, name + '.json'), JSON.stringify(docs, null, 1));
  }
  await fs.promises.writeFile(path.join(uploads, 'brand.bin'), Buffer.from('verified-brand-asset'));
  return fixtures;
}

async function prepareSqlite(source, uploads) {
  const store = new SqliteStore(source);
  await store.initialize();
  const fixtures = {
    tenants: [{ id: 'dr-tenant', name: '灾备演练租户', status: 'active' }],
    products: Array.from({ length: 50 }, (_, index) => ({
      id: 'p-' + index, tenantId: 'dr-tenant', name: '商品' + index, stock: index
    })),
    orders: [{ id: 'o-1', tenantId: 'dr-tenant', status: 'paid', payAmount: 9900 }]
  };
  for (const [name, docs] of Object.entries(fixtures)) {
    for (const doc of docs) await store.insert(name, doc);
  }
  await store.shutdown();
  await fs.promises.mkdir(uploads, { recursive: true });
  await fs.promises.writeFile(path.join(uploads, 'brand.bin'), Buffer.from('verified-brand-asset'));
  return fixtures;
}

async function readJsonRestored(target, names) {
  const restored = {};
  for (const name of names) {
    restored[name] = JSON.parse(await fs.promises.readFile(path.join(target, name + '.json'), 'utf8'));
  }
  return restored;
}

async function runFileBackend(service, root, backend, encryptionKey) {
  const source = path.join(root, backend + '-source');
  const target = path.join(root, backend + '-restored');
  const uploads = path.join(root, backend + '-uploads');
  const restoredUploads = path.join(root, backend + '-restored-uploads');
  const backups = path.join(root, backend + '-backups');
  const fixtures = backend === 'json'
    ? await prepareJson(source, uploads)
    : await prepareSqlite(source, uploads);
  const lastMutationAt = Date.now();
  const backupStartedAt = Date.now();
  const backup = await service.create(backups, {
    backend,
    dataDir: source,
    uploadDir: uploads,
    encryptionKey
  });
  const backupCompletedAt = Date.now();
  const restoreStartedAt = Date.now();
  const restored = await service.restore(backup.file, {
    targetDir: target,
    uploadDir: restoredUploads,
    encryptionKey
  });
  const recoveredAt = Date.now();
  let dataVerified = false;
  if (backend === 'json') {
    dataVerified = digest(fixtures) === digest(await readJsonRestored(target, Object.keys(fixtures)));
  } else {
    const check = new SqliteStore(target);
    await check.initialize();
    try {
      const tenants = await check.find('tenants', () => true);
      const products = await check.find('products', () => true);
      const orders = await check.find('orders', () => true);
      dataVerified = tenants.length === 1 && products.length === 50 && orders.length === 1;
    } finally {
      await check.shutdown();
    }
  }
  const assetFileVerified = await assetVerified(restoredUploads);
  return {
    backend,
    ok: dataVerified && assetFileVerified,
    backupFile: backup.file,
    backupManifestChecksum: backup.payloadChecksum,
    encrypted: backup.encrypted,
    collections: restored.collections,
    rows: Object.values(fixtures).reduce((sum, docs) => sum + docs.length, 0),
    dataVerified,
    assetVerified: assetFileVerified,
    backupDurationMs: backupCompletedAt - backupStartedAt,
    restoreDurationMs: recoveredAt - restoreStartedAt,
    rpoSeconds: Number(((backupCompletedAt - lastMutationAt) / 1000).toFixed(3)),
    rtoSeconds: Number(((recoveredAt - restoreStartedAt) / 1000).toFixed(3))
  };
}

async function runPostgresBackend(service, root, sourceUrl, restoreUrl, encryptionKey) {
  const fixtures = {
    tenants: [{ id: 'dr-pg-tenant', name: 'PostgreSQL 灾备演练', status: 'active' }],
    products: Array.from({ length: 100 }, (_, index) => ({
      id: 'pg-p-' + index, tenantId: 'dr-pg-tenant', name: '商品' + index, stock: index
    }))
  };
  const source = new PgStore({ connectionString: sourceUrl });
  await source.initialize();
  try {
    for (const [name, docs] of Object.entries(fixtures)) {
      for (const doc of docs) await source.insert(name, doc);
    }
  } finally {
    await source.shutdown();
  }
  const uploads = path.join(root, 'postgres-uploads');
  await fs.promises.mkdir(uploads, { recursive: true });
  await fs.promises.writeFile(path.join(uploads, 'brand.bin'), Buffer.from('verified-brand-asset'));
  const lastMutationAt = Date.now();
  const backupStartedAt = Date.now();
  const backup = await service.create(path.join(root, 'postgres-backups'), {
    backend: 'postgres',
    databaseUrl: sourceUrl,
    uploadDir: uploads,
    encryptionKey
  });
  const backupCompletedAt = Date.now();
  const restoreStartedAt = Date.now();
  const restored = await service.restore(backup.file, {
    databaseUrl: restoreUrl,
    allowOverwrite: true,
    uploadDir: path.join(root, 'postgres-restored-uploads'),
    encryptionKey
  });
  const recoveredAt = Date.now();
  const target = new PgStore({ connectionString: restoreUrl });
  await target.initialize();
  let dataVerified = false;
  try {
    dataVerified = (await target.count('tenants', item => item.id === 'dr-pg-tenant')) === 1 &&
      (await target.count('products', item => item.tenantId === 'dr-pg-tenant')) === 100;
  } finally {
    await target.shutdown();
  }
  const assetFileVerified = await assetVerified(path.join(root, 'postgres-restored-uploads'));
  return {
    backend: 'postgres',
    ok: dataVerified && assetFileVerified,
    backupFile: backup.file,
    backupManifestChecksum: backup.payloadChecksum,
    encrypted: backup.encrypted,
    collections: restored.collections,
    rows: Object.values(fixtures).reduce((sum, docs) => sum + docs.length, 0),
    dataVerified,
    assetVerified: assetFileVerified,
    backupDurationMs: backupCompletedAt - backupStartedAt,
    restoreDurationMs: recoveredAt - restoreStartedAt,
    rpoSeconds: Number(((backupCompletedAt - lastMutationAt) / 1000).toFixed(3)),
    rtoSeconds: Number(((recoveredAt - restoreStartedAt) / 1000).toFixed(3))
  };
}

(async () => {
  const startedAt = new Date().toISOString();
  const root = path.join(os.tmpdir(), 'wechat-saas-dr-' + Date.now());
  fs.mkdirSync(root, { recursive: true });
  const encryptionKey = 'drill-only-key';
  const service = new BackupService(config);
  const cases = [];
  for (const backend of ['json', 'sqlite']) {
    try {
      cases.push(await runFileBackend(service, root, backend, encryptionKey));
    } catch (error) {
      cases.push({ backend, ok: false, error: error.message });
    }
  }
  const drillDatabaseUrl = process.env.DRILL_DATABASE_URL || '';
  const drillRestoreDatabaseUrl = process.env.DRILL_RESTORE_DATABASE_URL || '';
  if (drillDatabaseUrl && drillRestoreDatabaseUrl) {
    try {
      cases.push(await runPostgresBackend(service, root, drillDatabaseUrl, drillRestoreDatabaseUrl, encryptionKey));
    } catch (error) {
      cases.push({ backend: 'postgres', ok: false, error: error.message });
    }
  } else {
    cases.push({
      backend: 'postgres',
      ok: null,
      skipped: true,
      reason: '未设置 DRILL_DATABASE_URL 与 DRILL_RESTORE_DATABASE_URL'
    });
  }
  const report = {
    format: 'wechat-saas-dr-report-v1',
    startedAt,
    finishedAt: new Date().toISOString(),
    ok: cases.filter(item => !item.skipped).every(item => item.ok === true),
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch
    },
    cases
  };
  const reportFile = path.resolve(arg('report', path.join('work', 'dr-drill-latest.json')));
  await fs.promises.mkdir(path.dirname(reportFile), { recursive: true });
  await fs.promises.writeFile(reportFile, JSON.stringify(report, null, 2));
  await fs.promises.writeFile(path.join(path.dirname(reportFile), 'latest-dr-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, reportFile }, null, 2));
  await fs.promises.rm(root, { recursive: true, force: true }).catch(() => {});
  if (!report.ok) process.exitCode = 1;
})().catch(error => {
  console.error('[灾备演练失败] ' + error.stack);
  process.exitCode = 1;
});
