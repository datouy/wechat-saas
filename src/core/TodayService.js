/**
 * 管理工作台读模型：只返回今天需要处理的事项，避免首屏加载全部业务集合。
 */
const { cnDate } = require('./time');

class TodayService {
  constructor(store, stats, config) {
    this.store = store;
    this.stats = stats;
    this.config = config || {};
  }

  dashboard(tenantId) {
    const today = cnDate();
    const now = Date.now();
    const endingBefore = now + (Number(this.config.endingSoonHours) || 24) * 3600000;
    const lowStockThreshold = Number(this.config.lowStockThreshold) || 10;
    const orders = this.store.find('orders', o => o.tenantId === tenantId);
    const groups = this.store.find('groupBuys', g => g.tenantId === tenantId);
    const appointments = this.store.find('appointments', a => a.tenantId === tenantId);
    const products = this.store.find('products', p => p.tenantId === tenantId);
    const members = this.store.find('members', m => m.tenantId === tenantId);

    const waitShip = orders
      .filter(o => o.status === 'paid' && o.deliveryType !== 'pickup')
      .sort((a, b) => new Date(a.paidAt || a.createdAt) - new Date(b.paidAt || b.createdAt));
    const waitPickup = orders
      .filter(o => o.status === 'paid' && o.deliveryType === 'pickup')
      .sort((a, b) => new Date(a.paidAt || a.createdAt) - new Date(b.paidAt || b.createdAt));
    const refunding = orders.filter(o => o.refund && o.refund.status === 'refunding');
    const endingGroups = groups
      .filter(g => g.status === 'active' && new Date(g.endAt).getTime() <= endingBefore)
      .sort((a, b) => new Date(a.endAt) - new Date(b.endAt));
    const todayAppointments = appointments
      .filter(a => a.date === today && a.status === 'booked')
      .sort((a, b) => String(a.slot).localeCompare(String(b.slot)));
    const lowStock = products
      .filter(p => p.onSale && Number(p.stock) <= lowStockThreshold)
      .sort((a, b) => Number(a.stock) - Number(b.stock));
    const base = this.stats.dashboard(tenantId);

    const tasks = [
      this._task('ship', waitShip.length, '待发货', waitShip.slice(0, 5).map(o => this._orderBrief(o)), '#/orders?status=paid'),
      this._task('pickup', waitPickup.length, '待自提', waitPickup.slice(0, 5).map(o => this._orderBrief(o)), '#/orders?status=paid'),
      this._task('refund', refunding.length, '退款处理中', refunding.slice(0, 5).map(o => this._orderBrief(o)), '#/orders?status=refunding'),
      this._task('groupbuy', endingGroups.length, '团购即将截止', endingGroups.slice(0, 5).map(g => ({
        id: g.id,
        title: g.title,
        meta: (g.participants || []).length + '/' + g.minParticipants + ' 人',
        dueAt: g.endAt
      })), '#/group-buys'),
      this._task('appointment', todayAppointments.length, '今日预约', todayAppointments.slice(0, 5).map(a => ({
        id: a.id,
        title: a.serviceName,
        meta: a.slot,
        memberId: a.memberId
      })), '#/appointments'),
      this._task('stock', lowStock.length, '库存偏低', lowStock.slice(0, 5).map(p => ({
        id: p.id,
        title: p.name,
        meta: p.stock + ' ' + (p.unit || '份')
      })), '#/products?stock=low')
    ].filter(t => t.count > 0);

    return {
      date: today,
      summary: {
        todayAmount: base.today.amount,
        todayOrders: base.today.orders,
        pendingOrders: base.pendingOrders,
        memberCount: base.memberCount,
        newMembersToday: base.newMembersToday,
        waitShip: waitShip.length,
        waitPickup: waitPickup.length,
        activeGroups: base.groupBuys.active,
        todayAppointments: todayAppointments.length
      },
      tasks,
      alerts: {
        lowStockThreshold,
        endingSoonHours: Number(this.config.endingSoonHours) || 24
      }
    };
  }

  _task(id, count, title, items, href) {
    return { id, count, title, items, href };
  }

  _orderBrief(order) {
    return {
      id: order.id,
      title: order.orderNo,
      meta: order.items.map(i => i.name + '×' + i.quantity).join('、'),
      amount: order.payAmount,
      createdAt: order.createdAt
    };
  }
}

module.exports = TodayService;
