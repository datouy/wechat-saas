/**
 * 优惠券系统
 * - 优惠券模板（满减券）
 * - 发放给会员（每人限领）
 * - 下单核销（单笔限用1张，可配置）
 */
const { v4: uuidv4 } = require('uuid');

class CouponManager {
  constructor(store, config) {
    this.store = store;
    this.config = config || { maxPerOrder: 1 };
  }

  /** 创建优惠券模板 */
  createTemplate(tenantId, data) {
    const tpl = {
      id: uuidv4(),
      tenantId,
      name: String(data.name || '满减券').slice(0, 30),
      type: 'cash', // 目前支持满减
      threshold: Number(data.threshold) || 0,   // 满X元可用
      amount: Number(data.amount) || 5,          // 减Y元
      validDays: Number(data.validDays) || 30,
      limitPerMember: Number(data.limitPerMember) || 1,
      enabled: data.enabled !== false,
      createdAt: new Date().toISOString()
    };
    if (tpl.amount <= 0) throw new Error('优惠金额必须大于0');
    this.store.insert('couponTemplates', tpl);
    return tpl;
  }

  listTemplates(tenantId) {
    return this.store.find('couponTemplates', t => t.tenantId === tenantId);
  }

  /** 领取优惠券 */
  claim(templateId, memberId) {
    const tpl = this.store.findById('couponTemplates', templateId);
    if (!tpl || !tpl.enabled) throw new Error('优惠券不存在或已停用');

    const claimed = this.store.count('coupons',
      c => c.templateId === templateId && c.memberId === memberId);
    if (claimed >= tpl.limitPerMember) throw new Error('已达领取上限');

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
      status: 'unused', // unused / used / expired
      expireAt: expireAt.toISOString(),
      createdAt: now.toISOString()
    };
    this.store.insert('coupons', c);
    return c;
  }

  /** 我的优惠券 */
  listMine(memberId, status) {
    let list = this.store.find('coupons', c => c.memberId === memberId);
    const now = Date.now();
    for (const c of list) {
      if (c.status === 'unused' && new Date(c.expireAt).getTime() < now) {
        c.status = 'expired';
        this.store.markDirty('coupons');
      }
    }
    if (status) list = list.filter(c => c.status === status);
    return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  /** 校验并返回可用优惠券详情（下单前调用） */
  validate(couponId, memberId, orderAmount) {
    if (!couponId) return null;
    const c = this.store.findById('coupons', couponId);
    if (!c) throw new Error('优惠券不存在');
    if (c.memberId !== memberId) throw new Error('优惠券不属于当前会员');
    if (c.status !== 'unused') throw new Error('优惠券已使用或已过期');
    if (new Date(c.expireAt).getTime() < Date.now()) throw new Error('优惠券已过期');
    if (orderAmount < c.threshold) throw new Error('订单金额未达到使用门槛');
    return c;
  }

  /** 核销优惠券 */
  use(couponId) {
    const c = this.store.findById('coupons', couponId);
    if (!c) return;
    c.status = 'used';
    c.usedAt = new Date().toISOString();
    this.store.markDirty('coupons');
  }
}

module.exports = CouponManager;
