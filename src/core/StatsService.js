/**
 * 数据统计服务
 * - 经营看板：今日/累计销售额、订单数、会员数
 * - 热销商品 Top5
 * - 近7日销售趋势
 */
const { cnDate } = require('./time');

class StatsService {
  constructor(store) { this.store = store; }

  async dashboard(tenantId) {
    const [orders, members, activeGroups, successGroups, formCount, submissionCount, appointmentCount] = await Promise.all([
      this.store.find('orders', o => o.tenantId === tenantId),
      this.store.find('members', m => m.tenantId === tenantId),
      this.store.count('groupBuys', g => g.tenantId === tenantId && g.status === 'active'),
      this.store.count('groupBuys', g => g.tenantId === tenantId && g.status === 'success'),
      this.store.count('forms', f => f.tenantId === tenantId),
      this.store.count('formSubmissions', s => s.tenantId === tenantId),
      this.store.count('appointments', a => a.tenantId === tenantId && a.date === this._today() && a.status === 'booked')
    ]);
    const today = cnDate();

    const paidOrders = orders.filter(o => ['paid', 'delivering', 'completed'].includes(o.status));
    const todayPaid = paidOrders.filter(o => (o.paidAt || '').startsWith(today));

    const sum = arr => arr.reduce((s, o) => s + (o.payAmount || 0), 0) / 100;

    // 热销商品
    const salesMap = {};
    for (const o of paidOrders) {
      for (const it of o.items || []) {
        if (!salesMap[it.productId]) salesMap[it.productId] = { productId: it.productId, name: it.name, qty: 0, amount: 0 };
        salesMap[it.productId].qty += it.quantity;
        salesMap[it.productId].amount += it.subtotal;
      }
    }
    const topProducts = Object.values(salesMap)
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5)
      .map(p => ({ ...p, amount: p.amount / 100 }));

    // 近7日趋势
    const trend = [];
    for (let i = 6; i >= 0; i--) {
      const d = cnDate(new Date(Date.now() - i * 86400000));
      const dayOrders = paidOrders.filter(o => (o.paidAt || '').startsWith(d));
      trend.push({ date: d, orders: dayOrders.length, amount: sum(dayOrders) });
    }

    return {
      today: { orders: todayPaid.length, amount: sum(todayPaid) },
      total: { orders: paidOrders.length, amount: sum(paidOrders) },
      pendingOrders: orders.filter(o => o.status === 'pending').length,
      memberCount: members.length,
      newMembersToday: members.filter(m => (m.createdAt || '').startsWith(today)).length,
      topProducts,
      trend,
      groupBuys: {
        active: activeGroups,
        success: successGroups
      },
      forms: {
        total: formCount,
        submissions: submissionCount
      },
      appointments: {
        today: appointmentCount
      }
    };
  }

  _today() { return cnDate(); }
}

module.exports = StatsService;
