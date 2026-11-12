/**
 * 微信服务对接层
 * - 小程序登录 code2Session（真实调用微信接口 / 本地mock）
 * - 微信支付 JSAPI 下单（真实模式返回支付参数；mock模式直接成功）
 * - access_token 缓存管理（真实模式）
 *
 * 本地开发默认 mock=true，无需AppID即可跑通全部业务流程。
 * 上线步骤见 docs/微信上线清单.md
 */
const https = require('https');
const crypto = require('crypto');

class WechatService {
  constructor(config) {
    this.config = config || { mock: true };
    this.accessTokenCache = null;
  }

  get mock() { return this.config.mock !== false; }

  /** 简易HTTPS请求封装 */
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
    if (!code) throw new Error('缺少登录code');

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
    if (result.errcode) throw new Error('微信登录失败: ' + result.errcode + ' ' + (result.errmsg || ''));
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

  /**
   * JSAPI下单（微信支付v3）
   * 真实模式返回小程序 wx.requestPayment 所需参数
   * 注意：完整v3下单需商户API证书签名，此处提供标准参数结构与mock通道；
   *      生产接入请按 docs/微信上线清单.md 配置证书后启用。
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
    throw new Error('真实微信支付需配置商户证书与v3签名，详见 docs/微信上线清单.md');
  }

  /** 构造小程序支付签名参数（v3，示例实现） */
  buildPayParams(prepayId, appId, mchId, payKey) {
    const timeStamp = String(Math.floor(Date.now() / 1000));
    const nonceStr = crypto.randomBytes(16).toString('hex');
    const pkg = 'prepay_id=' + prepayId;
    const message = appId + '\n' + timeStamp + '\n' + nonceStr + '\n' + pkg + '\n';
    const paySign = crypto.createHmac('sha256', payKey).update(message).digest('base64');
    return { timeStamp, nonceStr, package: pkg, signType: 'RSA', paySign, mchId };
  }
}

module.exports = WechatService;
