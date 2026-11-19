/**
 * 操作审计日志
 * - 记录管理端关键操作（登录/增删改/发货/退款/团购/优惠券/问卷）
 * - 供审计与合规查询（仅管理员可见）
 */
const { randomUUID: uuidv4 } = require('crypto');

class AuditLog {
  constructor(store) {
    this.store = store;
  }

  record({ tenantId, actorType = 'admin', actorId, actorName, action, resource, resourceId, detail, ip }) {
    const entry = {
      id: uuidv4(),
      tenantId,
      actorType,
      actorId: actorId || '',
      actorName: actorName || '',
      action,
      resource: resource || '',
      resourceId: resourceId || '',
      detail: detail ? JSON.stringify(detail).slice(0, 1000) : '',
      ip: ip || '',
      createdAt: new Date().toISOString()
    };
    this.store.insert('auditLogs', entry);
    return entry;
  }

  listByTenant(tenantId, opts = {}) {
    let list = this.store.find('auditLogs', a => a.tenantId === tenantId);
    if (opts.action) list = list.filter(a => a.action === opts.action);
    if (opts.actorType) list = list.filter(a => a.actorType === opts.actorType);
    return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }
}

module.exports = AuditLog;
