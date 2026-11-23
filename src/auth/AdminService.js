/**
 * 管理员账号服务（暂用 JSON 集合 admins 承载）
 * - 首次启动按配置创建默认管理员
 * - 登录校验口令并返回管理员
 */
const { randomUUID: uuidv4 } = require('crypto');
const { business } = require('../errors');

class AdminService {
  constructor(store, auth, config = {}, platformService) {
    this.store = store;
    this.auth = auth;
    this.config = config;
    this.platform = platformService || null;
  }

  /** 首次启动为租户创建默认管理员 */
  async ensureDefaultAdmin(tenantId) {
    const existing = await this.store.find('admins', a => a.tenantId === tenantId && a.username === this.config.username);
    if (existing.length) return existing[0];

    const admin = {
      id: uuidv4(),
      tenantId,
      username: this.config.username,
      passwordHash: this.auth.hashPassword(this.config.password),
      role: 'owner',
      status: 'active',
      tokenVersion: 0,
      createdAt: new Date().toISOString()
    };
    await this.store.insert('admins', admin);
    return admin;
  }

  async authenticate(username, tenantId, password) {
    const admin = (await this.store.find('admins',
      a => a.tenantId === tenantId && a.username === String(username || '')))[0];
    if (!admin || admin.status === 'disabled') return null;
    if (admin.lockedUntil && new Date(admin.lockedUntil).getTime() > Date.now()) return null;
    if (!this.auth.verifyPassword(password, admin.passwordHash)) {
      const attempts = Number(admin.failedLoginAttempts || 0) + 1;
      const patch = { failedLoginAttempts: attempts, lastFailedLoginAt: new Date().toISOString() };
      if (attempts >= 5) {
        patch.lockedUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        patch.failedLoginAttempts = 0;
      }
      await this.store.update('admins', admin.id, patch);
      return null;
    }
    if (admin.failedLoginAttempts || admin.lockedUntil) {
      await this.store.update('admins', admin.id, { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date().toISOString() });
    } else {
      await this.store.update('admins', admin.id, { lastLoginAt: new Date().toISOString() });
    }
    return admin;
  }

  async getById(id, tenantId) {
    const admin = await this.store.findById('admins', id);
    if (!admin || admin.tenantId !== tenantId || admin.status === 'disabled') return null;
    return admin;
  }

  async listByTenant(tenantId) {
    return (await this.store.find('admins', admin => admin.tenantId === tenantId))
      .map(admin => ({
        id: admin.id,
        username: admin.username,
        role: admin.role,
        status: admin.status || 'active',
        createdAt: admin.createdAt,
        updatedAt: admin.updatedAt
      }))
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  }

  async create(tenantId, data) {
    const username = String(data.username || '').trim();
    const duplicate = await this.store.find('admins', admin => admin.tenantId === tenantId && admin.username === username);
    if (duplicate.length) throw business('该用户名已存在');
    this.assertPasswordPolicy(data.username, data.password);
    if (this.platform) await this.platform.assertQuota(tenantId, 'admins');
    const admin = {
      id: uuidv4(),
      tenantId,
      username,
      passwordHash: this.auth.hashPassword(data.password),
      role: data.role === 'fulfillment' ? 'fulfillment' : 'manager',
      status: 'active',
      tokenVersion: 0,
      createdAt: new Date().toISOString()
    };
    await this.store.insert('admins', admin);
    return { id: admin.id, username: admin.username, role: admin.role, status: admin.status, createdAt: admin.createdAt };
  }

  async update(id, tenantId, data, actorId) {
    const admin = await this.store.findById('admins', id);
    if (!admin || admin.tenantId !== tenantId) throw business('员工账号不存在');
    if (admin.role === 'owner' && admin.id !== actorId && data.role) throw business('不能修改所有者角色');
    if (admin.role === 'owner' && data.status === 'disabled') {
      const activeOwners = await this.store.count('admins', a => a.tenantId === tenantId && a.role === 'owner' && a.status !== 'disabled');
      if (activeOwners <= 1) throw business('必须保留至少一个启用的所有者账号');
    }
    const patch = {};
    if (admin.role !== 'owner' && data.role) patch.role = data.role;
    if (data.status) {
      if (data.status === 'disabled' && admin.id === actorId) throw business('不能停用当前登录账号');
      patch.status = data.status;
      if (data.status === 'disabled') patch.tokenVersion = Number(admin.tokenVersion || 0) + 1;
    }
    if (data.password) {
      this.assertPasswordPolicy(admin.username, data.password);
      patch.passwordHash = this.auth.hashPassword(data.password);
      patch.passwordChangedAt = new Date().toISOString();
      patch.tokenVersion = Number(admin.tokenVersion || 0) + 1;
    }
    const updated = await this.store.update('admins', id, patch);
    return {
      id: updated.id,
      username: updated.username,
      role: updated.role,
      status: updated.status || 'active',
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt
    };
  }

  async revokeSessions(id, tenantId) {
    const admin = await this.store.findById('admins', id);
    if (!admin || admin.tenantId !== tenantId) throw business('员工账号不存在');
    return this.store.update('admins', id, {
      tokenVersion: Number(admin.tokenVersion || 0) + 1,
      sessionsRevokedAt: new Date().toISOString()
    });
  }

  assertPasswordPolicy(username, password) {
    const value = String(password || '');
    const problems = [];
    if (value.length < 10) problems.push('至少 10 位');
    if (!/[a-z]/.test(value)) problems.push('包含小写字母');
    if (!/[A-Z]/.test(value)) problems.push('包含大写字母');
    if (!/\d/.test(value)) problems.push('包含数字');
    if (String(username || '').toLowerCase() && value.toLowerCase().includes(String(username).toLowerCase())) problems.push('不能包含用户名');
    if (problems.length) throw business('密码需' + problems.join('、'));
    return true;
  }
}

module.exports = AdminService;

