/**
 * 并发超卖测试：多个进程共享同一 SQLite 文件同时扣库存
 * 初始 stock=50，4 个进程各尝试扣 15 次（共 60 次），应恰好 50 次成功、库存归零，不出现负数
 */
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execFileSync } = require('child_process');
const SqliteStore = require('../src/store/SqliteStore');

(async () => {
  const dir = path.join(os.tmpdir(), 'oversell-' + Date.now());
  fs.mkdirSync(dir, { recursive: true });

  const seed = new SqliteStore(dir);
  await seed.initialize();
  await seed.insert('products', { id: 'p1', stock: 50 });
  await seed.shutdown();

  const WORKERS = 4;
  const ATTEMPTS = 15;
  const workerPath = path.join(__dirname, '_oversell-worker.js');
  let ok = 0;
  for (let i = 0; i < WORKERS; i++) {
    const out = execFileSync(process.execPath, [workerPath, dir, String(ATTEMPTS)], { encoding: 'utf8' });
    const lines = out.trim().split(/\r?\n/);
    ok += Number(lines[lines.length - 1].trim());
  }

  const check = new SqliteStore(dir);
  await check.initialize();
  const product = await check.findById('products', 'p1');
  await check.shutdown();
  fs.rmSync(dir, { recursive: true, force: true });

  console.log('成功扣减次数: ' + ok + ' / 60');
  console.log('最终库存: ' + product.stock);
  if (ok === 50 && product.stock === 0) {
    console.log('✅ 未超卖：恰好 50 次成功，10 次被拒，库存归零');
    process.exit(0);
  }
  console.log('❌ 异常：存在超卖或漏扣');
  process.exit(1);
})().catch(error => {
  console.error(error.stack);
  process.exit(1);
});
