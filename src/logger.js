/**
 * 结构化日志
 * - 输出 JSON Lines，便于接入日志平台
 * - 支持 level 过滤与请求上下文（requestId）
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
    if (this.file) fs.mkdirSync(path.dirname(this.file), { recursive: true });
  }

  _emit(level, msg, fields) {
    if (LEVELS[level] < this.level) return;
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      msg,
      ...fields
    });
    if (this.file) this._appendFile(line);
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  }

  _appendFile(line) {
    try {
      if (fs.existsSync(this.file) && fs.statSync(this.file).size >= this.maxBytes) this._rotate();
      fs.appendFileSync(this.file, line + '\n', { encoding: 'utf8', mode: 0o640 });
    } catch (error) {
      console.error(JSON.stringify({
        ts: new Date().toISOString(), level: 'error', msg: 'log.file-write-failed', error: error.message
      }));
    }
  }

  _rotate() {
    const keep = Math.max(1, Number(this.maxFiles) || 5);
    fs.rmSync(this.file + '.' + keep, { force: true });
    for (let index = keep - 1; index >= 1; index -= 1) {
      const source = this.file + '.' + index;
      const target = this.file + '.' + (index + 1);
      if (fs.existsSync(source)) fs.renameSync(source, target);
    }
    if (fs.existsSync(this.file)) fs.renameSync(this.file, this.file + '.1');
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
