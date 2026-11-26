/**
 * 审计不可变归档。
 * - 本地模式：一次性写入、只读权限、SHA-256 清单，可做篡改检测
 * - S3 兼容模式：Object Lock（COMPLIANCE/GOVERNANCE）形成物理 WORM
 * - 每个租户按连续序号分段，并通过行锁避免多实例重复归档
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => crypto.createHmac('sha256', key).update(value).digest();
const safeSegment = value => String(value || '').replace(/[^A-Za-z0-9._-]/g, '_');

class AuditArchiveService {
  constructor(store, config, logger) {
    this.store = store;
    this.config = config || {};
    this.logger = logger || { info() {}, warn() {}, error() {} };
    this.timer = null;
    this.running = false;
  }

  get s3Enabled() {
    const s3 = this.config.s3 || {};
    return !!(s3.endpoint && s3.bucket && s3.accessKeyId && s3.secretAccessKey);
  }

  async archiveTenant(tenantId) {
    if (!tenantId) return null;
    return this.store.transaction(async () => {
      await this.store.lock('audit-archive:' + tenantId);
      const archives = await this.store.find('auditArchives', item => item.tenantId === tenantId && item.status === 'archived');
      const last = archives.sort((a, b) => Number(b.sequenceEnd || 0) - Number(a.sequenceEnd || 0))[0];
      const through = Number(last && last.sequenceEnd) || 0;
      const entries = (await this.store.find('auditLogs', item => item.tenantId === tenantId))
        .filter(item => Number(item.sequence || 0) > through)
        .sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0));
      if (!entries.length) return null;

      const body = entries.map(item => JSON.stringify(item)).join('\n') + '\n';
      const checksum = sha256(body);
      const sequenceStart = Number(entries[0].sequence || 0);
      const sequenceEnd = Number(entries[entries.length - 1].sequence || 0);
      const retainUntil = new Date(Date.now() + Math.max(1, Number(this.config.retainUntilDays) || 3650) * 86400000).toISOString();
      const key = [
        'tenants', safeSegment(tenantId), 'audit',
        new Date().toISOString().slice(0, 10),
        sequenceStart + '-' + sequenceEnd + '-' + checksum.slice(0, 12) + '.jsonl'
      ].join('/');

      let storage;
      if (this.s3Enabled) {
        await this._putS3(key, body, checksum, retainUntil);
        storage = {
          type: 's3',
          endpoint: this.config.s3.endpoint,
          bucket: this.config.s3.bucket,
          key,
          objectLockMode: this.config.s3.objectLockMode || 'COMPLIANCE'
        };
      } else {
        const file = path.join(path.resolve(this.config.dir || './archive/audit'), key);
        await this._writeLocal(file, body);
        storage = { type: 'local', file, objectLockMode: 'filesystem-readonly' };
      }

      const record = await this.store.insert('auditArchives', {
        id: randomUUID(),
        tenantId,
        sequenceStart,
        sequenceEnd,
        count: entries.length,
        checksum,
        storage,
        retainUntil,
        status: 'archived',
        createdAt: new Date().toISOString()
      });
      this.logger.info('audit.archived', {
        tenantId, sequenceStart, sequenceEnd, count: entries.length, checksum, storage: storage.type
      });
      return record;
    });
  }

  async _writeLocal(file, body) {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    const handle = await fs.promises.open(file, 'wx', 0o440);
    try {
      await handle.writeFile(body, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    try { await fs.promises.chmod(file, 0o440); } catch (error) {}
  }

  async _putS3(key, body, checksum, retainUntil) {
    const s3 = this.config.s3;
    const endpoint = String(s3.endpoint).replace(/\/$/, '');
    const uri = new URL(endpoint + '/' + [s3.bucket, ...key.split('/')].map(encodeURIComponent).join('/'));
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const date = amzDate.slice(0, 8);
    const payloadHash = sha256(body);
    const lockMode = this.config.s3.objectLockMode || 'COMPLIANCE';
    const headers = {
      host: uri.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      'x-amz-object-lock-mode': lockMode,
      'x-amz-object-lock-retain-until-date': retainUntil,
      'x-amz-meta-sha256': checksum,
      'content-type': 'application/x-ndjson'
    };
    const names = Object.keys(headers).sort();
    const canonicalHeaders = names.map(name => name + ':' + String(headers[name]).trim() + '\n').join('');
    const signedHeaders = names.join(';');
    const canonicalRequest = ['PUT', uri.pathname, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
    const scope = date + '/' + (s3.region || 'us-east-1') + '/s3/aws4_request';
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
    const kDate = hmac('AWS4' + s3.secretAccessKey, date);
    const kRegion = hmac(kDate, s3.region || 'us-east-1');
    const kService = hmac(kRegion, 's3');
    const signingKey = hmac(kService, 'aws4_request');
    const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');
    headers.authorization = 'AWS4-HMAC-SHA256 Credential=' + s3.accessKeyId + '/' + scope +
      ', SignedHeaders=' + signedHeaders + ', Signature=' + signature;
    const response = await fetch(uri, { method: 'PUT', headers, body });
    if (!response.ok) {
      throw new Error('审计对象写入失败 HTTP ' + response.status + ': ' + (await response.text()).slice(0, 300));
    }
  }

  async _readS3(storage) {
    const s3 = this.config.s3;
    const endpoint = String(s3.endpoint).replace(/\/$/, '');
    const key = String(storage.key || '');
    const uri = new URL(endpoint + '/' + [s3.bucket, ...key.split('/')].map(encodeURIComponent).join('/'));
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const date = amzDate.slice(0, 8);
    const payloadHash = sha256('');
    const headers = { host: uri.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
    const names = Object.keys(headers).sort();
    const canonicalHeaders = names.map(name => name + ':' + String(headers[name]).trim() + '\n').join('');
    const signedHeaders = names.join(';');
    const canonicalRequest = ['GET', uri.pathname, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
    const scope = date + '/' + (s3.region || 'us-east-1') + '/s3/aws4_request';
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
    const kDate = hmac('AWS4' + s3.secretAccessKey, date);
    const kRegion = hmac(kDate, s3.region || 'us-east-1');
    const kService = hmac(kRegion, 's3');
    const signingKey = hmac(kService, 'aws4_request');
    const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');
    headers.authorization = 'AWS4-HMAC-SHA256 Credential=' + s3.accessKeyId + '/' + scope +
      ', SignedHeaders=' + signedHeaders + ', Signature=' + signature;
    const response = await fetch(uri, { method: 'GET', headers });
    if (!response.ok) throw new Error('审计对象读取失败 HTTP ' + response.status);
    return {
      body: await response.text(),
      lockMode: response.headers.get('x-amz-object-lock-mode') || '',
      retainUntil: response.headers.get('x-amz-object-lock-retain-until-date') || ''
    };
  }

  async verify(tenantId) {
    const archives = await this.store.find('auditArchives', item => item.tenantId === tenantId && item.status === 'archived');
    const problems = [];
    for (const archive of archives) {
      try {
        if (archive.storage.type === 'local') {
          const body = await fs.promises.readFile(archive.storage.file, 'utf8');
          if (sha256(body) !== archive.checksum) problems.push({ id: archive.id, error: '本地归档校验和不一致' });
        } else if (archive.storage.type === 's3') {
          const object = await this._readS3(archive.storage);
          if (sha256(object.body) !== archive.checksum) problems.push({ id: archive.id, error: 'S3 归档内容校验和不一致' });
          if (!object.lockMode) problems.push({ id: archive.id, error: 'S3 对象未返回 Object Lock 信息' });
          if (!object.retainUntil || new Date(object.retainUntil).getTime() <= Date.now()) {
            problems.push({ id: archive.id, error: 'S3 对象保留期无效或已到期' });
          }
        }
      } catch (error) {
        problems.push({ id: archive.id, error: error.message });
      }
    }
    return {
      valid: problems.length === 0,
      archives: archives.length,
      entries: archives.reduce((sum, item) => sum + Number(item.count || 0), 0),
      storage: this.s3Enabled ? 's3-object-lock' : 'local-readonly',
      problems
    };
  }

  async flush() {
    if (this.running) return { skipped: true };
    this.running = true;
    try {
      const tenants = await this.store.find('tenants', () => true);
      let archived = 0;
      const errors = [];
      for (const tenant of tenants) {
        try {
          if (await this.archiveTenant(tenant.id)) archived += 1;
        } catch (error) {
          errors.push({ tenantId: tenant.id, error: error.message });
          this.logger.error('audit.archive-error', { tenantId: tenant.id, error: error.message });
        }
      }
      const platform = await this.archiveTenant('__platform__');
      if (platform) archived += 1;
      return { tenants: tenants.length + 1, archived, errors };
    } finally {
      this.running = false;
    }
  }

  start() {
    if (!this.config.enabled || !this.config.workerEnabled || this.timer) return;
    const interval = Math.max(10000, Number(this.config.intervalMs) || 60000);
    this.timer = setInterval(() => this.flush().catch(error => {
      this.logger.error('audit.archive-worker-error', { error: error.message });
    }), interval);
    if (this.timer.unref) this.timer.unref();
  }

  async shutdown() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = AuditArchiveService;
