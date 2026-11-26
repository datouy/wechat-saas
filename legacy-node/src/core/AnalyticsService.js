'use strict';

const { cnDate } = require('./time');

const VERSION = 1;
const PAID_STATUSES = new Set(['paid', 'delivering', 'completed']);

class AnalyticsService {
  constructor(store) {
    this.store = store;
  }

  _metaId(tenantId) { return String(tenantId); }
  _dailyId(tenantId, date) { return tenantId + ':' + date; }

  async ensure(tenantId) {
    const meta = await this.store.findById('analyticsMeta', this._metaId(tenantId));
    if (meta && Number(meta.version) === VERSION) return meta;
    return this.rebuild(tenantId);
  }

  async rebuild(tenantId) {
    return this.store.transaction(async () => {
      await this.store.lock('analytics:' + tenantId);
      // PostgreSQL 事务使用单一连接，事务内查询必须串行，避免 pg@9 不再支持的并发 query。
      const orders = await this.store.findByTenant('orders', tenantId);
      const members = await this.store.findByTenant('members', tenantId);
      const oldDaily = await this.store.findByTenant('analyticsDaily', tenantId);
      const productStats = {};
      const daily = {};
      let totalPaidOrders = 0;
      let totalPaidCents = 0;
      let pendingOrders = 0;
      for (const order of orders) {
        if (order.status === 'pending') pendingOrders += 1;
        if (!PAID_STATUSES.has(order.status)) continue;
        totalPaidOrders += 1;
        totalPaidCents += Number(order.payAmount) || 0;
        const date = order.paidAt ? cnDate(new Date(order.paidAt)) : '';
        if (date) {
          const day = daily[date] || { paidOrders: 0, paidCents: 0, newMembers: 0 };
          day.paidOrders += 1;
          day.paidCents += Number(order.payAmount) || 0;
          daily[date] = day;
        }
        for (const item of order.items || []) {
          const row = productStats[item.productId] || { productId: item.productId, name: item.name || '', qty: 0, cents: 0 };
          row.qty += Number(item.quantity) || 0;
          row.cents += Number(item.subtotal) || 0;
          row.name = item.name || row.name;
          productStats[item.productId] = row;
        }
      }
      for (const member of members) {
        if (!member.createdAt) continue;
        const date = cnDate(new Date(member.createdAt));
        const day = daily[date] || { paidOrders: 0, paidCents: 0, newMembers: 0 };
        day.newMembers += 1;
        daily[date] = day;
      }
      const now = new Date().toISOString();
      const meta = {
        id: this._metaId(tenantId),
        tenantId,
        version: VERSION,
        totalPaidOrders,
        totalPaidCents,
        pendingOrders,
        memberCount: members.length,
        productStats,
        rebuiltAt: now,
        updatedAt: now
      };
      await this._upsert('analyticsMeta', meta.id, meta);
      for (const item of oldDaily) await this.store.remove('analyticsDaily', item.id);
      for (const [date, values] of Object.entries(daily)) {
        await this.store.insert('analyticsDaily', {
          id: this._dailyId(tenantId, date), tenantId, date, ...values, updatedAt: now
        });
      }
      return meta;
    });
  }

  async _upsert(name, id, doc) {
    const existing = await this.store.findById(name, id);
    if (existing) return this.store.update(name, id, doc);
    return this.store.insert(name, doc);
  }

  async _mutate(tenantId, date, fn) {
    return this.store.transaction(async () => {
      const meta = await this.store.findByIdForUpdate('analyticsMeta', this._metaId(tenantId));
      if (!meta || Number(meta.version) !== VERSION) throw new Error('analyticsMeta 尚未初始化');
      const dailyId = this._dailyId(tenantId, date);
      const currentDay = await this.store.findByIdForUpdate('analyticsDaily', dailyId) || {
        id: dailyId, tenantId, date, paidOrders: 0, paidCents: 0, newMembers: 0
      };
      const nextMeta = JSON.parse(JSON.stringify(meta));
      const nextDay = { ...currentDay };
      fn(nextMeta, nextDay);
      await this.store.update('analyticsMeta', meta.id, {
        totalPaidOrders: nextMeta.totalPaidOrders,
        totalPaidCents: nextMeta.totalPaidCents,
        pendingOrders: nextMeta.pendingOrders,
        memberCount: nextMeta.memberCount,
        productStats: nextMeta.productStats,
        updatedAt: new Date().toISOString()
      });
      await this._upsert('analyticsDaily', dailyId, { ...nextDay, updatedAt: new Date().toISOString() });
    });
  }

  async recordOrderCreated(order) {
    const date = order.createdAt ? cnDate(new Date(order.createdAt)) : cnDate();
    return this._mutate(order.tenantId, date, meta => { meta.pendingOrders += 1; });
  }

