/**
 * 邻里团 SaaS - 全局配置
 * 本地开发默认 mock 模式；生产环境必须在 .env 中显式关闭 mock 并补齐密钥
 */
const normalizePem = value => {
  const raw = String(value || '').trim();
  if (raw.startsWith('base64:')) return Buffer.from(raw.slice(7), 'base64').toString('utf8');
  return raw.replace(/\\n/g, '\n');
};

const config = {
  server: {
    port: Number(process.env.PORT) || 3100,
    host: process.env.HOST || '0.0.0.0',
    trustProxy: process.env.TRUST_PROXY || ''
  },
  dataDir: process.env.DATA_DIR || './data',
  // 存储后端：json（本地）| sqlite（单实例 ACID）| postgres（生产多实例）
  dataStore: process.env.DATA_STORE || 'json',
  database: {
    url: process.env.DATABASE_URL || '',
    ssl: process.env.DATABASE_SSL === 'true',
    poolMax: Number(process.env.PG_POOL_MAX) || 20,
    connectTimeoutMs: Number(process.env.PG_CONNECT_TIMEOUT_MS) || 5000
  },
  env: process.env.NODE_ENV || 'development',
  // 跨域白名单（逗号分隔）；为空表示不允许任何跨域来源
  cors: {
    origins: (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
  },
  // 限流：应用内限流基于单进程内存，多实例下各实例独立计数；若由网关统一限流可关闭
  rateLimit: {
    disabled: process.env.RATE_LIMIT_DISABLED === 'true',
    mode: process.env.RATE_LIMIT_MODE || 'memory',
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    max: Number(process.env.RATE_LIMIT_MAX) || 5000,
    loginMax: Number(process.env.RATE_LIMIT_LOGIN_MAX) || 20,
    memberLoginMax: Number(process.env.RATE_LIMIT_MEMBER_LOGIN_MAX) || 300
  },
  wechat: {
    appId: process.env.WX_APPID || '',
    appSecret: process.env.WX_SECRET || '',
    mchId: process.env.WX_MCHID || '',
    payApiV3Key: process.env.WX_PAY_KEY || '',
    payPrivateKey: normalizePem(process.env.WX_PAY_PRIVATE_KEY || ''),
    paySerialNo: process.env.WX_PAY_SERIAL_NO || '',
    payPublicKey: normalizePem(process.env.WX_PAY_PUBLIC_KEY || ''),
    payPublicKeyId: process.env.WX_PAY_PUBLIC_KEY_ID || '',
    // 微信平台证书映射：序列号 -> PEM 证书（可多个，用于回调验签）
    platformCertificates: (() => {
      try { return JSON.parse(process.env.WX_PAY_PLATFORM_CERTS || '{}'); }
      catch (e) { return {}; }
    })(),
    // 订阅消息模板：{"orderPaid":{"templateId":"...","page":"pages/orders/orders","data":{...}}}
    subscribeTemplates: (() => {
      try { return JSON.parse(process.env.WX_SUBSCRIBE_TEMPLATES || '{}'); }
      catch (e) { return {}; }
    })(),
    notifyUrl: process.env.WX_NOTIFY_URL || 'https://your-domain.com/api/wx/pay/notify',
    mock: process.env.WX_MOCK !== 'false',
    // 真实微信支付/退款尚未完成商户资质联调时保持关闭。登录与订阅消息可独立启用。
    paymentEnabled: process.env.WX_PAYMENT_ENABLED === 'true'
  },
  tenant: {
    defaultId: process.env.DEFAULT_TENANT_ID || 't-default',
    defaultName: process.env.DEFAULT_TENANT_NAME || '邻里团示范社区'
  },
  auth: {
    secret: process.env.AUTH_SECRET || '',
    memberTtlSeconds: Number(process.env.AUTH_MEMBER_TTL) || 7 * 86400,
    adminTtlSeconds: Number(process.env.AUTH_ADMIN_TTL) || 12 * 3600,
    platformTtlSeconds: Number(process.env.AUTH_PLATFORM_TTL) || 8 * 3600
  },
  admin: {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || (process.env.NODE_ENV === 'production' ? '' : 'admin123')
  },
  orders: {
    payTimeoutMinutes: Number(process.env.ORDER_PAY_TIMEOUT_MINUTES) || 30,
    offlinePaymentTimeoutMinutes: Number(process.env.ORDER_OFFLINE_TIMEOUT_MINUTES) || 1440,
    autoCompleteDays: Number(process.env.ORDER_AUTO_COMPLETE_DAYS) || 3,
    deliveryFee: Number(process.env.ORDER_DELIVERY_FEE) || 0,
    pickupReminderHours: Number(process.env.ORDER_PICKUP_REMINDER_HOURS) || 12,
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
  inventory: {
    lowStockThreshold: Number(process.env.LOW_STOCK_THRESHOLD) || 10
  },
  today: {
    endingSoonHours: Number(process.env.GROUPBUY_ENDING_SOON_HOURS) || 24
  },
  log: {
    level: process.env.LOG_LEVEL || 'info',
    file: process.env.LOG_FILE || '',
    maxBytes: Number(process.env.LOG_MAX_BYTES) || 20 * 1024 * 1024,
    maxFiles: Number(process.env.LOG_MAX_FILES) || 5
  },
  observability: {
    metricsToken: process.env.METRICS_TOKEN || '',
    alertWebhookUrl: process.env.ALERT_WEBHOOK_URL || '',
    alertWebhookToken: process.env.ALERT_WEBHOOK_TOKEN || '',
    alertCooldownMs: Number(process.env.ALERT_COOLDOWN_MS) || 300000,
    rateWindowMs: Number(process.env.ALERT_WINDOW_MS) || 60000
  },
  outbox: {
    enabled: process.env.OUTBOX_ENABLED !== 'false',
    workerEnabled: process.env.OUTBOX_WORKER_ENABLED !== 'false',
    intervalMs: Number(process.env.OUTBOX_INTERVAL_MS) || 5000,
    maxAttempts: Number(process.env.OUTBOX_MAX_ATTEMPTS) || 8,
    batchSize: Number(process.env.OUTBOX_BATCH_SIZE) || 20,
    baseDelayMs: Number(process.env.OUTBOX_BASE_DELAY_MS) || 30000,
    leaseMs: Number(process.env.OUTBOX_LEASE_MS) || 120000
  },
  auditArchive: {
    enabled: process.env.AUDIT_ARCHIVE_ENABLED === 'true',
    workerEnabled: process.env.AUDIT_ARCHIVE_WORKER_ENABLED !== 'false',
    dir: process.env.AUDIT_ARCHIVE_DIR || './archive/audit',
    intervalMs: Number(process.env.AUDIT_ARCHIVE_INTERVAL_MS) || 60000,
    retainUntilDays: Number(process.env.AUDIT_RETAIN_UNTIL_DAYS) || 3650,
    s3: {
      endpoint: process.env.AUDIT_S3_ENDPOINT || '',
      region: process.env.AUDIT_S3_REGION || 'us-east-1',
      bucket: process.env.AUDIT_S3_BUCKET || '',
      accessKeyId: process.env.AUDIT_S3_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.AUDIT_S3_SECRET_ACCESS_KEY || '',
      objectLockMode: process.env.AUDIT_S3_OBJECT_LOCK_MODE || 'COMPLIANCE'
    }
  },
  backup: {
    dir: process.env.BACKUP_DIR || './backups',
    retentionDays: Number(process.env.BACKUP_RETENTION_DAYS) || 30,
    encryptionKey: process.env.BACKUP_ENCRYPTION_KEY || ''
  },
  tenantOps: {
    signupEnabled: process.env.TENANT_SIGNUP_ENABLED === 'true',
    trialDays: Number(process.env.TENANT_TRIAL_DAYS) || 14,
    defaultPlan: process.env.TENANT_DEFAULT_PLAN || 'starter'
  },
  uploads: {
    dir: process.env.UPLOAD_DIR || './data/uploads',
    maxBytes: Number(process.env.UPLOAD_MAX_BYTES) || 2 * 1024 * 1024,
    publicPrefix: '/uploads'
  },
  platformAdmin: {
    username: process.env.PLATFORM_ADMIN_USERNAME || (process.env.NODE_ENV === 'production' ? '' : 'platform'),
    password: process.env.PLATFORM_ADMIN_PASSWORD || (process.env.NODE_ENV === 'production' ? '' : 'OpsAdmin123!')
  }
};

/**
 * 生产环境启动前校验：任何关键配置缺失都直接失败，而不是悄悄进入 mock 或使用默认口令
 */
config.validateForProduction = function validateForProduction() {
  const problems = [];
  const parseJsonEnv = (name) => {
    const raw = process.env[name];
    if (!raw) return null;
    try { return JSON.parse(raw); }
    catch (error) { problems.push(name + ' 不是合法 JSON'); return null; }
  };
  if (this.env === 'production') {
    if (this.wechat.mock) problems.push('WX_MOCK 必须显式设置为 false');
    if (!this.wechat.appId) problems.push('缺少 WX_APPID');
    if (this.wechat.appId === 'touristappid') problems.push('WX_APPID 不能使用开发者工具占位值 touristappid');
    if (!this.wechat.appSecret) problems.push('缺少 WX_SECRET');
    if (this.wechat.appId && !/^wx[a-zA-Z0-9]{16}$/.test(this.wechat.appId)) problems.push('WX_APPID 格式不正确');
    parseJsonEnv('WX_SUBSCRIBE_TEMPLATES');
    parseJsonEnv('WX_PAY_PLATFORM_CERTS');
    if (this.wechat.paymentEnabled) {
      if (!this.wechat.mchId) problems.push('启用微信支付时缺少 WX_MCHID');
      if (!this.wechat.payApiV3Key) problems.push('启用微信支付时缺少 WX_PAY_KEY');
      if (!this.wechat.payPrivateKey) problems.push('启用微信支付时缺少 WX_PAY_PRIVATE_KEY');
      if (!this.wechat.paySerialNo) problems.push('启用微信支付时缺少 WX_PAY_SERIAL_NO');
      if (this.wechat.payPrivateKey && !this.wechat.payPrivateKey.includes('BEGIN PRIVATE KEY') && !this.wechat.payPrivateKey.includes('BEGIN RSA PRIVATE KEY')) {
        problems.push('WX_PAY_PRIVATE_KEY 不是有效的 PEM 私钥');
      }
      if ((this.wechat.payPublicKey && !this.wechat.payPublicKeyId) || (!this.wechat.payPublicKey && this.wechat.payPublicKeyId)) {
        problems.push('微信支付公钥模式必须同时配置 WX_PAY_PUBLIC_KEY 和 WX_PAY_PUBLIC_KEY_ID');
      }
      if (this.wechat.payPublicKey && !this.wechat.payPublicKey.includes('BEGIN PUBLIC KEY')) {
        problems.push('WX_PAY_PUBLIC_KEY 不是有效的 PEM 公钥');
      }
      if (this.wechat.payApiV3Key && Buffer.byteLength(this.wechat.payApiV3Key, 'utf8') !== 32) {
        problems.push('WX_PAY_KEY 必须恰好为 32 字节');
      }
      if (this.wechat.notifyUrl.includes('your-domain.com')) problems.push('WX_NOTIFY_URL 仍为占位地址');
      if (!/^https:\/\//i.test(this.wechat.notifyUrl)) problems.push('WX_NOTIFY_URL 必须使用 HTTPS');
    }
    if (this.dataStore === 'postgres' && !this.database.url) problems.push('DATA_STORE=postgres 时缺少 DATABASE_URL');
    if (!this.platformAdmin.username) problems.push('缺少 PLATFORM_ADMIN_USERNAME');
    if (!this.platformAdmin.password) problems.push('缺少 PLATFORM_ADMIN_PASSWORD');
    if (this.platformAdmin.password && this.platformAdmin.password.length < 10) problems.push('生产环境 PLATFORM_ADMIN_PASSWORD 至少 10 位');
    if (!this.observability.metricsToken) problems.push('缺少 METRICS_TOKEN');
    if (this.observability.metricsToken && this.observability.metricsToken.length < 32) problems.push('METRICS_TOKEN 至少 32 位');
    if (!this.backup.encryptionKey) problems.push('缺少 BACKUP_ENCRYPTION_KEY');
    if (this.backup.encryptionKey && this.backup.encryptionKey.length < 32) problems.push('BACKUP_ENCRYPTION_KEY 至少 32 位');
  }
  if (!this.auth.secret) problems.push('缺少 AUTH_SECRET');
  if (this.env === 'production' && this.auth.secret && this.auth.secret.length < 32) problems.push('生产环境 AUTH_SECRET 至少 32 位');
  if (this.env === 'production' && !this.admin.password) problems.push('生产环境缺少 ADMIN_PASSWORD');
  if (this.env === 'production' && this.admin.password) {
    const username = String(this.admin.username || '').toLowerCase();
    const password = String(this.admin.password);
    if (password.length < 10) problems.push('生产环境 ADMIN_PASSWORD 至少 10 位');
    if (!/[a-z]/.test(password)) problems.push('生产环境 ADMIN_PASSWORD 需包含小写字母');
    if (!/[A-Z]/.test(password)) problems.push('生产环境 ADMIN_PASSWORD 需包含大写字母');
    if (!/\d/.test(password)) problems.push('生产环境 ADMIN_PASSWORD 需包含数字');
    if (username && password.toLowerCase().includes(username)) problems.push('生产环境 ADMIN_PASSWORD 不能包含管理员用户名');
  }
  if (problems.length) {
    throw new Error('配置校验失败:\n - ' + problems.join('\n - '));
  }
  return true;
};

module.exports = config;


