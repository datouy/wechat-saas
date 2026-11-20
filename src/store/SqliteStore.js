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

class SqliteStore {
  constructor(dataDir) {
    this.dataDir = path.resolve(dataDir || './data');
    this.collections = new Map();
    this.db = null;
  }

  initialize() {
    if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });
    this.db = new DatabaseSync(path.join(this.dataDir, 'app.sqlite'));
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    console.log('[SqliteStore] 数据文件: ' + path.join(this.dataDir, 'app.sqlite'));
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
  load(name) { this._table(name); return this.collection(name); }

  collection(name) {
    this._table(name);
    return this.find(name, () => true);
  }

  insert(name, doc) {
    const n = this._table(name);
    this.db.prepare('INSERT INTO "' + n + '" (id, doc) VALUES (?, ?)').run(String(doc.id), JSON.stringify(doc));
    return doc;
  }

  findById(name, id) {
    this._table(name);
    const row = this.db.prepare('SELECT doc FROM "' + this._table(name) + '" WHERE id = ?').get(String(id));
    return row ? JSON.parse(row.doc) : null;
  }

  update(name, id, patch) {
    const n = this._table(name);
    const existing = this.findById(name, id);
    if (!existing) return null;
    const merged = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    this.db.prepare('UPDATE "' + n + '" SET doc = ? WHERE id = ?').run(JSON.stringify(merged), String(id));
    return merged;
  }

  remove(name, id) {
    const n = this._table(name);
    const r = this.db.prepare('DELETE FROM "' + n + '" WHERE id = ?').run(String(id));
    return r.changes > 0;
  }

  find(name, predicate) {
    this._table(name);
    const rows = this.db.prepare('SELECT doc FROM "' + this._table(name) + '"').all();
    const docs = rows.map(r => JSON.parse(r.doc));
    return docs.filter(predicate || (() => true));
  }

  count(name, predicate) {
    return this.find(name, predicate).length;
  }

  /** 兼容接口：SQLite 即时落库，无需脏标记 */
  markDirty(name) { return; }
  flush() { return []; }

  /** 跨集合 ACID 事务：BEGIN IMMEDIATE 持写锁，异常回滚 */
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (e) {
      try { this.db.exec('ROLLBACK'); } catch (e2) {}
      throw e;
    }
  }

  /** 原子条件扣减：仅当 field 当前值 >= qty 时扣减，返回是否成功（防超卖） */
  atomicDec(name, id, field, qty) {
    const n = this._table(name);
    return this.transaction(() => {
      const doc = this.findById(name, id);
      if (!doc) return false;
      const cur = Number(doc[field]) || 0;
      if (cur < qty) return false;
      this.db.prepare('UPDATE "' + n + '" SET doc = ? WHERE id = ?')
        .run(JSON.stringify({ ...doc, [field]: cur - qty, updatedAt: new Date().toISOString() }), String(id));
      return true;
    });
  }

  shutdown() {
    if (this.db) { try { this.db.close(); } catch (e) {} this.db = null; }
  }
}

module.exports = SqliteStore;