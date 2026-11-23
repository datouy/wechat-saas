# 邻里团 · 微信生态小程序 SaaS

> 面向社区团购 / 会员积分 / 预约排队 / 表单问卷四大场景的多商户 SaaS 平台
> 商家经营台 + 顾客体验端 + 微信小程序 = 一套可完整演示的经营闭环

## ✨ 功能特性

| 模块 | 能力 |
|------|------|
| 🛍 商品管理 | 分类、商品、库存、上下架、销量统计 |
| 🎯 社区团购 | 团购创建、成团进度、截止改期、人数上限、结束活动、自动截止 |
| 📦 订单履约 | 下单/支付/发货/收货、自提门店、取货码核销、物流与退款状态 |
| 🧾 售后服务 | 顾客退款/退货/投诉申请与撤回，经营台受理、拒绝和完成 |
| 🏬 多履约门店 | 自提点、配送门店、营业时间、主门店与品牌色配置 |
| 👥 会员运营 | 会员资料、地址 CRUD、消费统计、分层、复购、沉睡召回与群文案 |
| 🎛 客户运营 | 客户档案、积分调整、优惠券定向发放、订单与预约历史 |
| 💰 积分体系 | 消费返积分、积分抵扣（可配置比例与上限）、完整流水 |
| 🎟 优惠券 | 满减券模板、领取限制、下单核销 |
| 📝 问卷表单 | 满意度调查/投票/报名，结果自动统计（分布+均分） |
| 📅 预约管理 | 服务项目、时段容量、防重复预约、取消 |
| 📊 经营驾驶舱 | 今日待办、三步真实引导、经营建议、异常雷达、7 日趋势与门店对比 |
| 🔔 消息中心 | 微信订阅消息模板管理、支付/取货/退款/售后事件和测试发送 |
| 🛡 企业管控 | 三角色权限、登录限流、会话撤销、密码策略、请求追踪与结构化日志 |
| 🔗 链式审计 | 每租户 SHA-256 前序哈希链、序号连续性校验、异常定位与操作报表 |
| 🧾 交易对账 | 微信交易账单与本地订单比对，识别漏单、金额和退款差异 |

## 🚀 快速开始（本地，无需微信 AppID）

运行环境：**Node.js >= 22.5**（内置 SQLite 依赖 `node:sqlite`）。

```bash
cd E:\\project\\Dtou\\wechat-saas
npm install
npm start
```

打开 http://localhost:3100 进入**商家经营台**，打开 http://localhost:3100/shop 进入**顾客体验端**。首次启动会自动生成 6 个商品、2 个团购、5 位客户、5 笔订单、优惠券、积分、问卷、预约和低库存待办。

管理后台默认账号：**admin / admin123**（仅本地开发默认；生产环境请在 .env 中修改 ADMIN_PASSWORD）。

默认 **微信模拟模式**：小程序登录、支付在本地直接模拟成功，可完整走通"下单→支付→发货→收货"流程。

## ⏱ 10 分钟体验路线

1. 在经营台使用 `admin / admin123` 登录。「今天」页会自动完成第一步引导，展示待办、经营建议和异常雷达。
2. 点击「打开顾客体验端」，先维护默认收货地址，再参加苹果团购并用优惠券或积分支付；第二步引导会由真实订单操作推导。
3. 选择门店自提完成结算，回到经营台核销取货码；顾客端订单详情会显示取货码、门店和完整履约记录。
4. 在顾客端对已支付订单提交售后并尝试撤回；在经营台「售后工单」完成受理、拒绝或结束处理。
5. 在商品详情调整库存并撤销一次调整，在团购页修改截止时间和人数上限，在优惠券页停发一个模板。
6. 打开「客户」进入任一档案，查看积分、复购与优惠券轨迹；第三步引导会由真实查看动作完成。
7. 在「会员增长」查看分层、复购率、沉睡名单并复制群运营素材；在「经营报表」查看操作趋势和门店收入对比。
8. 在「设置」上传 Logo/Banner、修改品牌色和小程序标题；所有者可新增员工、测试订阅消息模板并撤销会话。
9. 打开「运营保障」查看订阅授权率、Outbox、死信重试和审计归档；最后到「交易对账」检查账单差异。

