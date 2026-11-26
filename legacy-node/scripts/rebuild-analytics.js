'use strict';

require('dotenv').config();
const config = require('../config/default');
const AnalyticsService = require('../src/core/AnalyticsService');
const TenantManager = require('../src/core/TenantManager');

async function createStore() {
  if (config.dataStore === 'postgres') {
    const PgStore = require('../src/store/PgStore');
    return new PgStore({ connectionString: config.database.url, ssl: config.database.ssl });
  }
  if (config.dataStore === 'sqlite') {
    const SqliteStore = require('../src/store/SqliteStore');
    return new SqliteStore(config.dataDir);
  }
  if (config.dataStore === 'json') {
    const JsonStore = require('../src/store/JsonStore');
    return new JsonStore(config.dataDir);
  }
  throw new Error('不支持的 DATA_STORE: ' + config.dataStore);
}

(async () => {
  const store = await createStore();
  try {
    await store.initialize();
    const tenants = await new TenantManager(store).list();
    const analytics = new AnalyticsService(store);
    for (const tenant of tenants) {
      const result = await analytics.rebuild(tenant.id);
      console.log('[analytics] ' + tenant.id + ': ' + result.totalPaidOrders + ' 个已支付订单，' + result.memberCount + ' 位会员');
    }
    console.log('[analytics] 已重建 ' + tenants.length + ' 个租户的增量汇总');
  } finally {
    await store.shutdown();
  }
})().catch(error => {
  console.error('[analytics] 重建失败: ' + error.stack);
  process.exit(1);
});
