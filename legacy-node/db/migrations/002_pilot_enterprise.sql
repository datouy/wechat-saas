-- =====================================================================
-- 邻里团 SaaS · 企业级试点增量 Schema
-- 依赖 001_init.sql；可重复执行（CREATE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS）。
-- 适用场景：单租户试点到多门店、多租户试运行前的 PostgreSQL 目标模型。
-- =====================================================================

BEGIN;

-- ---------- 管理员会话与登录安全 ----------
ALTER TABLE admins ADD COLUMN IF NOT EXISTS token_version BIGINT NOT NULL DEFAULT 0;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS failed_login_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS last_failed_login_at TIMESTAMPTZ;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS sessions_revoked_at TIMESTAMPTZ;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;

-- 001 使用 admin/staff，应用运行时使用 manager/fulfillment；统一到应用角色模型。
UPDATE admins SET role = 'manager' WHERE role = 'admin';
UPDATE admins SET role = 'fulfillment' WHERE role = 'staff';
ALTER TABLE admins DROP CONSTRAINT IF EXISTS admins_role_check;
ALTER TABLE admins DROP CONSTRAINT IF EXISTS admins_role_pilot_check;
ALTER TABLE admins ADD CONSTRAINT admins_role_pilot_check
  CHECK (role IN ('owner', 'manager', 'fulfillment'));
ALTER TABLE admins DROP CONSTRAINT IF EXISTS admins_failed_login_nonnegative;
ALTER TABLE admins ADD CONSTRAINT admins_failed_login_nonnegative
  CHECK (failed_login_attempts >= 0);

