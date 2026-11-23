/**
 * 持久化消息 Outbox。
 * - 业务请求只负责可靠入队，发送由独立 worker 执行
 * - 多实例通过数据库行锁和租约抢占，避免并发重复认领
 * - 采用至少一次投递；微信成功但状态落库前崩溃时，租约到期后可能重发
 * - 指数退避、最大尝试次数、死信与人工重试
 */
const { randomUUID } = require('crypto');
const { business } = require('../errors');

class OutboxService {
  constructor(store, wechat, config, logger) {
    this.store = store;
    this.wechat = wechat;
    this.config = config || {};
    this.logger = logger || { info() {}, warn() {}, error() {} };
    this.timer = null;
    this.kickTimer = null;
    this.running = false;
    this.workerId = process.env.HOSTNAME || ('worker-' + process.pid);
  }

  async enqueue(data) {
    const now = new Date().toISOString();
    const record = {
      id: randomUUID(),
      tenantId: data.tenantId,
      memberId: data.memberId,
      openid: data.openid || '',
      event: data.event,
      title: data.title || data.event,
      templateId: data.templateId,
      page: data.page || '',
      payload: data.payload || {},
      status: 'queued',
      attempts: 0,
      maxAttempts: Number(this.config.maxAttempts) || 8,
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now
    };
    await this.store.insert('notifications', record);
    return record;
  }

  async deliverNow(id, tenantId) {
    const record = await this.store.findById('notifications', id);
    if (!record || (tenantId && record.tenantId !== tenantId)) return null;
    const claimed = await this._claim(id);
    if (!claimed) return record;
    return this._send(claimed);
  }

  async _claim(id) {
    return this.store.transaction(async () => {
      const record = await this.store.findByIdForUpdate('notifications', id);
      if (!record) return null;
      const now = Date.now();
      const due = !record.nextAttemptAt || new Date(record.nextAttemptAt).getTime() <= now;
      const leaseExpired = record.status === 'processing' &&
        (!record.leaseUntil || new Date(record.leaseUntil).getTime() <= now);
      if (!['queued', 'failed'].includes(record.status) && !leaseExpired) return null;
      if (!due && !leaseExpired) return null;
      return this.store.update('notifications', id, {
        status: 'processing',
        attempts: Number(record.attempts || 0) + 1,
        leaseOwner: this.workerId,
        leaseUntil: new Date(now + (Number(this.config.leaseMs) || 120000)).toISOString(),
        processingAt: new Date(now).toISOString()
      });
    });
  }

  async _send(record) {
    try {
      const result = await this.wechat.sendSubscribeMessage({
        openid: record.openid,
        templateId: record.templateId,
        page: record.page,
        data: record.payload
      });
      const updated = await this.store.update('notifications', record.id, {
        status: result && result.mock ? 'mocked' : 'sent',
        result: { errcode: result && result.errcode, errmsg: result && result.errmsg },
        sentAt: new Date().toISOString(),
        leaseOwner: '',
        leaseUntil: null
      });
      this.logger.info('outbox.sent', {
        notificationId: record.id,
        tenantId: record.tenantId,
        event: record.event,
        attempt: record.attempts
      });
      return updated;
    } catch (error) {
      const attempts = Number(record.attempts || 1);
      const dead = attempts >= Number(record.maxAttempts || this.config.maxAttempts || 8);
      const delay = Math.min(3600000,
        (Number(this.config.baseDelayMs) || 30000) * Math.pow(2, Math.max(0, attempts - 1)));
      const updated = await this.store.update('notifications', record.id, {
        status: dead ? 'dead' : 'failed',
        error: String(error.message || error).slice(0, 500),
        failedAt: new Date().toISOString(),
        nextAttemptAt: dead ? null : new Date(Date.now() + delay).toISOString(),
        leaseOwner: '',
        leaseUntil: null,
        deadLetteredAt: dead ? new Date().toISOString() : null
      });
      this.logger[dead ? 'error' : 'warn']('outbox.failed', {
        notificationId: record.id,
        tenantId: record.tenantId,
        event: record.event,
        attempt: attempts,
        dead,
        error: error.message
      });
      return updated;
    }
  }

  async processDue() {
    if (this.running) return { skipped: true };
    this.running = true;
    const now = Date.now();
    let candidates = [];
    try {
      candidates = (await this.store.find('notifications', item => {
        if (!['queued', 'failed', 'processing'].includes(item.status)) return false;
        if (item.status === 'processing') {
          return !item.leaseUntil || new Date(item.leaseUntil).getTime() <= now;
        }
        return !item.nextAttemptAt || new Date(item.nextAttemptAt).getTime() <= now;
      })).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
        .slice(0, Number(this.config.batchSize) || 20);

      let sent = 0;
      let failed = 0;
      for (const candidate of candidates) {
        const claimed = await this._claim(candidate.id);
        if (!claimed) continue;
        const result = await this._send(claimed);
        if (result && ['sent', 'mocked'].includes(result.status)) sent += 1;
        else failed += 1;
      }
      return { checked: candidates.length, sent, failed };
    } finally {
      this.running = false;
    }
  }

  async retry(id, tenantId) {
    const record = await this.store.findById('notifications', id);
    if (!record || record.tenantId !== tenantId) throw business('消息记录不存在');
    if (!['failed', 'dead', 'mocked'].includes(record.status)) throw business('当前消息状态不能重试');
    const updated = await this.store.update('notifications', id, {
      status: 'queued',
      attempts: 0,
      nextAttemptAt: new Date().toISOString(),
      error: '',
      deadLetteredAt: null
    });
    this.kick();
    return updated;
  }

  async stats(tenantId) {
    const list = await this.store.find('notifications', item => item.tenantId === tenantId);
    return list.reduce((out, item) => {
      out[item.status] = (out[item.status] || 0) + 1;
      return out;
    }, { total: list.length });
  }

  start() {
    if (!this.config.enabled || !this.config.workerEnabled || this.timer) return;
    const interval = Math.max(1000, Number(this.config.intervalMs) || 5000);
    this.timer = setInterval(() => this.processDue().catch(error => {
      this.logger.error('outbox.worker-error', { error: error.message });
    }), interval);
    if (this.timer.unref) this.timer.unref();
    this.kick();
  }

  kick() {
    if (!this.config.enabled || !this.config.workerEnabled || this.kickTimer) return;
    this.kickTimer = setTimeout(() => {
      this.kickTimer = null;
      this.processDue().catch(error => this.logger.error('outbox.kick-error', { error: error.message }));
    }, 10);
    if (this.kickTimer.unref) this.kickTimer.unref();
  }

  async shutdown() {
    if (this.timer) clearInterval(this.timer);
    if (this.kickTimer) clearTimeout(this.kickTimer);
    this.timer = null;
    this.kickTimer = null;
  }
}

module.exports = OutboxService;
