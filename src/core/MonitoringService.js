/**
 * 运行监控：请求指标、Prometheus 输出、错误采样、就绪检查与外部告警。
 * 每个实例暴露自身指标，由 Prometheus 聚合；告警 webhook 可在多实例环境统一接入。
 */
const crypto = require('crypto');

class MonitoringService {
  constructor(logger, options = {}) {
    this.logger = logger;
    this.startedAt = new Date();
    this.routes = new Map();
    this.recentErrors = [];
    this.recentRequests = [];
    this.alertState = new Map();
    this.gauges = new Map();
    this.maxSamples = Math.max(50, Number(options.maxSamples) || 250);
    this.maxErrors = Math.max(20, Number(options.maxErrors) || 100);
    this.maxRecentRequests = Math.max(100, Number(options.maxRecentRequests) || 2000);
    this.slowMs = Math.max(100, Number(options.slowMs) || 1000);
    this.windowMs = Math.max(10000, Number(options.windowMs) || 60000);
    this.alertWebhookUrl = options.alertWebhookUrl || '';
    this.alertWebhookToken = options.alertWebhookToken || '';
    this.alertCooldownMs = Math.max(10000, Number(options.alertCooldownMs) || 300000);
  }

  middleware() {
    return (req, res, next) => {
      req.id = req.headers['x-request-id'] || crypto.randomBytes(8).toString('hex');
      req.startedAt = process.hrtime.bigint();
      res.setHeader('X-Request-Id', req.id);
      res.on('finish', () => {
        const ms = Number(process.hrtime.bigint() - req.startedAt) / 1e6;
        const route = this._routeKey(req.method, req.originalUrl);
        this.recordRequest({ route, method: req.method, status: res.statusCode, ms });
        this.logger.info('http', {
          requestId: req.id,
          method: req.method,
          path: req.originalUrl,
          status: res.statusCode,
          ms: Math.round(ms),
          tenantId: req.tenantId || null,
          actorType: req.auth ? req.auth.typ : 'anonymous'
        });
      });
      next();
    };
  }

  recordRequest({ route, method, status, ms }) {
    const key = String(route || method || 'unknown');
    const bucket = this.routes.get(key) || {
      route: key, method: String(method || 'GET').toUpperCase(), count: 0, errors: 0,
      totalMs: 0, maxMs: 0, samples: [], statusCounts: {}, histogram: {},
      lastStatus: 0, lastAt: ''
    };
    bucket.count += 1;
    bucket.totalMs += Number(ms) || 0;
    bucket.maxMs = Math.max(bucket.maxMs, Number(ms) || 0);
    bucket.lastStatus = Number(status) || 0;
    bucket.lastAt = new Date().toISOString();
    bucket.statusCounts[bucket.lastStatus] = (bucket.statusCounts[bucket.lastStatus] || 0) + 1;
    if (bucket.lastStatus >= 500) bucket.errors += 1;
    bucket.samples.push(Math.round(Number(ms) || 0));
    if (bucket.samples.length > this.maxSamples) bucket.samples.shift();
    for (const limit of [50, 100, 250, 500, 1000, 2500, 5000, Infinity]) {
      if ((Number(ms) || 0) <= limit) bucket.histogram[String(limit)] = (bucket.histogram[String(limit)] || 0) + 1;
    }
    this.routes.set(key, bucket);
    this.recentRequests.push({ status: bucket.lastStatus, ms: Number(ms) || 0, at: Date.now() });
    if (this.recentRequests.length > this.maxRecentRequests) this.recentRequests.shift();
    this._evaluateAlerts();
  }

  recordError(source, error, fields = {}) {
    const item = {
      id: crypto.randomBytes(6).toString('hex'),
      source: String(source || 'application'),
      message: String(error && error.message ? error.message : error || '未知错误').slice(0, 500),
      stack: String(error && error.stack ? error.stack : '').slice(0, 2000),
      ...fields,
      createdAt: new Date().toISOString()
    };
    this.recentErrors.unshift(item);
    if (this.recentErrors.length > this.maxErrors) this.recentErrors.length = this.maxErrors;
    this.logger.error(source, item);
    this._dispatchedAlert({
      key: 'error:' + item.source,
      level: 'error',
      title: '服务端异常',
      detail: item.source + ': ' + item.message,
      fields: { requestId: item.requestId || '', path: item.path || '' }
    });
    return item;
  }

