# 邻里团 · 微信生态小程序 SaaS

> 面向社区团购 / 会员积分 / 预约排队 / 表单问卷四大场景的多商户SaaS平台
> 商家管理后台 + 微信小程序端 = 开箱即用

## ✨ 功能特性

| 模块 | 能力 |
|------|------|
| 🛍 商品管理 | 分类、商品、库存、上下架、销量统计 |
| 🎯 社区团购 | 团购活动、成团进度、开团参团、自动截止 |
| 📦 订单管理 | 下单/支付/发货/收货全流程，库存自动扣减回滚 |
| 👥 会员中心 | 微信登录、会员资料、收货地址、消费统计 |
| 💰 积分体系 | 消费返积分、积分抵扣（可配置比例与上限）、完整流水 |
| 🎟 优惠券 | 满减券模板、领取限制、下单核销 |
| 📝 问卷表单 | 满意度调查/投票/报名，结果自动统计（分布+均分） |
| 📅 预约管理 | 服务项目、时段容量、防重复预约、取消 |
| 📊 经营看板 | 今日/累计销售额、7日趋势、热销Top5 |

## 🚀 快速开始（本地，无需微信AppID）

```bash
cd F:\\project\\Dtou\\wechat-saas
npm install
npm start
```

打开 http://localhost:3100 进入**商家管理后台**。首次启动会自动生成演示数据（6个商品、2个团购、2张优惠券、1个问卷、2个预约服务、1个演示会员）。

默认 **微信模拟模式**：小程序登录、支付在本地直接模拟成功，可完整走通"下单→支付→发货→收货"流程。

### 小程序端

1. 打开 **微信开发者工具**（你电脑已安装）
2. 导入项目目录：`F:\\project\\Dtou\\wechat-saas\\mini-program`
3. AppID 选择"测试号"即可
4. 详情 → 本地设置 → 勾选「不校验合法域名」
5. 点击编译，即可看到小程序界面（首页/问卷/预约/订单/我的）

## 📁 项目结构

```
wechat-saas/
├── config/default.js          # 全局配置（微信/积分/订单规则）
├── src/
│   ├── index.js               # 服务入口
│   ├── store/JsonStore.js     # JSON持久化（零原生依赖）
│   ├── core/                  # 业务核心
│   │   ├── ProductManager.js
│   │   ├── OrderManager.js
│   │   ├── GroupBuyManager.js
│   │   ├── MemberManager.js
│   │   ├── PointsManager.js
│   │   ├── CouponManager.js
│   │   ├── FormManager.js
│   │   ├── AppointmentManager.js
│   │   ├── StatsService.js
│   │   └── seed.js
│   ├── services/WechatService.js  # 微信登录/支付（mock+真实）
│   ├── api/ApiService.js      # 小程序API + 管理后台API
│   └── web/templates/index.html   # 管理后台界面
├── mini-program/              # 微信小程序源码（开发者工具可直接导入）
├── tests/run.js               # 自动化测试
├── docs/微信上线清单.md        # 上线配置指南
└── data/                      # 运行期数据（JSON文件）
```

## 🔌 API 概览

### 小程序端 `/api/wx/*`
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/wx/login | 微信登录（mock/真实） |
| GET | /api/wx/home | 首页：分类+商品+团购 |
| GET | /api/wx/products | 商品列表 |
| POST | /api/wx/orders | 创建订单（支持积分/优惠券/团购价） |
| POST | /api/wx/orders/:id/pay | 支付订单 |
| POST | /api/wx/orders/:id/cancel | 取消订单 |
| POST | /api/wx/orders/:id/complete | 确认收货 |
| GET | /api/wx/member/:id/points | 积分余额与流水 |
| POST | /api/wx/coupons/claim | 领取优惠券 |
| POST | /api/wx/groupbuys/:id/join | 参团 |
| POST | /api/wx/forms/:id/submit | 提交问卷 |
| GET | /api/wx/appointments/slots | 查询可约时段 |
| POST | /api/wx/appointments | 提交预约 |

### 管理后台 `/api/admin/*`
商品/订单/会员/优惠券/团购/问卷/预约/统计/系统信息，完整CRUD见 `src/api/ApiService.js`。

## 💰 商业模式参考

| 收入模式 | 说明 | 定价参考 |
|---------|------|---------|
| 订阅费 | 商家按月/年付费使用SaaS | ¥99-299/月/商户 |
| 交易佣金 | 按成交额抽成 | 0.5%-2% |
| 增值服务 | 定制开发、代运营、私域培训 | ¥3000-20000/单 |
| 多商户加盟 | 发展区域代理，收取代理费 | ¥5000-30000/年 |

## 🛣 商业化路线图

- **阶段1（当前）**：单机版MVP，JSON存储，本地模拟微信 —— 验证需求
- **阶段2**：接入真实微信登录/支付，部署到云服务器，HTTPS域名
- **阶段3**：MySQL + Redis，多商户开通流程，订阅计费
- **阶段4**：小程序模板市场、行业插件、区域代理体系

## ✅ 测试

```bash
npm test
```

覆盖：下单→支付→发货→收货全链路、积分抵扣、优惠券核销、库存回滚、团购成团、问卷提交、预约占位。

## ⚠️ 当前边界

- 数据存储为JSON文件，适合单机和小规模使用（<1万订单）；规模增长后请迁移数据库
- 真实微信支付需要商户API证书与v3签名实现（见上线清单）
- 多商户目前通过 `X-Tenant-Id` 请求头隔离，管理端鉴权/登录体系待阶段3补充

## License

MIT
