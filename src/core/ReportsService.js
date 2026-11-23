/**
 * 经营与操作报表：给试点门店提供可解释的操作量和履约门店对比。
 * 金额统一在服务内转换为元，便于管理端直接展示。
 */
const DAY = 86400000;
const { cnDate } = require('./time');

class ReportsService {
  constructor(store, locations) {
    this.store = store;
    this.locations = locations || null;
  }

  async get(tenantId, options = {}) {
    const days = Math.min(90, Math.max(1, Number(options.days) || 30));
    const [operations, stores] = await Promise.all([
      this.operations(tenantId, days, options.auditLog),
      this.stores(tenantId, days)
    ]);
    return {
      rangeDays: days,
      generatedAt: new Date().toISOString(),
      operations,
      stores
    };
  }

  async operations(tenantId, days, auditLog) {
    const cutoff = Date.now() - days * DAY;
    const source = auditLog ? await auditLog.listByTenant(tenantId, {}) : [];
    const logs = source.filter(item => new Date(item.createdAt).getTime() >= cutoff);
    const actionMap = new Map();
    const actorMap = new Map();
    const dayMap = new Map();
    for (const item of logs) {
      const action = item.action || 'unknown';
      actionMap.set(action, (actionMap.get(action) || 0) + 1);
      const actor = item.actorName || item.actorType || '系统';
      actorMap.set(actor, (actorMap.get(actor) || 0) + 1);
      const day = String(item.createdAt || '').slice(0, 10);
      if (day) dayMap.set(day, (dayMap.get(day) || 0) + 1);
    }
    const daily = [];
    for (let i = Math.min(days, 14) - 1; i >= 0; i -= 1) {
      const date = cnDate(new Date(Date.now() - i * DAY));
      daily.push({ date, count: dayMap.get(date) || 0 });
    }
    return {
      total: logs.length,
      uniqueActors: actorMap.size,
      actions: [...actionMap.entries()]
        .map(([action, count]) => ({ action, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 12),
      actors: [...actorMap.entries()]
        .map(([actor, count]) => ({ actor, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8),
      daily
    };
  }

  async stores(tenantId, days) {
    const cutoff = Date.now() - days * DAY;
    const [orders, locations] = await Promise.all([
      this.store.find('orders', item =>
        item.tenantId === tenantId &&
        ['paid', 'delivering', 'completed', 'refunded'].includes(item.status) &&
        new Date(item.paidAt || item.createdAt).getTime() >= cutoff
      ),
      this.locations ? this.locations.list(tenantId) : []
    ]);
    const buckets = new Map(locations.map(item => [item.id, {
      id: item.id,
      name: item.name,
      code: item.code || '',
      status: item.status,
      orders: 0,
      revenue: 0,
      buyers: new Set()
    }]));
    buckets.set('delivery', {
      id: 'delivery',
      name: '配送订单',
      code: 'DELIVERY',
      status: 'active',
      orders: 0,
      revenue: 0,
      buyers: new Set()
    });
    buckets.set('unassigned-pickup', {
      id: 'unassigned-pickup',
      name: '未绑定门店自提',
      code: 'PICKUP-N/A',
      status: 'disabled',
      orders: 0,
      revenue: 0,
      buyers: new Set()
    });
    for (const order of orders) {
      const key = order.deliveryType === 'pickup'
        ? (order.pickupLocationId || 'unassigned-pickup')
        : 'delivery';
      if (!buckets.has(key)) buckets.set(key, {
        id: key,
        name: '已归档门店',
        code: '',
        status: 'disabled',
        orders: 0,
        revenue: 0,
        buyers: new Set()
      });
      const bucket = buckets.get(key);
      const net = Math.max(0, Number(order.payAmount || 0) - Number(order.refundedAmount || 0));
      bucket.orders += 1;
      bucket.revenue += net;
      bucket.buyers.add(order.memberId);
    }
    const list = [...buckets.values()].map(item => ({
      id: item.id,
      name: item.name,
      code: item.code,
      status: item.status,
      orders: item.orders,
      revenue: item.revenue / 100,
      buyers: item.buyers.size,
      averageOrder: item.orders ? item.revenue / item.orders / 100 : 0
    })).sort((a, b) => b.revenue - a.revenue);
    const totalRevenue = list.reduce((sum, item) => sum + item.revenue, 0);
    list.forEach(item => { item.share = totalRevenue ? Number((item.revenue / totalRevenue * 100).toFixed(1)) : 0; });
    return {
      totalRevenue,
      totalOrders: orders.length,
      locations: list
    };
  }
}

module.exports = ReportsService;
