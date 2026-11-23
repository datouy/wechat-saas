/**
 * HTTP 参数校验 + 分页 + 错误契约集成测试
 */
const path = require('path');
const os = require('os');

process.env.NODE_ENV = 'development';
process.env.AUTH_SECRET = 'integration-test-secret';
process.env.DATA_DIR = path.join(os.tmpdir(), 'wechat-saas-val-' + Date.now());

const WechatSaas = require('../src/index');

let passed = 0, failed = 0;
function assert(cond, msg) { if (!cond) throw new Error(msg || '断言失败'); }
async function check(name, fn) { try { await fn(); console.log('  ✅ ' + name); passed++; } catch (e) { console.log('  ❌ ' + name + ' -> ' + e.message); failed++; } }

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
    let json = null; try { json = await res.json(); } catch (e) {}
    return { status: res.status, json, headers: res.headers };
  }

  const login = await req('/api/admin/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
  const at = login.json.data.token;
  assert(at, '管理员登录失败');

  console.log('\n[1] 参数校验');
  await check('负库存商品被拒绝', async () => {
    const r = await req('/api/admin/products', { method: 'POST', token: at, body: { name: 'x', price: 1, stock: -5 } });
    assert(r.status === 400, '期望400，实际' + r.status);
    assert(r.json.code, '应返回错误码');
  });
  await check('负价格商品被拒绝', async () => {
    const r = await req('/api/admin/products', { method: 'POST', token: at, body: { name: 'x', price: -1 } });
    assert(r.status === 400, '期望400，实际' + r.status);
  });
  await check('缺名称商品被拒绝', async () => {
    const r = await req('/api/admin/products', { method: 'POST', token: at, body: { price: 1 } });
    assert(r.status === 400 && r.json.code === 'VALIDATION', '期望400 VALIDATION');
  });
  await check('负金额优惠券被拒绝', async () => {
    const r = await req('/api/admin/coupons', { method: 'POST', token: at, body: { name: '券', amount: -1 } });
    assert(r.status === 400, '期望400');
  });
  await check('非法日期预约被拒绝', async () => {
    const r = await req('/api/wx/appointments', { method: 'POST', token: at, body: { serviceId: 'x', date: '2026/01/01', slot: '09:00' } });
    assert(r.status !== 200, '应被拒绝');
  });
  await check('错误响应包含 requestId', async () => {
    const r = await req('/api/admin/products', { method: 'POST', token: at, body: { price: 1 } });
    assert(r.json.requestId, '应返回 requestId');
  });

  console.log('\n[2] 分页');
  await check('商品列表返回分页结构', async () => {
    const r = await req('/api/admin/products?page=1&pageSize=2', { token: at });
    assert(r.status === 200 && Array.isArray(r.json.data.list), '应返回 list');
    assert(typeof r.json.data.total === 'number', '应返回 total');
    assert(r.json.data.page === 1 && r.json.data.pageSize === 2, '分页参数应回显');
  });
  await check('订单列表返回分页结构', async () => {
    const r = await req('/api/admin/orders?page=1&pageSize=10', { token: at });
    assert(r.status === 200 && Array.isArray(r.json.data.list) && typeof r.json.data.total === 'number', '应返回分页结构');
  });
  await check('会员列表返回分页结构', async () => {
    const r = await req('/api/admin/members?page=1&pageSize=10', { token: at });
    assert(r.status === 200 && Array.isArray(r.json.data.list), '应返回 list');
  });

  console.log('\n[2.5] 审计日志');
  await check('审计日志记录管理操作', async () => {
    const r = await req('/api/admin/audit-logs?page=1&pageSize=50', { token: at });
    assert(r.status === 200 && Array.isArray(r.json.data.list), '应返回 list');
    assert(r.json.data.list.some(x => x.action === 'admin.login'), '应包含登录审计');
  });

  console.log('\n[3] 安全响应头');
  await check('响应包含 X-Request-Id 与安全头', async () => {
    const r = await req('/api/admin/stats', { token: at });
    assert(r.headers.get('x-request-id'), '应包含 X-Request-Id');
    assert(r.headers.get('x-content-type-options') === 'nosniff', '应包含 nosniff');
  });

  await saas.shutdown();
  console.log('\n===== 校验/分页测试结果 =====');
  console.log('通过: ' + passed + ' | 失败: ' + failed);
  process.exit(failed ? 1 : 0);
})();
