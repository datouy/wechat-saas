/**
 * HTTP 鉴权集成测试（不依赖微信开发者工具）
 * 验证：会员/管理员令牌、未登录拦截、越权访问拦截
 */
const path = require('path');
const os = require('os');
const fs = require('fs');

process.env.NODE_ENV = 'development';
process.env.AUTH_SECRET = 'integration-test-secret';
process.env.DATA_DIR = path.join(os.tmpdir(), 'wechat-saas-http-' + Date.now());

const WechatSaas = require('../src/index');

let passed = 0, failed = 0;
function assert(cond, msg) { if (!cond) throw new Error(msg || '断言失败'); }
function check(name, fn) { try { fn(); console.log('  ✅ ' + name); passed++; } catch (e) { console.log('  ❌ ' + name + ' -> ' + e.message); failed++; } }

(async () => {
  const saas = new WechatSaas();
  await saas.initialize();
  await new Promise((resolve) => { saas.server = saas.app.listen(0, '127.0.0.1', resolve); });
  const base = 'http://127.0.0.1:' + saas.server.address().port;

  async function req(p, opts) {
    opts = opts || {};
    const headers = { 'Content-Type': 'application/json' };
    if (opts.token) headers['Authorization'] = 'Bearer ' + opts.token;
    const res = await fetch(base + p, {
      method: opts.method || 'GET',
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    let json = null;
    try { json = await res.json(); } catch (e) {}
    return { status: res.status, json };
  }

  console.log('\n[1] 会员鉴权');
  const m1 = (await req('/api/wx/login', { method: 'POST', body: { code: 'member-1' } }));
  const m2 = (await req('/api/wx/login', { method: 'POST', body: { code: 'member-2' } }));
  const m1Id = m1.json.data.memberId, t1 = m1.json.data.token;
  const m2Id = m2.json.data.memberId, t2 = m2.json.data.token;

  check('登录返回会员令牌', () => assert(t1 && m1Id));

  check('未登录访问会员资料返回401', async () => {
    const r = await req('/api/wx/member/' + m1Id);
    assert(r.status === 401, '期望401，实际' + r.status);
  });

  check('携带令牌访问自己的资料成功', async () => {
    const r = await req('/api/wx/member/' + m1Id, { token: t1 });
    assert(r.status === 200 && r.json.success, '期望200');
  });

  check('会员B不能访问会员A的资料', async () => {
    const r = await req('/api/wx/member/' + m1Id, { token: t2 });
    assert(r.status === 401, '期望401，实际' + r.status);
  });

  console.log('\n[2] 订单越权');
  const home = await req('/api/wx/home');
  const product = home.json.data.products[0];
  const created = await req('/api/wx/orders', { method: 'POST', token: t1, body: { items: [{ productId: product.id, quantity: 1 }] } });
  check('会员可创建订单', () => assert(created.status === 200 && created.json.data.id));

  const orderId = created.json.data.id;
  check('会员可查看自己的订单', async () => {
    const r = await req('/api/wx/orders/' + orderId, { token: t1 });
    assert(r.status === 200, '期望200');
  });
  check('会员B不能查看会员A的订单', async () => {
    const r = await req('/api/wx/orders/' + orderId, { token: t2 });
    assert(r.status === 400 && !r.json.success, '期望400拒绝');
  });

  console.log('\n[3] 管理员鉴权');
  check('未登录访问管理接口返回401', async () => {
    const r = await req('/api/admin/stats');
    assert(r.status === 401, '期望401，实际' + r.status);
  });
  check('管理员错误密码返回401', async () => {
    const r = await req('/api/admin/login', { method: 'POST', body: { username: 'admin', password: 'wrong' } });
    assert(r.status === 401, '期望401，实际' + r.status);
  });
  const adminLogin = await req('/api/admin/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
  check('管理员正确登录返回令牌', () => assert(adminLogin.status === 200 && adminLogin.json.data.token));
  const at = adminLogin.json.data.token;
  check('携带管理员令牌访问看板成功', async () => {
    const r = await req('/api/admin/stats', { token: at });
    assert(r.status === 200 && r.json.success, '期望200');
  });
  check('管理员令牌不能访问会员接口', async () => {
    const r = await req('/api/wx/member/' + m1Id, { token: at });
    assert(r.status === 401, '期望401');
  });

  await saas.shutdown();
  try { fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); } catch (e) {}

  console.log('\n===== HTTP 鉴权测试结果 =====');
  console.log('通过: ' + passed + ' | 失败: ' + failed);
  process.exit(failed > 0 ? 1 : 0);
})();

