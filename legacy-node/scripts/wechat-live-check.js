'use strict';

require('dotenv').config();
const config = require('../config/default');
const WechatService = require('../src/services/WechatService');

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

(async () => {
  const service = new WechatService(config.wechat);
  try {
    if (config.wechat.mock || config.env !== 'production') {
      throw new Error('真实微信检查必须在 NODE_ENV=production 且 WX_MOCK=false 时执行');
    }
    await service.initialize();
    console.log('[PASS] 微信登录与支付基础配置已加载');

    const token = await service.getAccessToken();
    console.log('[PASS] access_token 获取成功: ' + String(token).slice(0, 8) + '***');

    const loginCode = argument('--login-code');
    if (loginCode) {
      const session = await service.code2Session(loginCode);
      console.log('[PASS] code2Session 成功: openid ' + String(session.openid || '').slice(0, 8) + '***');
    }

    const openid = argument('--openid');
    const templateId = argument('--template-id');
    if (openid || templateId) {
      if (!openid || !templateId) throw new Error('发送订阅消息必须同时提供 --openid 和 --template-id');
      const data = JSON.parse(argument('--data') || '{"thing1":{"value":"订阅测试"}}');
      await service.sendSubscribeMessage({ openid, templateId, page: argument('--page'), data });
      console.log('[PASS] 订阅消息接口已接受发送请求；请在真实微信账号确认是否收到');
    }

    const billDate = argument('--bill-date');
    if (billDate) {
      const bill = await service.downloadTradeBill(billDate);
      console.log('[PASS] 微信支付只读接口与响应验签成功，账单字节数: ' + Buffer.byteLength(bill, 'utf8'));
    }

    console.log('\n真实微信检查完成。支付扣款/退款仍需使用专门测试商户和真实小程序账号执行资金验收。');
  } finally {
    service.shutdown();
  }
})().catch(error => {
  console.error('[FAIL] ' + error.message);
  process.exit(1);
});