  async recordOrderPaid(order) {
    const date = order.paidAt ? cnDate(new Date(order.paidAt)) : cnDate();
    return this._mutate(order.tenantId, date, (meta, day) => {
      meta.pendingOrders = Math.max(0, Number(meta.pendingOrders || 0) - 1);
      meta.totalPaidOrders = Number(meta.totalPaidOrders || 0) + 1;
      meta.totalPaidCents = Number(meta.totalPaidCents || 0) + Number(order.payAmount || 0);
      day.paidOrders += 1;
      day.paidCents += Number(order.payAmount || 0);
      for (const item of order.items || []) {
        const row = meta.productStats[item.productId] || { productId: item.productId, name: item.name || '', qty: 0, cents: 0 };
        row.qty += Number(item.quantity) || 0;
        row.cents += Number(item.subtotal) || 0;
        row.name = item.name || row.name;
        meta.productStats[item.productId] = row;
      }
    });
  }

  async recordOrderCancelled(order) {
    const date = order.createdAt ? cnDate(new Date(order.createdAt)) : cnDate();
    return this._mutate(order.tenantId, date, meta => {
      meta.pendingOrders = Math.max(0, Number(meta.pendingOrders || 0) - 1);
    });
  }

  async recordOrderRefunded(order) {
    const date = order.paidAt ? cnDate(new Date(order.paidAt)) : cnDate();
    return this._mutate(order.tenantId, date, (meta, day) => {
      meta.totalPaidOrders = Math.max(0, Number(meta.totalPaidOrders || 0) - 1);
      meta.totalPaidCents = Math.max(0, Number(meta.totalPaidCents || 0) - Number(order.payAmount || 0));
      day.paidOrders = Math.max(0, Number(day.paidOrders || 0) - 1);
      day.paidCents = Math.max(0, Number(day.paidCents || 0) - Number(order.payAmount || 0));
      for (const item of order.items || []) {
        const row = meta.productStats[item.productId];
        if (!row) continue;
        row.qty = Math.max(0, Number(row.qty || 0) - Number(item.quantity || 0));
        row.cents = Math.max(0, Number(row.cents || 0) - Number(item.subtotal || 0));
        if (!row.qty) delete meta.productStats[item.productId];
      }
    });
  }

  async recordMemberCreated(member) {
    const date = member.createdAt ? cnDate(new Date(member.createdAt)) : cnDate();
    return this._mutate(member.tenantId, date, (meta, day) => {
      meta.memberCount = Number(meta.memberCount || 0) + 1;
      day.newMembers += 1;
    });
  }

  async dashboard(tenantId) {
    const meta = await this.ensure(tenantId);
    const today = cnDate();
    const dates = [];
    for (let index = 6; index >= 0; index--) dates.push(cnDate(new Date(Date.now() - index * 86400000)));
    const [days, groups, forms, submissions, appointments] = await Promise.all([
      Promise.all(dates.map(date => this.store.findById('analyticsDaily', this._dailyId(tenantId, date)))),
      this.store.findByTenant('groupBuys', tenantId),
      this.store.findByTenant('forms', tenantId),
      this.store.findByTenant('formSubmissions', tenantId),
      this.store.findByTenant('appointments', tenantId)
    ]);
    const todayRow = days[days.length - 1] || { paidOrders: 0, paidCents: 0, newMembers: 0 };
    const topProducts = Object.values(meta.productStats || {})
      .sort((a, b) => Number(b.qty) - Number(a.qty))
      .slice(0, 5)
      .map(item => ({ ...item, amount: Number(item.cents || 0) / 100 }));
    return {
      today: { orders: Number(todayRow.paidOrders || 0), amount: Number(todayRow.paidCents || 0) / 100 },
      total: { orders: Number(meta.totalPaidOrders || 0), amount: Number(meta.totalPaidCents || 0) / 100 },
      pendingOrders: Number(meta.pendingOrders || 0),
      memberCount: Number(meta.memberCount || 0),
      newMembersToday: Number(todayRow.newMembers || 0),
      topProducts,
      trend: dates.map((date, index) => ({
        date,
        orders: Number(days[index] && days[index].paidOrders || 0),
        amount: Number(days[index] && days[index].paidCents || 0) / 100
      })),
      groupBuys: {
        active: groups.filter(item => item.status === 'active').length,
        success: groups.filter(item => item.status === 'success').length
      },
      forms: { total: forms.length, submissions: submissions.length },
      appointments: {
        today: appointments.filter(item => item.date === today && item.status === 'booked').length
      },
      rebuiltAt: meta.rebuiltAt || null
    };
  }
}

AnalyticsService.VERSION = VERSION;
module.exports = AnalyticsService;
