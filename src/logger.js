/**
 * 结构化日志
 * - 输出 JSON Lines，便于接入日志平台
 * - 支持 level 过滤与请求上下文（requestId）
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

class Logger {
  constructor(level) {
    this.level = LEVELS[level] || LEVELS.info;
  }

  _emit(level, msg, fields) {
    if (LEVELS[level] < this.level) return;
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      msg,
      ...fields
    });
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
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
