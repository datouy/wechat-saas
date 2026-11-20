/**
 * 优惠券系统
 * - 优惠券模板（满减券）
 * - 发放给会员（每人限领）
 * - 下单预留、支付核销、取消释放（防止同一张券被多个待支付订单重复使用）
 */

const { business } = require('../errors');
const { randomUUID: uuidv4 } = require('crypto');

class CouponManager {
  constructor(store, config) {
    this.store = store;
    this.config = config || { maxPerOrder: 1 };
  }

  createTemplate(tenantId, data) {
    const tpl = {
      id: uuidv4(),
      tenantId,
      name: String(data.name || '满减券').slice(0, 30),
      type: 'cash',
      threshold: Math.round(Number(data.threshold || 0) * 100),
      amount: Math.round(Number(data.amount) * 100),
      validDays: Number(data.validDays) || 30,
      limitPerMember: Number(data.limitPerMember) || 1,
      enabled: data.enabled !== false,
      createdAt: new Date().toISOString()
    };
    if (tpl.amount <= 0) throw business('优惠金额必须大于0');
    this.store.insert('couponTemplates', tpl);
    return tpl;
  }

  listTemplates(tenantId) {
    return this.store.find('couponTemplates', t => t.tenantId === tenantId);
  }

  getTemplate(id) {
    return this.store.findById('couponTemplates', id) || null;
  }

  claim(templateId, memberId) {
    const tpl = this.store.findById('couponTemplates', templateId);
    if (!tpl || !tpl.enabled) throw business('优惠券不存在或已停用');

    const claimed = this.store.count('coupons',
      c => c.templateId === templateId && c.memberId === memberId);
    if (claimed >= tpl.limitPerMember) throw business('已达领取上限');

    const now = new Date();
    const expireAt = new Date(now.getTime() + tpl.validDays * 86400000);
    const c = {
      id: uuidv4(),
      tenantId: tpl.tenantId,
      templateId,
      memberId,
      name: tpl.name,
      threshold: tpl.threshold,
      amount: tpl.amount,
      status: 'unused', // unused / reserved / used / expired
      expireAt: expireAt.toISOString(),
      reservedByOrderId: null,
      createdAt: now.toISOString(),
      usedAt: null
    };
    this.store.insert('coupons', c);
    return c;
  }

  listMine(memberId, status) {
    let list = this.store.find('coupons', c => c.memberId === memberId);
    const now = Date.now();
    for (const c of list) {
      if (c.status === 'unused' && new Date(c.expireAt).getTime() < now) {
        this.store.update('coupons', c.id, { status: 'expired' });
        c.status = 'expired';
      }
    }
    if (status) list = list.filter(c => c.status === status);
    return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  /** 校验并返回可用优惠券（仅未使用状态可用） */
  validate(couponId, memberId, orderAmount) {
    if (!couponId) return null;
    const c = this.store.findById('coupons', couponId);
    if (!c) throw business('优惠券不存在');
    if (c.memberId !== memberId) throw business('优惠券不属于当前会员');
    if (c.status !== 'unused') throw business('优惠券已使用或已被占用');
    if (new Date(c.expireAt).getTime() < Date.now()) throw business('优惠券已过期');
    if (orderAmount < c.threshold) throw business('订单金额未达到使用门槛');
    return c;
  }

  /** 下单时预留优惠券 */
  reserve(couponId, orderId) {
    const c = this.store.findById('coupons', couponId);
    if (!c) throw business('优惠券不存在');
    if (c.status !== 'unused') throw business('优惠券已使用或已被占用');
    return this.store.update('coupons', couponId, { status: 'reserved', reservedByOrderId: orderId, reservedAt: new Date().toISOString() });
  }

  /** 取消订单时释放预留 */
  release(couponId, orderId) {
    const c = this.store.findById('coupons', couponId);
    if (!c) return;
    if (c.status === 'reserved' && c.reservedByOrderId === orderId) {
      this.store.update('coupons', couponId, { status: 'unused', reservedByOrderId: null, reservedAt: null });
    }
  }

  /** 支付成功核销（允许 reserved -> used） */
  use(couponId) {
    const c = this.store.findById('coupons', couponId);
    if (!c) return;
    if (c.status === 'reserved' || c.status === 'unused') {
      this.store.update('coupons', couponId, { status: 'used', usedAt: new Date().toISOString(), reservedByOrderId: null });
    }
  }
}

module.exports = CouponManager;

