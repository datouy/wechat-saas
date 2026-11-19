/**
 * 自动化测试 - 核心业务全链路
 * 覆盖: 商品/下单/支付/发货/收货/积分/优惠券/库存回滚/团购/问卷/预约
 */
const path = require('path');
const fs = require('fs');
process.chdir(path.join(__dirname, '..'));

const JsonStore = require('../src/store/JsonStore');
const ProductManager = require('../src/core/ProductManager');
const MemberManager = require('../src/core/MemberManager');
const PointsManager = require('../src/core/PointsManager');
const CouponManager = require('../src/core/CouponManager');
const GroupBuyManager = require('../src/core/GroupBuyManager');
const OrderManager = require('../src/core/OrderManager');
const FormManager = require('../src/core/FormManager');
const AppointmentManager = require('../src/core/AppointmentManager');
const WechatService = require('../src/services/WechatService');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✅ ' + name); passed++; }
  catch (e) { console.log('  ❌ ' + name + ' -> ' + e.message); failed++; }
}
async function testAsync(name, fn) {
  try { await fn(); console.log('  ✅ ' + name); passed++; }
  catch (e) { console.log('  ❌ ' + name + ' -> ' + e.message); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || '断言失败'); }

(async () => {
  console.log('\n===== 邻里团 SaaS 自动化测试 =====\n');

  // 独立测试数据目录
  const testDir = path.join(__dirname, 'test-data-' + Date.now());
  fs.mkdirSync(testDir, { recursive: true });
  const store = new JsonStore(testDir);
  store.initialize();

  const wechat = new WechatService({ mock: true });
  const mm = new MemberManager(store, wechat);
  const pts = new PointsManager(store, { enabled: true, ratePerYuan: 1, maxPercentPerOrder: 50 });
  const cm = new CouponManager(store, { maxPerOrder: 1 });
  const pm = new ProductManager(store);
  const gbm = new GroupBuyManager(store, pm, { minParticipants: 2, autoCloseHours: 24 });
  const om = new OrderManager(store, {
    productManager: pm, pointsManager: pts, couponManager: cm,
    memberManager: mm, wechatService: wechat,
    config: { payTimeoutMinutes: 30, autoCompleteDays: 3, deliveryFee: 0 }
  });
  const fm = new FormManager(store);
  const am = new AppointmentManager(store);
  const tenant = 't-test';

  // 准备数据
  const cat = pm.createCategory(tenant, { name: '测试分类' });
  const prod = pm.create(tenant, { name: '测试苹果', categoryId: cat.id, price: 20, stock: 10, unit: '箱' });
  const member = await mm.loginByWechatCode('test-code-123', tenant);

  console.log('[1] 会员与积分');
  test('微信mock登录生成会员', () => assert(member.id && member.openid.startsWith('mock_')));
  test('新会员初始积分为0', () => assert(pts.getBalance(member.id) === 0));
  test('手动增加积分', () => { pts.change(member.id, 100, '测试赠送'); assert(pts.getBalance(member.id) === 100); });
  test('积分抵扣受余额限制', () => {
    const c = pts.calcDiscount(member.id, 20, 99999);
    assert(c.pointsUsed === 100, '余额100分时最多用100分，实际' + c.pointsUsed);
    assert(c.discount === 1, '抵扣应1元，实际' + c.discount);
  });
  test('积分抵扣受50%比例上限约束', () => {
    pts.change(member.id, 5000, '测试追加积分');
    const c = pts.calcDiscount(member.id, 20, 99999);
    assert(c.pointsUsed === 1000, '20元订单最多抵扣50%即1000分，实际' + c.pointsUsed);
    assert(c.discount === 10, '抵扣应10元，实际' + c.discount);
    pts.change(member.id, -5000, '测试回收积分'); // 恢复余额为100，供后续订单断言
  });

  console.log('[2] 优惠券');
  const tpl = cm.createTemplate(tenant, { name: '满30减5', threshold: 30, amount: 5, validDays: 30, limitPerMember: 1 });
  let coupon;
  test('领取优惠券', () => { coupon = cm.claim(tpl.id, member.id); assert(coupon.status === 'unused'); });
  test('重复领取被拒绝', () => {
    let thrown = false;
    try { cm.claim(tpl.id, member.id); } catch (e) { thrown = true; }
    assert(thrown, '应抛出已达上限');
  });

  console.log('[3] 订单全链路');
  let order;
  test('创建订单(积分+优惠券)', () => {
    order = om.create(tenant, member.id, [{ productId: prod.id, quantity: 2 }], {
      usePoints: 500, couponId: coupon.id
    });
    // 货款40元, 券满30减5 -> 35元, 余额仅100分 -> 抵扣1元 -> 实付34元
    assert(order.payAmount === 3400, '实付应为3400分(34元)，实际' + order.payAmount);
    assert(order.pointsUsed === 100, '仅能用余额100分，实际' + order.pointsUsed);
    assert(pm.get(prod.id).stock === 8, '库存应扣至8');
  });
  await testAsync('支付订单(mock)', async () => {
    const r = await om.pay(order.id, member.id);
    assert(r.success && r.mock);
    assert(om.get(order.id).status === 'paid');
  });
  test('支付后优惠券已核销', () => assert(store.findById('coupons', coupon.id).status === 'used'));
  test('支付后消费返积分', () => {
    // 初始100 - 抵扣100 + 消费34元返34分 = 34
    const bal = pts.getBalance(member.id);
    assert(bal === 34, '支付后积分应为34，实际' + bal);
  });
  test('商家发货', () => { om.deliver(order.id); assert(om.get(order.id).status === 'delivering'); });
  test('确认收货', () => { om.complete(order.id, member.id); assert(om.get(order.id).status === 'completed'); });
  test('会员消费统计更新', () => {
    const m = mm.get(member.id);
    assert(m.orderCount === 1 && m.totalSpent > 0);
  });

  console.log('[4] 库存回滚');
  test('取消订单回滚库存', () => {
    const p2 = pm.create(tenant, { name: '测试取消商品', price: 10, stock: 5 });
    const o2 = om.create(tenant, member.id, [{ productId: p2.id, quantity: 2 }]);
    assert(pm.get(p2.id).stock === 3);
    om.cancel(o2.id, member.id, '测试取消');
    assert(pm.get(p2.id).stock === 5, '取消后库存应回滚至5');
    assert(om.get(o2.id).status === 'cancelled');
  });
  test('库存不足拒绝下单', () => {
    let thrown = false;
    try { om.create(tenant, member.id, [{ productId: prod.id, quantity: 999 }]); }
    catch (e) { thrown = true; }
    assert(thrown, '应抛出库存不足');
  });

  console.log('[5] 团购');
  const gb = gbm.create(tenant, { productId: prod.id, groupPrice: 15, minParticipants: 2 });
  test('创建团购活动', () => assert(gb.status === 'active' && gb.groupPrice === 1500));
  test('团长参团', () => {
    const g = gbm.join(gb.id, member.id);
    assert(g.participantCount === 1 && g.remaining === 1);
  });
  await testAsync('第二人参团成团', async () => {
    const m2 = await mm.loginByWechatCode('test-code-456', tenant);
    const g = gbm.join(gb.id, m2.id);
    assert(g.status === 'success');
  });
  test('团购价下单', () => {
    const o = om.create(tenant, member.id, [{ productId: prod.id, quantity: 1 }], { groupBuyId: gb.id });
    assert(o.items[0].unitPrice === 1500, '应按团购价15元');
    om.cancel(o.id, member.id, '测试清理');
  });

  console.log('[6] 问卷');
  const form = fm.create(tenant, {
    title: '测试问卷',
    fields: [
      { label: '满意度', type: 'rating', required: true },
      { label: '选项', type: 'radio', options: ['A', 'B'], required: true }
    ]
  });
  test('提交问卷', () => { fm.submit(form.id, member.id, { f1: 5, f2: 'A' }); });
  test('重复提交被拒绝', () => {
    let thrown = false;
    try { fm.submit(form.id, member.id, { f1: 4, f2: 'B' }); } catch (e) { thrown = true; }
    assert(thrown);
  });
  test('问卷统计', () => {
    const s = fm.stats(form.id);
    assert(s.total === 1);
    const rating = s.fields[0];
    assert(rating.average === 5);
  });
  test('必填校验', () => {
    let thrown = false;
    try { fm.submit(form.id, 'other-member', { f2: 'A' }); } catch (e) { thrown = true; }
    assert(thrown, '缺必填项应报错');
  });

  console.log('[7] 预约');
  const svc = am.createService(tenant, { name: '测试保洁', price: 100, capacityPerSlot: 1, slots: ['09:00', '10:00'] });
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  test('预约成功', () => {
    const a = am.book(svc.id, member.id, tomorrow, '09:00');
    assert(a.status === 'booked');
  });
  test('重复预约被拒绝', () => {
    let thrown = false;
    try { am.book(svc.id, member.id, tomorrow, '09:00'); } catch (e) { thrown = true; }
    assert(thrown);
  });
  await testAsync('时段容量限制', async () => {
    const m3 = await mm.loginByWechatCode('test-code-789', tenant);
    let thrown = false;
    try { am.book(svc.id, m3.id, tomorrow, '09:00'); } catch (e) { thrown = true; }
    assert(thrown, '容量1的时段已被占用，第二人预约应失败');
  });
  test('取消预约释放时段', () => {
    const list = am.listByMember(member.id);
    am.cancel(list[0].id, member.id);
    const slots = am.querySlots(svc.id, tomorrow);
    assert(slots.find(s => s.slot === '09:00').available === 1);
  });

  // 清理测试数据
  fs.rmSync(testDir, { recursive: true, force: true });

  console.log('\n===== 测试结果 =====');
  console.log('通过: ' + passed + ' | 失败: ' + failed);
  process.exit(failed > 0 ? 1 : 0);
})();
