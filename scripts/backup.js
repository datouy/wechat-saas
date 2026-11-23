/** 用法: node scripts/backup.js [输出目录] [--backend=json|sqlite|postgres] */
require('dotenv').config();
const path = require('path');
const config = require('../config/default');
const BackupService = require('../src/core/BackupService');

function arg(name, fallback) {
  const prefix = '--' + name + '=';
  const found = process.argv.find(value => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

(async () => {
  const positional = process.argv.slice(2).find(value => !value.startsWith('--'));
  const backend = arg('backend', config.dataStore);
  const service = new BackupService(config);
  const result = await service.create(positional, { backend });
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
})().catch(error => {
  console.error('[备份失败] ' + error.message);
  process.exit(1);
});
