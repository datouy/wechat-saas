/**
 * 核心业务回归测试：所有 Store 与业务服务均按异步接口调用。
 * DATA_STORE=sqlite 时复用同一套用例，验证 JSON 与 SQLite 行为一致。
 */
const path = require('path');
const fs = require('fs');
process.chdir(path.join(__dirname, '..'));

const JsonStore = require('../src/store/JsonStore');
const SqliteStore = require('../src/store/SqliteStore');
const ProductManager = require('../src/core/ProductManager');
const MemberManager = require('../src/core/MemberManager');
const PointsManager = require('../src/core/PointsManager');
const CouponManager = require('../src/core/CouponManager');
const GroupBuyManager = require('../src/core/GroupBuyManager');
const OrderManager = require('../src/core/OrderManager');
const FormManager = require('../src/core/FormManager');
const AppointmentManager = require('../src/core/AppointmentManager');
const WechatService = require('../src/services/WechatService');

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

async function expectReject(fn, message) {
  let rejected = false;
  try {
    await fn();
  } catch (error) {
    rejected = true;
  }
  assert(rejected, message || '应拒绝此操作');
}

(async () => {
  console.log('\n===== 邻里团 SaaS 自动化测试 =====\n');

  const testDir = path.join(__dirname, 'test-data-' + Date.now());
  fs.mkdirSync(testDir, { recursive: true });
  const Store = process.env.DATA_STORE === 'sqlite' ? SqliteStore : JsonStore;
  const store = new Store(testDir);
  await store.initialize();

  const wechat = new WechatService({ mock: true });
  const mm = new MemberManager(store, wechat);
  const pts = new PointsManager(store, { enabled: true, ratePerYuan: 1, maxPercentPerOrder: 50 });
  const cm = new CouponManager(store, { maxPerOrder: 1 });
  const pm = new ProductManager(store);
  const gbm = new GroupBuyManager(store, pm, { minParticipants: 2, autoCloseHours: 24 });
  const om = new OrderManager(store, {
    productManager: pm,
    pointsManager: pts,
    couponManager: cm,
    memberManager: mm,
    wechatService: wechat,
    config: { payTimeoutMinutes: 30, autoCompleteDays: 3, deliveryFee: 0 }
  });
  const fm = new FormManager(store);
  const am = new AppointmentManager(store);
  const tenant = 't-test';

  const category = await pm.createCategory(tenant, { name: '测试分类' });
  const product = await pm.create(tenant, {
    name: '测试苹果', categoryId: category.id, price: 20, stock: 10, unit: '箱'
  });
  const member = await mm.loginByWechatCode('test-code-123', tenant);

  console.log('[1] 会员与积分');
  await test('微信 mock 登录生成会员', () => assert(member.id && member.openid.startsWith('mock_')));
  await test('新会员初始积分为 0', async () => assert(await pts.getBalance(member.id) === 0));
  await test('手动增加积分', async () => {
    await pts.change(member.id, 100, '测试赠送');
    assert(await pts.getBalance(member.id) === 100);
  });
  await test('积分抵扣受余额限制', async () => {
    const discount = await pts.calcDiscount(member.id, 20, 99999);
    assert(discount.pointsUsed === 100, '余额 100 分时最多使用 100 分');
    assert(discount.discount === 1, '抵扣应为 1 元');
  });
  await test('积分抵扣受 50% 比例上限约束', async () => {
    await pts.change(member.id, 5000, '测试追加积分');
    const discount = await pts.calcDiscount(member.id, 20, 99999);
    assert(discount.pointsUsed === 1000, '20 元订单最多抵扣 50%');
    assert(discount.discount === 10, '抵扣应为 10 元');
    await pts.change(member.id, -5000, '测试回收积分');
  });

  console.log('[2] 优惠券');
  const template = await cm.createTemplate(tenant, {
    name: '满 30 减 5', threshold: 30, amount: 5, validDays: 30, limitPerMember: 1
  });
  let coupon;
  await test('领取优惠券', async () => {
    coupon = await cm.claim(template.id, member.id);
    assert(coupon.status === 'unused');
  });
  await test('重复领取被拒绝', () => expectReject(() => cm.claim(template.id, member.id)));

  console.log('[3] 订单全链路');
  let order;
  await test('创建订单并核销积分与优惠券', async () => {
    order = await om.create(tenant, member.id, [{ productId: product.id, quantity: 2 }], {
      usePoints: 500,
      couponId: coupon.id
    });
    assert(order.payAmount === 3400, '实付应为 3400 分，实际 ' + order.payAmount);
    assert(order.pointsUsed === 100, '仅能使用余额 100 分');
    assert((await pm.get(product.id)).stock === 8, '库存应扣至 8');
  });
  await test('模拟支付订单', async () => {
    const result = await om.pay(order.id, member.id);
    assert(result.success && result.mock);
    assert((await om.get(order.id)).status === 'paid');
  });
  await test('支付后优惠券已核销', async () => {
    assert((await store.findById('coupons', coupon.id)).status === 'used');
  });
  await test('支付后消费返积分', async () => {
    assert(await pts.getBalance(member.id) === 34, '支付后积分应为 34');
  });
  await test('商家发货', async () => {
    await om.deliver(order.id);
    assert((await om.get(order.id)).status === 'delivering');
  });
  await test('确认收货', async () => {
    await om.complete(order.id, member.id);
    assert((await om.get(order.id)).status === 'completed');
  });
  await test('会员消费统计更新', async () => {
    const current = await mm.get(member.id);
    assert(current.orderCount === 1 && current.totalSpent > 0);
  });

  console.log('[4] 库存回滚与退款');
  await test('取消订单回滚库存', async () => {
    const secondProduct = await pm.create(tenant, { name: '测试取消商品', price: 10, stock: 5 });
    const pending = await om.create(tenant, member.id, [{ productId: secondProduct.id, quantity: 2 }]);
    assert((await pm.get(secondProduct.id)).stock === 3);
    await om.cancel(pending.id, member.id, '测试取消');
    assert((await pm.get(secondProduct.id)).stock === 5, '取消后库存应回滚至 5');
    assert((await om.get(pending.id)).status === 'cancelled');
  });
  await test('库存不足拒绝下单', () => expectReject(
    () => om.create(tenant, member.id, [{ productId: product.id, quantity: 999 }]),
    '应抛出库存不足'
  ));

  let partialOrder;
  await test('部分退款保留订单并累计退款金额', async () => {
    const refundProduct = await pm.create(tenant, { name: '部分退款商品', price: 10, stock: 10 });
    partialOrder = await om.create(tenant, member.id, [{ productId: refundProduct.id, quantity: 1 }]);
    await om.pay(partialOrder.id, member.id);
    const result = await om.refund(partialOrder.id, '部分退款', 400);
    assert(result.success && result.mock);
    const current = await om.get(partialOrder.id);
    assert(current.refundedAmount === 400 && current.status === 'paid');
  });
  await test('超额退款被拒绝', () => expectReject(() => om.refund(partialOrder.id, '超额', 99999)));
  await test('剩余全额退款后结单', async () => {
    await om.refund(partialOrder.id, '尾款');
    const current = await om.get(partialOrder.id);
    assert(current.refundedAmount === current.payAmount && current.status === 'refunded');
  });
  await test('发货记录物流', async () => {
    const logisticsProduct = await pm.create(tenant, { name: '物流商品', price: 10, stock: 10 });
    const logisticsOrder = await om.create(tenant, member.id, [{ productId: logisticsProduct.id, quantity: 1 }]);
    await om.pay(logisticsOrder.id, member.id);
    await om.deliver(logisticsOrder.id, { company: '顺丰', trackingNo: 'SF1234567890' });
    const current = await om.get(logisticsOrder.id);
    assert(current.status === 'delivering');
    assert(current.logistics && current.logistics.company === '顺丰');
  });

  console.log('[5] 团购');
  const groupBuy = await gbm.create(tenant, { productId: product.id, groupPrice: 15, minParticipants: 2 });
  await test('创建团购活动', () => assert(groupBuy.status === 'active' && groupBuy.groupPrice === 1500));
  await test('团长参团', async () => {
    const joined = await gbm.join(groupBuy.id, member.id);
    assert(joined.participantCount === 1 && joined.remaining === 1);
  });
  await test('未成团不可使用团购价下单', () => expectReject(
    () => om.create(tenant, member.id, [{ productId: product.id, quantity: 1 }], { groupBuyId: groupBuy.id })
  ));
  await test('第二人参团成团', async () => {
    const secondMember = await mm.loginByWechatCode('test-code-456', tenant);
    const joined = await gbm.join(groupBuy.id, secondMember.id);
    assert(joined.status === 'success');
  });
  await test('团购价下单', async () => {
    const grouped = await om.create(tenant, member.id, [{ productId: product.id, quantity: 1 }], { groupBuyId: groupBuy.id });
    assert(grouped.items[0].unitPrice === 1500);
    await om.cancel(grouped.id, member.id, '测试清理');
  });

  console.log('[6] 问卷');
  const form = await fm.create(tenant, {
    title: '测试问卷',
    fields: [
      { label: '满意度', type: 'rating', required: true },
      { label: '选项', type: 'radio', options: ['A', 'B'], required: true }
    ]
  });
  await test('提交问卷', async () => {
    const submission = await fm.submit(form.id, member.id, { f1: 5, f2: 'A' });
    assert(submission.id);
  });
  await test('重复提交被拒绝', () => expectReject(() => fm.submit(form.id, member.id, { f1: 4, f2: 'B' })));
  await test('问卷统计', async () => {
    const stats = await fm.stats(form.id);
    assert(stats.total === 1 && stats.fields[0].average === 5);
  });
  await test('必填校验', () => expectReject(() => fm.submit(form.id, 'other-member', { f2: 'A' })));

  console.log('[7] 预约');
  const service = await am.createService(tenant, {
    name: '测试保洁', price: 100, capacityPerSlot: 1, slots: ['09:00', '10:00']
  });
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  await test('预约成功', async () => {
    const appointment = await am.book(service.id, member.id, tomorrow, '09:00');
    assert(appointment.status === 'booked');
  });
  await test('重复预约被拒绝', () => expectReject(() => am.book(service.id, member.id, tomorrow, '09:00')));
  await test('时段容量限制', async () => {
    const thirdMember = await mm.loginByWechatCode('test-code-789', tenant);
    await expectReject(() => am.book(service.id, thirdMember.id, tomorrow, '09:00'));
  });
  await test('取消预约释放时段', async () => {
    const list = await am.listByMember(member.id);
    await am.cancel(list[0].id, member.id);
    const slots = await am.querySlots(service.id, tomorrow);
    assert(slots.find(item => item.slot === '09:00').available === 1);
  });

  await store.shutdown();
  fs.rmSync(testDir, { recursive: true, force: true });

  console.log('\n===== 测试结果 =====');
  console.log('通过: ' + passed + ' | 失败: ' + failed);
  process.exit(failed > 0 ? 1 : 0);
})().catch(error => {
  console.error('[测试初始化失败] ' + error.stack);
  process.exit(1);
});
