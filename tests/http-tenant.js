/**
 * HTTP 租户隔离集成测试
 * 验证：未知租户被拒绝、公开目录按 X-Tenant-Id 校验租户、登录不再信任 body 自报 tenantId
 */
const path = require('path');
const os = require('os');
const fs = require('fs');

process.env.NODE_ENV = 'development';
process.env.AUTH_SECRET = 'integration-test-secret';
process.env.DATA_DIR = path.join(os.tmpdir(), 'wechat-saas-tenant-' + Date.now());

const WechatSaas = require('../src/index');

let passed = 0, failed = 0;
function assert(cond, msg) { if (!cond) throw new Error(msg || '断言失败'); }
async function check(name, fn) { try { await fn(); console.log('  ✅ ' + name); passed++; } catch (e) { console.log('  ❌ ' + name + ' -> ' + e.message); failed++; } }

(async () => {
  const saas = new WechatSaas();
  await saas.initialize();

  // 直接构造第二个合法租户与跨租户商品
  await saas.store.insert('tenants', { id: 't-other', name: '其他商户', status: 'active', createdAt: new Date().toISOString() });
  const pDefault = await saas.productManager.create('t-default', { name: '默认租户商品', price: 1 });
  const pOther = await saas.productManager.create('t-other', { name: '其他租户商品', price: 2 });

  await new Promise((resolve) => { saas.server = saas.app.listen(0, '127.0.0.1', resolve); });
  const base = 'http://127.0.0.1:' + saas.server.address().port;

  async function req(p, opts) {
    opts = opts || {};
    const headers = { 'Content-Type': 'application/json' };
    if (opts.token) headers['Authorization'] = 'Bearer ' + opts.token;
    if (opts.tenant) headers['X-Tenant-Id'] = opts.tenant;
    const res = await fetch(base + p, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
    let json = null; try { json = await res.json(); } catch (e) {}
    return { status: res.status, json };
  }

  console.log('\n[1] 未知租户拒绝');
  await check('未知租户访问首页被拒绝', async () => {
    const r = await req('/api/wx/home', { tenant: 'evil-tenant' });
    assert(r.status === 400 && r.json.code === 'BAD_REQUEST', '期望400 BAD_REQUEST，实际' + r.status);
  });
  await check('未知租户访问商品被拒绝', async () => {
    const r = await req('/api/wx/products/' + pDefault.id, { tenant: 'evil-tenant' });
    assert(r.status === 400, '期望400，实际' + r.status);
  });

  console.log('\n[2] 公开目录按租户隔离');
  await check('跨租户访问商品被拒绝', async () => {
    const r = await req('/api/wx/products/' + pDefault.id, { tenant: 't-other' });
    assert(r.status === 400, '期望400拒绝，实际' + r.status);
  });
  await check('跨租户访问团购/表单不存在则拒绝', async () => {
    const r = await req('/api/wx/forms/nonexistent', { tenant: 't-other' });
    assert(r.status === 400, '期望400，实际' + r.status);
  });
  await check('正确租户可访问自己的商品', async () => {
    const r = await req('/api/wx/products/' + pOther.id, { tenant: 't-other' });
    assert(r.status === 200 && r.json.data.id === pOther.id, '期望200');
  });

  console.log('\n[3] 登录不再信任 body 自报 tenantId');
  await check('body 传任意 tenantId 被忽略，落入默认租户', async () => {
    const r = await req('/api/wx/login', { method: 'POST', body: { code: 'tenant-test-user', tenantId: 'evil-tenant' } });
    assert(r.status === 200 && r.json.data.token, '期望200且返回令牌');
    // 令牌签发给默认租户
    const m = (await saas.store.find('members', x => x.openid === r.json.data.memberId || x.id === r.json.data.memberId))[0];
    assert(m && m.tenantId === 't-default', '会员应落在默认租户，实际' + (m && m.tenantId));
  });

  await saas.shutdown();
  try { fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); } catch (e) {}

  console.log('\n===== 租户隔离测试结果 =====');
  console.log('通过: ' + passed + ' | 失败: ' + failed);
  process.exit(failed > 0 ? 1 : 0);
})();
