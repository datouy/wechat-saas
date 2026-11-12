/**
 * 邻里团 SaaS - 微信小程序SaaS服务入口
 * 组合: Express + JSON存储 + 微信双模式(mock/真实)
 */
const express = require('express');
const path = require('path');
const config = require('../config/default');

const JsonStore = require('./store/JsonStore');
const MemberManager = require('./core/MemberManager');
const PointsManager = require('./core/PointsManager');
const CouponManager = require('./core/CouponManager');
const ProductManager = require('./core/ProductManager');
const GroupBuyManager = require('./core/GroupBuyManager');
const OrderManager = require('./core/OrderManager');
const FormManager = require('./core/FormManager');
const AppointmentManager = require('./core/AppointmentManager');
const StatsService = require('./core/StatsService');
const WechatService = require('./services/WechatService');
const ApiService = require('./api/ApiService');
const seed = require('./core/seed');

class WechatSaas {
  constructor() {
    this.app = express();
    this.app.use(express.json({ limit: '1mb' }));
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Headers', 'Content-Type, X-Tenant-Id');
      res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
      if (req.method === 'OPTIONS') return res.sendStatus(204);
      next();
    });

    this.store = new JsonStore(config.dataDir);
    this.wechat = new WechatService(config.wechat);
    this.memberManager = new MemberManager(this.store, this.wechat);
    this.pointsManager = new PointsManager(this.store, config.points);
    this.couponManager = new CouponManager(this.store, config.coupon);
    this.productManager = new ProductManager(this.store);
    this.groupBuyManager = new GroupBuyManager(this.store, this.productManager, config.groupBuy);
    this.orderManager = new OrderManager(this.store, {
      productManager: this.productManager,
      pointsManager: this.pointsManager,
      couponManager: this.couponManager,
      memberManager: this.memberManager,
      wechatService: this.wechat,
      config: config.orders
    });
    this.formManager = new FormManager(this.store);
    this.appointmentManager = new AppointmentManager(this.store);
    this.statsService = new StatsService(this.store);
  }

  async initialize() {
    console.log('========================================');
    console.log('  邻里团 SaaS v1.0 正在启动...');
    console.log('  微信模式: ' + (this.wechat.mock ? '本地模拟(mock)' : '真实对接'));
    console.log('========================================');

    this.store.initialize();
    await seed.run(this.store, this.productManager, this.couponManager, this.formManager, this.appointmentManager, config);
    this.groupBuyManager.initialize();
    this.orderManager.initialize();

    this.apiService = new ApiService(this.app, {
      store: this.store,
      config,
      productManager: this.productManager,
      memberManager: this.memberManager,
      pointsManager: this.pointsManager,
      couponManager: this.couponManager,
      orderManager: this.orderManager,
      groupBuyManager: this.groupBuyManager,
      formManager: this.formManager,
      appointmentManager: this.appointmentManager,
      statsService: this.statsService,
      wechat: this.wechat
    });
    this.apiService.registerRoutes();

    console.log('[WechatSaas] ✅ 初始化完成');
    console.log('[WechatSaas] 管理后台: http://localhost:' + config.server.port);
  }

  start() {
    this.server = this.app.listen(config.server.port, config.server.host, () => {
      console.log('[WechatSaas] 🚀 服务已启动: http://localhost:' + config.server.port);
    });
  }

  async shutdown() {
    this.groupBuyManager.shutdown();
    this.orderManager.shutdown();
    this.store.shutdown();
    if (this.server) this.server.close();
    console.log('[WechatSaas] 已安全关闭');
  }
}

if (require.main === module) {
  const saas = new WechatSaas();
  saas.initialize().then(() => {
    saas.start();
    process.on('SIGINT', async () => { await saas.shutdown(); process.exit(0); });
    process.on('uncaughtException', (e) => console.error('[WechatSaas] 未捕获异常:', e));
  }).catch(e => {
    console.error('[WechatSaas] 启动失败:', e);
    process.exit(1);
  });
}

module.exports = WechatSaas;
