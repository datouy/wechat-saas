/**
 * 对账服务单元测试
 * 覆盖：账单 CSV 解析（BOM/CRLF/汇总行/金额元→分）、mock 下载、对账差异识别（金额不符/本地缺失/漏单/退款差异）、一致时 balanced=true
 */
const path = require('path');
const fs = require('fs');
process.chdir(path.join(__dirname, '..'));

const JsonStore = require('../src/store/JsonStore');
const OrderManager = require('../src/core/OrderManager');
const WechatService = require('../src/services/WechatService');
const ReconciliationService = require('../src/core/ReconciliationService');

let passed = 0, failed = 0;
function assert(cond, msg) { if (!cond) throw new Error(msg || '断言失败'); }
function test(name, fn) { try { fn(); console.log('  ✅ ' + name); passed++; } catch (e) { console.log('  ❌ ' + name + ' -> ' + e.message); failed++; } }
async function testAsync(name, fn) { try { await fn(); console.log('  ✅ ' + name); passed++; } catch (e) { console.log('  ❌ ' + name + ' -> ' + e.message); failed++; } }

const DATE = '2026-01-01';

// 按 27 列表头构造一条账单明细行（微信支付 v3 交易对账单）
function billRow({ orderNo, txId = '', state = 'SUCCESS', amount = '0.00', refund = '0.00', refundState = '' }) {
  return [
    DATE + ' 10:00:00', 'wx-test-appid', '1900000001', '', '', txId, orderNo, 'mock_openid',
    'JSAPI', state, 'BANK', 'CNY', amount, '0.00', '', '', refund, '0.00', '', refundState,
    '商品', '', '0.00', '0.60%', amount, '0.00', ''
  ];
}
function makeBill(rows) {
  return [ReconciliationService.BILL_HEADER]
    .concat(rows.map(r => r.join(',')))
    .concat(['总交易单数,总交易额,总退款金额,总企业红包金额,总手续费金额'])
    .join('\n');
}
function newStore() {
  const dir = path.join(__dirname, 'test-data-' + Date.now() + '-' + Math.floor(Math.random() * 10000));
  fs.mkdirSync(dir, { recursive: true });
  const store = new JsonStore(dir);
  store.initialize();
  return store;
}

(async () => {
  console.log('\n===== 对账服务测试 =====\n');

  const wechat = new WechatService({ mock: true });
  const store = newStore();
  const om = new OrderManager(store, { productManager: null, pointsManager: null, couponManager: null, memberManager: null, wechatService: wechat, config: { deliveryFee: 0 } });
  const recon = new ReconciliationService(store, om, wechat);

  // 本地订单
  store.insert('orders', { orderNo: 'NT-A', payAmount: 100, paidAt: DATE + 'T00:00:00.000Z', refundedAmount: 0, status: 'paid' });
  store.insert('orders', { orderNo: 'NT-B', payAmount: 150, paidAt: DATE + 'T00:00:00.000Z', refundedAmount: 0, status: 'paid' });
  store.insert('orders', { orderNo: 'NT-C', payAmount: 100, paidAt: '2025-12-31T00:00:00.000Z', refundedAmount: 50, status: 'refunded' });
  store.insert('orders', { orderNo: 'NT-D', payAmount: 300, paidAt: DATE + 'T00:00:00.000Z', refundedAmount: 0, status: 'paid' });
  store.insert('orders', { orderNo: 'NT-E', payAmount: 100, paidAt: '2025-12-31T00:00:00.000Z', refundedAmount: 0, status: 'paid' });

  // 账单：NT-A 匹配；NT-B 金额不符；NT-X 本地缺失；NT-C 退款50；NT-E 退款70(本地0)
  const bill = makeBill([
    billRow({ orderNo: 'NT-A', txId: 'WX-001', amount: '1.00' }),
    billRow({ orderNo: 'NT-B', txId: 'WX-002', amount: '2.00' }),
    billRow({ orderNo: 'NT-X', txId: 'WX-003', amount: '5.00' }),
    billRow({ orderNo: 'NT-C', state: 'REFUND', amount: '0.00', refund: '0.50', refundState: 'SUCCESS' }),
    billRow({ orderNo: 'NT-E', state: 'REFUND', amount: '0.00', refund: '0.70', refundState: 'SUCCESS' })
  ]);

  await testAsync('mock 下载对账单返回可解析 CSV', async () => {
    const csv = await wechat.downloadTradeBill(DATE);
    const rows = recon.parseBill(csv);
    assert(rows.length === 1 && rows[0].orderNo === 'NT20260101000001', 'mock 对账单应含1笔 NT20260101000001');
  });

  test('解析对账单列与金额换算', () => {
    const rows = recon.parseBill(bill);
    assert(rows.length === 5, '应解析出5行，实际' + rows.length);
    const a = rows.find(r => r.orderNo === 'NT-A');
    assert(a.amount === 100 && a.tradeState === 'SUCCESS', 'NT-A 金额应为100分且交易成功');
    const c = rows.find(r => r.orderNo === 'NT-C');
    assert(c.refundAmount === 50, 'NT-C 退款应为50分');
  });

  await testAsync('对账识别金额不符/本地缺失/漏单/退款差异', async () => {
    const r = await recon.reconcile(DATE, bill);
    assert(r.summary.matchedPayments === 1, '应1笔匹配，实际' + r.summary.matchedPayments);
    assert(r.summary.amountMismatch === 1, '应1笔金额不符');
    assert(r.summary.missingInLocal === 1, '应1笔本地缺失(NT-X)');
    assert(r.summary.missingInBill === 1, '应1笔本地有单账单无(NT-D)');
    assert(r.summary.refundMismatch === 1, '应1笔退款差异(NT-E)');
    assert(r.balanced === false, '存在差异时 balanced 应为 false');
    assert(r.amountMismatch[0].orderNo === 'NT-B', '金额不符应为 NT-B');
    assert(r.missingInLocal[0].orderNo === 'NT-X', '本地缺失应为 NT-X');
    assert(r.missingInBill[0].orderNo === 'NT-D', '漏单应为 NT-D');
    assert(r.refundMismatch[0].orderNo === 'NT-E', '退款差异应为 NT-E');
  });

  await testAsync('对账一致时 balanced=true', async () => {
    const s2 = newStore();
    const om2 = new OrderManager(s2, { productManager: null, pointsManager: null, couponManager: null, memberManager: null, wechatService: wechat, config: { deliveryFee: 0 } });
    const recon2 = new ReconciliationService(s2, om2, wechat);
    s2.insert('orders', { orderNo: 'NT-Z', payAmount: 900, paidAt: DATE + 'T00:00:00.000Z', refundedAmount: 0, status: 'paid' });
    const bill2 = makeBill([billRow({ orderNo: 'NT-Z', txId: 'WX-Z', amount: '9.00' })]);
    const r = await recon2.reconcile(DATE, bill2);
    assert(r.balanced === true, '应平衡');
    assert(r.summary.matchedPayments === 1, '应1笔匹配');
    s2.shutdown();
    fs.rmSync(s2.dataDir, { recursive: true, force: true });
  });

  store.shutdown();
  fs.rmSync(store.dataDir, { recursive: true, force: true });

  console.log('\n===== 结果 =====');
  console.log('通过: ' + passed + ' | 失败: ' + failed);
  process.exit(failed > 0 ? 1 : 0);
})();