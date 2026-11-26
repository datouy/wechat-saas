'use strict';

require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const runtime = require('../src/runtime');
const config = require('../config/default');

const checks = [];
const add = (status, name, detail) => checks.push({ status, name, detail });
const pass = (name, detail = '') => add('PASS', name, detail);
const warn = (name, detail = '') => add('WARN', name, detail);
const fail = (name, detail = '') => add('FAIL', name, detail);

function validPem(value, type) {
  if (!value) return false;
  try {
    if (type === 'private') crypto.createPrivateKey(value);
    else crypto.createPublicKey(value);
    return true;
  } catch (error) { return false; }
}

function checkWritable(label, target) {
  const resolved = path.resolve(target || '.');
  let candidate = resolved;
  while (!fs.existsSync(candidate) && path.dirname(candidate) !== candidate) candidate = path.dirname(candidate);
  try {
    fs.accessSync(candidate, fs.constants.W_OK);
    pass(label, resolved);
  } catch (error) {
    fail(label, resolved + ' 不可写');
  }
}

async function checkLive() {
  if (!process.argv.includes('--live')) return;
  const base = (process.env.PUBLIC_BASE_URL || 'http://127.0.0.1:' + config.server.port).replace(/\/$/, '');
  for (const endpoint of ['/healthz', '/readyz']) {
    try {
      const response = await fetch(base + endpoint, { signal: AbortSignal.timeout(5000) });
      const body = await response.json();
      if (response.ok) pass('在线检查 ' + endpoint, body.status || 'ok');
      else fail('在线检查 ' + endpoint, 'HTTP ' + response.status + ' ' + JSON.stringify(body));
    } catch (error) {
      fail('在线检查 ' + endpoint, error.message);
    }
  }
}

