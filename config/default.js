/**
 * 邻里团 SaaS - 全局配置
 * 本地开发默认 mock 模式；生产环境必须在 .env 中显式关闭 mock 并补齐密钥
 */
const config = {
  server: {
    port: Number(process.env.PORT) || 3100,
    host: process.env.HOST || '0.0.0.0'
  },
  dataDir: process.env.DATA_DIR || './data',
  // 存储后端：json（默认）| sqlite（ACID 事务 + 原子扣减防超卖）
  dataStore: process.env.DATA_STORE || 'json',
  env: process.env.NODE_ENV || 'development',
  // 跨域白名单（逗号分隔）；为空表示不允许任何跨域来源
  cors: {
    origins: (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
  },
  // 限流：应用内限流基于单进程内存，多实例下各实例独立计数；若由网关统一限流可关闭
  rateLimit: {
    disabled: process.env.RATE_LIMIT_DISABLED === 'true'
  },
  wechat: {
    appId: process.env.WX_APPID || '',
    appSecret: process.env.WX_SECRET || '',
    mchId: process.env.WX_MCHID || '',
    payApiV3Key: process.env.WX_PAY_KEY || '',
    payPrivateKey: process.env.WX_PAY_PRIVATE_KEY || '',
    paySerialNo: process.env.WX_PAY_SERIAL_NO || '',
    // 微信平台证书映射：序列号 -> PEM 证书（可多个，用于回调验签）
    platformCertificates: (() => {
      try { return JSON.parse(process.env.WX_PAY_PLATFORM_CERTS || '{}'); }
      catch (e) { return {}; }
    })(),
    notifyUrl: process.env.WX_NOTIFY_URL || 'https://your-domain.com/api/wx/pay/notify',
    mock: process.env.WX_MOCK !== 'false'
  },
  tenant: {
    defaultId: process.env.DEFAULT_TENANT_ID || 't-default',
    defaultName: process.env.DEFAULT_TENANT_NAME || '邻里团示范社区'
  },
  auth: {
    secret: process.env.AUTH_SECRET || '',
    memberTtlSeconds: Number(process.env.AUTH_MEMBER_TTL) || 7 * 86400,
    adminTtlSeconds: Number(process.env.AUTH_ADMIN_TTL) || 12 * 3600
  },
  admin: {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || (process.env.NODE_ENV === 'production' ? '' : 'admin123')
  },
  orders: {
    payTimeoutMinutes: Number(process.env.ORDER_PAY_TIMEOUT_MINUTES) || 30,
    autoCompleteDays: Number(process.env.ORDER_AUTO_COMPLETE_DAYS) || 3,
    deliveryFee: Number(process.env.ORDER_DELIVERY_FEE) || 0,
    // 多实例部署时可在除“后台任务实例”外的节点关闭，避免每实例重复跑定时器（幂等，关闭仅为省资源/减锁竞争）
    housekeepingEnabled: process.env.ORDER_HOUSEKEEPING_ENABLED !== 'false'
  },
  points: {
    enabled: process.env.POINTS_ENABLED !== 'false',
    ratePerYuan: Number(process.env.POINTS_RATE_PER_YUAN) || 1,
    commentReward: Number(process.env.POINTS_COMMENT_REWARD ?? 5),
    maxPercentPerOrder: Number(process.env.POINTS_MAX_PERCENT ?? 50)
  },
  coupon: {
    maxPerOrder: Number(process.env.COUPON_MAX_PER_ORDER ?? 1)
  },
  groupBuy: {
    minParticipants: 2,
    autoCloseHours: Number(process.env.GROUPBUY_CLOSE_HOURS) || 24,
    autoCloseEnabled: process.env.GROUPBUY_AUTOCLOSE_ENABLED !== 'false'
  },
  log: {
    level: process.env.LOG_LEVEL || 'info'
  }
};

/**
 * 生产环境启动前校验：任何关键配置缺失都直接失败，而不是悄悄进入 mock 或使用默认口令
 */
config.validateForProduction = function validateForProduction() {
  const problems = [];
  if (this.env === 'production') {
    if (this.wechat.mock) problems.push('WX_MOCK 必须显式设置为 false');
    if (!this.wechat.appId) problems.push('缺少 WX_APPID');
    if (!this.wechat.appSecret) problems.push('缺少 WX_SECRET');
    if (!this.wechat.mchId) problems.push('缺少 WX_MCHID');
    if (!this.wechat.payApiV3Key) problems.push('缺少 WX_PAY_KEY');
    if (!this.wechat.payPrivateKey) problems.push('缺少 WX_PAY_PRIVATE_KEY');
    if (!this.wechat.paySerialNo) problems.push('缺少 WX_PAY_SERIAL_NO');
    if (this.wechat.notifyUrl.includes('your-domain.com')) problems.push('WX_NOTIFY_URL 仍为占位地址');
  }
  if (!this.auth.secret) problems.push('缺少 AUTH_SECRET');
  if (this.env === 'production' && !this.admin.password) problems.push('生产环境缺少 ADMIN_PASSWORD');
  if (problems.length) {
    throw new Error('配置校验失败:\n - ' + problems.join('\n - '));
  }
  return true;
};

module.exports = config;


