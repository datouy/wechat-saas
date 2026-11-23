/** 可校验、可加密、覆盖 JSON/SQLite/PostgreSQL 的应用级备份与恢复。 */
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

class BackupService {
  constructor(config = {}, options = {}) {
    this.config = config;
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
  }

  async create(outputDir, options = {}) {
    const startedAt = Date.now();
    const backend = String(options.backend || this.config.dataStore || 'json');
    const payload = await this._snapshot(backend, options);
    const compressed = zlib.gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'), { level: 9 });
    const checksum = sha256(compressed);
    const envelope = this._encrypt(compressed, options);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dir = path.resolve(outputDir || this.config.backup.dir || './backups');
    await fs.promises.mkdir(dir, { recursive: true });
    const file = path.join(dir, 'wechat-saas-' + backend + '-' + stamp + '.snapshot.json');
    const outer = {
      format: 'wechat-saas-backup-v1',
      backend,
      createdAt: new Date().toISOString(),
      checksum,
      ...envelope
    };
    const body = JSON.stringify(outer);
    await this._writeAtomic(file, body);
    const manifest = {
      file, checksum: sha256(body), payloadChecksum: checksum, backend,
      createdAt: outer.createdAt, bytes: Buffer.byteLength(body), encrypted: !!envelope.encrypted,
      durationMs: Date.now() - startedAt
    };
    await this._writeAtomic(file + '.manifest.json', JSON.stringify(manifest, null, 2));
    await this.cleanup(dir, options.retentionDays);
    return manifest;
  }

  async restore(snapshotFile, options = {}) {
    const startedAt = Date.now();
    const outer = JSON.parse(await fs.promises.readFile(snapshotFile, 'utf8'));
    if (outer.format !== 'wechat-saas-backup-v1') throw new Error('不支持的备份格式');
    const compressed = this._decrypt(outer, options);
    if (sha256(compressed) !== outer.checksum) throw new Error('备份载荷校验和不一致');
    const payload = JSON.parse(zlib.gunzipSync(compressed).toString('utf8'));
    const result = await this._restorePayload(payload, options);
    return { ...result, backend: outer.backend, createdAt: outer.createdAt, durationMs: Date.now() - startedAt };
  }

  async digest(snapshotFile, options = {}) {
    const outer = JSON.parse(await fs.promises.readFile(snapshotFile, 'utf8'));
    const compressed = this._decrypt(outer, options);
    if (sha256(compressed) !== outer.checksum) throw new Error('备份载荷校验和不一致');
    return sha256(zlib.gunzipSync(compressed));
  }

