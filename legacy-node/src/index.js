require('dotenv').config();
require('./runtime').assertSupported();
/**
 * 邻里团 SaaS - 微信小程序SaaS服务入口
 * 组合: Express + JSON/SQLite/PostgreSQL + 微信双模式(mock/真实)
 */
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const config = require('../config/default');
const Logger = require('./logger');

const JsonStore = require('./store/JsonStore');
const AuthService = require('./auth/AuthService');
const AdminService = require('./auth/AdminService');
const MemberManager = require('./core/MemberManager');
const PointsManager = require('./core/PointsManager');
const CouponManager = require('./core/CouponManager');
const ProductManager = require('./core/ProductManager');
const GroupBuyManager = require('./core/GroupBuyManager');
const OrderManager = require('./core/OrderManager');
const ReconciliationService = require('./core/ReconciliationService');
const FormManager = require('./core/FormManager');
const AppointmentManager = require('./core/AppointmentManager');
const StatsService = require('./core/StatsService');
const AnalyticsService = require('./core/AnalyticsService');
const TodayService = require('./core/TodayService');
const AuditLog = require('./core/AuditLog');
const TenantManager = require('./core/TenantManager');
const StoreService = require('./core/StoreService');
const NotificationService = require('./core/NotificationService');
const MonitoringService = require('./core/MonitoringService');
const AfterSalesService = require('./core/AfterSalesService');
const GrowthService = require('./core/GrowthService');
const ReportsService = require('./core/ReportsService');
const OnboardingService = require('./core/OnboardingService');
const LocationService = require('./core/LocationService');
const WechatService = require('./services/WechatService');
const OutboxService = require('./core/OutboxService');
const AuditArchiveService = require('./core/AuditArchiveService');
const PlatformService = require('./core/PlatformService');
const AssetService = require('./core/AssetService');
const BackupService = require('./core/BackupService');
const ApiService = require('./api/ApiService');
const seed = require('./core/seed');

