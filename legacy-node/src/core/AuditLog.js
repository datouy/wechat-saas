/**
 * 操作审计日志：每个租户独立哈希链，可检测历史记录被直接改动。
 * 存储层不提供物理 WORM；生产环境应再同步到对象存储或日志平台做不可变归档。
 */
const crypto = require('crypto');
const { randomUUID: uuidv4 } = require('crypto');

class AuditLog {
  constructor(store, logger) {
    this.store = store;
    this.logger = logger || null;
    this.readyTenants = new Set();
  }

  async initialize() {
    const tenantIds = new Set((await this.store.find('auditLogs', () => true)).map(item => item.tenantId));
    for (const tenantId of tenantIds) await this._ensureChain(tenantId);
  }

  async record({ tenantId, actorType = 'admin', actorId, actorName, action, resource, resourceId, detail, ip }) {
    return this.store.transaction(async () => {
      await this.store.lock('audit:' + tenantId);
      await this._ensureChain(tenantId);
      const previous = (await this._chain(tenantId)).slice(-1)[0] || null;
      const entry = {
        id: uuidv4(),
        tenantId,
        sequence: previous ? Number(previous.sequence || 0) + 1 : 1,
        actorType,
        actorId: actorId || '',
        actorName: actorName || '',
        action,
        resource: resource || '',
        resourceId: resourceId || '',
        detail: detail ? JSON.stringify(detail).slice(0, 1000) : '',
        ip: ip || '',
        previousHash: previous ? previous.hash : '',
        version: 1,
        createdAt: new Date().toISOString()
      };
      entry.hash = this._hash(entry);
      await this.store.insert('auditLogs', entry);
      return entry;
    });
  }

  async listByTenant(tenantId, opts = {}) {
    let list = await this.store.find('auditLogs', a => a.tenantId === tenantId);
    if (opts.action) list = list.filter(a => a.action === opts.action);
    if (opts.actorType) list = list.filter(a => a.actorType === opts.actorType);
    if (opts.actorId) list = list.filter(a => a.actorId === opts.actorId);
    return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  async verify(tenantId) {
    const list = await this._chain(tenantId);
    let previousHash = '';
    const problems = [];
    list.forEach((entry, index) => {
      if (Number(entry.sequence || 0) !== index + 1) {
        problems.push({ id: entry.id, type: 'sequence', message: '审计序号不连续' });
      }
      if ((entry.previousHash || '') !== previousHash) {
        problems.push({ id: entry.id, type: 'previous-hash', message: '前序哈希不一致' });
      }
      const expected = this._hash(entry);
      if (!entry.hash || entry.hash !== expected) {
        problems.push({ id: entry.id, type: 'content-hash', message: '记录内容或哈希已被改动' });
      }
      previousHash = entry.hash || '';
    });
    return {
      valid: problems.length === 0,
      checked: list.length,
      headHash: previousHash,
      checkedAt: new Date().toISOString(),
      problems: problems.slice(0, 20)
    };
  }

  async _chain(tenantId) {
    return (await this.store.find('auditLogs', item => item.tenantId === tenantId))
      .sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0) || new Date(a.createdAt) - new Date(b.createdAt));
  }

  /** 旧数据只在完全没有哈希时一次性封存；混合缺失不会掩盖可能的篡改。 */
  async _ensureChain(tenantId) {
    if (this.readyTenants.has(tenantId)) return;
    const list = await this._chain(tenantId);
    const hasHash = list.some(item => item.hash);
    const missingHash = list.some(item => !item.hash);
    if (!hasHash && missingHash) {
      let previousHash = '';
      for (let index = 0; index < list.length; index += 1) {
        const entry = list[index];
        const sealed = { ...entry, sequence: index + 1, previousHash, version: 1 };
        sealed.hash = this._hash(sealed);
        await this.store.update('auditLogs', entry.id, sealed);
        previousHash = sealed.hash;
      }
      if (this.logger) this.logger.info('audit.chain-sealed', { tenantId, count: list.length });
    }
    this.readyTenants.add(tenantId);
  }

  _hash(entry) {
    const content = {
      id: entry.id,
      tenantId: entry.tenantId,
      sequence: Number(entry.sequence || 0),
      actorType: entry.actorType || '',
      actorId: entry.actorId || '',
      actorName: entry.actorName || '',
      action: entry.action || '',
      resource: entry.resource || '',
      resourceId: entry.resourceId || '',
      detail: entry.detail || '',
      ip: entry.ip || '',
      previousHash: entry.previousHash || '',
      version: Number(entry.version || 1),
      createdAt: entry.createdAt || ''
    };
    return crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex');
  }
}

module.exports = AuditLog;
