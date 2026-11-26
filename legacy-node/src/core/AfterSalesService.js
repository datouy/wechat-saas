/**
 * 售后工单：先受理、后处理，避免顾客端直接触发资金操作。
 */
const { randomUUID } = require('crypto');
const { business } = require('../errors');

const ACTIVE = ['pending', 'approved'];
const TYPES = ['refund', 'return', 'complaint'];

class AfterSalesService {
  constructor(store, orderManager, notifications, auditLog, memberManager) {
    this.store = store;
    this.orders = orderManager;
    this.notifications = notifications || null;
    this.auditLog = auditLog || null;
    this.members = memberManager || null;
  }

  async request(memberId, tenantId, orderId, data = {}) {
    const order = await this.orders.get(orderId);
    if (!order || order.memberId !== memberId || order.tenantId !== tenantId) throw business('订单不存在');
    if (!['paid', 'delivering', 'completed'].includes(order.status)) throw business('当前订单状态不支持申请售后');
    const type = TYPES.includes(data.type) ? data.type : 'refund';
    const refundable = Math.max(0, Number(order.payAmount || 0) - Number(order.refundedAmount || 0));
    if (type === 'refund' && refundable <= 0) throw business('该订单已无可退款金额');
    const requestedAmount = data.amount === undefined ? refundable : Math.max(0, Math.round(Number(data.amount) || 0));
    if (type === 'refund' && (!(requestedAmount > 0) || requestedAmount > refundable)) throw business('申请金额超过可退款金额');
    const reason = String(data.reason || '').slice(0, 120);
    if (!reason) throw business('请填写售后原因');
    const item = await this.store.transaction(async () => {
      await this.store.lock('after-sales:' + order.id);
      const active = await this.store.find('afterSalesRequests', entry =>
        entry.orderId === order.id && ACTIVE.includes(entry.status));
      if (active.length) throw business('该订单已有处理中的售后申请');
      const record = {
        id: randomUUID(), tenantId, orderId: order.id, orderNo: order.orderNo, memberId, type,
        requestedAmount: type === 'refund' ? requestedAmount : 0,
        reason,
        description: String(data.description || '').slice(0, 500),
        status: 'pending', resolution: '',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      };
      await this.store.insert('afterSalesRequests', record);
      return record;
    });
    await this._audit('member', memberId, 'after-sales.create', item.id, { orderNo: order.orderNo, type });
    await this._notify(order, 'afterSalesSubmitted', '申请已提交');
    return this._decorate(item);
  }

  async cancel(id, memberId) {
    const item = await this.store.transaction(async () => {
      const current = await this.store.findByIdForUpdate('afterSalesRequests', id);
      if (!current || current.memberId !== memberId) throw business('售后申请不存在');
      if (current.status !== 'pending') throw business('当前售后申请不能撤回');
      return this.store.update('afterSalesRequests', id, { status: 'closed', resolution: '顾客撤回', closedAt: new Date().toISOString() });
    });
    await this._audit('member', memberId, 'after-sales.cancel', id, { orderNo: item.orderNo });
    return this._decorate(item);
  }

  async resolve(id, tenantId, data, actor = {}) {
    const updated = await this.store.transaction(async () => {
      const item = await this.store.findByIdForUpdate('afterSalesRequests', id);
      if (!item || item.tenantId !== tenantId) throw business('售后申请不存在');
      if (!ACTIVE.includes(item.status)) throw business('该售后申请已结束');
      const status = ['approved', 'rejected', 'resolved'].includes(data.status) ? data.status : 'approved';
      const record = await this.store.update('afterSalesRequests', id, {
        status,
        resolution: String(data.resolution || '').slice(0, 500),
        resolvedBy: actor.id || '',
        resolvedByName: actor.name || '',
        resolvedAt: new Date().toISOString()
      });
      const order = await this.orders.get(item.orderId);
      if (order) await this._notify(order, 'afterSalesUpdated', status === 'rejected' ? '申请未通过' : '售后进展更新');
      await this._audit('admin', actor.id || '', 'after-sales.' + status, id, { orderNo: item.orderNo });
      return record;
    });
    return this._decorate(updated);
  }

  async listByTenant(tenantId, opts = {}) {
    let list = await this.store.find('afterSalesRequests', item => item.tenantId === tenantId);
    if (opts.status) list = list.filter(item => item.status === opts.status);
    if (opts.type) list = list.filter(item => item.type === opts.type);
    return Promise.all(list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(item => this._decorate(item)));
  }

  async listByMember(memberId) {
    return Promise.all((await this.store.find('afterSalesRequests', item => item.memberId === memberId))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map(item => this._decorate(item)));
  }

  async pendingCount(tenantId) {
    return this.store.count('afterSalesRequests', item => item.tenantId === tenantId && item.status === 'pending');
  }

  async _notify(order, event, status) {
    if (!this.notifications) return;
    await this.notifications.notifyOrder(order, event, { status });
  }

  async _decorate(item) {
    if (!item) return item;
    const member = this.members ? await this.members.get(item.memberId) : null;
    return {
      ...item,
      member: member ? {
        id: member.id,
        nickname: member.nickname || '微信会员',
        phone: member.phone || '',
        avatar: member.avatar || ''
      } : null
    };
  }

  async _audit(actorType, actorId, action, resourceId, detail) {
    if (!this.auditLog) return;
    try {
      const item = await this.store.findById('afterSalesRequests', resourceId);
      await this.auditLog.record({
        tenantId: item ? item.tenantId : '',
        actorType,
        actorId,
        action,
        resource: 'after-sales',
        resourceId,
        detail
      });
    } catch (error) { /* 审计失败由独立监控捕获，不阻断主链路 */ }
  }
}

module.exports = AfterSalesService;
