// 以 SQLite 后端运行核心业务测试
process.env.DATA_STORE = 'sqlite';
require('./run.js');