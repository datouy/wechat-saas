/**
 * 邻里团 SaaS - 全局配置
 * 本地开发默认使用 mock 模式：无需真实微信AppID即可跑通全部流程
 * 上线时将 wechat.mock 设为 false 并填入 AppID / AppSecret / 商户号
 */
module.exports = {
  server: {
    port: Number(process.env.PORT) || 3100,
    host: process.env.HOST || '0.0.0.0'
  },
  dataDir: './data',
  wechat: {
    // 小程序凭证（微信公众平台 -> 开发管理 -> 开发设置）
    appId: process.env.WX_APPID || '',
    appSecret: process.env.WX_SECRET || '',
    // 微信支付商户凭证（商户平台 -> 账户中心）
    mchId: process.env.WX_MCHID || '',
    payApiV3Key: process.env.WX_PAY_KEY || '',
    notifyUrl: process.env.WX_NOTIFY_URL || 'https://your-domain.com/api/wx/pay/notify',
    // 本地开发模拟模式：true 时登录/支付均使用本地模拟实现
    mock: process.env.WX_MOCK !== 'false'
  },
  tenant: {
    // 默认商户（多商户SaaS可后续扩展开通流程）
    defaultId: 't-default',
    defaultName: '邻里团示范社区'
  },
  orders: {
    payTimeoutMinutes: 30,   // 未支付订单自动取消
    autoCompleteDays: 3,     // 发货后自动确认收货
    deliveryFee: 0           // 配送费（自提为0）
  },
  points: {
    enabled: true,
    ratePerYuan: 1,           // 每消费1元积1分
    commentReward: 5,         // 评价奖励积分
    maxPercentPerOrder: 50    // 单笔订单最多可用积分抵扣订单金额的百分比
  },
  coupon: {
    maxPerOrder: 1            // 单笔订单最多使用1张优惠券
  },
  groupBuy: {
    minParticipants: 2,       // 默认成团人数
    autoCloseHours: 24        // 活动默认持续小时数
  },
  log: {
    level: process.env.LOG_LEVEL || 'info'
  }
};
