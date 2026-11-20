/**
 * 微信服务对接层
 * - 小程序登录 code2Session（真实调用微信接口 / 本地mock）
 * - 微信支付 v3（JSAPI 下单、回调验签、资源解密、退款）
 * - access_token 缓存管理（真实模式）
 *
 * 本地开发默认 mock=true，无需AppID即可跑通全部业务流程。
 * 生产接入需配置商户 API 私钥、证书序列号、APIv3 密钥与平台证书，见 docs/微信上线清单.md
 */
const https = require('https');
const crypto = require('crypto');
const { business } = require('../errors');

class WechatService {
  constructor(config) {
    this.config = config || { mock: true };
    this.accessTokenCache = null;

    // 微信支付 v3 所需配置
    this.appId = config.appId || '';
    this.mchId = config.mchId || '';
    this.apiV3Key = config.apiV3Key || config.payApiV3Key || '';
    this.privateKey = config.payPrivateKey || config.privateKey || '';
    this.serialNo = config.paySerialNo || config.serialNo || '';
    this.notifyUrl = config.notifyUrl || '';
    // 平台证书映射：serialNo -> PEM 公钥证书；也可通过 loadPlatformCertificates 动态获取
    this.platformCertificates = config.platformCertificates || {};
  }

  get mock() { return this.config.mock !== false; }