class WechatSaas {
  constructor() {
    if (config.env !== 'production' && !config.auth.secret) {
      config.auth.secret = 'dev-insecure-secret';
    }
    this.config = config;
    this.logger = new Logger(config.log.level, {
      file: config.log.file,
      maxBytes: config.log.maxBytes,
      maxFiles: config.log.maxFiles
    });
    this.monitoring = new MonitoringService(this.logger, {
      slowMs: Number(process.env.SLOW_REQUEST_MS) || 1000,
      alertWebhookUrl: config.observability.alertWebhookUrl,
      alertWebhookToken: config.observability.alertWebhookToken,
      alertCooldownMs: config.observability.alertCooldownMs,
      windowMs: config.observability.rateWindowMs
    });
    this.app = express();
    if (config.server.trustProxy) {
      const trust = config.server.trustProxy === 'true' ? true :
        (/^\d+$/.test(config.server.trustProxy) ? Number(config.server.trustProxy) : config.server.trustProxy);
      this.app.set('trust proxy', trust);
    }

    // 安全响应头（管理后台已外置 CSS/JS，启用严格 CSP：禁内联脚本与事件处理器）
    this.app.use(helmet({
      crossOriginEmbedderPolicy: false,
      contentSecurityPolicy: {
        directives: {
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          frameAncestors: ["'none'"],
          formAction: ["'self'"]
        }
      }
    }));

    // 请求 ID、访问日志和进程内接口指标
    this.app.use(this.monitoring.middleware());

    // 接口限流：全局 + 登录接口更严格（基于单进程内存；多实例下各自计数，可经 RATE_LIMIT_DISABLED 交由网关统一限流）
    if (!config.rateLimit.disabled && config.rateLimit.mode !== 'gateway') {
      const limited = (message) => (req, res) => res.status(429).json({
        success: false,
        code: 'RATE_LIMITED',
        error: message,
        requestId: req.id || null
      });
      const publicOperationalPath = /^\/(?:healthz|readyz|metrics|api\/wx\/pay\/notify|api\/wx\/pay\/refund\/notify)(?:\/|$)/;
      this.app.use(rateLimit({
        windowMs: config.rateLimit.windowMs,
        limit: config.rateLimit.max,
        standardHeaders: true,
        legacyHeaders: false,
        skip: req => publicOperationalPath.test(String(req.originalUrl || '').split('?')[0]),
        handler: limited('请求过于频繁，请稍后再试')
      }));
      this.app.use('/api/wx/login', rateLimit({
        windowMs: config.rateLimit.windowMs,
        limit: config.rateLimit.memberLoginMax,
        standardHeaders: true,
        legacyHeaders: false,
        handler: limited('登录尝试过于频繁，请稍后再试')
      }));
      this.app.use('/api/admin/login', rateLimit({
        windowMs: config.rateLimit.windowMs,
        limit: config.rateLimit.loginMax,
        standardHeaders: true,
        legacyHeaders: false,
        handler: limited('登录尝试过于频繁，请稍后再试')
      }));
    }

    // 保留原始请求体，供微信支付回调验签使用
    this.app.use(express.json({
      limit: Math.max(1024 * 1024, Number(config.uploads.maxBytes) * 2) + 262144,
      verify: (req, res, buf) => { req.rawBody = buf; }
    }));
    // CORS：仅允许配置白名单内的跨域来源，不再通配 '*'
    const allowedOrigins = new Set(config.cors.origins);
    this.app.use((req, res, next) => {
      const origin = req.headers.origin;
      if (origin && allowedOrigins.has(origin)) {
        res.header('Access-Control-Allow-Origin', origin);
        res.header('Vary', 'Origin');
        res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Tenant-Id');
        res.header('Access-Control-Expose-Headers', 'X-Request-Id');
        res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      }
      if (req.method === 'OPTIONS') return res.sendStatus(204);
      next();
    });

    // 三种后端共享同一异步接口；生产多实例使用 PostgreSQL。
    if (config.dataStore === 'postgres') {
      const PgStore = require('./store/PgStore');
      this.store = new PgStore({ connectionString: config.database.url, ssl: config.database.ssl });
    } else if (config.dataStore === 'sqlite') {
      const SqliteStore = require('./store/SqliteStore');
      this.store = new SqliteStore(config.dataDir);
    } else if (config.dataStore === 'json') {
      this.store = new JsonStore(config.dataDir);
    } else {
      throw new Error('不支持的 DATA_STORE: ' + config.dataStore);
    }
    this.tenantManager = new TenantManager(this.store);
    this.storeService = new StoreService(this.store, {
      name: config.tenant.defaultName
    });
    this.auth = new AuthService(config.auth);
    this.wechat = new WechatService(config.wechat);
    this.auditLog = new AuditLog(this.store, this.logger);
    this.analytics = new AnalyticsService(this.store);
    this.platformService = new PlatformService(this.store, this.auth, {
      ...config.tenantOps,
      defaultTenantId: config.tenant.defaultId,
      platformUsername: config.platformAdmin.username,
      platformPassword: config.platformAdmin.password
    }, this.auditLog);
    this.outboxService = new OutboxService(this.store, this.wechat, config.outbox, this.logger);
    this.adminService = new AdminService(this.store, this.auth, config.admin, this.platformService);
    this.memberManager = new MemberManager(this.store, this.wechat, this.platformService, this.analytics);
    this.notifications = new NotificationService(this.store, this.wechat, this.memberManager, config.wechat.subscribeTemplates, this.outboxService);
    this.assetService = new AssetService(this.store, config.uploads, this.logger);
    this.auditArchiveService = new AuditArchiveService(this.store, config.auditArchive, this.logger);
    this.backupService = new BackupService(config, { logger: this.logger });
    this.pointsManager = new PointsManager(this.store, config.points, this.auditLog);
    this.couponManager = new CouponManager(this.store, config.coupon, this.auditLog);
    this.productManager = new ProductManager(this.store);
    this.groupBuyManager = new GroupBuyManager(this.store, this.productManager, config.groupBuy);
    this.locationService = new LocationService(this.store, this.storeService, this.platformService);
    this.orderManager = new OrderManager(this.store, {
      productManager: this.productManager,
      pointsManager: this.pointsManager,
      couponManager: this.couponManager,
      memberManager: this.memberManager,
      notifications: this.notifications,
      wechatService: this.wechat,
      locationService: this.locationService,
      auditLog: this.auditLog,
      analytics: this.analytics,
      config: config.orders
    });
    this.afterSales = new AfterSalesService(this.store, this.orderManager, this.notifications, this.auditLog, this.memberManager);
    this.growth = new GrowthService(this.store);
    this.reports = new ReportsService(this.store, this.locationService);
    this.onboarding = new OnboardingService(this.store, this.auditLog);
    this.reconciliation = new ReconciliationService(this.store, this.orderManager, this.wechat);
    this.formManager = new FormManager(this.store);
    this.appointmentManager = new AppointmentManager(this.store, this.notifications);
    this.statsService = new StatsService(this.store, this.analytics);
    this.todayService = new TodayService(this.store, this.statsService, {
      lowStockThreshold: config.inventory.lowStockThreshold,
      endingSoonHours: config.today.endingSoonHours,
      pickupReminderHours: config.orders.pickupReminderHours,
      afterSales: this.afterSales
    });
  }

