/**
 * JSON文件存储层（本地开发用）
 * - 每个集合一个JSON文件，写入采用“临时文件 + fsync + rename”原子替换
 * - 加载失败直接报错，避免把损坏文件静默当成空数据
 * - 写入失败保留脏标记，不静默丢弃未持久化数据
 */
const fs = require('fs');
const path = require('path');
const AsyncMutex = require('./AsyncMutex');

class JsonStore {
  constructor(dataDir) {
    this.dataDir = path.resolve(dataDir || './data');
    this.collections = new Map();
    this.dirty = new Set();
    this.saveTimer = null;
    this.mutex = new AsyncMutex();
    if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });
  }

  async initialize() {
    await this.mutex.run(() => {
      for (const name of this._listFiles()) {
        this._load(name);
      }
      console.log('[JsonStore] 数据目录: ' + this.dataDir);
      console.log('[JsonStore] 已加载集合: ' + ([...this.collections.keys()].join(', ') || '(空)'));
    });
  }

  _listFiles() {
    try {
      return fs.readdirSync(this.dataDir)
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace(/\.json$/, ''));
    } catch (e) { return []; }
  }

  async load(name) {
    return this.mutex.run(() => this._load(name));
  }

  _load(name) {
    const file = path.join(this.dataDir, name + '.json');
    if (!fs.existsSync(file)) {
      this.collections.set(name, []);
      return this.collections.get(name);
    }
    const raw = fs.readFileSync(file, 'utf8');
    if (!raw || raw.trim() === '') {
      this.collections.set(name, []);
      return this.collections.get(name);
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new Error('[JsonStore] 集合 ' + name + ' 数据文件损坏，拒绝启动以避免覆盖数据: ' + e.message);
    }
    if (!Array.isArray(parsed)) {
      throw new Error('[JsonStore] 集合 ' + name + ' 数据格式错误（应为数组）');
    }
    this.collections.set(name, parsed);
    return parsed;
  }

  async collection(name) {
    return this.mutex.run(() => this._collection(name));
  }

  _collection(name) {
    if (!this.collections.has(name)) this.collections.set(name, []);
    return this.collections.get(name);
  }

  async insert(name, doc) {
    return this.mutex.run(() => {
      this._collection(name).push(doc);
      this.markDirty(name);
      return doc;
    });
  }

  async findById(name, id) {
    return this.mutex.run(() => this._collection(name).find(d => d.id === id) || null);
  }

  async findByIdForUpdate(name, id) {
    return this.mutex.run(() => this._collection(name).find(d => d.id === id) || null);
  }

  async update(name, id, patch) {
    return this.mutex.run(() => {
      const doc = this._collection(name).find(d => d.id === id);
      if (!doc) return null;
      Object.assign(doc, patch, { updatedAt: new Date().toISOString() });
      this.markDirty(name);
      return doc;
    });
  }

  async remove(name, id) {
    return this.mutex.run(() => {
      const arr = this._collection(name);
      const idx = arr.findIndex(d => d.id === id);
      if (idx === -1) return false;
      arr.splice(idx, 1);
      this.markDirty(name);
      return true;
    });
  }

  async find(name, predicate) {
    return this.mutex.run(() => this._collection(name).filter(predicate || (() => true)));
  }

  async count(name, predicate) {
    return this.mutex.run(() => this._collection(name).filter(predicate || (() => true)).length);
  }

  /** JSON 后端使用内存快照回滚，保证单进程开发/测试环境下的事务语义。 */
  async transaction(fn) {
    return this.mutex.run(async () => {
      const snapshot = new Map();
      for (const [name, docs] of this.collections) snapshot.set(name, docs.map(doc => JSON.parse(JSON.stringify(doc))));
      const dirty = new Set(this.dirty);
      try {
        return await fn();
      } catch (error) {
        this.collections = snapshot;
        this.dirty = dirty;
        throw error;
      }
    });
  }

  async lock() {
    if (!this.mutex.inTransaction()) throw new Error('[JsonStore] lock 必须在事务中调用');
  }

  /** 原子条件扣减：仅当 field 当前值 >= qty 时扣减，返回是否成功（防超卖） */
  async atomicDec(name, id, field, qty) {
    return this.mutex.run(() => {
      const doc = this._collection(name).find(d => d.id === id);
      if (!doc) return false;
      const cur = Number(doc[field]) || 0;
      if (cur < Number(qty)) return false;
      doc[field] = cur - Number(qty);
      doc.updatedAt = new Date().toISOString();
      this.markDirty(name);
      return true;
    });
  }

  markDirty(name) {
    this.dirty.add(name);
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush();
    }, 300);
  }

  /** 原子写入单个集合 */
  _write(name) {
    const file = path.join(this.dataDir, name + '.json');
    const tmp = file + '.tmp';
    const data = JSON.stringify(this._collection(name), null, 1);
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeSync(fd, data, null, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, file);
  }

  /** 立即落盘；返回失败的集合列表（不再丢失脏标记） */
  async flush() {
    const failed = [];
    for (const name of [...this.dirty]) {
      try {
        this._write(name);
        this.dirty.delete(name);
      } catch (e) {
        console.error('[JsonStore] 保存失败 ' + name + ': ' + e.message);
        failed.push(name);
      }
    }
    return failed;
  }

  async ping() {
    return true;
  }

  async exportCollections() {
    return this.mutex.run(() => {
      const out = {};
      for (const [name, docs] of this.collections) out[name] = docs.map(doc => JSON.parse(JSON.stringify(doc)));
      return out;
    });
  }

  async importCollections(collections) {
    await this.mutex.run(() => {
      this.collections = new Map();
      for (const [name, docs] of Object.entries(collections || {})) {
        this.collections.set(name, docs.map(doc => JSON.parse(JSON.stringify(doc))));
        this.dirty.add(name);
      }
    });
    await this.flush();
  }

  async shutdown() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    const failed = await this.flush();
    if (failed.length) {
      console.error('[JsonStore] 关闭时仍有集合未持久化: ' + failed.join(', '));
    }
  }

  get kind() { return 'json'; }
}

module.exports = JsonStore;

