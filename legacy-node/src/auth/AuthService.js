/**
 * 认证与令牌服务
 * - 会员/管理员两类签名令牌（HMAC-SHA256，带过期时间）
 * - 管理员口令加盐哈希（scrypt）
 * - 密钥来自 AUTH_SECRET，生产环境必须显式配置
 */
const crypto = require('crypto');

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const un64url = (s) => Buffer.from(String(s), 'base64url');

class AuthService {
  constructor(config = {}) {
    this.secret = config.secret || process.env.AUTH_SECRET || '';
    this.memberTtlSeconds = Number(config.memberTtlSeconds) || 7 * 86400;
    this.adminTtlSeconds = Number(config.adminTtlSeconds) || 12 * 3600;
    this.platformTtlSeconds = Number(config.platformTtlSeconds) || 8 * 3600;
  }

  /** 生产环境禁止使用空密钥启动 */
  assertSecret() {
    if (!this.secret) {
      throw new Error('缺少 AUTH_SECRET，请在环境变量中配置随机密钥后重启');
    }
  }

  _sign(data) {
    return crypto.createHmac('sha256', this.secret).update(data).digest();
  }

  /** 签发令牌：payload 内嵌 typ/sub/tenantId/iat/exp */
  issue(payload, ttlSeconds) {
    const now = Math.floor(Date.now() / 1000);
    const body = {
      ...payload,
      iat: now,
      exp: now + ttlSeconds
    };
    const encoded = b64url(JSON.stringify(body));
    return encoded + '.' + b64url(this._sign(encoded));
  }

  issueMemberToken(member) {
    return this.issue({ typ: 'member', sub: member.id, tenantId: member.tenantId }, this.memberTtlSeconds);
  }

  issueAdminToken(admin) {
    return this.issue({
      typ: 'admin',
      sub: admin.id,
      tenantId: admin.tenantId,
      role: admin.role || 'admin',
      ver: Number(admin.tokenVersion || 0)
    }, this.adminTtlSeconds);
  }

  issuePlatformToken(operator) {
    return this.issue({
      typ: 'platform',
      sub: operator.id,
      username: operator.username,
      ver: Number(operator.tokenVersion || 0)
    }, this.platformTtlSeconds);
  }

  /** 校验令牌并返回载荷，失败返回 null */
  verify(token, expectedType) {
    if (!token || typeof token !== 'string') return null;
    const idx = token.lastIndexOf('.');
    if (idx <= 0 || idx === token.length - 1) return null;
    const encoded = token.slice(0, idx);
    let expected;
    try {
      expected = this._sign(encoded);
      const provided = un64url(token.slice(idx + 1));
      if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) return null;
      const payload = JSON.parse(un64url(encoded).toString('utf8'));
      if (!payload || typeof payload !== 'object') return null;
      if (payload.typ !== expectedType) return null;
      if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
      return payload;
    } catch (e) {
      return null;
    }
  }

  /** 口令哈希：salt$hash（base64url） */
  hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(String(password), salt, 64);
    return b64url(salt) + '$' + b64url(hash);
  }

  verifyPassword(password, encoded) {
    if (!encoded || typeof encoded !== 'string') return false;
    const [saltStr, hashStr] = encoded.split('$');
    if (!saltStr || !hashStr) return false;
    try {
      const salt = un64url(saltStr);
      const expected = un64url(hashStr);
      const actual = crypto.scryptSync(String(password), salt, expected.length);
      return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
    } catch (e) {
      return false;
    }
  }
}

module.exports = AuthService;

