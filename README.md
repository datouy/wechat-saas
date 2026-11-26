# 邻里团 SaaS

面向社区团购、会员积分、预约和表单场景的多租户小程序 SaaS。

## 当前架构

- `backend/`：Java 21 + Spring Boot 3 + MySQL 8 + Flyway
- `admin-web/`：Vue 3 + Vite + TypeScript + Pinia + Element Plus
- `mobile/`：uni-app + Vue 3（H5 / 微信小程序 / App）

## 本地启动

### 1. 准备 MySQL

> 本机实际联调版本为 MySQL 5.7.44，业务模块已跑通；但 Hibernate 6 与 Flyway 10 已提示 5.7 不再受支持，生产环境请使用 MySQL 8.0+（Docker 编排使用 8.4）。

创建数据库：

```sql
CREATE DATABASE wechat_saas CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

后端默认连接 `jdbc:mysql://127.0.0.1:3306/wechat_saas`、用户 `root`、空密码。正式环境请通过环境变量覆盖：

```powershell
$env:SPRING_DATASOURCE_URL="jdbc:mysql://127.0.0.1:3306/wechat_saas?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai&useSSL=false"
$env:SPRING_DATASOURCE_USERNAME="wechat_saas"
$env:SPRING_DATASOURCE_PASSWORD="change-me"
$env:APP_JWT_SECRET="至少32字节的随机密钥"
```

### 2. 启动 Java 后端

```powershell
cd backend
mvn spring-boot:run
```

- API：http://127.0.0.1:8080
- OpenAPI：http://127.0.0.1:8080/swagger-ui.html
- 健康检查：http://127.0.0.1:8080/actuator/health

开发种子数据：租户 `t-default`，账号 `admin / admin123`。

### 3. 启动 Vue3 管理台

```powershell
cd admin-web
npm install
npm run dev
```

地址：http://127.0.0.1:5173

### 4. 启动 uni-app 移动端

```powershell
cd mobile
npm install
npm run dev:h5
```

H5 地址：http://127.0.0.1:5174

微信小程序构建：

```powershell
cd mobile
npm run build:mp-weixin
```

产物目录：`mobile/dist/build/mp-weixin`，用微信开发者工具导入。

## 数据库文件

- 数据库结构统一提交在 backend/src/main/resources/db/migration/ 下的 V1、V2、V3 SQL 文件中。
- Spring Boot 启动时由 Flyway 自动执行迁移，不需要手工导入 SQL。
- 不提交 MySQL 数据目录、.ibd、binlog、账号口令等本地运行文件；这些文件与机器绑定并可能包含敏感数据。
- 开发演示数据由 DataBootstrap 在空库首次启动时生成。

## 微信配置

生产环境需要配置以下变量，真实支付和订阅消息仍需微信商户与模板资质完成外部验收：

```powershell
$env:APP_WECHAT_MOCK="false"
$env:APP_WECHAT_APP_ID="真实 AppID"
$env:APP_WECHAT_APP_SECRET="真实 AppSecret"
$env:APP_WECHAT_MCH_ID="微信商户号"
$env:APP_WECHAT_API_V3_KEY="32字节 APIv3 密钥"
$env:APP_WECHAT_PRIVATE_KEY="商户私钥 PEM"
$env:APP_WECHAT_SERIAL_NO="商户证书序列号"
$env:APP_WECHAT_PUBLIC_KEY="微信支付公钥 PEM"
$env:APP_WECHAT_PUBLIC_KEY_ID="微信支付公钥 ID"
$env:APP_WECHAT_NOTIFY_URL="https://你的域名/api/wx/pay/notify"
$env:APP_WECHAT_PAYMENT_ENABLED="true"
$env:APP_WECHAT_SUBSCRIBE_TEMPLATES='{"orderPaid":{"templateId":"真实模板ID","page":"pages/orders/orders"}}'
```

本地默认使用 mock 微信登录、mock 支付和 mock 订阅消息，不依赖真实微信账号。

## 已实现业务模块

- 商品新增、编辑、下架
- 优惠券模板、会员领取、限领与有效期
- 团购创建、参团、成团、取消与人数上限
- 问卷创建、必填校验、单次提交与分布/均分统计
- 预约服务、时段容量、防重复预约、取消/完成
- 微信 code2Session 登录、订阅授权、测试发送
- 微信支付 mock 下单/支付；真实模式支持 v3 JSAPI 配置和回调验签解密

- 库存调整、撤销调整、调整记录
- 订单支付、发货、完成、取消、全额/部分退款
- 退款幂等：相同 Idempotency-Key 不会重复退款
- 会员积分调整与积分流水
- 商品、库存、订单、退款、积分动作写入审计日志

## Docker 本地编排

```powershell
docker compose up --build
```

- 管理台：http://127.0.0.1:5173
- API：http://127.0.0.1:8080
- MySQL：127.0.0.1:3306（本地示例口令见 docker-compose.yml）


## 验证

```powershell
npm test

# 或分端执行
cd backend; mvn test
cd admin-web; npm run check
cd mobile; npm run build:h5; npm run build:mp-weixin
```

当前验证基线：

- Java 后端：编译与运行验收通过（仓库不保留 tests 目录）
- Vue 管理台：typecheck + production build 通过
- uni-app：H5 与微信小程序构建通过

## 安全与边界

- 租户身份只来自 JWT，不接受前端自报的 `tenantId`。
- 生产环境必须覆盖默认 JWT 密钥、数据库口令和种子账号。
- 真实微信登录、支付、退款、云 WORM 与生产 SLA 仍需独立外部验收。

