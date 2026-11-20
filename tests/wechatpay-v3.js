/**
 * 微信支付 v3 加解密/验签单元测试（使用本地生成的 RSA 密钥验证签名往返）
 * 覆盖：小程序支付参数 RSA 签名、回调验签、AES-256-GCM 资源解密、错误签名拒绝、平台证书下载轮换
 */
const crypto = require('crypto');
const WechatService = require('../src/services/WechatService');

let passed = 0, failed = 0;
function assert(cond, msg) { if (!cond) throw new Error(msg || '断言失败'); }
function test(name, fn) {
  try { fn(); console.log('  ✅ ' + name); passed++; }
  catch (e) { console.log('  ❌ ' + name + ' -> ' + e.message); failed++; }
}

const API_V3_KEY = '0123456789abcdef0123456789abcdef'; // 32字节
const APP_ID = 'wx-test-appid';
const MCH_ID = '1900000001';

// 生成商户私钥 + 平台证书（用公钥PEM代替证书，签名验签逻辑一致）
const merchantKeys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const platformKeys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const merchantPublicPem = merchantKeys.publicKey.export({ type: 'spki', format: 'pem' });
const merchantPrivatePem = merchantKeys.privateKey.export({ type: 'pkcs8', format: 'pem' });
const platformPublicPem = platformKeys.publicKey.export({ type: 'spki', format: 'pem' });
const platformPrivatePem = platformKeys.privateKey.export({ type: 'pkcs8', format: 'pem' });

const wechat = new WechatService({
  mock: false,
  appId: APP_ID,
  mchId: MCH_ID,
  apiV3Key: API_V3_KEY,
  payPrivateKey: merchantPrivatePem,
  paySerialNo: 'SERIAL-0001',
  notifyUrl: 'https://example.com/api/wx/pay/notify',
  platformCertificates: { 'PLATFORM-SERIAL-1': platformPublicPem }
});

console.log('\n===== 微信支付 v3 加解密测试 =====\n');

test('小程序支付参数使用 RSA 签名且 signType=RSA', () => {
  const params = wechat.buildPayParams('prepay_id_test_001');
  assert(params.signType === 'RSA', 'signType 应为 RSA');
  const msg = APP_ID + '\n' + params.timeStamp + '\n' + params.nonceStr + '\n' + params.package + '\n';
  const v = crypto.createVerify('RSA-SHA256');
  v.update(msg);
  assert(v.verify(merchantPublicPem, params.paySign, 'base64'), '支付参数签名校验失败');
});