### 小程序端

1. 打开 **微信开发者工具**（你电脑已安装）
2. 导入项目目录：`E:\\project\\Dtou\\wechat-saas\\mini-program`
3. AppID 选择"测试号"即可
4. 详情 → 本地设置 → 勾选「不校验合法域名」
5. 点击编译，即可使用首页、问卷、预约、结算、订单详情与售后、地址管理和会员中心。
6. 订单详情会显示自提门店、取货码、优惠明细、物流和退款状态；接口失败时弹窗会附带请求追踪号。

## 📁 项目结构

```
wechat-saas/
├── config/default.js          # 全局配置（微信/积分/订单规则）
├── src/
│   ├── index.js               # 服务入口
│   ├── store/JsonStore.js     # 开发环境 JSON 持久化
│   ├── store/SqliteStore.js   # SQLite 事务与原子扣减
│   ├── store/PgStore.js       # PostgreSQL 事务、行锁与多实例存储
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
│   │   ├── AfterSalesService.js
│   │   ├── NotificationService.js
│   │   ├── MonitoringService.js
│   │   ├── GrowthService.js
│   │   ├── ReportsService.js
│   │   ├── LocationService.js
│   │   ├── OutboxService.js   # 持久化通知队列、重试与死信
│   │   ├── AuditArchiveService.js # 审计分段与 WORM 归档
│   │   ├── BackupService.js   # 加密快照与恢复
│   │   ├── PlatformService.js # 租户开通、套餐与账单
│   │   └── seed.js
│   ├── services/WechatService.js  # 微信登录/支付v3（mock+真实）
│   ├── auth/                 # 令牌签发/口令哈希/管理员账号
│   ├── errors.js / validation.js / logger.js  # 错误码/Zod校验/结构化日志
│   ├── core/AuditLog.js      # 操作审计日志
│   ├── api/ApiService.js      # 小程序API + 管理后台API
│   ├── web/templates/index.html   # 商家经营台
│   └── web/templates/shop.html    # 顾客体验端
├── mini-program/              # 微信小程序源码（开发者工具可直接导入）
├── tests/run.js               # 自动化测试
├── docs/微信上线清单.md        # 上线配置指南
├── docs/生产运行手册.md        # 数据库、多实例、监控、审计和灾备
├── docs/数据库迁移.md          # 三种存储与 PostgreSQL 运行说明
├── db/migrations/001_init.sql  # PostgreSQL 企业版 Schema
├── db/migrations/002_pilot_enterprise.sql # 试点增量：门店/售后/消息/审计链
├── db/migrations/003_runtime_pgstore.sql # PostgreSQL 运行时文档存储
├── scripts/migrate.js         # 迁移执行与状态检查
├── scripts/backup.js / scripts/restore.js / scripts/dr-drill.js
├── Dockerfile / docker-compose.yml
└── data/                      # 运行期数据、SQLite 与上传素材
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
| GET | /api/wx/orders/:id | 订单详情与售后记录 |
| GET | /api/wx/after-sales | 顾客售后列表 |
| POST | /api/wx/orders/:id/after-sales | 发起退款/退货/投诉 |
| POST | /api/wx/after-sales/:id/cancel | 撤回待受理售后 |
| GET/POST/PUT/DELETE | /api/wx/member/:id/addresses | 收货地址 CRUD |
| GET | /api/wx/subscriptions | 当前租户可授权的订阅事件 |
| POST | /api/wx/subscriptions/authorize | 回传逐模板用户授权结果 |
| GET | /api/wx/locations | 当前租户可用履约门店 |
| GET | /api/wx/member/:id/points | 积分余额与流水 |
| POST | /api/wx/coupons/claim | 领取优惠券 |
| POST | /api/wx/groupbuys/:id/join | 参团 |
| POST | /api/wx/forms/:id/submit | 提交问卷 |
| GET | /api/wx/appointments/slots | 查询可约时段 |
| POST | /api/wx/appointments | 提交预约 |

### 管理后台 `/api/admin/*`
商品/订单/会员/优惠券/团购/问卷/预约/售后/履约门店/消息模板/增长/报表/诊断/系统信息，完整路由见 `src/api/ApiService.js`。

重点接口：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/admin/today | 今日待办、建议与异常雷达 |
| GET/POST | /api/admin/onboarding | 三步引导状态与真实动作完成 |
| GET | /api/admin/growth | 会员分层、复购、召回与素材 |
| GET | /api/admin/reports?days=30 | 操作报表与履约门店收入对比 |
| GET/PUT | /api/admin/after-sales/:id | 售后查询和处理 |
| GET/POST/PUT | /api/admin/locations | 多履约门店管理 |
| GET/PUT | /api/admin/subscriptions/:event | 消息模板查看与编辑 |
| GET/POST | /api/admin/outbox | 通知队列筛选与死信重试 |
| GET/POST | /api/admin/audit-archive | 审计完整性检查与手动归档 |
| GET | /api/admin/system/diagnostics | 指标、就绪检查与审计链状态 |
| POST | /api/admin/session/revoke | 撤销当前账号会话 |
| POST | /api/platform/tenants | 平台运营开通租户并创建所有者 |

## 💰 商业模式参考

| 收入模式 | 说明 | 定价参考 |
|---------|------|---------|
| 订阅费 | 商家按月/年付费使用SaaS | ¥99-299/月/商户 |
| 交易佣金 | 按成交额抽成 | 0.5%-2% |
| 增值服务 | 定制开发、代运营、私域培训 | ¥3000-20000/单 |
| 多商户加盟 | 发展区域代理，收取代理费 | ¥5000-30000/年 |

## 🛣 产品化路线

- **当前试点层**：经营闭环、PostgreSQL 多实例、租户开通/套餐、订阅授权、Outbox、监控告警、审计归档和加密灾备已具备。
- **外部联调层**：真实小程序 AppID、模板 ID、用户授权，以及后续另立的微信支付/退款商户联调。
- **规模化层**：共享限流、高频报表 SQL 投影、云端 WORM/异地归档、生产 RPO/RTO 压测和容量治理。
- **增长层**：模板市场、行业插件、区域代理和更细的运营自动化。

## ✅ 测试

```bash
npm run test:all
```

- `npm test`：核心业务全链路（33 项）
- `npm run test:http`：会员/管理员令牌、越权访问、租户隔离（12 项）
- `npm run test:pay`：微信支付 v3 RSA 签名 / 回调验签 / AES-GCM 解密（5 项）
- `npm run test:validation`：参数校验、分页、安全头、审计日志（11 项）
- `npm run test:tenant`：多租户隔离、未知租户拒绝、登录不信任自报 tenantId（6 项）
- `npm run test:sqlite`：SQLite 后端核心业务全链路（33 项）
- `npm run test:concurrency`：多进程并发扣库存，验证原子扣减不超卖
- `npm run test:reconciliation`：交易账单与本地订单对账（4 项）
- `npm run test:s3-archive`：本地 S3 兼容端点验证签名上传、Object Lock 头和归档校验
- `npm run test:enterprise`：平台租户、套餐、素材、订阅授权、Outbox、归档、指标和备份恢复（13 项）
- `npm run test:postgres`：真实临时 PostgreSQL 17 迁移、并发、双 worker、审计与恢复（6 项）
- `npm run dr:drill`：JSON/SQLite 隔离灾备演练；配置 `DRILL_DATABASE_URL` 后再加入 PostgreSQL

## 🚀 部署

```bash
docker compose up -d --build
```

- `Dockerfile`：node:22-alpine 非 root 运行，内置 `/healthz` 健康检查
- `docker-compose.yml`：单机试点示例，默认 SQLite 并挂载 `./data`；生产多实例请按 [生产运行手册](docs/生产运行手册.md) 切换到 PostgreSQL 并拆分 worker
- `scripts/migrate.js`：执行 PostgreSQL `001` 至 `003` 迁移并校验历史文件
- `scripts/backup.js` / `scripts/restore.js`：JSON、SQLite、PostgreSQL 加密快照与隔离恢复
- `.github/workflows/ci.yml`：CI 跑测试 + npm audit

## ✅ 已完成的企业级加固

- **鉴权**：HMAC 签名令牌（会员/管理员两类）、scrypt 口令哈希、租户由令牌推导，不再信任客户端自报身份
- **微信支付 v3**：RSA-SHA256 下单签名、回调验签 + AES-256-GCM 解密、金额/商户号/AppID 校验、退款，小程序 `wx.requestPayment`
- **交易一致性**：库存「可用+预留」语义（下单扣可用、支付后记销量）、优惠券 reserved/used/released、成团后仍可参团、已支付订单需走退款
- **参数校验**：Zod 入口校验，统一错误码 + requestId
- **存储**：开发可用 JSON，单机可用 SQLite，生产多实例使用 `PgStore` + PostgreSQL 事务、行锁、原子扣减和迁移校验
- **安全**：Helmet 严格 CSP（禁内联脚本注入）、登录/全局限流、管理后台存储型 XSS 转义、CORS 白名单
- **安全基线**：生产管理员强口令校验、5 次失败锁定、管理员会话版本撤销、同源写操作校验、请求追踪号
- **分页/审计**：管理端列表分页；订单、支付、积分、优惠券、库存、团购、售后、导出和账号动作进入链式审计
- **可观测性**：带鉴权的 Prometheus 指标、请求 ID、P95/错误率、最近错误、慢接口、就绪检查、日志轮转和告警 webhook
- **消息可靠性**：订阅授权逐模板回传，通知先写持久化 Outbox，由 worker 重试、死信和人工补发
- **审计留存**：SHA-256 链、PostgreSQL 追加写触发器、分段校验、只读归档和 S3 Object Lock 接口
- **租户运营**：平台运营台开通/暂停租户、套餐配额、品牌素材、自助试用和平台账单状态
- **灾备**：JSON、SQLite、PostgreSQL 加密快照、独立恢复、素材校验以及 RPO/RTO 演练脚本
- **试点运营**：真实动作三步引导、今日建议、异常提醒、会员分层、沉睡召回、操作报表与门店对比
- **对账**：微信交易对账单下载 + 本地订单自动比对，识别金额不符/漏单/多单/退款差异
- **多实例**：PostgreSQL 行锁与 advisory lock、Web/worker 分离、会话撤销、Outbox 抢占和限流交给网关（见 docs/多实例部署.md）

## ⚠️ 当前边界

- 生产和多实例建议 `DATA_STORE=postgres`；SQLite 只适合单机或单写节点。现有 JSON/SQLite 数据切到 PostgreSQL 需执行受控迁移和金额核对（见 `docs/数据库迁移.md`）
- 真实微信支付 v3 已实现，但需要真实商户证书/APIv3 密钥/平台证书才能端到端联调（本地用生成的 RSA 密钥验证了加解密往返）
- 公开目录（首页/商品/团购/问卷列表）通过 `X-Tenant-Id` 定位租户，租户 ID 必须命中注册表（`TenantManager`），非法租户返回 400；敏感身份与写操作均需令牌鉴权
- 指标端点已提供 Prometheus 格式，告警 webhook 可独立接入；生产仍应配置 Prometheus/APM、集中日志和独立值班通道
- PostgreSQL 和本地只读归档已验证；S3 Object Lock、异地副本和真实云端 WORM 尚未对真实云账号验收
- 订阅消息受微信模板 ID、用户授权和账号资质约束；mock 模式只能验证业务事件与渲染，不能证明真实微信送达
- 微信支付/退款本轮保持关闭；取得真实商户资质后应另立支付上线验收，不能把密码学测试当作资金流验收
- 备份 RPO/RTO 当前是小型隔离样本；生产 SLA 取决于数据库 PITR、对象存储复制、网络和定期演练

## License

MIT
