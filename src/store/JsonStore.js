/**
 * JSON文件存储层
 * - 纯JS实现，无需原生编译（对比 better-sqlite3 更易部署）
 * - 每个集合一个JSON文件，写入自动防抖持久化
 * - 适合单机/小规模SaaS商用起步；后续可平滑替换为 MySQL/PG
 */
const fs = require('fs');
const path = require('path');

class JsonStore {
  constructor(dataDir) {
    this.dataDir = path.resolve(dataDir || './data');
    this.collections = new Map(); // name -> array
    this.dirty = new Set();
    this.saveTimer = null;
    if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });
  }

  /** 初始化：加载所有集合 */
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

  /** 加载集合 */
  load(name) {
    const file = path.join(this.dataDir, name + '.json');
    try {
      if (fs.existsSync(file)) {
        const raw = fs.readFileSync(file, 'utf8');
        this.collections.set(name, JSON.parse(raw));
      } else {
        this.collections.set(name, []);
      }
    } catch (e) {
      console.warn('[JsonStore] 加载集合失败 ' + name + ': ' + e.message);
      this.collections.set(name, []);
    }
    return this.collections.get(name);
  }

  /** 获取集合（不存在则创建空集合） */
  collection(name) {
    if (!this.collections.has(name)) {
      this.collections.set(name, []);
    }
    return this.collections.get(name);
  }

  /** 插入一条记录 */
  insert(name, doc) {
    const arr = this.collection(name);
    arr.push(doc);
    this.markDirty(name);
    return doc;
  }

  /** 按ID查找 */
  findById(name, id) {
    return this.collection(name).find(d => d.id === id) || null;
  }

  /** 更新记录（浅合并） */
  update(name, id, patch) {
    const doc = this.findById(name, id);
    if (!doc) return null;
    Object.assign(doc, patch, { updatedAt: new Date().toISOString() });
    this.markDirty(name);
    return doc;
  }

  /** 删除记录 */
  remove(name, id) {
    const arr = this.collection(name);
    const idx = arr.findIndex(d => d.id === id);
    if (idx === -1) return false;
    arr.splice(idx, 1);
    this.markDirty(name);
    return true;
  }

  /** 条件查询 */
  find(name, predicate) {
    return this.collection(name).filter(predicate || (() => true));
  }

  /** 统计数量 */
  count(name, predicate) {
    return this.collection(name).filter(predicate || (() => true)).length;
  }

  /** 标记脏集合，防抖保存 */
  markDirty(name) {
    this.dirty.add(name);
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush();
    }, 300);
  }

  /** 立即落盘 */
  flush() {
    for (const name of this.dirty) {
      try {
        const file = path.join(this.dataDir, name + '.json');
        fs.writeFileSync(file, JSON.stringify(this.collection(name), null, 1), 'utf8');
      } catch (e) {
        console.error('[JsonStore] 保存失败 ' + name + ': ' + e.message);
      }
    }
    this.dirty.clear();
  }

  /** 关闭 */
  shutdown() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.flush();
  }
}

module.exports = JsonStore;
