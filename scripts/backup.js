/**
 * 数据备份脚本：将 DATA_DIR 下的 JSON 集合快照到带时间戳的目录。
 * 用法: node scripts/backup.js [目标目录]
 * 生产建议配合 cron 或对象存储；恢复演练见 docs/数据库迁移.md
 */
const fs = require('fs');
const path = require('path');

const dataDir = path.resolve(process.env.DATA_DIR || './data');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const target = path.resolve(process.argv[2] || path.join('backups', 'data-' + stamp));

if (!fs.existsSync(dataDir)) {
  console.error('[备份] 数据目录不存在: ' + dataDir);
  process.exit(1);
}

fs.mkdirSync(target, { recursive: true });
const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.json'));
for (const f of files) {
  fs.copyFileSync(path.join(dataDir, f), path.join(target, f));
}

const manifest = {
  createdAt: new Date().toISOString(),
  source: dataDir,
  files
};
fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify(manifest, null, 2));

console.log('[备份] 已备份 ' + files.length + ' 个集合到: ' + target);
