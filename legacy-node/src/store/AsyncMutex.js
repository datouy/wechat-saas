const { AsyncLocalStorage } = require('async_hooks');

/** 串行化单进程 Store 的异步事务，事务中的嵌套调用自动复用当前上下文。 */
class AsyncMutex {
  constructor() {
    this.tail = Promise.resolve();
    this.context = new AsyncLocalStorage();
  }

  inTransaction() {
    return !!this.context.getStore();
  }

  run(fn) {
    if (this.inTransaction()) return fn();
    let release;
    const next = new Promise(resolve => { release = resolve; });
    const previous = this.tail;
    this.tail = previous.then(() => next);
    return previous.then(async () => {
      try {
        return await this.context.run({ locked: true }, fn);
      } finally {
        release();
      }
    });
  }
}

module.exports = AsyncMutex;
