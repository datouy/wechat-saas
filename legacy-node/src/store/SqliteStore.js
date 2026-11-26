/**
 * SQLite 存储层（node:sqlite，零原生依赖，Node >= 22.5）
 * 与 JsonStore 实现同一接口，但：
 * - 写入即时落库（markDirty/flush 为兼容接口的空实现）
 * - 提供 transaction() 跨集合 ACID 事务
 * - 提供 atomicDec() 原子条件扣减，杜绝超卖
 * - 每集合一张表（id 主键 + doc JSON 列），find/count 在 JS 侧过滤谓词
 * 通过 DATA_STORE=sqlite 启用；默认仍为 JSON。
 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const AsyncMutex = require('./AsyncMutex');

class SqliteStore {
  constructor(dataDir) {
    this.dataDir = path.resolve(dataDir || './data');
    this.collections = new Map();
    this.db = null;
    this.mutex = new AsyncMutex();
  }

  async initialize() {
    await this.mutex.run(() => {
    if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });
    this.db = new DatabaseSync(path.join(this.dataDir, 'app.sqlite'));
    this.db.exec('PRAGMA busy_timeout = 10000;');
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    console.log('[SqliteStore] 数据文件: ' + path.join(this.dataDir, 'app.sqlite'));
    });
  }

  _table(name) {
    const n = String(name);
    if (!this.collections.has(n)) {
      this.db.exec('CREATE TABLE IF NOT EXISTS "' + n + '" (id TEXT PRIMARY KEY, doc TEXT NOT NULL)');
      this.collections.set(n, true);
    }
    return n;
  }

  /** 兼容 JsonStore.load */
  async load(name) { return this.mutex.run(() => { this._table(name); return this.find(name, () => true); }); }

  async collection(name) {
    return this.mutex.run(() => {
      this._table(name);
      return this.find(name, () => true);
    });
  }

  async insert(name, doc) {
    return this.mutex.run(() => {
      const n = this._table(name);
      this.db.prepare('INSERT INTO "' + n + '" (id, doc) VALUES (?, ?)').run(String(doc.id), JSON.stringify(doc));
      return doc;
    });
  }

  async findById(name, id) {
    return this.mutex.run(() => {
      this._table(name);
      const row = this.db.prepare('SELECT doc FROM "' + this._table(name) + '" WHERE id = ?').get(String(id));
      return row ? JSON.parse(row.doc) : null;
    });
  }

  async findByIdForUpdate(name, id) {
    return this.findById(name, id);
  }

  async update(name, id, patch) {
    return this.mutex.run(() => {
      const n = this._table(name);
      const row = this.db.prepare('SELECT doc FROM "' + n + '" WHERE id = ?').get(String(id));
      const existing = row ? JSON.parse(row.doc) : null;
      if (!existing) return null;
      const merged = { ...existing, ...patch, updatedAt: new Date().toISOString() };
      this.db.prepare('UPDATE "' + n + '" SET doc = ? WHERE id = ?').run(JSON.stringify(merged), String(id));
      return merged;
    });
  }

  async remove(name, id) {
    return this.mutex.run(() => {
      const n = this._table(name);
      const r = this.db.prepare('DELETE FROM "' + n + '" WHERE id = ?').run(String(id));
      return r.changes > 0;
    });
  }

  async find(name, predicate) {
    return this.mutex.run(() => {
      this._table(name);
      const rows = this.db.prepare('SELECT doc FROM "' + this._table(name) + '"').all();
      const docs = rows.map(r => JSON.parse(r.doc));
      return docs.filter(predicate || (() => true));
    });
  }

  async findByTenant(name, tenantId) {
    return this.find(name, doc => doc.tenantId === tenantId);
  }

  async findByTenantStatus(name, tenantId, statuses) {
    const allowed = new Set((statuses || []).map(String));
    return this.find(name, doc => doc.tenantId === tenantId && allowed.has(String(doc.status || '')));
  }

  async findByMember(name, memberId) {
    return this.find(name, doc => doc.memberId === memberId);
  }

  async pageByTenant(name, tenantId, options = {}) {
    const page = Math.max(1, Number(options.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(options.pageSize) || 20));
    let list = await this.findByTenant(name, tenantId);
    if (options.statuses && options.statuses.length) {
      const allowed = new Set(options.statuses.map(String));
      list = list.filter(doc => allowed.has(String(doc.status || '')));
    }
    if (options.refundStatus) list = list.filter(doc => doc.refund && doc.refund.status === options.refundStatus);
    if (options.keyword && options.keywordField) {
      const keyword = String(options.keyword).toLowerCase();
      list = list.filter(doc => String(doc[options.keywordField] || '').toLowerCase().includes(keyword));
    }
    const field = options.sortField || 'createdAt';
    const direction = String(options.sortDirection || 'DESC').toUpperCase() === 'ASC' ? 1 : -1;
    list.sort((a, b) => direction * (new Date(a[field] || 0) - new Date(b[field] || 0)));
    const total = list.length;
    const start = (page - 1) * pageSize;
    return { list: list.slice(start, start + pageSize), total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async findDueNotifications(now, limit) {
    const at = Number(now) || Date.now();
    const list = await this.find('notifications', item => {
      if (!['queued', 'failed', 'processing'].includes(item.status)) return false;
      if (item.status === 'processing') return !item.leaseUntil || new Date(item.leaseUntil).getTime() <= at;
      return !item.nextAttemptAt || new Date(item.nextAttemptAt).getTime() <= at;
    });
    return list.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)).slice(0, limit);
  }

  async notificationStats(tenantId) {
    const list = await this.findByTenant('notifications', tenantId);
    return list.reduce((out, item) => {
      out[item.status] = (out[item.status] || 0) + 1;
      return out;
    }, { total: list.length });
  }

  async findHousekeepingOrders({ pendingExpiresBefore, autoCompleteDeliveredBefore, pickupReminderPaidBefore }) {
    const pendingCut = new Date(pendingExpiresBefore).getTime();
    const autoCut = new Date(autoCompleteDeliveredBefore).getTime();
    const reminderCut = new Date(pickupReminderPaidBefore).getTime();
    return this.find('orders', o => {
      if (o.status === 'pending' && o.expiresAt && new Date(o.expiresAt).getTime() < pendingCut) return true;
      if (o.status === 'delivering' && o.deliveredAt && new Date(o.deliveredAt).getTime() <= autoCut) return true;
      if (o.status === 'paid' && o.deliveryType === 'pickup' && o.paidAt && !o.pickupReminderSentAt && new Date(o.paidAt).getTime() <= reminderCut) return true;
      return false;
    });
  }
  async count(name, predicate) {
    return (await this.find(name, predicate)).length;
  }

  /** 兼容接口：SQLite 即时落库，无需脏标记 */
  markDirty(name) { return; }
  async flush() { return []; }

  /** 跨集合 ACID 事务：BEGIN IMMEDIATE 持写锁，异常回滚 */
  async transaction(fn) {
    if (this.mutex.inTransaction()) return fn();
    return this.mutex.run(async () => {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const result = await fn();
        this.db.exec('COMMIT');
        return result;
      } catch (e) {
        try { this.db.exec('ROLLBACK'); } catch (e2) {}
        throw e;
      }
    });
  }

  /** 原子条件扣减：仅当 field 当前值 >= qty 时扣减，返回是否成功（防超卖） */
  async atomicDec(name, id, field, qty) {
    return this.transaction(async () => {
      const doc = await this.findById(name, id);
      if (!doc) return false;
      const cur = Number(doc[field]) || 0;
      if (cur < qty) return false;
      const n = this._table(name);
      this.db.prepare('UPDATE "' + n + '" SET doc = ? WHERE id = ?')
        .run(JSON.stringify({ ...doc, [field]: cur - qty, updatedAt: new Date().toISOString() }), String(id));
      return true;
    });
  }

  async lock() {
    if (!this.mutex.inTransaction()) throw new Error('[SqliteStore] lock 必须在事务中调用');
  }

  async ping() {
    return this.mutex.run(() => !!this.db && this.db.prepare('SELECT 1 AS ok').get().ok === 1);
  }

  async exportCollections() {
    return this.mutex.run(() => {
      const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
      const out = {};
      for (const table of tables) {
        out[table.name] = this.db.prepare('SELECT doc FROM "' + table.name + '"').all().map(row => JSON.parse(row.doc));
      }
      return out;
    });
  }

  /** 恢复完整快照：清空全部运行时集合后再写入，避免旧集合残留。 */
  async importCollections(collections) {
    const entries = Object.entries(collections || {});
    await this.transaction(async () => {
      for (const [name] of entries) this._table(name);
      const tables = this.db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
      ).all();
      for (const table of tables) this.db.prepare('DELETE FROM "' + table.name + '"').run();
      for (const [name, docs] of entries) {
        const table = this._table(name);
        const insert = this.db.prepare('INSERT INTO "' + table + '" (id, doc) VALUES (?, ?)');
        for (const doc of docs || []) insert.run(String(doc.id), JSON.stringify(doc));
      }
    });
  }

  async shutdown() {
    await this.mutex.run(() => {
      if (this.db) { try { this.db.close(); } catch (e) {} this.db = null; }
    });
  }

  get kind() { return 'sqlite'; }
}

module.exports = SqliteStore;
