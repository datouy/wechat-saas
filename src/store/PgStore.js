/**
 * PostgreSQL 运行时文档存储。
 *
 * 业务层长期使用统一的文档集合接口；本实现将集合保存在 saas_documents 中，
 * 同时提供真实的跨实例事务、行锁、原子扣减和租户/集合索引。
 * 读方法的谓词仍在 Node.js 侧执行，以保持与 JSON/SQLite 后端一致；
 * 高频报表后续可增加专用 SQL 投影，而不改变业务接口。
 */
const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');
const { Pool } = require('pg');

const VALID_COLLECTION = /^[A-Za-z][A-Za-z0-9_]{0,62}$/;

class PgStore {
  constructor(options = {}) {
    this.connectionString = options.connectionString || process.env.DATABASE_URL || '';
    this.pool = null;
    this.txContext = new AsyncLocalStorage();
    this.ssl = options.ssl;
  }

  async initialize() {
    if (!this.connectionString) {
      throw new Error('[PgStore] 缺少 DATABASE_URL');
    }
    this.pool = new Pool({
      connectionString: this.connectionString,
      max: Number(process.env.PG_POOL_MAX) || 20,
      idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS) || 30000,
      connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS) || 5000,
      ssl: this.ssl
    });
    this.pool.on('error', error => console.error('[PgStore] 空闲连接错误: ' + error.message));

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS saas_documents (
        collection TEXT NOT NULL,
        id TEXT NOT NULL,
        doc JSONB NOT NULL,
        revision BIGINT NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (collection, id)
      )
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_saas_documents_tenant
      ON saas_documents (collection, (doc->>'tenantId'))
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_saas_documents_member
      ON saas_documents (collection, (doc->>'memberId'))
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_saas_documents_status
      ON saas_documents (collection, (doc->>'status'), updated_at)
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_saas_documents_due
      ON saas_documents (collection, (doc->>'nextAttemptAt'))
      WHERE doc->>'nextAttemptAt' IS NOT NULL
    `);
    await this._installAuditGuards();
    console.log('[PgStore] PostgreSQL 文档存储已就绪');
  }

  async _installAuditGuards() {
    await this.pool.query(`
      CREATE OR REPLACE FUNCTION saas_protect_audit_document() RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'DELETE' AND OLD.collection = 'auditLogs' THEN
          RAISE EXCEPTION 'auditLogs is append-only';
        END IF;
        IF TG_OP = 'UPDATE' AND OLD.collection = 'auditLogs' THEN
          IF COALESCE(OLD.doc->>'hash', '') <> '' THEN
            RAISE EXCEPTION 'sealed auditLogs are append-only';
          END IF;
          IF (NEW.doc - ARRAY['sequence','previousHash','version','hash']) <>
             (OLD.doc - ARRAY['sequence','previousHash','version','hash']) THEN
            RAISE EXCEPTION 'legacy audit sealing may only add chain metadata';
          END IF;
        END IF;
        RETURN COALESCE(NEW, OLD);
      END;
      $$ LANGUAGE plpgsql
    `);
    await this.pool.query('DROP TRIGGER IF EXISTS trg_saas_documents_audit_guard ON saas_documents');
    await this.pool.query(`
      CREATE TRIGGER trg_saas_documents_audit_guard
      BEFORE UPDATE OR DELETE ON saas_documents
      FOR EACH ROW EXECUTE FUNCTION saas_protect_audit_document()
    `);
  }

  _runner() {
    return this.txContext.getStore() || this.pool;
  }

  _assertCollection(name) {
    const value = String(name || '');
    if (!VALID_COLLECTION.test(value)) throw new Error('[PgStore] 非法集合名: ' + value);
    return value;
  }

  async load(name) {
    return this.find(name, () => true);
  }

  async collection(name) {
    return this.find(name, () => true);
  }

  async insert(name, doc) {
    const collection = this._assertCollection(name);
    const result = await this._runner().query(
      `INSERT INTO saas_documents (collection, id, doc, revision)
       VALUES ($1, $2, $3::jsonb, 1)
       RETURNING doc`,
      [collection, String(doc.id), JSON.stringify(doc)]
    );
    return result.rows[0].doc;
  }

  async findById(name, id) {
    const collection = this._assertCollection(name);
    const result = await this._runner().query(
      'SELECT doc FROM saas_documents WHERE collection = $1 AND id = $2',
      [collection, String(id)]
    );
    return result.rows[0] ? result.rows[0].doc : null;
  }

  async findByIdForUpdate(name, id) {
    const collection = this._assertCollection(name);
    if (!this.txContext.getStore()) throw new Error('[PgStore] findByIdForUpdate 必须在事务中调用');
    const result = await this._runner().query(
      'SELECT doc FROM saas_documents WHERE collection = $1 AND id = $2 FOR UPDATE',
      [collection, String(id)]
    );
    return result.rows[0] ? result.rows[0].doc : null;
  }

  async update(name, id, patch) {
    const collection = this._assertCollection(name);
    const result = await this._runner().query(
      `UPDATE saas_documents
       SET doc = doc || $3::jsonb || jsonb_build_object('updatedAt', $4::text),
           revision = revision + 1,
           updated_at = now()
       WHERE collection = $1 AND id = $2
       RETURNING doc`,
      [collection, String(id), JSON.stringify(patch || {}), new Date().toISOString()]
    );
    return result.rows[0] ? result.rows[0].doc : null;
  }

  async remove(name, id) {
    const collection = this._assertCollection(name);
    const result = await this._runner().query(
      'DELETE FROM saas_documents WHERE collection = $1 AND id = $2',
      [collection, String(id)]
    );
    return result.rowCount > 0;
  }

  async find(name, predicate) {
    const collection = this._assertCollection(name);
    const result = await this._runner().query(
      'SELECT doc FROM saas_documents WHERE collection = $1',
      [collection]
    );
    const docs = result.rows.map(row => row.doc);
    return typeof predicate === 'function' ? docs.filter(predicate) : docs;
  }

  async count(name, predicate) {
    return (await this.find(name, predicate)).length;
  }

  async transaction(fn) {
    if (this.txContext.getStore()) return fn();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      const result = await this.txContext.run(client, () => fn());
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (rollbackError) {}
      throw error;
    } finally {
      client.release();
    }
  }

  async lock(key) {
    if (!this.txContext.getStore()) throw new Error('[PgStore] lock 必须在事务中调用');
    await this._runner().query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [String(key)]);
  }

  async atomicDec(name, id, field, qty) {
    return this.transaction(async () => {
      const doc = await this.findByIdForUpdate(name, id);
      if (!doc) return false;
      const current = Number(doc[field]) || 0;
      const amount = Number(qty) || 0;
      if (amount <= 0 || current < amount) return false;
      await this.update(name, id, { [field]: current - amount });
      return true;
    });
  }

  async ping() {
    const result = await this.pool.query('SELECT 1 AS ok');
    return result.rows[0] && result.rows[0].ok === 1;
  }

  async exportCollections() {
    const result = await this.pool.query(
      'SELECT collection, doc FROM saas_documents ORDER BY collection, id'
    );
    const out = {};
    for (const row of result.rows) {
      if (!out[row.collection]) out[row.collection] = [];
      out[row.collection].push(row.doc);
    }
    return out;
  }

  /** 恢复完整快照：目标运行时集合必须被整体替换，不能与旧数据合并。 */
  async importCollections(collections) {
    const entries = Object.entries(collections || {});
    for (const [name] of entries) this._assertCollection(name);
    await this.transaction(async () => {
      // 使用独立恢复账号执行；TRUNCATE 不会触发行级 DELETE 审计保护。
      await this._runner().query('TRUNCATE TABLE saas_documents');
      for (const [name, docs] of entries) {
        for (const doc of docs || []) {
          await this._runner().query(
            `INSERT INTO saas_documents (collection, id, doc)
             VALUES ($1, $2, $3::jsonb)
             ON CONFLICT (collection, id)
             DO UPDATE SET doc = EXCLUDED.doc, revision = saas_documents.revision + 1, updated_at = now()`,
            [name, String(doc.id), JSON.stringify(doc)]
          );
        }
      }
    });
  }

  /** 用于备份清单校验的稳定摘要。 */
  async digest() {
    const payload = JSON.stringify(await this.exportCollections());
    return crypto.createHash('sha256').update(payload).digest('hex');
  }

  markDirty() { return; }
  async flush() { return []; }

  async shutdown() {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  get kind() { return 'postgres'; }
}

module.exports = PgStore;