  setGauge(name, value) {
    this.gauges.set(String(name), Number(value) || 0);
  }

  snapshot() {
    const routes = this._routeSnapshot();
    const total = routes.reduce((sum, item) => sum + item.count, 0);
    const errors = routes.reduce((sum, item) => sum + item.errors, 0);
    const cutoff = Date.now() - this.windowMs;
    const recent = this.recentRequests.filter(item => item.at >= cutoff);
    const recentErrors = recent.filter(item => item.status >= 500).length;
    const alerts = [];
    if (recentErrors >= 3) alerts.push({ level: 'error', title: '服务端错误', detail: '最近窗口 ' + recentErrors + ' 个 HTTP 5xx' });
    if (recent.length >= 20 && recentErrors / recent.length >= 0.05) {
      alerts.push({ level: 'warning', title: '错误率偏高', detail: '最近窗口错误率 ' + Math.round(recentErrors / recent.length * 100) + '%' });
    }
    const slow = routes.find(item => item.p95Ms >= this.slowMs);
    if (slow) alerts.push({ level: 'warning', title: '接口延迟偏高', detail: slow.route + ' P95 ' + slow.p95Ms + 'ms' });
    return {
      startedAt: this.startedAt.toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      totalRequests: total,
      totalErrors: errors,
      errorRate: total ? Number((errors / total).toFixed(4)) : 0,
      routes: routes.slice(0, 30),
      recentErrors: this.recentErrors.slice(0, 20),
      alerts,
      memory: process.memoryUsage(),
      instance: { pid: process.pid, hostname: process.env.HOSTNAME || '', version: process.version }
    };
  }

  prometheus() {
    const routes = this._routeSnapshot();
    const lines = [
      '# HELP saas_up 服务进程状态',
      '# TYPE saas_up gauge',
      'saas_up 1',
      '# HELP saas_process_uptime_seconds 服务运行秒数',
      '# TYPE saas_process_uptime_seconds gauge',
      'saas_process_uptime_seconds ' + Math.round(process.uptime()),
      '# HELP saas_process_resident_memory_bytes 常驻内存',
      '# TYPE saas_process_resident_memory_bytes gauge',
      'saas_process_resident_memory_bytes ' + process.memoryUsage().rss
    ];
    lines.push('# HELP saas_http_requests_total HTTP 请求数', '# TYPE saas_http_requests_total counter');
    for (const route of routes) {
      for (const [status, count] of Object.entries(route.statusCounts || {})) {
        lines.push('saas_http_requests_total{method="' + this._label(route.method) + '",route="' +
          this._label(route.route) + '",status="' + this._label(status) + '"} ' + count);
      }
    }
    lines.push('# HELP saas_http_request_duration_seconds HTTP 请求耗时直方图', '# TYPE saas_http_request_duration_seconds histogram');
    for (const route of routes) {
      for (const limit of [50, 100, 250, 500, 1000, 2500, 5000, Infinity]) {
        const label = limit === Infinity ? '+Inf' : String(limit / 1000);
        lines.push('saas_http_request_duration_seconds_bucket{method="' + this._label(route.method) +
          '",route="' + this._label(route.route) + '",le="' + label + '"} ' + (route.histogram[String(limit)] || 0));
      }
      lines.push('saas_http_request_duration_seconds_count{method="' + this._label(route.method) +
        '",route="' + this._label(route.route) + '"} ' + route.count);
    }
    for (const [name, value] of this.gauges) {
      const metric = 'saas_' + String(name).replace(/[^A-Za-z0-9_]/g, '_');
      lines.push(metric + ' ' + (Number(value) || 0));
    }
    return lines.join('\n') + '\n';
  }

