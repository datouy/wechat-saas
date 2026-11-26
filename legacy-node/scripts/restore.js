/**
 * 用法:
 *   node scripts/restore.js <snapshot> --target=<目录> [--force]
 *   node scripts/restore.js <snapshot> --database-url=<隔离数据库> --allow-overwrite
 */
require('dotenv').config();
const config = require('../config/default');
const BackupService = require('../src/core/BackupService');

function arg(name, fallback) {
  const prefix = '--' + name + '=';
  const found = process.argv.find(value => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

(async () => {
  const file = process.argv.slice(2).find(value => !value.startsWith('--'));
  if (!file) throw new Error('缺少备份文件路径');
  const service = new BackupService(config);
  const result = await service.restore(file, {
    targetDir: arg('target', ''),
    databaseUrl: arg('database-url', ''),
    force: process.argv.includes('--force'),
    allowOverwrite: process.argv.includes('--allow-overwrite'),
    encryptionKey: arg('encryption-key', '')
  });
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
})().catch(error => {
  console.error('[恢复失败] ' + error.message);
  process.exit(1);
});
