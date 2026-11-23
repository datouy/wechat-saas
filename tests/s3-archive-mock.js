/** 本地 S3 兼容端点验收：验证签名 PUT、Object Lock 请求头、GET 校验与归档幂等。 */
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const assert = require('assert');
const SqliteStore = require('../src/store/SqliteStore');
const AuditArchiveService = require('../src/core/AuditArchiveService');

(async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wechat-saas-s3-'));
  const object = { body: '', putHeaders: null, getHeaders: null };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      if (req.method === 'PUT') {
        object.putHeaders = req.headers;
        object.body = Buffer.concat(chunks).toString('utf8');
        res.writeHead(200);
        res.end();
        return;
      }
      if (req.method === 'GET') {
        object.getHeaders = req.headers;
        object.getHeaders['x-amz-object-lock-mode'] = object.putHeaders['x-amz-object-lock-mode'];
        object.getHeaders['x-amz-object-lock-retain-until-date'] = object.putHeaders['x-amz-object-lock-retain-until-date'];
        res.writeHead(200, {
          'content-type': 'application/x-ndjson',
          'x-amz-object-lock-mode': object.putHeaders['x-amz-object-lock-mode'],
          'x-amz-object-lock-retain-until-date': object.putHeaders['x-amz-object-lock-retain-until-date']
        });
        res.end(object.body);
        return;
      }
      res.writeHead(405);
      res.end();
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const store = new SqliteStore(path.join(root, 'data'));
  await store.initialize();
  const service = new AuditArchiveService(store, {
    dir: path.join(root, 'local'),
    retainUntilDays: 3650,
    s3: {
      endpoint: 'http://127.0.0.1:' + port,
      region: 'us-east-1',
      bucket: 'audit-test',
      accessKeyId: 'test-access',
      secretAccessKey: 'test-secret',
      objectLockMode: 'COMPLIANCE'
    }
  });
  try {
    await store.insert('auditLogs', {
      id: 's3-audit-1',
      tenantId: 't-s3',
      sequence: 1,
      hash: 'hash-1',
      action: 'test.s3',
      createdAt: new Date().toISOString()
    });
    const archive = await service.archiveTenant('t-s3');
    assert(archive && archive.storage.type === 's3');
    assert(archive.storage.objectLockMode === 'COMPLIANCE');
    assert(/^AWS4-HMAC-SHA256 Credential=test-access\//.test(object.putHeaders.authorization));
    assert(object.putHeaders['x-amz-object-lock-mode'] === 'COMPLIANCE');
    assert(object.putHeaders['x-amz-object-lock-retain-until-date']);
    const verification = await service.verify('t-s3');
    assert(verification.valid && verification.entries === 1);
    assert((await service.archiveTenant('t-s3')) === null, '同一审计段不应重复归档');
    console.log('S3 归档模拟验收通过: 1/1');
  } finally {
    await store.shutdown();
    await new Promise(resolve => server.close(resolve));
    await fs.promises.rm(root, { recursive: true, force: true });
  }
})().catch(error => {
  console.error('[S3 归档模拟验收失败] ' + error.stack);
  process.exitCode = 1;
});