  async initialize() {
    if (this.config.env === 'production') {
      this.config.validateForProduction();
    }
    await this.wechat.initialize();

    console.log('========================================');
    console.log('  邻里团 SaaS v1.1 正在启动...');
    console.log('  微信模式: ' + (this.wechat.mock ? '本地模拟(mock)' : '真实对接'));
    console.log('========================================');

    await this.store.initialize();
    await this.auditLog.initialize();
    await this.tenantManager.ensureDefault(this.config.tenant.defaultId, this.config.tenant.defaultName);
    await this.platformService.initialize();
    await seed.run(this.store, this.productManager, this.couponManager, this.formManager, this.appointmentManager, this.config, this.storeService);
    await this.locationService.initialize(this.config.tenant.defaultId);
    await this.adminService.ensureDefaultAdmin(this.config.tenant.defaultId);
    this.groupBuyManager.initialize();
    this.orderManager.initialize();
    this.outboxService.start();
    this.auditArchiveService.start();

    this.apiService = new ApiService(this.app, {
      store: this.store,
      config,
      tenantManager: this.tenantManager,
      storeService: this.storeService,
      auth: this.auth,
      adminService: this.adminService,
      productManager: this.productManager,
      memberManager: this.memberManager,
      pointsManager: this.pointsManager,
      couponManager: this.couponManager,
      orderManager: this.orderManager,
      groupBuyManager: this.groupBuyManager,
      formManager: this.formManager,
      appointmentManager: this.appointmentManager,
      statsService: this.statsService,
      todayService: this.todayService,
      notifications: this.notifications,
      auditLog: this.auditLog,
      reconciliation: this.reconciliation,
      wechat: this.wechat,
      monitoring: this.monitoring,
      afterSales: this.afterSales,
      growth: this.growth,
      reports: this.reports,
      onboarding: this.onboarding,
      locations: this.locationService,
      platform: this.platformService,
      outbox: this.outboxService,
      assets: this.assetService,
      auditArchive: this.auditArchiveService
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
    await this.outboxService.shutdown();
    await this.auditArchiveService.shutdown();
    this.groupBuyManager.shutdown();
    this.orderManager.shutdown();
    this.wechat.shutdown();
    if (this.server) {
      await new Promise(resolve => this.server.close(() => resolve()));
      this.server = null;
    }
    await this.store.shutdown();
    await this.logger.flush().catch(() => {});
    console.log('[WechatSaas] 已安全关闭');
  }
}

if (require.main === module) {
  const saas = new WechatSaas();
  saas.initialize().then(() => {
    saas.start();
    process.on('SIGINT', async () => { await saas.shutdown(); process.exit(0); });
    process.on('SIGTERM', async () => { await saas.shutdown(); process.exit(0); });
    process.on('uncaughtException', (e) => saas.monitoring.recordError('uncaughtException', e));
    process.on('unhandledRejection', (e) => saas.monitoring.recordError('unhandledRejection', e));
  }).catch(e => {
    console.error('[WechatSaas] 启动失败:', e);
    process.exit(1);
  });
}

module.exports = WechatSaas;