(async () => {
  try {
    runtime.assertSupported();
    pass('Node.js 运行时', process.versions.node);
  } catch (error) { fail('Node.js 运行时', error.message); }

  if (config.env === 'production') pass('运行环境', 'production');
  else fail('运行环境', '必须设置 NODE_ENV=production');
  if (config.dataStore === 'postgres') pass('存储后端', 'postgres');
  else fail('存储后端', '中型生产环境必须使用 DATA_STORE=postgres');
  if (config.database.url) {
    pass('数据库连接', '已配置');
    const secureUrl = /[?&]sslmode=(require|verify-ca|verify-full)/i.test(config.database.url);
    if (config.database.ssl || secureUrl) pass('数据库 TLS', '已启用');
    else warn('数据库 TLS', '请确认数据库链路已加密，或在 DATABASE_URL 中设置 sslmode=require');
  } else fail('数据库连接', '缺少 DATABASE_URL');

  if (config.env === 'production' && config.dataStore === 'postgres' && config.rateLimit.mode === 'memory' && !config.rateLimit.disabled) {
    warn('应用限流', '多实例 PostgreSQL 部署下内存限流按实例独立计数；请接入网关/Redis 统一限流，或设置 RATE_LIMIT_MODE=gateway');
  } else {
    pass('应用限流', config.rateLimit.mode === 'gateway' ? '由网关统一限流' : '内存限流（单实例）');
  }
  if ((config.auth.secret || '').length >= 32) pass('AUTH_SECRET', '长度满足要求');
  else fail('AUTH_SECRET', '至少 32 位');
  if ((config.admin.password || '').length >= 10) pass('管理员口令', '长度满足最低要求');
  else fail('管理员口令', '至少 10 位且需包含大小写字母和数字');
  if (config.platformAdmin.username && config.platformAdmin.password) pass('平台运营账号', config.platformAdmin.username);
  else fail('平台运营账号', '缺少用户名或密码');
  if ((config.observability.metricsToken || '').length >= 32) pass('METRICS_TOKEN', '长度满足要求');
  else fail('METRICS_TOKEN', '至少 32 位');
  if ((config.backup.encryptionKey || '').length >= 32) pass('备份加密密钥', '长度满足要求');
  else fail('备份加密密钥', '至少 32 位');

  if (config.wechat.mock === false) pass('微信模式', '真实模式');
  else fail('微信模式', '必须设置 WX_MOCK=false');
  if (/^wx[a-zA-Z0-9]{16}$/.test(config.wechat.appId || '')) pass('微信 AppID', config.wechat.appId.slice(0, 6) + '***');
  else fail('微信 AppID', '格式不正确或仍为占位值');
  if (config.wechat.appSecret) pass('微信 AppSecret', '已配置');
  else fail('微信 AppSecret', '缺少 WX_SECRET');

  let templates = {};
  try { templates = JSON.parse(process.env.WX_SUBSCRIBE_TEMPLATES || '{}'); }
  catch (error) { fail('订阅模板 JSON', 'WX_SUBSCRIBE_TEMPLATES 不是合法 JSON'); }
  const templateEntries = Object.entries(templates || {}).filter(([, value]) =>
    value && (typeof value === 'string' ? value : value.templateId));
  if (templateEntries.length) pass('订阅模板', templateEntries.length + ' 个已配置');
  else warn('订阅模板', '环境变量未配置，可在经营台按租户配置真实模板 ID');

  if (config.wechat.paymentEnabled) pass('微信支付', '已启用');
  else fail('微信支付', '必须设置 WX_PAYMENT_ENABLED=true');
  if (config.wechat.mchId) pass('微信商户号', config.wechat.mchId);
  else fail('微信商户号', '缺少 WX_MCHID');
  if (config.wechat.paySerialNo) pass('商户证书序列号', '已配置');
  else fail('商户证书序列号', '缺少 WX_PAY_SERIAL_NO');
  if (Buffer.byteLength(config.wechat.payApiV3Key || '', 'utf8') === 32) pass('APIv3 密钥', '32 字节');
  else fail('APIv3 密钥', '必须为 32 字节');
  if (validPem(config.wechat.payPrivateKey, 'private')) pass('商户私钥', 'PEM 有效');
  else fail('商户私钥', '不是有效 RSA 私钥');
  if (/^https:\/\//i.test(config.wechat.notifyUrl || '') && !config.wechat.notifyUrl.includes('your-domain.com')) {
    pass('支付回调地址', config.wechat.notifyUrl);
  } else fail('支付回调地址', '必须为可公网访问的 HTTPS 地址');
  if (config.wechat.payPublicKey || Object.keys(config.wechat.platformCertificates || {}).length) {
    if (config.wechat.payPublicKey && !validPem(config.wechat.payPublicKey, 'public')) {
      fail('微信支付公钥', '不是有效 PEM 公钥');
    } else pass('微信支付验签根', config.wechat.payPublicKey ? '公钥模式' : '平台证书模式');
  } else {
    warn('微信支付验签根', '启动时将自动下载平台证书；请确保服务器可访问微信支付 API');
  }

  checkWritable('数据目录', config.dataDir);
  checkWritable('上传目录', config.uploads.dir);
  checkWritable('备份目录', config.backup.dir);
  if (config.auditArchive.enabled) checkWritable('审计归档目录', config.auditArchive.dir);

  try { config.validateForProduction(); pass('生产配置校验', '通过'); }
  catch (error) { fail('生产配置校验', error.message.replace(/\n/g, '；')); }

  await checkLive();

  for (const item of checks) console.log('[' + item.status + '] ' + item.name + (item.detail ? ': ' + item.detail : ''));
  const failures = checks.filter(item => item.status === 'FAIL').length;
  const warnings = checks.filter(item => item.status === 'WARN').length;
  console.log('\n部署检查结果: ' + (checks.length - failures - warnings) + ' PASS, ' + warnings + ' WARN, ' + failures + ' FAIL');
  process.exit(failures ? 1 : 0);
})().catch(error => {
  console.error('[deploy-check] ' + error.stack);
  process.exit(1);
});
