/**
 * 管理员账号服务（暂用 JSON 集合 admins 承载）
 * - 首次启动按配置创建默认管理员
 * - 登录校验口令并返回管理员
 */
const { randomUUID: uuidv4 } = require('crypto');

class AdminService {
  constructor(store, auth, config = {}) {
    this.store = store;
    this.auth = auth;
    this.config = config;
  }

  /** 首次启动为租户创建默认管理员 */
  ensureDefaultAdmin(tenantId) {
    const existing = this.store.find('admins', a => a.tenantId === tenantId && a.username === this.config.username);
    if (existing.length) return existing[0];

    const admin = {
      id: uuidv4(),
      tenantId,
      username: this.config.username,
      passwordHash: this.auth.hashPassword(this.config.password),
      role: 'owner',
      createdAt: new Date().toISOString()
    };
    this.store.insert('admins', admin);
    return admin;
  }

  authenticate(username, tenantId, password) {
    const admin = this.store.find('admins',
      a => a.tenantId === tenantId && a.username === String(username || ''))[0];
    if (!admin) return null;
    if (!this.auth.verifyPassword(password, admin.passwordHash)) return null;
    return admin;
  }

  getById(id, tenantId) {
    const admin = this.store.findById('admins', id);
    if (!admin || admin.tenantId !== tenantId) return null;
    return admin;
  }
}

module.exports = AdminService;

