// 并发超卖测试 worker：打开同一 SQLite 文件，多次 atomicDec，输出成功次数
const SqliteStore = require('../src/store/SqliteStore');
const dir = process.argv[2];
const attempts = Number(process.argv[3]) || 1;
const store = new SqliteStore(dir);
(async () => {
  await store.initialize();
  let ok = 0;
  for (let i = 0; i < attempts; i++) {
    if (await store.atomicDec('products', 'p1', 'stock', 1)) ok++;
  }
  await store.shutdown();
  process.stdout.write(String(ok));
})().catch(error => {
  console.error(error.stack);
  process.exit(1);
});
