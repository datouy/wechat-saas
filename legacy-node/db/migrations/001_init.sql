-- =====================================================================
-- 邻里团 SaaS · PostgreSQL 企业版初始 Schema
-- 说明：JSON 存储仅用于本地演示；生产交易应迁移到 PostgreSQL 以获得
--       事务、唯一约束、行锁、外键与多实例一致性保障。
-- 约定：金额一律以「分」(integer) 存储；业务日期以 Asia/Shanghai 解释。
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid()

-- ---------- 租户与账号 ----------
CREATE TABLE tenants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','pending','suspended')),
  plan_id       UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE admins (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  username      TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('owner','admin','staff')),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, username)
);

CREATE TABLE members (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  openid        TEXT NOT NULL,
  unionid       TEXT,
  nickname      TEXT,
  avatar        TEXT,
  phone         TEXT,
  phone_encrypted TEXT,
  total_spent   BIGINT NOT NULL DEFAULT 0,      -- 分
  order_count   INT NOT NULL DEFAULT 0,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, openid)
);

CREATE TABLE member_addresses (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id     UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  phone         TEXT NOT NULL,
  detail        TEXT NOT NULL,
  is_default    BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- 商品与库存 ----------
CREATE TABLE categories (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  sort          INT NOT NULL DEFAULT 0
);

CREATE TABLE products (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category_id   UUID REFERENCES categories(id) ON DELETE SET NULL,
  name          TEXT NOT NULL,
  description   TEXT,
  image         TEXT,
  unit          TEXT,
  price         BIGINT NOT NULL CHECK (price > 0),          -- 分
  original_price BIGINT,
  stock         INT NOT NULL DEFAULT 0 CHECK (stock >= 0),  -- 可用库存
  reserved_stock INT NOT NULL DEFAULT 0 CHECK (reserved_stock >= 0),
  sales         INT NOT NULL DEFAULT 0,
  on_sale       BOOLEAN NOT NULL DEFAULT true,
  sort          INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_products_tenant ON products(tenant_id);
CREATE INDEX idx_products_category ON products(category_id);

-- ---------- 优惠券 ----------
CREATE TABLE coupon_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  threshold     BIGINT NOT NULL DEFAULT 0,   -- 分
  amount        BIGINT NOT NULL CHECK (amount > 0), -- 分
  valid_days    INT NOT NULL DEFAULT 30,
  limit_per_member INT NOT NULL DEFAULT 1,
  enabled       BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE coupons (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  template_id   UUID NOT NULL REFERENCES coupon_templates(id) ON DELETE CASCADE,
  member_id     UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'unused' CHECK (status IN ('unused','reserved','used','released','expired')),
  threshold     BIGINT NOT NULL DEFAULT 0,
  amount        BIGINT NOT NULL,
  reserved_by_order_id UUID,
  expire_at     TIMESTAMPTZ,
  reserved_at   TIMESTAMPTZ,
  used_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_coupons_member ON coupons(member_id);
CREATE INDEX idx_coupons_status ON coupons(status);

-- ---------- 团购 ----------
CREATE TABLE group_buys (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id    UUID NOT NULL REFERENCES products(id),
  title         TEXT NOT NULL,
  group_price   BIGINT NOT NULL CHECK (group_price > 0), -- 分
  min_participants INT NOT NULL DEFAULT 2,
  max_participants INT NOT NULL DEFAULT 100,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','success','closed','cancelled')),
  start_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  end_at        TIMESTAMPTZ NOT NULL,
  success_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_groupbuys_tenant_status ON group_buys(tenant_id, status);

CREATE TABLE group_buy_participants (
  group_buy_id  UUID NOT NULL REFERENCES group_buys(id) ON DELETE CASCADE,
  member_id     UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('leader','member')),
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_buy_id, member_id)
);

-- ---------- 订单 / 支付 / 退款 ----------
CREATE TABLE orders (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  member_id     UUID NOT NULL REFERENCES members(id),
  order_no      TEXT NOT NULL UNIQUE,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','delivering','completed','cancelled','refunding','refunded')),
  goods_amount  BIGINT NOT NULL,
  coupon_id     UUID,
  coupon_discount BIGINT NOT NULL DEFAULT 0,
  points_used   INT NOT NULL DEFAULT 0,
  points_discount BIGINT NOT NULL DEFAULT 0,
  delivery_fee  BIGINT NOT NULL DEFAULT 0,
  pay_amount    BIGINT NOT NULL,
  delivery_type TEXT NOT NULL DEFAULT 'delivery',
  remark        TEXT,
  group_buy_id  UUID,
  address       JSONB,
  expires_at    TIMESTAMPTZ,
  paid_at       TIMESTAMPTZ,
  delivered_at  TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  cancelled_at  TIMESTAMPTZ,
  refunded_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_orders_tenant ON orders(tenant_id);
CREATE INDEX idx_orders_member ON orders(member_id);
CREATE INDEX idx_orders_status ON orders(status);

CREATE TABLE order_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id    UUID NOT NULL REFERENCES products(id),
  name          TEXT NOT NULL,
  image         TEXT,
  unit          TEXT,
  unit_price    BIGINT NOT NULL,
  quantity      INT NOT NULL CHECK (quantity > 0),
  subtotal      BIGINT NOT NULL
);
CREATE INDEX idx_order_items_order ON order_items(order_id);

CREATE TABLE payments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id      UUID NOT NULL REFERENCES orders(id),
  out_trade_no  TEXT NOT NULL UNIQUE,
  transaction_id TEXT UNIQUE,
  amount        BIGINT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','success','closed','failed')),
  raw_payload   JSONB,
  paid_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE refunds (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id      UUID NOT NULL REFERENCES orders(id),
  out_refund_no TEXT NOT NULL UNIQUE,
  refund_id     TEXT,
  amount        BIGINT NOT NULL,
  reason        TEXT,
  status        TEXT NOT NULL DEFAULT 'refunding' CHECK (status IN ('refunding','success','closed','failed')),
  raw_payload   JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- 积分 ----------
CREATE TABLE points_ledger (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  member_id     UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  change        BIGINT NOT NULL,
  reason        TEXT,
  ref_id        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_points_member ON points_ledger(member_id);

-- ---------- 预约 ----------
CREATE TABLE appointment_services (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  price         BIGINT NOT NULL,
  duration_minutes INT NOT NULL DEFAULT 60,
  capacity_per_slot INT NOT NULL DEFAULT 1,
  slots         JSONB NOT NULL DEFAULT '[]',
  enabled       BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE appointments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  service_id    UUID NOT NULL REFERENCES appointment_services(id),
  member_id     UUID NOT NULL REFERENCES members(id),
  date          DATE NOT NULL,
  slot          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','completed','cancelled')),
  note          TEXT,
  cancelled_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (service_id, member_id, date, slot)
);
CREATE INDEX idx_appointments_service_date ON appointments(service_id, date, status);

-- ---------- 问卷 ----------
CREATE TABLE forms (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  description   TEXT,
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE form_fields (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id       UUID NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  position      INT NOT NULL DEFAULT 0,
  label         TEXT NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('text','textarea','radio','checkbox','rating','number')),
  options       JSONB NOT NULL DEFAULT '[]',
  required      BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE form_submissions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  form_id       UUID NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  member_id     UUID NOT NULL REFERENCES members(id),
  answers       JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (form_id, member_id)
);

-- ---------- 审计 ----------
CREATE TABLE audit_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_type    TEXT NOT NULL DEFAULT 'admin',
  actor_id      TEXT,
  actor_name    TEXT,
  action        TEXT NOT NULL,
  resource      TEXT,
  resource_id   TEXT,
  detail        JSONB,
  ip            TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_tenant ON audit_logs(tenant_id, created_at DESC);

-- ---------- 订阅计费 ----------
CREATE TABLE subscription_plans (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  price_monthly BIGINT NOT NULL,
  quota_members INT NOT NULL DEFAULT 1000,
  quota_products INT NOT NULL DEFAULT 500,
  quota_orders INT NOT NULL DEFAULT 10000
);

CREATE TABLE tenant_subscriptions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id       UUID NOT NULL REFERENCES subscription_plans(id),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','past_due','cancelled')),
  current_period_start TIMESTAMPTZ NOT NULL,
  current_period_end   TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
