/**
 * 结构化日志
 * - 输出 JSON Lines，便于接入日志平台
 * - 支持 level 过滤与请求上下文（requestId）
 * - 文件写入采用异步缓冲队列，避免高并发下同步 I/O 阻塞事件循环
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const fs = require('fs');
const path = require('path');

class Logger {
  constructor(level, options = {}) {
    this.level = LEVELS[level] || LEVELS.info;
    this.file = options.file ? path.resolve(options.file) : '';
    this.maxBytes = Number(options.maxBytes) || 20 * 1024 * 1024;
    this.maxFiles = Number(options.maxFiles) || 5;
    this.maxQueue = Math.max(1000, Number(options.maxQueue) || 10000);
    this._pending = [];
    this._drainPromise = null;
    this._dropped = 0;
    if (this.file) fs.mkdirSync(path.dirname(this.file), { recursive: true });
  }

  _emit(level, msg, fields) {
    if (LEVELS[level] < this.level) return;
    const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields });
    if (this.file) this._appendFile(line);
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  }

  _appendFile(line) {
    if (this._pending.length >= this.maxQueue) {
      this._dropped += 1;
      if (this._dropped === 1 || this._dropped % 1000 === 0) {
        console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', msg: 'log.queue-overflow', dropped: this._dropped }));
      }
      return;
    }
    this._pending.push(line);
    this._drain().catch(error => console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', msg: 'log.file-write-failed', error: error.message })));
  }

  async _drain() {
    if (this._drainPromise) return this._drainPromise;
    this._drainPromise = (async () => {
      while (this._pending.length) {
        const batch = this._pending.splice(0, 500);
        let content = batch.join('\n') + '\n';
        try {
          let st = null;
          try { st = await fs.promises.stat(this.file); } catch (e) {}
          if (st && st.size >= this.maxBytes) await this._rotate();
        } catch (e) {}
        await fs.promises.appendFile(this.file, content, { encoding: 'utf8', mode: 0o640 });
      }
    })().finally(() => { this._drainPromise = null; });
    return this._drainPromise;
  }

  async _rotate() {
    const keep = Math.max(1, Number(this.maxFiles) || 5);
    try { await fs.promises.rm(this.file + '.' + keep, { force: true }); } catch (e) {}
    for (let index = keep - 1; index >= 1; index -= 1) {
      const source = this.file + '.' + index;
      const target = this.file + '.' + (index + 1);
      try { if (fs.existsSync(source)) await fs.promises.rename(source, target); } catch (e) {}
    }
    try { if (fs.existsSync(this.file)) await fs.promises.rename(this.file, this.file + '.1'); } catch (e) {}
  }

  async flush() {
    await this._drain();
  }

  debug(msg, fields) { this._emit('debug', msg, fields); }
  info(msg, fields) { this._emit('info', msg, fields); }
  warn(msg, fields) { this._emit('warn', msg, fields); }
  error(msg, fields) { this._emit('error', msg, fields); }

  child(fields) {
    const self = this;
    return {
      debug: (m, f) => self.debug(m, { ...fields, ...f }),
      info: (m, f) => self.info(m, { ...fields, ...f }),
      warn: (m, f) => self.warn(m, { ...fields, ...f }),
      error: (m, f) => self.error(m, { ...fields, ...f })
    };
  }
}

module.exports = Logger;

