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

管理后台默认账号：**admin / admin123**（仅本地开发默认；生产环境请在 .env 中修改 ADMIN_PASSWORD）。

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
│   ├── services/WechatService.js  # 微信登录/支付v3（mock+真实）
│   ├── auth/                 # 令牌签发/口令哈希/管理员账号
│   ├── errors.js / validation.js / logger.js  # 错误码/Zod校验/结构化日志
│   ├── core/AuditLog.js      # 操作审计日志
│   ├── api/ApiService.js      # 小程序API + 管理后台API
│   └── web/templates/index.html   # 管理后台界面
├── mini-program/              # 微信小程序源码（开发者工具可直接导入）
├── tests/run.js               # 自动化测试
├── docs/微信上线清单.md        # 上线配置指南
├── docs/数据库迁移.md          # JSON→PostgreSQL 迁移方案
├── db/migrations/001_init.sql  # PostgreSQL 企业版 Schema
├── Dockerfile / docker-compose.yml / scripts/backup.js  # 部署与备份
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
npm run test:all
```

- `npm test`：核心业务全链路（28 项）
- `npm run test:http`：会员/管理员令牌、越权访问、租户隔离（12 项）
- `npm run test:pay`：微信支付 v3 RSA 签名 / 回调验签 / AES-GCM 解密（4 项）
- `npm run test:validation`：参数校验、分页、安全头、审计日志（11 项）
- `npm run test:tenant`：多租户隔离、未知租户拒绝、登录不信任自报 tenantId（6 项）
- `npm run test:sqlite`：SQLite 后端核心业务全链路（28 项）
- `npm run test:concurrency`：多进程并发扣库存，验证原子扣减不超卖

## 🚀 部署

```bash
docker compose up -d --build
```

- `Dockerfile`：node:20-alpine 非 root 运行，内置 `/healthz` 健康检查
- `docker-compose.yml`：挂载 `./data` 持久化数据（PostgreSQL 迁移预留，见 `db/migrations/001_init.sql`）
- `scripts/backup.js`：JSON 数据快照备份
- `.github/workflows/ci.yml`：CI 跑测试 + npm audit

## ✅ 已完成的企业级加固

- **鉴权**：HMAC 签名令牌（会员/管理员两类）、scrypt 口令哈希、租户由令牌推导，不再信任客户端自报身份
- **微信支付 v3**：RSA-SHA256 下单签名、回调验签 + AES-256-GCM 解密、金额/商户号/AppID 校验、退款，小程序 `wx.requestPayment`
- **交易一致性**：库存「可用+预留」语义（下单扣可用、支付后记销量）、优惠券 reserved/used/released、成团后仍可参团、已支付订单需走退款
- **参数校验**：Zod 入口校验，统一错误码 + requestId
- **存储**：JSON 原子写入与内置 SQLite 双后端；SQLite 提供跨集合 ACID 事务与原子条件扣减防超卖（`DATA_STORE=sqlite` 启用）
- **安全**：Helmet、登录/全局限流、管理后台存储型 XSS 转义、CORS 白名单预留
- **分页/审计**：管理端列表分页、操作审计日志

## ⚠️ 当前边界

- 默认 JSON 文件存储适合单机小规模（<1万订单）；`DATA_STORE=sqlite` 可启用内置 SQLite 后端（ACID 事务 + 原子扣减防超卖，支持多进程/多实例），规模再增长可迁移 PostgreSQL（见 `docs/数据库迁移.md`）
- 真实微信支付 v3 已实现，但需要真实商户证书/APIv3 密钥/平台证书才能端到端联调（本地用生成的 RSA 密钥验证了加解密往返）
- 公开目录（首页/商品/团购/问卷列表）通过 `X-Tenant-Id` 定位租户，租户 ID 必须命中注册表（`TenantManager`），非法租户返回 400；敏感身份与写操作均需令牌鉴权

## License

MIT
