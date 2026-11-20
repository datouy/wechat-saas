/**
 * JSON文件存储层（本地开发用）
 * - 每个集合一个JSON文件，写入采用“临时文件 + fsync + rename”原子替换
 * - 加载失败直接报错，避免把损坏文件静默当成空数据
 * - 写入失败保留脏标记，不静默丢弃未持久化数据
 */
const fs = require('fs');
const path = require('path');

class JsonStore {
  constructor(dataDir) {
    this.dataDir = path.resolve(dataDir || './data');
    this.collections = new Map();
    this.dirty = new Set();
    this.saveTimer = null;
    if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });
  }

  initialize() {
    for (const name of this._listFiles()) {
      this.load(name);
    }
    console.log('[JsonStore] 数据目录: ' + this.dataDir);
    console.log('[JsonStore] 已加载集合: ' + [...this.collections.keys()].join(', ') || '(空)');
  }

  _listFiles() {
    try {
      return fs.readdirSync(this.dataDir)
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace(/\.json$/, ''));
    } catch (e) { return []; }
  }

  load(name) {
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

  collection(name) {
    if (!this.collections.has(name)) this.collections.set(name, []);
    return this.collections.get(name);
  }

  insert(name, doc) {
    this.collection(name).push(doc);
    this.markDirty(name);
    return doc;
  }

  findById(name, id) {
    return this.collection(name).find(d => d.id === id) || null;
  }

  update(name, id, patch) {
    const doc = this.findById(name, id);
    if (!doc) return null;
    Object.assign(doc, patch, { updatedAt: new Date().toISOString() });
    this.markDirty(name);
    return doc;
  }

  remove(name, id) {
    const arr = this.collection(name);
    const idx = arr.findIndex(d => d.id === id);
    if (idx === -1) return false;
    arr.splice(idx, 1);
    this.markDirty(name);
    return true;
  }

  find(name, predicate) {
    return this.collection(name).filter(predicate || (() => true));
  }

  count(name, predicate) {
    return this.collection(name).filter(predicate || (() => true)).length;
  }

  /** 跨集合事务：JSON 为单进程内存模型，此处直通执行（错误回滚由业务层 try/catch 保证） */
  transaction(fn) {
    return fn();
  }

  /** 原子条件扣减：仅当 field 当前值 >= qty 时扣减，返回是否成功（防超卖） */
  atomicDec(name, id, field, qty) {
    const doc = this.findById(name, id);
    if (!doc) return false;
    const cur = Number(doc[field]) || 0;
    if (cur < qty) return false;
    doc[field] = cur - qty;
    this.markDirty(name);
    return true;
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
    const data = JSON.stringify(this.collection(name), null, 1);
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
  flush() {
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

  shutdown() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    const failed = this.flush();
    if (failed.length) {
      console.error('[JsonStore] 关闭时仍有集合未持久化: ' + failed.join(', '));
    }
  }
}

module.exports = JsonStore;

