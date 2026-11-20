require('dotenv').config();
/**
 * 邻里团 SaaS - 微信小程序SaaS服务入口
 * 组合: Express + JSON存储 + 微信双模式(mock/真实)
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
const AuditLog = require('./core/AuditLog');
const TenantManager = require('./core/TenantManager');
const WechatService = require('./services/WechatService');
const ApiService = require('./api/ApiService');
const seed = require('./core/seed');

class WechatSaas {
  constructor() {
    if (config.env !== 'production' && !config.auth.secret) {
      config.auth.secret = 'dev-insecure-secret';
    }
    this.config = config;
    this.logger = new Logger(config.log.level);
    this.app = express();

    // 安全响应头（管理后台已外置 CSS/JS，启用严格 CSP：禁内联脚本与事件处理器）
    this.app.use(helmet({
      crossOriginEmbedderPolicy: false,
      contentSecurityPolicy: {
        directives: {
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"]
        }
      }
    }));

    // 请求 ID 与访问日志
    this.app.use((req, res, next) => {
      req.id = crypto.randomBytes(8).toString('hex');
      req.startedAt = process.hrtime.bigint();
      res.setHeader('X-Request-Id', req.id);
      res.on('finish', () => {
        const ms = Number(process.hrtime.bigint() - req.startedAt) / 1e6;
        this.logger.info('http', { requestId: req.id, method: req.method, path: req.originalUrl, status: res.statusCode, ms: Math.round(ms) });
      });
      next();
    });

    // 接口限流：全局 + 登录接口更严格（基于单进程内存；多实例下各自计数，可经 RATE_LIMIT_DISABLED 交由网关统一限流）
    if (!config.rateLimit.disabled) {
      this.app.use(rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: 1000,
        standardHeaders: true,
        legacyHeaders: false,
        message: { success: false, code: 'RATE_LIMITED', error: '请求过于频繁，请稍后再试' }
      }));
      this.app.use(['/api/wx/login', '/api/admin/login'], rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: 20,
        standardHeaders: true,
        legacyHeaders: false,
        message: { success: false, code: 'RATE_LIMITED', error: '登录尝试过于频繁，请稍后再试' }
      }));
    }

    // 保留原始请求体，供微信支付回调验签使用
    this.app.use(express.json({ limit: '1mb', verify: (req, res, buf) => { req.rawBody = buf; } }));
    // CORS：仅允许配置白名单内的跨域来源，不再通配 '*'
    const allowedOrigins = new Set(config.cors.origins);
    this.app.use((req, res, next) => {
      const origin = req.headers.origin;
      if (origin && allowedOrigins.has(origin)) {
        res.header('Access-Control-Allow-Origin', origin);
        res.header('Vary', 'Origin');
        res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Tenant-Id');
        res.header('Access-Control-Expose-Headers', 'X-Request-Id');
        res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
      }
      if (req.method === 'OPTIONS') return res.sendStatus(204);
      next();
    });

    // 按 DATA_STORE 选择后端；sqlite 延迟加载，避免默认 JSON 模式下触发 node:sqlite 实验警告
    this.store = (config.dataStore === 'sqlite')
      ? new (require('./store/SqliteStore'))(config.dataDir)
      : new JsonStore(config.dataDir);
    this.tenantManager = new TenantManager(this.store);
    this.auth = new AuthService(config.auth);
    this.adminService = new AdminService(this.store, this.auth, config.admin);
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
    this.reconciliation = new ReconciliationService(this.store, this.orderManager, this.wechat);
    this.formManager = new FormManager(this.store);
    this.appointmentManager = new AppointmentManager(this.store);
    this.statsService = new StatsService(this.store);
    this.auditLog = new AuditLog(this.store);
  }

  async initialize() {
    if (this.config.env === 'production') {
      this.config.validateForProduction();
    }

    console.log('========================================');
    console.log('  邻里团 SaaS v1.0 正在启动...');
    console.log('  微信模式: ' + (this.wechat.mock ? '本地模拟(mock)' : '真实对接'));
    console.log('========================================');

    this.store.initialize();
    this.tenantManager.ensureDefault(this.config.tenant.defaultId, this.config.tenant.defaultName);
    await seed.run(this.store, this.productManager, this.couponManager, this.formManager, this.appointmentManager, this.config);
    this.adminService.ensureDefaultAdmin(this.config.tenant.defaultId);
    this.groupBuyManager.initialize();
    this.orderManager.initialize();

    this.apiService = new ApiService(this.app, {
      store: this.store,
      config,
      tenantManager: this.tenantManager,
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
      auditLog: this.auditLog,
      reconciliation: this.reconciliation,
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
    process.on('SIGTERM', async () => { await saas.shutdown(); process.exit(0); });
    process.on('uncaughtException', (e) => console.error('[WechatSaas] 未捕获异常:', e));
    process.on('unhandledRejection', (e) => console.error('[WechatSaas] 未处理的 Promise 拒绝:', e));
  }).catch(e => {
    console.error('[WechatSaas] 启动失败:', e);
    process.exit(1);
  });
}

module.exports = WechatSaas;


