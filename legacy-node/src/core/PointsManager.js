/**
 * 积分系统
 * - 消费返积分（可配置比例）
 * - 积分抵扣订单（可配置上限）
 * - 完整积分流水（收支明细）
 */
const { randomUUID: uuidv4 } = require('crypto');
const { business } = require('../errors');

class PointsManager {
  constructor(store, config, auditLog) {
    this.store = store;
    this.config = config || { enabled: true, ratePerYuan: 1, maxPercentPerOrder: 50 };
    this.auditLog = auditLog || null;
  }

  /** 获取会员积分余额 */
  async getBalance(memberId) {
    return (await this.store
      .find('pointsLedger', p => p.memberId === memberId))
      .reduce((sum, p) => sum + p.change, 0);
  }

  /** 变更积分（正为收入，负为支出），返回新余额 */
  async change(memberId, amount, reason, refId, actor = {}) {
    amount = Math.round(Number(amount) || 0);
    if (!amount) return this.getBalance(memberId);

    const entry = {
      id: uuidv4(),
      memberId,
      change: amount,
      reason: reason || '',
      refId: refId || '',
      createdAt: new Date().toISOString()
    };
    return this.store.transaction(async () => {
      if (amount < 0) {
        await this.store.lock('points:' + memberId);
        const balance = await this.getBalance(memberId);
        if (balance + amount < 0) throw business('积分余额不足');
      }
      await this.store.insert('pointsLedger', entry);
      if (this.auditLog) {
        const member = await this.store.findById('members', memberId);
        try {
          await this.auditLog.record({
          tenantId: member ? member.tenantId : '',
          actorType: actor.type || 'system',
          actorId: actor.id || '',
          actorName: actor.name || '',
          action: 'points.change',
          resource: 'member',
          resourceId: memberId,
          detail: { change: amount, reason: entry.reason, refId: entry.refId }
          });
        } catch (error) { /* 审计异常不阻断积分主链路 */ }
      }
      return this.getBalance(memberId);
    });
  }

  /** 支付成功后按金额发放积分 */
  async earnByOrder(memberId, orderId, paidAmount) {
    if (!this.config.enabled) return 0;
    const rate = Number(this.config.ratePerYuan) || 0;
    const earn = Math.floor(Number(paidAmount) * rate);
    if (earn > 0) await this.change(memberId, earn, '消费返积分', orderId);
    return earn;
  }

  /** 下单时计算积分抵扣金额 */
  async calcDiscount(memberId, orderAmount, usePoints) {
    const balance = await this.getBalance(memberId);
    const maxUsableByPercent = Math.floor(orderAmount * (this.config.maxPercentPerOrder / 100));
    // 1积分=0.01元，且不超过订单金额的可抵扣上限与积分余额
    const usable = Math.min(Number(usePoints) || 0, balance, maxUsableByPercent * 100);
    const discount = Math.round(usable) / 100;
    return {
      pointsUsed: Math.floor(usable),
      discount: Math.min(discount, orderAmount),
      balance
    };
  }

  /** 积分流水列表 */
  async getLedger(memberId, limit = 50) {
    return (await this.store
      .find('pointsLedger', p => p.memberId === memberId))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit);
  }
}

module.exports = PointsManager;