function makeNotifyResource() {
  const payment = {
    appid: APP_ID, mchid: MCH_ID, out_trade_no: 'NT20260101000001',
    transaction_id: '420000000000000001', trade_state: 'SUCCESS',
    trade_type: 'JSAPI', amount: { total: 100, payer_total: 100, currency: 'CNY' },
    payer: { openid: 'mock_openid' }, success_time: new Date().toISOString()
  };
  const nonce = 'abcdefghijkl'; // 12字节
  const aad = 'transaction';
  const key = Buffer.from(API_V3_KEY, 'utf8');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, Buffer.from(nonce, 'utf8'));
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const enc = Buffer.concat([cipher.update(JSON.stringify(payment), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const ciphertext = Buffer.concat([enc, tag]).toString('base64');
  return { payment, resource: { ciphertext, nonce, associated_data: aad, algorithm: 'AEAD_AES_256_GCM' } };
}

function signNotify(timestamp, nonce, body) {
  const msg = timestamp + '\n' + nonce + '\n' + body + '\n';
  const s = crypto.createSign('RSA-SHA256');
  s.update(msg);
  return s.sign(platformPrivatePem, 'base64');
}

test('回调验签 + AES-GCM 解密返回支付结果', () => {
  const { payment, resource } = makeNotifyResource();
  const body = JSON.stringify({ id: 'evt-001', event_type: 'TRANSACTION.SUCCESS', resource });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomBytes(16).toString('hex');
  const signature = signNotify(timestamp, nonce, body);
  const headers = {
    'wechatpay-timestamp': timestamp,
    'wechatpay-nonce': nonce,
    'wechatpay-signature': signature,
    'wechatpay-serial': 'PLATFORM-SERIAL-1'
  };
  const result = wechat.verifyPayNotify(headers, body);
  assert(result.out_trade_no === payment.out_trade_no, 'out_trade_no 解密不一致');
  assert(result.transaction_id === payment.transaction_id, 'transaction_id 解密不一致');
  assert(result.amount.total === 100, '金额解密不一致');
});

test('错误签名被拒绝', () => {
  const { resource } = makeNotifyResource();
  const body = JSON.stringify({ id: 'evt-002', event_type: 'TRANSACTION.SUCCESS', resource });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomBytes(16).toString('hex');
  const headers = {
    'wechatpay-timestamp': timestamp,
    'wechatpay-nonce': nonce,
    'wechatpay-signature': signNotify(timestamp, nonce, body + 'tamper'),
    'wechatpay-serial': 'PLATFORM-SERIAL-1'
  };
  let threw = false;
  try { wechat.verifyPayNotify(headers, body); } catch (e) { threw = true; }
  assert(threw, '篡改后的签名应当被拒绝');
});

test('未知平台证书序列号被拒绝', () => {
  const { resource } = makeNotifyResource();
  const body = JSON.stringify({ id: 'evt-003', event_type: 'TRANSACTION.SUCCESS', resource });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomBytes(16).toString('hex');
  const headers = {
    'wechatpay-timestamp': timestamp,
    'wechatpay-nonce': nonce,
    'wechatpay-signature': signNotify(timestamp, nonce, body),
    'wechatpay-serial': 'UNKNOWN-SERIAL'
  };
  let threw = false;
  try { wechat.verifyPayNotify(headers, body); } catch (e) { threw = true; }
  assert(threw, '未知证书序列号应当被拒绝');
});

(async () => {
  try {
    // 平台证书下载/轮换测试：mock _requestV3 返回加密证书，避免真实网络请求
    const newCert = {
      serial_no: 'PLATFORM-SERIAL-2',
      effective_time: '2026-01-01T00:00:00+08:00',
      expire_time: '2030-01-01T00:00:00+08:00',
      certificate: platformPublicPem
    };
    const nonce = 'abcdefghijkl';
    const aad = 'certificate';
    const key = Buffer.from(API_V3_KEY, 'utf8');
    const cipher = crypto.createCipheriv('aes-256-gcm', key, Buffer.from(nonce, 'utf8'));
    cipher.setAAD(Buffer.from(aad, 'utf8'));
    const enc = Buffer.concat([cipher.update(JSON.stringify(newCert), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const ciphertext = Buffer.concat([enc, tag]).toString('base64');

    const original = wechat._requestV3;
    wechat._requestV3 = async () => ({ data: [{ encrypt_certificate: { ciphertext, nonce, associated_data: aad } }] });
    try {
      await wechat.downloadPlatformCertificates();
      const cert = wechat.getPlatformCert('PLATFORM-SERIAL-2');
      assert(typeof cert === 'string' && cert.includes('BEGIN PUBLIC KEY'), '下载的证书未按序列号写入');

      const { resource } = makeNotifyResource();
      const body = JSON.stringify({ id: 'evt-004', event_type: 'TRANSACTION.SUCCESS', resource });
      const ts = String(Math.floor(Date.now() / 1000));
      const n = crypto.randomBytes(16).toString('hex');
      const sig = signNotify(ts, n, body);
      const result = wechat.verifyPayNotify({
        'wechatpay-timestamp': ts,
        'wechatpay-nonce': n,
        'wechatpay-signature': sig,
        'wechatpay-serial': 'PLATFORM-SERIAL-2'
      }, body);
      assert(result.out_trade_no === 'NT20260101000001', '新证书验签+解密失败');
      console.log('  ✅ 下载并轮换平台证书');
      passed++;
    } finally {
      wechat._requestV3 = original;
    }
  } catch (e) {
    console.log('  ❌ 下载并轮换平台证书 -> ' + e.message);
    failed++;
  }

  console.log('\n===== 结果 =====');
  console.log('通过: ' + passed + ' | 失败: ' + failed);
  process.exit(failed ? 1 : 0);
})();