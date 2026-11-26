'use strict';

/**
 * PostgreSQL 主备切换演练与验收：
 * 1) 核对主库流复制状态与 WAL 延迟；
 * 2) 核对备库处于 recovery 且 replay 位置；
 * 3) 对主备两库的 saas_documents 做 SHA-256 摘要，比对业务数据一致性；
 * 4) 核对审计链头哈希一致；
 * 5) 输出 pg_promote 切换命令与切换后健康/一致性检查清单（不自动切换）。
 *
 * 用法：
 *   PRIMARY_DATABASE_URL=... STANDBY_DATABASE_URL=... node scripts/pg-failover-drill.js
 */
const crypto = require('crypto');
const { Pool } = require('pg');

const primaryUrl = process.env.PRIMARY_DATABASE_URL || '';
const standbyUrl = process.env.STANDBY_DATABASE_URL || '';
const baseUrl = process.env.PUBLIC_BASE_URL || '';

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function query(pool, sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows;
}

async function documentsDigest(pool) {
  const rows = await query(pool,
    "SELECT collection, id, doc::text AS doc FROM saas_documents ORDER BY collection, id"
  );
  const payload = rows.map(row => row.collection + '|' + row.id + '|' + row.doc).join(String.fromCharCode(10));
  return { count: rows.length, digest: sha256(payload) };
}

async function auditHead(pool) {
  const rows = await query(pool,
    "SELECT doc FROM saas_documents WHERE collection = 'auditLogs' ORDER BY (doc->>'sequence')::int DESC LIMIT 1"
  );
  const head = rows[0] ? rows[0].doc : null;
  return head ? { sequence: head.sequence, hash: head.hash, tenantId: head.tenantId } : null;
}

(async () => {
  if (!primaryUrl || !standbyUrl) {
    console.error('缺少 PRIMARY_DATABASE_URL 或 STANDBY_DATABASE_URL');
    process.exit(1);
  }

  const primary = new Pool({ connectionString: primaryUrl, max: 2 });
  const standby = new Pool({ connectionString: standbyUrl, max: 2 });
  const results = [];

  const add = (ok, name, detail) => results.push({ ok, name, detail });
  const pass = (name, detail) => add(true, name, detail);
  const fail = (name, detail) => add(false, name, detail);

  try {
    const replication = await query(primary, 'SELECT application_name, state, sync_state, pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn) AS lag_bytes FROM pg_stat_replication');
    if (!replication.length) {
      fail('流复制状态', '主库没有活动的流复制连接');
    } else {
      for (const row of replication) {
        const ok = row.state === 'streaming' && Number(row.lag_bytes || 0) < 10 * 1024 * 1024;
        add(ok, '流复制连接 ' + (row.application_name || row.sync_state), row.state + '，lag=' + row.lag_bytes + ' bytes');
      }
    }

    const standbyState = await query(standby, 'SELECT pg_is_in_recovery() AS in_recovery, pg_last_wal_receive_lsn() AS receive_lsn, pg_last_wal_replay_lsn() AS replay_lsn');
    const inRecovery = standbyState[0] && standbyState[0].in_recovery;
    add(inRecovery === true, '备库恢复模式', 'pg_is_in_recovery()=' + inRecovery + '，replay_lsn=' + (standbyState[0] && standbyState[0].replay_lsn));

    const primaryDigest = await documentsDigest(primary);
    const standbyDigest = await documentsDigest(standby);
    const digestOk = primaryDigest.digest === standbyDigest.digest && primaryDigest.count === standbyDigest.count;
    add(digestOk, '业务数据一致性', 'primary ' + primaryDigest.count + ' docs / standby ' + standbyDigest.count + ' docs，摘要' + (digestOk ? '一致' : '不一致'));

    const primaryHead = await auditHead(primary);
    const standbyHead = await auditHead(standby);
    const auditOk = primaryHead && standbyHead && primaryHead.hash === standbyHead.hash && primaryHead.sequence === standbyHead.sequence;
    add(auditOk, '审计链头一致性', 'primary head seq=' + (primaryHead && primaryHead.sequence) + ' / standby head seq=' + (standbyHead && standbyHead.sequence));

    console.log('===== PostgreSQL 主备切换演练验收 =====');
    for (const item of results) {
      console.log('[' + (item.ok ? 'PASS' : 'FAIL') + '] ' + item.name + (item.detail ? ': ' + item.detail : ''));
    }
    const failures = results.filter(item => !item.ok).length;

    console.log('');
    console.log('切换命令（需在备库执行，人工确认后进行）：');
    console.log('  SELECT pg_promote();');
    console.log('');
    console.log('切换后检查清单：');
    console.log('  1) ' + (baseUrl || '<PUBLIC_BASE_URL>') + '/healthz 与 /readyz 返回 200');
    console.log('  2) 重新运行本脚本，核对新主库与恢复后的旧主库业务摘要一致');
    console.log('  3) 用 dr:drill:all 复核订单/库存/积分/优惠券/审计链');
    console.log('  4) 确认应用已切换 DATABASE_URL 并重启 worker');

    console.log('');
    console.log('结果: ' + (results.length - failures) + ' PASS, ' + failures + ' FAIL');
    process.exit(failures ? 1 : 0);
  } finally {
    await primary.end().catch(() => {});
    await standby.end().catch(() => {});
  }
})().catch(error => {
  console.error('[pg-failover-drill] ' + error.stack);
  process.exit(1);
});

