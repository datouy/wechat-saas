/** 用法: DATA_STORE=postgres DATABASE_URL=... node scripts/migrate.js [--status] */
require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const dir = path.resolve(__dirname, '..', 'db', 'migrations');
const connectionString = process.env.DATABASE_URL || '';

(async () => {
  if (!connectionString) throw new Error('缺少 DATABASE_URL');
  const client = new Client({
    connectionString,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined
  });
  await client.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      checksum TEXT NOT NULL
    )`);
    const applied = new Map((await client.query('SELECT version, checksum FROM schema_migrations ORDER BY version')).rows.map(row => [row.version, row.checksum]));
    const files = (await fs.promises.readdir(dir)).filter(name => name.endsWith('.sql')).sort();
    if (process.argv.includes('--status')) {
      console.log(JSON.stringify(files.map(name => ({ version: name, applied: applied.has(name) })), null, 2));
      return;
    }
    for (const name of files) {
      const sql = await fs.promises.readFile(path.join(dir, name), 'utf8');
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');
      if (applied.has(name)) {
        if (applied.get(name) !== checksum) throw new Error('迁移文件已被修改: ' + name);
        console.log('[skip] ' + name);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [name, checksum]);
        await client.query('COMMIT');
        console.log('[applied] ' + name);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(name + ': ' + error.message);
      }
    }
  } finally {
    await client.end();
  }
})().catch(error => {
  console.error('[迁移失败] ' + error.message);
  process.exit(1);
});