-- ---------- 品牌与小程序配置 ----------
CREATE TABLE IF NOT EXISTS store_profiles (
  tenant_id               UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  name                    TEXT NOT NULL,
  tagline                 TEXT NOT NULL DEFAULT '',
  description             TEXT NOT NULL DEFAULT '',
  announcement            TEXT NOT NULL DEFAULT '',
  contact_phone           TEXT NOT NULL DEFAULT '',
  pickup_address          TEXT NOT NULL DEFAULT '',
  delivery_notice         TEXT NOT NULL DEFAULT '',
  brand_color             TEXT NOT NULL DEFAULT '#b84a35'
    CHECK (brand_color ~ '^#[0-9A-Fa-f]{6}$'),
  mini_program_title      TEXT NOT NULL DEFAULT '邻里团',
  mini_program_app_id     TEXT NOT NULL DEFAULT '',
  customer_service_phone  TEXT NOT NULL DEFAULT '',
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- 多履约门店 ----------
CREATE TABLE IF NOT EXISTS store_locations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  code              TEXT NOT NULL DEFAULT '',
  address           TEXT NOT NULL,
  phone             TEXT NOT NULL DEFAULT '',
  hours             TEXT NOT NULL DEFAULT '每日 09:00-20:00',
  pickup_enabled    BOOLEAN NOT NULL DEFAULT true,
  delivery_enabled  BOOLEAN NOT NULL DEFAULT true,
  is_primary        BOOLEAN NOT NULL DEFAULT false,
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  brand_color       TEXT NOT NULL DEFAULT '#b84a35'
    CHECK (brand_color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_store_locations_tenant
  ON store_locations(tenant_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_store_locations_tenant_code
  ON store_locations(tenant_id, code) WHERE code <> '';
CREATE UNIQUE INDEX IF NOT EXISTS uq_store_locations_one_primary
  ON store_locations(tenant_id) WHERE is_primary;

-- ---------- 订单履约快照 ----------
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_location_id UUID;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_location JSONB;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_code TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_verified_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_reminder_sent_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refunded_amount BIGINT NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund JSONB;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS completed_refunds JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS logistics JSONB;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancel_reason TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_refunded_amount_nonnegative;
ALTER TABLE orders ADD CONSTRAINT orders_refunded_amount_nonnegative
  CHECK (refunded_amount >= 0);
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_pickup_location_fk;
ALTER TABLE orders ADD CONSTRAINT orders_pickup_location_fk
  FOREIGN KEY (pickup_location_id) REFERENCES store_locations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_orders_pickup_location
  ON orders(tenant_id, pickup_location_id, paid_at);
CREATE INDEX IF NOT EXISTS idx_orders_pickup_reminder
  ON orders(paid_at) WHERE status = 'paid' AND pickup_reminder_sent_at IS NULL;

-- ---------- 售后工单 ----------
CREATE TABLE IF NOT EXISTS after_sales_requests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id          UUID NOT NULL REFERENCES orders(id),
  order_no          TEXT NOT NULL,
  member_id         UUID NOT NULL REFERENCES members(id),
  type              TEXT NOT NULL DEFAULT 'refund'
    CHECK (type IN ('refund', 'return', 'complaint')),
  requested_amount  BIGINT NOT NULL DEFAULT 0 CHECK (requested_amount >= 0),
  reason            TEXT NOT NULL,
  description       TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'resolved', 'rejected', 'closed')),
  resolution        TEXT NOT NULL DEFAULT '',
  resolved_by       TEXT NOT NULL DEFAULT '',
  resolved_by_name  TEXT NOT NULL DEFAULT '',
  resolved_at       TIMESTAMPTZ,
  closed_at         TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_after_sales_tenant_status
  ON after_sales_requests(tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_after_sales_member
  ON after_sales_requests(member_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_after_sales_active_order
  ON after_sales_requests(order_id)
  WHERE status IN ('pending', 'approved');

-- ---------- 库存调整与反向流水 ----------
CREATE TABLE IF NOT EXISTS inventory_adjustments (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id                UUID NOT NULL REFERENCES products(id),
  product_name              TEXT NOT NULL,
  before_qty                INT NOT NULL CHECK (before_qty >= 0),
  delta                     INT NOT NULL CHECK (delta <> 0),
  after_qty                 INT NOT NULL CHECK (after_qty >= 0),
  reason                    TEXT NOT NULL,
  actor_id                  TEXT NOT NULL DEFAULT '',
  actor_name                TEXT NOT NULL DEFAULT '',
  reversed_adjustment_id    UUID REFERENCES inventory_adjustments(id),
  undone_at                 TIMESTAMPTZ,
  undone_by                 TEXT NOT NULL DEFAULT '',
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inventory_adjustments_product
  ON inventory_adjustments(tenant_id, product_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_adjustment_reversal
  ON inventory_adjustments(reversed_adjustment_id) WHERE reversed_adjustment_id IS NOT NULL;

-- ---------- 微信订阅消息模板与投递日志 ----------
CREATE TABLE IF NOT EXISTS notification_templates (
  id            TEXT PRIMARY KEY,
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event         TEXT NOT NULL,
  template_id   TEXT NOT NULL DEFAULT '',
  page          TEXT NOT NULL DEFAULT '',
  data          JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled       BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, event)
);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  member_id     UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  event         TEXT NOT NULL,
  title         TEXT NOT NULL,
  template_id   TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'sending'
    CHECK (status IN ('sending', 'sent', 'mocked', 'failed')),
  result        JSONB,
  error         TEXT,
  sent_at       TIMESTAMPTZ,
  failed_at     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_tenant
  ON notification_deliveries(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_retry
  ON notification_deliveries(status, created_at) WHERE status IN ('sending', 'failed');

-- ---------- 三步真实经营引导 ----------
CREATE TABLE IF NOT EXISTS onboarding_progress (
  id                TEXT PRIMARY KEY,
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  admin_id          UUID NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  actor_name        TEXT NOT NULL DEFAULT '',
  today_viewed_at   TIMESTAMPTZ,
  customer_viewed_at TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, admin_id)
);

-- ---------- 每租户链式审计 ----------
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS sequence BIGINT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS previous_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS hash TEXT NOT NULL DEFAULT '';
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;

WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY created_at, id) AS seq
  FROM audit_logs
)
UPDATE audit_logs AS target
SET sequence = ranked.seq
FROM ranked
WHERE target.id = ranked.id AND target.sequence IS NULL;

ALTER TABLE audit_logs ALTER COLUMN sequence SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_audit_logs_tenant_sequence
  ON audit_logs(tenant_id, sequence);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_action
  ON audit_logs(tenant_id, action, created_at DESC);

-- 旧记录允许应用完成一次哈希封存；已有哈希后，内容、哈希和链头均不可改写。
CREATE OR REPLACE FUNCTION protect_audit_log() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'audit_logs is append-only';
  END IF;
  IF OLD.hash IS NULL OR OLD.hash = '' THEN
    IF ROW(
      OLD.id, OLD.tenant_id, OLD.actor_type, OLD.actor_id, OLD.actor_name,
      OLD.action, OLD.resource, OLD.resource_id, OLD.detail, OLD.ip, OLD.created_at
    ) IS DISTINCT FROM ROW(
      NEW.id, NEW.tenant_id, NEW.actor_type, NEW.actor_id, NEW.actor_name,
      NEW.action, NEW.resource, NEW.resource_id, NEW.detail, NEW.ip, NEW.created_at
    ) THEN
      RAISE EXCEPTION 'legacy audit sealing may only add chain metadata';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$;
DROP TRIGGER IF EXISTS trg_audit_logs_append_only ON audit_logs;
CREATE TRIGGER trg_audit_logs_append_only
BEFORE UPDATE OR DELETE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION protect_audit_log();

COMMIT;