  /** 简易HTTPS请求封装（用于登录/token等普通接口） */
  _request(options, body) {
    return new Promise((resolve, reject) => {
      const req = https.request(options, res => {
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch (e) { resolve({ raw: data }); }
        });
      });
      req.on('error', reject);
      req.setTimeout(10000, () => { req.destroy(); reject(new Error('微信接口请求超时')); });
      if (body) req.write(body);
      req.end();
    });
  }

  /**
   * 小程序登录：code -> openid/session_key
   * mock模式：根据code派生稳定openid，便于本地联调
   */
  async code2Session(code) {
    if (!code) throw business('缺少登录code');

    if (this.mock) {
      const hash = crypto.createHash('md5').update(String(code)).digest('hex');
      return {
        openid: 'mock_' + hash.slice(0, 20),
        session_key: 'mock_session_' + hash.slice(0, 16),
        mock: true
      };
    }

    if (!this.config.appId || !this.config.appSecret) {
      throw new Error('未配置微信AppID/AppSecret（或启用mock模式）');
    }
    const url = '/sns/jscode2session?appid=' + encodeURIComponent(this.config.appId) +
      '&secret=' + encodeURIComponent(this.config.appSecret) +
      '&js_code=' + encodeURIComponent(code) + '&grant_type=authorization_code';
    const result = await this._request({
      hostname: 'api.weixin.qq.com', path: url, method: 'GET'
    });
    if (result.errcode) throw business('微信登录失败: ' + result.errcode + ' ' + (result.errmsg || ''));
    return result;
  }

  /** 获取接口调用凭证（真实模式，带缓存） */
  async getAccessToken() {
    if (this.accessTokenCache && this.accessTokenCache.expiresAt > Date.now() + 60000) {
      return this.accessTokenCache.token;
    }
    if (this.mock) return 'mock_access_token';
    const url = '/cgi-bin/token?grant_type=client_credential&appid=' +
      encodeURIComponent(this.config.appId) + '&secret=' + encodeURIComponent(this.config.appSecret);
    const result = await this._request({ hostname: 'api.weixin.qq.com', path: url, method: 'GET' });
    if (!result.access_token) throw new Error('获取access_token失败: ' + JSON.stringify(result));
    this.accessTokenCache = {
      token: result.access_token,
      expiresAt: Date.now() + (result.expires_in || 7000) * 1000
    };
    return result.access_token;
  }

  // ===================== 微信支付 v3 =====================

  /** RSA-SHA256 签名（商户私钥），返回 base64 */
  _rsaSign(message) {
    if (!this.privateKey) throw new Error('缺少商户 API 私钥 WX_PAY_PRIVATE_KEY');
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(message, 'utf8');
    return sign.sign(this.privateKey, 'base64');
  }

  /** 构造 v3 请求 Authorization 头 */
  _authHeader(method, urlPath, body) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = crypto.randomBytes(16).toString('hex');
    const message = method + '\n' + urlPath + '\n' + timestamp + '\n' + nonce + '\n' + body + '\n';
    const signature = this._rsaSign(message);
    return {
      'Authorization': 'WECHATPAY2-SHA256-RSA2048 mchid="' + this.mchId +
        '",nonce_str="' + nonce + '",signature="' + signature +
        '",timestamp="' + timestamp + '",serial_no="' + this.serialNo + '"',
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'wechat-saas/1.0.0'
    };
  }

  /** 微信支付 v3 接口请求（自动签名） */
  async _requestV3(method, urlPath, bodyObj) {
    const body = bodyObj ? JSON.stringify(bodyObj) : '';
    const headers = this._authHeader(method, urlPath, body);
    const result = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.mch.weixin.qq.com',
        path: urlPath,
        method,
        headers
      }, res => {
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => {
          let parsed;
          try { parsed = JSON.parse(data); } catch (e) { parsed = { raw: data }; }
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed);
          else {
            const msg = (parsed && (parsed.message || parsed.code)) || ('HTTP ' + res.statusCode);
            reject(new Error('微信支付请求失败: ' + msg));
          }
        });
      });
      req.on('error', reject);
      req.setTimeout(10000, () => { req.destroy(); reject(new Error('微信支付接口请求超时')); });
      if (body) req.write(body);
      req.end();
    });
    return result;
  }


  /** 微信支付 v3 原始响应请求（对账单等返回非 JSON 文本的接口） */
  async _requestV3Raw(method, urlPath, bodyObj) {
    const body = bodyObj ? JSON.stringify(bodyObj) : '';
    const headers = this._authHeader(method, urlPath, body);
    const result = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.mch.weixin.qq.com',
        path: urlPath,
        method,
        headers
      }, res => {
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(data);
          else reject(new Error('微信支付请求失败: HTTP ' + res.statusCode));
        });
      });
      req.on('error', reject);
      req.setTimeout(10000, () => { req.destroy(); reject(new Error('微信支付接口请求超时')); });
      if (body) req.write(body);
      req.end();
    });
    return result;
  }

  /** 下载账单 CSV 文件（download_url 为无需商户签名的明文地址，返回原始文本） */
  _requestPlain(url) {
    return new Promise((resolve, reject) => {
      const req = https.get(url, res => {
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => resolve(data));
      });
      req.on('error', reject);
      req.setTimeout(10000, () => { req.destroy(); reject(new Error('账单下载超时')); });
    });
  }
  /**
   * JSAPI下单（微信支付 v3）
   * 真实模式：调用 /v3/pay/transactions/jsapi 获取 prepay_id，再构造小程序调起支付参数
   * mock模式：本地直接返回模拟参数
   */
  async createJsapiOrder(order) {
    if (this.mock) {
      return {
        timeStamp: String(Math.floor(Date.now() / 1000)),
        nonceStr: crypto.randomBytes(8).toString('hex'),
        package: 'prepay_id=mock_' + order.orderNo,
        signType: 'RSA',
        paySign: 'MOCK_SIGN',
        mock: true
      };
    }

    if (!this.appId || !this.mchId || !this.serialNo || !this.privateKey || !this.apiV3Key) {
      throw new Error('微信支付 v3 配置不完整，无法下单（需 AppID/MCHID/证书序列号/私钥/APIv3密钥）');
    }

    const body = {
      appid: this.appId,
      mchid: this.mchId,
      description: String(order.description || '邻里团订单').slice(0, 127),
      out_trade_no: order.orderNo,
      notify_url: this.notifyUrl,
      amount: { total: Math.round(Number(order.amount) || 0), currency: 'CNY' },
      payer: { openid: order.openid }
    };

    const result = await this._requestV3('POST', '/v3/pay/transactions/jsapi', body);
    if (!result.prepay_id) throw new Error('微信下单失败：未返回 prepay_id');
    return this.buildPayParams(result.prepay_id);
  }

  /** 构造小程序 wx.requestPayment 所需参数（signType=RSA，使用商户私钥签名） */
  buildPayParams(prepayId) {
    const appId = this.appId;
    const timeStamp = String(Math.floor(Date.now() / 1000));
    const nonceStr = crypto.randomBytes(16).toString('hex');
    const pkg = 'prepay_id=' + prepayId;
    const message = appId + '\n' + timeStamp + '\n' + nonceStr + '\n' + pkg + '\n';
    const paySign = this._rsaSign(message);
    return { timeStamp, nonceStr, package: pkg, signType: 'RSA', paySign };
  }

  /**
   * 校验支付回调并解密资源
   * @param headers 请求头（wechatpay-timestamp/nonce/signature/serial）
   * @param rawBody 原始请求体（未经 JSON.parse，用于验签）
   * @returns 解密后的支付结果对象 { out_trade_no, transaction_id, trade_state, amount, mchid, appid, ... }
   */
  verifyPayNotify(headers, rawBody) {
    const h = (k) => headers[k] || headers[k.toLowerCase()] || '';
    const timestamp = h('wechatpay-timestamp');
    const nonce = h('wechatpay-nonce');
    const signature = h('wechatpay-signature');
    const serial = h('wechatpay-serial');

    if (!timestamp || !nonce || !signature || !serial) {
      throw new Error('支付回调缺少验签头');
    }
    const cert = this.getPlatformCert(serial);
    if (!cert) throw new Error('未找到微信平台证书: ' + serial);

    const message = timestamp + '\n' + nonce + '\n' + rawBody + '\n';
    const verify = crypto.createVerify('RSA-SHA256');
    verify.update(message, 'utf8');
    const ok = verify.verify(cert, signature, 'base64');
    if (!ok) throw new Error('支付回调签名校验失败');

    let body;
    try { body = JSON.parse(rawBody); } catch (e) { throw new Error('支付回调 body 不是合法 JSON'); }
    if (!body.resource) throw new Error('支付回调缺少 resource');
    return this.decryptResource(body.resource);
  }

  /** AES-256-GCM 解密回调 resource */
  decryptResource(resource) {
    if (!this.apiV3Key) throw new Error('缺少 APIv3 密钥');
    const key = Buffer.from(this.apiV3Key, 'utf8');
    if (key.length !== 32) throw new Error('APIv3 密钥长度必须为32字节');

    const buf = Buffer.from(resource.ciphertext, 'base64');
    const authTag = buf.subarray(buf.length - 16);
    const ciphertext = buf.subarray(0, buf.length - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(resource.nonce || '', 'utf8'));
    decipher.setAuthTag(authTag);
    decipher.setAAD(Buffer.from(resource.associated_data || '', 'utf8'));
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    return JSON.parse(decrypted);
  }

  /**
   * 下载并轮换微信平台证书（GET /v3/certificates）
   * 响应为用 APIv3 密钥 AES-256-GCM 加密的证书列表；解密后按 serial_no 存入 platformCertificates。
   * 说明：首次联调需先在商户平台下载平台证书作为 bootstrap（或首次下载后人工核对），后续可用本方法自动轮换。
   */
  async downloadPlatformCertificates() {
    if (!this.mchId || !this.serialNo || !this.privateKey || !this.apiV3Key) {
      throw business('微信支付配置不完整，无法下载平台证书');
    }
    const result = await this._requestV3('GET', '/v3/certificates', null);
    const list = result && result.data;
    if (!Array.isArray(list) || list.length === 0) throw business('下载平台证书失败：响应缺少 data');

    const updated = {};
    for (const item of list) {
      if (!item.encrypt_certificate) continue;
      const decrypted = this.decryptResource(item.encrypt_certificate);
      // 解密字段：serial_no / effective_time / expire_time / certificate
      if (decrypted.serial_no && decrypted.certificate) {
        updated[decrypted.serial_no] = {
          pem: decrypted.certificate,
          expireAt: decrypted.expire_time || null
        };
      }
    }
    // 兼容旧格式（字符串 PEM）与新增的 {pem, expireAt} 对象
    this.platformCertificates = { ...this.platformCertificates, ...updated };
    return this.platformCertificates;
  }

  /** 获取指定序列号的平台证书（兼容字符串/对象两种存储）；不存在返回 null */
  getPlatformCert(serialNo) {
    const c = this.platformCertificates && this.platformCertificates[serialNo];
    if (!c) return null;
    return typeof c === 'string' ? c : c.pem;
  }

  /**
   * 下载交易对账单（微信支付 v3）
   * @param date YYYY-MM-DD
   * mock 模式返回确定性示例 CSV；真实模式先请求 /v3/bill/tradebill 获取 download_url，再下载 CSV 原文。
   * 说明：真实对账需完成商户证书/密钥联调，本方法已实现完整调用链路但尚未接入真实环境验证。
   */
  async downloadTradeBill(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) throw business('对账日期格式应为 YYYY-MM-DD');
    if (this.mock) return this._mockTradeBill(date);
    if (!this.mchId || !this.serialNo || !this.privateKey || !this.apiV3Key) throw business('微信支付配置不完整，无法下载对账单');
    const url = '/v3/bill/tradebill?bill_date=' + encodeURIComponent(String(date));
    const meta = await this._requestV3('GET', url, null);
    if (meta && meta.download_url) return this._requestPlain(meta.download_url);
    if (meta && typeof meta.raw === 'string') return meta.raw;
    throw business('对账单下载失败：未返回下载地址或账单内容');
  }

  /** mock 对账单（与真实表头一致，供对账流程本地联调） */
  _mockTradeBill(date) {
    const header = '交易时间,公众账号ID,商户号,特约商户号,设备号,微信订单号,商户订单号,用户标识,交易类型,交易状态,付款银行,货币种类,应结订单金额,代金券金额,微信退款单号,商户退款单号,退款金额,充值券退款金额,退款类型,退款状态,商品名称,商户数据包,手续费,费率,订单金额,申请退款金额,费率备注';
    const row = [
      date + ' 12:00:00', 'wx-test-appid', '1900000001', '', '', '420000000000000001',
      'NT20260101000001', 'mock_openid', 'JSAPI', 'SUCCESS', 'BANK', 'CNY', '1.00', '0.00',
      '', '', '0.00', '0.00', '', '', '邻里团订单', '', '0.00', '0.60%', '1.00', '0.00', ''
    ];
    return header + '\n' + row.join(',');
  }
  /** 退款（微信支付 v3） */
  async refund({ outTradeNo, outRefundNo, total, refund, reason }) {
    if (this.mock) {
      return { mock: true, out_refund_no: outRefundNo, status: 'PROCESSING' };
    }
    const body = {
      out_trade_no: outTradeNo,
      out_refund_no: outRefundNo,
      amount: { refund: Math.round(Number(refund) || 0), total: Math.round(Number(total) || 0), currency: 'CNY' },
      reason: String(reason || '用户申请退款').slice(0, 80)
    };
    return this._requestV3('POST', '/v3/refund/domestic/refunds', body);
  }
}

module.exports = WechatService;
