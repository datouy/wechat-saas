/**
 * 数据统计服务
 * - 经营看板：今日/累计销售额、订单数、会员数
 * - 热销商品 Top5
 * - 近7日销售趋势
 */
class StatsService {
  constructor(store) { this.store = store; }

  dashboard(tenantId) {
    const orders = this.store.find('orders', o => o.tenantId === tenantId);
    const members = this.store.find('members', m => m.tenantId === tenantId);
    const today = new Date().toISOString().slice(0, 10);

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
      const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
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
        active: this.store.count('groupBuys', g => g.tenantId === tenantId && g.status === 'active'),
        success: this.store.count('groupBuys', g => g.tenantId === tenantId && g.status === 'success')
      },
      forms: {
        total: this.store.count('forms', f => f.tenantId === tenantId),
        submissions: this.store.count('formSubmissions', s => s.tenantId === tenantId)
      },
      appointments: {
        today: this.store.count('appointments', a => a.tenantId === tenantId && a.date === today && a.status === 'booked')
      }
    };
  }
}

module.exports = StatsService;
