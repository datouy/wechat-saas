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

  async dashboard(tenantId) {
    const today = cnDate();
    const now = Date.now();
    const endingBefore = now + (Number(this.config.endingSoonHours) || 24) * 3600000;
    const lowStockThreshold = Number(this.config.lowStockThreshold) || 10;
    const [orders, groups, appointments, products, members, afterSales, base] = await Promise.all([
      this.store.findByTenantStatus('orders', tenantId, ['pending', 'paid']),
      this.store.findByTenant('groupBuys', tenantId),
      this.store.findByTenant('appointments', tenantId),
      this.store.findByTenant('products', tenantId),
      this.store.findByTenant('members', tenantId),
      this.config.afterSales ? this.config.afterSales.listByTenant(tenantId, { status: 'pending' }) : [],
      this.stats.dashboard(tenantId)
    ]);

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
    const overduePickup = waitPickup.filter(order => {
      const hours = (now - new Date(order.paidAt || order.createdAt).getTime()) / 3600000;
      return hours >= (Number(this.config.pickupReminderHours) || 12);
    });
    const expiringPayments = orders.filter(order =>
      order.status === 'pending' &&
      new Date(order.expiresAt).getTime() > now &&
      new Date(order.expiresAt).getTime() - now <= 10 * 60000);
    const almostGrouped = groups.filter(group => group.status === 'active' &&
      Number(group.minParticipants || 0) - (group.participants || []).length === 1 &&
      new Date(group.endAt).getTime() <= endingBefore);
    const tasks = [
      this._task('ship', waitShip.length, '待发货', waitShip.slice(0, 5).map(o => this._orderBrief(o)), '#/orders?status=paid'),
      this._task('pickup', waitPickup.length, '待自提', waitPickup.slice(0, 5).map(o => this._orderBrief(o)), '#/orders?status=paid'),
      this._task('refund', refunding.length, '退款处理中', refunding.slice(0, 5).map(o => this._orderBrief(o)), '#/orders?status=refunding'),
      this._task('after-sales', afterSales.length, '待处理售后', afterSales.slice(0, 5).map(item => ({
        id: item.id, title: item.orderNo, meta: item.reason, dueAt: item.createdAt
      })), '#/after-sales?status=pending'),
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
      total: base.total,
      trend: base.trend,
      topProducts: base.topProducts,
      businessSignals: {
        groupBuys: base.groupBuys,
        forms: base.forms,
        appointments: base.appointments
      },
      tasks,
      alerts: {
        lowStockThreshold,
        endingSoonHours: Number(this.config.endingSoonHours) || 24,
        overduePickup: overduePickup.length,
        expiringPayments: expiringPayments.length
      },
      recommendations: this._recommendations({ almostGrouped, lowStock, overduePickup, expiringPayments, afterSales, members, products }),
      anomalies: [
        ...overduePickup.slice(0, 3).map(order => ({ type: 'pickup-overdue', title: order.orderNo, detail: '待自提已超过提醒阈值' })),
        ...almostGrouped.slice(0, 3).map(group => ({ type: 'group-near-success', title: group.title, detail: '只差 1 人成团，适合主动邀请' })),
        ...lowStock.filter(product => Number(product.stock) <= 3).slice(0, 3).map(product => ({ type: 'stockout-risk', title: product.name, detail: '仅剩 ' + product.stock + ' ' + (product.unit || '份') }))
      ]
    };
  }

  _recommendations(context) {
    const out = [];
    if (context.almostGrouped.length) {
      out.push({ priority: 'high', title: '推一把即将成团的邻里团', detail: context.almostGrouped[0].title + ' 只差 1 人，复制群运营素材发到社群。', action: '#/growth' });
    }
    if (context.lowStock.length) {
      out.push({ priority: 'high', title: '安排库存补充', detail: context.lowStock[0].name + ' 仅剩 ' + context.lowStock[0].stock + ' ' + (context.lowStock[0].unit || '份') + '。', action: '#/products?stock=low' });
    }
    if (context.afterSales.length) {
      out.push({ priority: 'normal', title: '售后响应会直接影响复购', detail: '当前有 ' + context.afterSales.length + ' 个待处理申请，建议在 2 小时内响应。', action: '#/after-sales' });
    }
    const noAddress = context.members.filter(member => !(member.addresses || []).length).length;
    if (noAddress) {
      out.push({ priority: 'normal', title: '补齐客户配送信息', detail: noAddress + ' 位客户还没有收货地址，可在顾客端地址管理中补充。', action: '#/customers' });
    }
    if (!out.length) out.push({ priority: 'low', title: '今天的经营节奏正常', detail: '保留库存与售后巡检，继续关注即将截止的团购。', action: '#/group-buys' });
    return out.slice(0, 4);
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