  readiness(checks = {}) {
    return Promise.resolve().then(async () => {
      const results = [];
      for (const [name, fn] of Object.entries(checks)) {
        const started = process.hrtime.bigint();
        try {
          const detail = typeof fn === 'function' ? await fn() : fn;
          results.push({
            name,
            status: detail === false ? 'down' : 'up',
            latencyMs: Math.round(Number(process.hrtime.bigint() - started) / 1e6),
            detail: detail === undefined || detail === true ? '' : detail
          });
        } catch (error) {
          results.push({
            name,
            status: 'down',
            latencyMs: Math.round(Number(process.hrtime.bigint() - started) / 1e6),
            detail: String(error.message || error).slice(0, 300)
          });
        }
      }
      return {
        status: results.every(item => item.status === 'up') ? 'ok' : 'degraded',
        checkedAt: new Date().toISOString(),
        checks: results
      };
    });
  }

  _routeSnapshot() {
    return [...this.routes.values()].map(bucket => {
      const samples = bucket.samples.slice().sort((a, b) => a - b);
      const p95 = samples.length ? samples[Math.min(samples.length - 1, Math.ceil(samples.length * 0.95) - 1)] : 0;
      return {
        route: bucket.route,
        method: bucket.method,
        count: bucket.count,
        errors: bucket.errors,
        avgMs: bucket.count ? Math.round(bucket.totalMs / bucket.count) : 0,
        p95Ms: p95,
        maxMs: Math.round(bucket.maxMs),
        lastStatus: bucket.lastStatus,
        lastAt: bucket.lastAt,
        statusCounts: bucket.statusCounts,
        histogram: bucket.histogram
      };
    }).sort((a, b) => b.count - a.count);
  }

  _evaluateAlerts() {
    const cutoff = Date.now() - this.windowMs;
    const recent = this.recentRequests.filter(item => item.at >= cutoff);
    const errors = recent.filter(item => item.status >= 500).length;
    if (errors >= 3) {
      this._dispatchedAlert({ key: 'http-errors', level: 'error', title: 'HTTP 5xx 告警', detail: '最近窗口 ' + errors + ' 个服务端错误' });
    }
    if (recent.length >= 20 && errors / recent.length >= 0.05) {
      this._dispatchedAlert({ key: 'http-error-rate', level: 'error', title: '错误率超过 5%', detail: Math.round(errors / recent.length * 100) + '%' });
    }
  }

  _dispatchedAlert(alert) {
    const now = Date.now();
    const last = this.alertState.get(alert.key) || 0;
    if (now - last < this.alertCooldownMs) return;
    this.alertState.set(alert.key, now);
    this.logger.warn('alert', alert);
    if (!this.alertWebhookUrl || typeof fetch !== 'function') return;
    const payload = {
      source: 'wechat-saas',
      service: process.env.SERVICE_NAME || 'wechat-saas',
      instance: process.env.HOSTNAME || String(process.pid),
      environment: process.env.NODE_ENV || 'development',
      ...alert,
      occurredAt: new Date().toISOString()
    };
    const headers = { 'Content-Type': 'application/json' };
    if (this.alertWebhookToken) headers.Authorization = 'Bearer ' + this.alertWebhookToken;
    fetch(this.alertWebhookUrl, { method: 'POST', headers, body: JSON.stringify(payload) })
      .then(response => {
        if (!response.ok) this.logger.error('alert.webhook-failed', { status: response.status, title: alert.title });
      })
      .catch(error => this.logger.error('alert.webhook-error', { error: error.message, title: alert.title }));
  }

  _label(value) {
    return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  }

  _routeKey(method, url) {
    const pathname = String(url || '').split('?')[0]
      .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id')
      .replace(/\/(\d{4,})(?=\/|$)/g, '/:id');
    return String(method || 'GET').toUpperCase() + ' ' + pathname.slice(0, 180);
  }
}

module.exports = MonitoringService;
