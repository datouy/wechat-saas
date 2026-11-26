/**
 * 租户管理
 * - 租户注册表（tenants 集合），作为「租户是否合法存在」的唯一权威来源
 * - 公开目录与登录不再信任客户端自报的任意 tenantId，必须命中注册表
 * - 租户状态独立于账号状态，可用于试用、停用、欠费和恢复控制
 */
const { randomUUID } = require('crypto');

class TenantManager {
  constructor(store) {
    this.store = store;
  }

  /** 确保默认租户存在（幂等） */
  async ensureDefault(id, name) {
    let t = await this.store.findById('tenants', id);
    if (t) return t;
    t = { id, slug: id, name: name || id, status: 'active', createdAt: new Date().toISOString() };
    await this.store.insert('tenants', t);
    return t;
  }

  /** 按 id 获取租户（不存在返回 null） */
  async get(id) {
    return await this.store.findById('tenants', id) || null;
  }

  /** 判断租户是否合法存在且可用 */
  async exists(id) {
    const t = await this.get(id);
    return !!t && !['disabled', 'suspended', 'pending', 'closed'].includes(t.status);
  }

  /** 列出所有租户 */
  async list() {
    return this.store.find('tenants', () => true);
  }
}

module.exports = TenantManager;
