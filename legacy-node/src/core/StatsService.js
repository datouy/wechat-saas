'use strict';

const AnalyticsService = require('./AnalyticsService');

/** 经营看板读取增量汇总，避免历史订单增长后每次扫描全部订单。 */
class StatsService {
  constructor(store, analytics) {
    this.store = store;
    this.analytics = analytics || new AnalyticsService(store);
  }

  async dashboard(tenantId) {
    return this.analytics.dashboard(tenantId);
  }

  async rebuild(tenantId) {
    return this.analytics.rebuild(tenantId);
  }
}

module.exports = StatsService;
