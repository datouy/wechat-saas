/**
 * 三后端灾备演练。自动启动临时 PostgreSQL 17，并复用 dr-drill.js 生成统一报告。
 * 该命令依赖 devDependencies 中的 embedded-postgres，仅用于隔离验收。
 */
require('dotenv').config();
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(os.tmpdir(), 'wechat-saas-dr-all-' + Date.now());
let postgres;

function portFree(port) {
  return new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

async function availablePort() {
  for (let port = 55532; port < 55632; port += 1) {
    if (await portFree(port)) return port;
  }
  throw new Error('没有可用的 PostgreSQL 灾备演练端口');
}

function reportPath() {
  const arg = process.argv.find(value => value.startsWith('--report='));
  return path.resolve(arg ? arg.slice('--report='.length) : path.join('work', 'dr-drill-all-latest.json'));
}

(async () => {
  const port = await availablePort();
  process.env.PGDATABASE = 'postgres';
  const EmbeddedPostgresModule = require('embedded-postgres');
  const EmbeddedPostgres = EmbeddedPostgresModule.default || EmbeddedPostgresModule;
  postgres = new EmbeddedPostgres({
    databaseDir: path.join(root, 'cluster'),
    user: 'postgres',
    password: 'drillpg123',
    port,
    persistent: true,
    onLog: () => {},
    onError: error => console.error('[embedded-postgres] ' + error)
  });
  await postgres.initialise();
  await postgres.start();
  await postgres.createDatabase('wechat_saas_dr_source');
  await postgres.createDatabase('wechat_saas_dr_restore');

  const sourceUrl = 'postgresql://postgres:drillpg123@127.0.0.1:' + port + '/wechat_saas_dr_source';
  const restoreUrl = 'postgresql://postgres:drillpg123@127.0.0.1:' + port + '/wechat_saas_dr_restore';
  const target = reportPath();
  execFileSync(process.execPath, [
    path.join(__dirname, 'dr-drill.js'),
    '--report=' + target
  ], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      DRILL_DATABASE_URL: sourceUrl,
      DRILL_RESTORE_DATABASE_URL: restoreUrl
    },
    stdio: 'inherit'
  });
  console.log('[灾备演练] 三后端报告: ' + target);
})().catch(error => {
  console.error('[三后端灾备演练失败] ' + error.stack);
  process.exitCode = 1;
}).finally(async () => {
  if (postgres) await postgres.stop().catch(() => {});
  await fs.promises.rm(root, { recursive: true, force: true }).catch(() => {});
});