  async _snapshot(backend, options) {
    const createdAt = new Date().toISOString();
    if (backend === 'json') {
      const dataDir = path.resolve(options.dataDir || this.config.dataDir || './data');
      const collections = {};
      for (const name of await fs.promises.readdir(dataDir).catch(() => [])) {
        if (!name.endsWith('.json')) continue;
        collections[name.replace(/\.json$/, '')] = JSON.parse(await fs.promises.readFile(path.join(dataDir, name), 'utf8'));
      }
      return { backend, createdAt, collections, assets: await this._collectFiles(options.uploadDir || this.config.uploads.dir) };
    }
    if (backend === 'sqlite') {
      const { DatabaseSync } = require('node:sqlite');
      const dataDir = path.resolve(options.dataDir || this.config.dataDir || './data');
      const source = path.join(dataDir, 'app.sqlite');
      const temporary = path.join(os.tmpdir(), 'wechat-saas-backup-' + crypto.randomUUID() + '.sqlite');
      const db = new DatabaseSync(source);
      try {
        db.exec("VACUUM INTO '" + temporary.replace(/'/g, "''") + "'");
      } finally {
        db.close();
      }
      const data = await fs.promises.readFile(temporary);
      await fs.promises.unlink(temporary).catch(() => {});
      return {
        backend, createdAt, sqlite: data.toString('base64'),
        assets: await this._collectFiles(options.uploadDir || this.config.uploads.dir)
      };
    }
    if (backend === 'postgres') {
      const PgStore = require('../store/PgStore');
      const store = new PgStore({ connectionString: options.databaseUrl || this.config.database.url, ssl: this.config.database.ssl });
      await store.initialize();
      try {
        return {
          backend, createdAt, collections: await store.exportCollections(),
          assets: await this._collectFiles(options.uploadDir || this.config.uploads.dir)
        };
      } finally {
        await store.shutdown();
      }
    }
    throw new Error('不支持的备份后端: ' + backend);
  }

  async _restorePayload(payload, options) {
    if (payload.backend === 'json') {
      const target = path.resolve(options.targetDir || this.config.dataDir || './data');
      await this._prepareTarget(target, options.force);
      if (options.force) await this._clearJsonCollections(target);
      for (const [name, docs] of Object.entries(payload.collections || {})) {
        await fs.promises.writeFile(path.join(target, name + '.json'), JSON.stringify(docs, null, 1), { mode: 0o640 });
      }
      await this._restoreFiles(options.uploadDir || this.config.uploads.dir, payload.assets);
      return { target, collections: Object.keys(payload.collections || {}).length };
    }
    if (payload.backend === 'sqlite') {
      const target = path.resolve(options.targetDir || this.config.dataDir || './data');
      await fs.promises.mkdir(target, { recursive: true });
      const file = path.join(target, 'app.sqlite');
      if (fs.existsSync(file) && !options.force) throw new Error('目标 SQLite 已存在；恢复演练请使用 --force 或新目录');
      const buffer = Buffer.from(payload.sqlite, 'base64');
      const temp = file + '.restore-' + process.pid;
      await fs.promises.writeFile(temp, buffer, { mode: 0o640 });
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(temp, { readOnly: true });
      const check = db.prepare('PRAGMA integrity_check').get();
      db.close();
      if (!check || check.integrity_check !== 'ok') throw new Error('SQLite 备份完整性检查失败');
      if (fs.existsSync(file)) await fs.promises.rename(file, file + '.pre-restore-' + Date.now());
      await fs.promises.rename(temp, file);
      await this._restoreFiles(options.uploadDir || this.config.uploads.dir, payload.assets);
      return { target, sqlite: file };
    }
    if (payload.backend === 'postgres') {
      if (!options.databaseUrl) throw new Error('PostgreSQL 恢复必须提供目标 DATABASE_URL');
      if (options.allowOverwrite !== true) throw new Error('PostgreSQL 恢复必须显式允许目标数据库写入');
      const PgStore = require('../store/PgStore');
      const store = new PgStore({ connectionString: options.databaseUrl, ssl: options.databaseSsl });
      await store.initialize();
      try {
        await store.importCollections(payload.collections || {});
        await this._restoreFiles(options.uploadDir || this.config.uploads.dir, payload.assets);
        return { target: options.databaseUrl.replace(/:[^:@/]+@/, ':***@'), collections: Object.keys(payload.collections || {}).length };
      } finally {
        await store.shutdown();
      }
    }
    throw new Error('备份载荷后端不受支持');
  }

  _encrypt(buffer, options) {
    const keyMaterial = options.encryptionKey || this.config.backup.encryptionKey;
    if (this.config.env === 'production' && (!keyMaterial || String(keyMaterial).length < 16)) {
      throw new Error('生产备份必须配置至少 16 位的 BACKUP_ENCRYPTION_KEY');
    }
    if (!keyMaterial) return { encrypted: false, data: buffer.toString('base64') };
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const key = crypto.scryptSync(String(keyMaterial), salt, 32);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([cipher.update(buffer), cipher.final()]);
    return {
      encrypted: true, salt: salt.toString('base64'), iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64')
    };
  }

  _decrypt(outer, options) {
    const data = Buffer.from(outer.data, 'base64');
    if (!outer.encrypted) return data;
    const keyMaterial = options.encryptionKey || this.config.backup.encryptionKey;
    if (!keyMaterial) throw new Error('备份已加密，请提供 BACKUP_ENCRYPTION_KEY');
    const key = crypto.scryptSync(String(keyMaterial), Buffer.from(outer.salt, 'base64'), 32);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(outer.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(outer.tag, 'base64'));
    return Buffer.concat([decipher.update(data), decipher.final()]);
  }

  async _collectFiles(root) {
    if (!root) return {};
    const resolved = path.resolve(root);
    if (!fs.existsSync(resolved)) return {};
    const out = {};
    async function walk(dir) {
      for (const entry of await fs.promises.readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (entry.isFile()) out[path.relative(resolved, full).replace(/\\/g, '/')] = (await fs.promises.readFile(full)).toString('base64');
      }
    }
    await walk(resolved);
    return out;
  }

  async _restoreFiles(root, files) {
    if (!root || !files) return;
    const resolved = path.resolve(root);
    for (const [relative, base64] of Object.entries(files)) {
      const safe = relative.split('/').filter(part => part && part !== '..').join('/');
      const target = path.resolve(resolved, safe);
      if (!target.startsWith(resolved + path.sep) && target !== resolved) throw new Error('非法素材路径');
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      await fs.promises.writeFile(target, Buffer.from(base64, 'base64'), { mode: 0o640 });
    }
  }

  async _prepareTarget(target, force) {
    if (fs.existsSync(target) && (await fs.promises.readdir(target)).length && !force) {
      throw new Error('目标目录非空；恢复演练请使用 --force 或新目录');
    }
    await fs.promises.mkdir(target, { recursive: true });
  }

  async _clearJsonCollections(target) {
    for (const name of await fs.promises.readdir(target)) {
      if (name.endsWith('.json')) await fs.promises.unlink(path.join(target, name));
    }
  }

  async _writeAtomic(file, body) {
    const temp = file + '.tmp-' + process.pid;
    const handle = await fs.promises.open(temp, 'wx', 0o640);
    try {
      await handle.writeFile(body, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.promises.rename(temp, file);
  }

  async cleanup(dir, retentionDays) {
    const days = Math.max(1, Number(retentionDays) || Number(this.config.backup.retentionDays) || 30);
    const cutoff = Date.now() - days * 86400000;
    for (const name of await fs.promises.readdir(dir).catch(() => [])) {
      if (!name.endsWith('.snapshot.json')) continue;
      const file = path.join(dir, name);
      const stat = await fs.promises.stat(file);
      if (stat.mtimeMs < cutoff) {
        await fs.promises.unlink(file).catch(() => {});
        await fs.promises.unlink(file + '.manifest.json').catch(() => {});
      }
    }
  }
}

module.exports = BackupService;
