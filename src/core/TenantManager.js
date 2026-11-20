/**
 * 租户管理
 * - 租户注册表（tenants 集合），作为「租户是否合法存在」的唯一权威来源
 * - 公开目录与登录不再信任客户端自报的任意 tenantId，必须命中注册表
 * - 首次启动 seed 默认租户；多商户开通流程后续在此扩展（订阅/配额/状态）
 */
const { randomUUID } = require('crypto');

class TenantManager {
  constructor(store) {
    this.store = store;
  }

  /** 确保默认租户存在（幂等） */
  ensureDefault(id, name) {
    let t = this.store.findById('tenants', id);
    if (t) return t;
    t = { id, name: name || id, status: 'active', createdAt: new Date().toISOString() };
    this.store.insert('tenants', t);
    return t;
  }

  /** 按 id 获取租户（不存在返回 null） */
  get(id) {
    return this.store.findById('tenants', id) || null;
  }

  /** 判断租户是否合法存在且可用 */
  exists(id) {
    const t = this.get(id);
    return !!t && t.status !== 'disabled';
  }

  /** 列出所有租户 */
  list() {
    return this.store.find('tenants', () => true);
  }
}

module.exports = TenantManager;