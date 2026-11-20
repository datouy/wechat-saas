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
    const cert = this.platformCertificates[serial];
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
