/**
 * 企业试运行集成验收：平台租户、套餐配额、品牌素材、订阅授权、Outbox、
 * 审计归档、指标鉴权、暂停恢复、灾备恢复与 404 错误契约。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(os.tmpdir(), 'wechat-saas-enterprise-' + Date.now());
process.env.NODE_ENV = 'development';
process.env.AUTH_SECRET = 'enterprise-runtime-secret-please-change';
process.env.DATA_DIR = path.join(root, 'data');
process.env.UPLOAD_DIR = path.join(root, 'uploads');
process.env.AUDIT_ARCHIVE_DIR = path.join(root, 'archive');
process.env.BACKUP_DIR = path.join(root, 'backups');
process.env.METRICS_TOKEN = 'enterprise-metrics-token-123';
process.env.TENANT_SIGNUP_ENABLED = 'true';
process.env.OUTBOX_WORKER_ENABLED = 'false';
process.env.OUTBOX_MAX_ATTEMPTS = '1';
process.env.AUDIT_ARCHIVE_ENABLED = 'true';
process.env.AUDIT_ARCHIVE_WORKER_ENABLED = 'false';
process.env.BACKUP_ENCRYPTION_KEY = 'enterprise-backup-test-key';

const SqliteStore = require('../src/store/SqliteStore');
const WechatSaas = require('../src/index');

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

(async () => {
  console.log('\n===== 企业试运行集成验收 =====\n');
  const saas = new WechatSaas();
  await saas.initialize();
  await new Promise(resolve => { saas.server = saas.app.listen(0, '127.0.0.1', resolve); });
  const base = 'http://127.0.0.1:' + saas.server.address().port;

  async function api(route, options = {}) {
    const headers = {};
    if (options.token) headers.Authorization = 'Bearer ' + options.token;
    if (options.tenant) headers['X-Tenant-Id'] = options.tenant;
    let body;
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }
    const response = await fetch(base + route, {
      method: options.method || 'GET',
      headers,
      body
    });
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (error) {}
    return { status: response.status, json, text, headers: response.headers };
  }

  const adminLogin = await api('/api/admin/login', {
    method: 'POST',
    body: { username: 'admin', password: 'admin123' }
  });
  const adminToken = adminLogin.json && adminLogin.json.data && adminLogin.json.data.token;
  assert(adminToken, '默认管理员登录失败');

  await test('健康检查与结构化 404', async () => {
    assert((await api('/healthz')).status === 200);
    const missingApi = await api('/api/not-a-real-route');
    assert(missingApi.status === 404 && missingApi.json.code === 'NOT_FOUND');
    const missingAsset = await api('/uploads/missing.png');
    assert(missingAsset.status === 404, '缺失素材应返回 404，实际 ' + missingAsset.status);
  });

  await test('指标端点拒绝无令牌访问', async () => {
    assert((await api('/metrics')).status === 401);
    const metrics = await api('/metrics', { token: process.env.METRICS_TOKEN });
    assert(metrics.status === 200 && metrics.text.includes('saas_http_requests_total'));
    assert(metrics.text.includes('outbox_dead_letters'));
  });

  const platformLogin = await api('/api/platform/login', {
    method: 'POST',
    body: { username: 'platform', password: 'OpsAdmin123!' }
  });
  const platformToken = platformLogin.json && platformLogin.json.data && platformLogin.json.data.token;
  assert(platformToken, '平台运营账号登录失败');

  let tenantId;
  let ownerToken;
  const ownerPassword = 'StoreOwner123';
  await test('平台开通租户并允许所有者登录', async () => {
    const created = await api('/api/platform/tenants', {
      method: 'POST',
      token: platformToken,
      body: {
        name: '山湖里测试店',
        slug: 'shanhu-test',
        ownerUsername: 'store_owner',
        ownerPassword,
        contactPhone: '13800000000',
        planCode: 'starter',
        trial: false
      }
    });
    assert(created.status === 200, created.text);
    tenantId = created.json.data.tenant.id;
    const login = await api('/api/admin/login', {
      method: 'POST',
      tenant: tenantId,
      body: { username: 'store_owner', password: ownerPassword }
    });
    assert(login.status === 200, login.text);
    ownerToken = login.json.data.token;
  });

  await test('套餐员工配额与门店配额生效', async () => {
    for (let index = 1; index <= 2; index++) {
      const created = await api('/api/admin/admins', {
        method: 'POST',
        token: ownerToken,
        body: { username: 'manager_' + index, password: 'StrongManager123', role: 'manager' }
      });
      assert(created.status === 200, '创建第 ' + index + ' 位员工失败: ' + created.text);
    }
    const overAdmin = await api('/api/admin/admins', {
      method: 'POST',
      token: ownerToken,
      body: { username: 'manager_3', password: 'StrongManager123', role: 'manager' }
    });
    assert(overAdmin.status >= 400, '员工配额应阻止第 4 个账号');
    const firstLocation = await api('/api/admin/locations', {
      method: 'POST',
      token: ownerToken,
      body: { name: '试点门店', code: 'TEST', address: '测试路 1 号', isPrimary: true }
    });
    assert(firstLocation.status === 200, firstLocation.text);
    const overLocation = await api('/api/admin/locations', {
      method: 'POST',
      token: ownerToken,
      body: { name: '超额门店', code: 'OVER', address: '测试路 2 号' }
    });
    assert(overLocation.status >= 400, '门店配额应阻止第 2 个门店');
  });

  let assetUrl;
  await test('品牌素材签名校验、租户隔离与静态访问', async () => {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const uploaded = await api('/api/admin/assets', {
      method: 'POST',
      token: ownerToken,
      body: { filename: 'logo.png', mimeType: 'image/png', data: png, kind: 'logo' }
    });
    assert(uploaded.status === 200, uploaded.text);
    assetUrl = uploaded.json.data.url;
    assert(assetUrl.includes('/shanhu-test/'));
    const saved = await api('/api/admin/store', {
      method: 'PUT',
      token: ownerToken,
      body: { logoUrl: assetUrl }
    });
    assert(saved.status === 200 && saved.json.data.logoUrl === assetUrl);
    const image = await fetch(base + assetUrl);
    assert(image.status === 200 && image.headers.get('content-type').includes('image/png'));
  });

  let memberToken;
  let memberId;
  await test('顾客订阅授权逐模板回传并形成统计', async () => {
    const template = await api('/api/admin/subscriptions/orderPaid', {
      method: 'PUT',
      token: ownerToken,
      body: {
        templateId: 'tmpl-order-paid',
        page: 'pages/orders/orders',
        data: { thing1: { value: '订单 {orderNo}' }, amount2: { value: '{amount}' } },
        enabled: true
      }
    });
    assert(template.status === 200, template.text);
    const member = await api('/api/wx/login', {
      method: 'POST',
      tenant: tenantId,
      body: { code: 'enterprise-member-1' }
    });
    assert(member.status === 200, member.text);
    memberToken = member.json.data.token;
    memberId = member.json.data.memberId;
    const configured = await api('/api/wx/subscriptions', { token: memberToken });
    assert(configured.status === 200 && configured.json.data.events.some(item => item.event === 'orderPaid'));
    const authorized = await api('/api/wx/subscriptions/authorize', {
      method: 'POST',
      token: memberToken,
      body: { decisions: { 'tmpl-order-paid': 'accept' } }
    });
    assert(authorized.status === 200 && authorized.json.data.accepted === 1);
    const summary = await api('/api/admin/subscriptions', { token: ownerToken });
    assert(summary.json.data.authorizations.participants === 1);
    assert(summary.json.data.authorizations.acceptRate === 1);
  });

  let deadNotificationId;
  await test('Outbox 死信、人工重试与手动执行', async () => {
    const originalSend = saas.outboxService.wechat.sendSubscribeMessage;
    saas.outboxService.wechat.sendSubscribeMessage = async () => { throw new Error('模拟发送失败'); };
    try {
      const failedSend = await api('/api/admin/subscriptions/orderPaid/test', {
        method: 'POST',
        token: ownerToken,
        body: { memberId }
      });
      assert(failedSend.status === 200, failedSend.text);
      deadNotificationId = failedSend.json.data.id;
      assert(failedSend.json.data.status === 'dead', '一次失败应进入死信');
    } finally {
      saas.outboxService.wechat.sendSubscribeMessage = originalSend;
    }
    const deadList = await api('/api/admin/outbox?status=dead', { token: ownerToken });
    assert(deadList.status === 200 && deadList.json.data.total === 1);
    const retried = await api('/api/admin/outbox/' + deadNotificationId + '/retry', {
      method: 'POST',
      token: ownerToken,
      body: {}
    });
    assert(retried.status === 200 && retried.json.data.status === 'queued');
    const run = await api('/api/admin/outbox/run', {
      method: 'POST',
      token: ownerToken,
      body: {}
    });
    assert(run.status === 200 && run.json.data.sent === 1, run.text);
    const after = await api('/api/admin/outbox?pageSize=10', { token: ownerToken });
    const item = after.json.data.list.find(entry => entry.id === deadNotificationId);
    assert(item && ['sent', 'mocked'].includes(item.status));
  });

  await test('审计段归档与内容完整性校验', async () => {
    const archived = await api('/api/admin/audit-archive/run', {
      method: 'POST',
      token: ownerToken,
      body: {}
    });
    assert(archived.status === 200 && archived.json.data.status === 'archived', archived.text);
    const state = await api('/api/admin/audit-archive', { token: ownerToken });
    assert(state.status === 200 && state.json.data.integrity.valid === true);
    assert(state.json.data.integrity.entries > 0);
  });

  await test('平台账单生成与状态维护', async () => {
    const created = await api('/api/platform/tenants/' + tenantId + '/invoices', {
      method: 'POST',
      token: platformToken,
      body: {}
    });
    assert(created.status === 200 && created.json.data.status === 'issued');
    const paid = await api('/api/platform/invoices/' + created.json.data.id, {
      method: 'PATCH',
      token: platformToken,
      body: { status: 'paid', note: '集成验收' }
    });
    assert(paid.status === 200 && paid.json.data.status === 'paid');
  });

  await test('暂停立即阻断登录与存量会话，恢复后可重新登录', async () => {
    const suspended = await api('/api/platform/tenants/' + tenantId, {
      method: 'PATCH',
      token: platformToken,
      body: { status: 'suspended' }
    });
    assert(suspended.status === 200);
    const blocked = await api('/api/admin/session', { token: ownerToken });
    assert(blocked.status === 403 && blocked.json.code === 'TENANT_UNAVAILABLE');
    await api('/api/platform/tenants/' + tenantId, {
      method: 'PATCH',
      token: platformToken,
      body: { status: 'active' }
    });
    const login = await api('/api/admin/login', {
      method: 'POST',
      tenant: tenantId,
      body: { username: 'store_owner', password: ownerPassword }
    });
    assert(login.status === 200);
    ownerToken = login.json.data.token;
  });

  await test('公开自助开通返回独立所有者会话', async () => {
    const signup = await api('/api/public/signup', {
      method: 'POST',
      body: {
        name: '自助测试社区店',
        slug: 'self-service-test',
        username: 'self_owner',
        password: 'SelfOwner123',
        planCode: 'starter'
      }
    });
    assert(signup.status === 200, signup.text);
    assert(signup.json.data.tenant.status === 'trialing');
    assert(signup.json.data.token);
  });

  await test('JSON 加密备份、恢复和素材校验', async () => {
    await saas.store.flush();
    const backup = await saas.backupService.create(path.join(root, 'json-backups'), {
      backend: 'json',
      dataDir: process.env.DATA_DIR,
      uploadDir: process.env.UPLOAD_DIR,
      encryptionKey: process.env.BACKUP_ENCRYPTION_KEY
    });
    const jsonTarget = path.join(root, 'json-restored');
    await fs.promises.mkdir(jsonTarget, { recursive: true });
    await fs.promises.writeFile(path.join(jsonTarget, 'staleOnly.json'), '[]');
    const restored = await saas.backupService.restore(backup.file, {
      targetDir: jsonTarget,
      force: true,
      uploadDir: path.join(root, 'json-restored-uploads'),
      encryptionKey: process.env.BACKUP_ENCRYPTION_KEY
    });
    assert(backup.encrypted === true && restored.collections > 0);
    assert(!fs.existsSync(path.join(jsonTarget, 'staleOnly.json')), '完整恢复应清除目标目录旧集合');
    const assetRelative = assetUrl.replace(/^\/uploads\//, '').split('/').join(path.sep);
    assert(fs.existsSync(path.join(root, 'json-restored-uploads', assetRelative)));
  });

  await test('SQLite 备份恢复与 integrity_check', async () => {
    const source = path.join(root, 'sqlite-source');
    const sqlite = new SqliteStore(source);
    await sqlite.initialize();
    await sqlite.insert('tenants', { id: 'sqlite-tenant', name: 'SQLite 灾备测试', status: 'active' });
    await sqlite.shutdown();
    const backup = await saas.backupService.create(path.join(root, 'sqlite-backups'), {
      backend: 'sqlite',
      dataDir: source,
      uploadDir: path.join(root, 'empty-uploads'),
      encryptionKey: process.env.BACKUP_ENCRYPTION_KEY
    });
    const target = path.join(root, 'sqlite-restored');
    const restored = await saas.backupService.restore(backup.file, {
      targetDir: target,
      uploadDir: path.join(root, 'sqlite-restored-uploads'),
      encryptionKey: process.env.BACKUP_ENCRYPTION_KEY
    });
    assert(restored.sqlite && fs.existsSync(restored.sqlite));
    const check = new SqliteStore(target);
    await check.initialize();
    const row = await check.findById('tenants', 'sqlite-tenant');
    assert(row && row.name === 'SQLite 灾备测试');
    await check.shutdown();

    const importTarget = new SqliteStore(path.join(root, 'sqlite-import-target'));
    await importTarget.initialize();
    await importTarget.insert('staleOnly', { id: 'stale-sqlite-doc' });
    await importTarget.importCollections({ tenants: [{ id: 'snapshot-only', name: '快照租户' }] });
    assert((await importTarget.find('staleOnly', () => true)).length === 0, 'SQLite 完整恢复应清除旧集合');
    assert(await importTarget.findById('tenants', 'snapshot-only'), 'SQLite 完整恢复应写入快照数据');
    await importTarget.shutdown();
  });

  await saas.shutdown();

  console.log('\n===== 企业验收结果 =====');
  console.log('通过: ' + passed + ' | 失败: ' + failed);
  process.exit(failed > 0 ? 1 : 0);
})().catch(async error => {
  console.error('[企业验收失败] ' + error.stack);
  process.exit(1);
});
