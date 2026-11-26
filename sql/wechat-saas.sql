-- 邻里团 SaaS MySQL 完整建表脚本
-- 由 Flyway V1-V3 汇总生成，便于查看和手工建库。
-- 正式启动仍以 backend/src/main/resources/db/migration 下的迁移文件为准。

-- V1__init.sql
CREATE TABLE saas_tenants (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(48) NOT NULL UNIQUE,
  name VARCHAR(80) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE saas_users (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  username VARCHAR(64) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(80) NOT NULL,
  role VARCHAR(24) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_users_tenant FOREIGN KEY (tenant_id) REFERENCES saas_tenants(id),
  CONSTRAINT uk_users_tenant_username UNIQUE (tenant_id, username)
);

CREATE TABLE saas_members (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  openid VARCHAR(96) NOT NULL,
  nickname VARCHAR(80) NOT NULL,
  phone VARCHAR(32),
  points BIGINT NOT NULL DEFAULT 0,
  total_spent_cent BIGINT NOT NULL DEFAULT 0,
  order_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_members_tenant FOREIGN KEY (tenant_id) REFERENCES saas_tenants(id),
  CONSTRAINT uk_members_tenant_openid UNIQUE (tenant_id, openid)
);

CREATE TABLE saas_categories (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  name VARCHAR(40) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_categories_tenant FOREIGN KEY (tenant_id) REFERENCES saas_tenants(id)
);

CREATE TABLE saas_products (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  category_id BIGINT,
  name VARCHAR(80) NOT NULL,
  description VARCHAR(500),
  image_url VARCHAR(500),
  price_cent BIGINT NOT NULL,
  original_price_cent BIGINT NOT NULL,
  stock INT NOT NULL DEFAULT 0,
  sales INT NOT NULL DEFAULT 0,
  on_sale BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_products_tenant FOREIGN KEY (tenant_id) REFERENCES saas_tenants(id),
  CONSTRAINT fk_products_category FOREIGN KEY (category_id) REFERENCES saas_categories(id)
);

CREATE TABLE saas_orders (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  member_id BIGINT NOT NULL,
  order_no VARCHAR(40) NOT NULL UNIQUE,
  status VARCHAR(24) NOT NULL,
  payment_mode VARCHAR(24) NOT NULL,
  goods_amount_cent BIGINT NOT NULL,
  pay_amount_cent BIGINT NOT NULL,
  remark VARCHAR(200),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at TIMESTAMP NULL,
  cancelled_at TIMESTAMP NULL,
  CONSTRAINT fk_orders_tenant FOREIGN KEY (tenant_id) REFERENCES saas_tenants(id),
  CONSTRAINT fk_orders_member FOREIGN KEY (member_id) REFERENCES saas_members(id)
);

CREATE TABLE saas_order_items (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  order_id BIGINT NOT NULL,
  product_id BIGINT NOT NULL,
  product_name VARCHAR(80) NOT NULL,
  unit_price_cent BIGINT NOT NULL,
  quantity INT NOT NULL,
  subtotal_cent BIGINT NOT NULL,
  CONSTRAINT fk_order_items_order FOREIGN KEY (order_id) REFERENCES saas_orders(id),
  CONSTRAINT fk_order_items_product FOREIGN KEY (product_id) REFERENCES saas_products(id)
);

CREATE TABLE saas_audit_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  actor_type VARCHAR(24) NOT NULL,
  actor_id BIGINT,
  action VARCHAR(80) NOT NULL,
  resource VARCHAR(80),
  resource_id VARCHAR(80),
  detail VARCHAR(1000),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_audit_tenant FOREIGN KEY (tenant_id) REFERENCES saas_tenants(id)
);

CREATE INDEX idx_products_tenant_created ON saas_products (tenant_id, created_at);
CREATE INDEX idx_orders_tenant_created ON saas_orders (tenant_id, created_at);
CREATE INDEX idx_orders_tenant_status ON saas_orders (tenant_id, status);
CREATE INDEX idx_audit_tenant_created ON saas_audit_logs (tenant_id, created_at);



-- V2__business_modules.sql
ALTER TABLE saas_orders ADD COLUMN delivered_at TIMESTAMP NULL;
ALTER TABLE saas_orders ADD COLUMN completed_at TIMESTAMP NULL;
ALTER TABLE saas_orders ADD COLUMN logistics_company VARCHAR(50);
ALTER TABLE saas_orders ADD COLUMN logistics_no VARCHAR(64);
ALTER TABLE saas_orders ADD COLUMN refunded_amount_cent BIGINT NOT NULL DEFAULT 0;

ALTER TABLE saas_audit_logs ADD COLUMN actor_name VARCHAR(80);

CREATE TABLE saas_inventory_adjustments (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  product_id BIGINT NOT NULL,
  product_name VARCHAR(80) NOT NULL,
  before_stock INT NOT NULL,
  delta INT NOT NULL,
  after_stock INT NOT NULL,
  reason VARCHAR(200) NOT NULL,
  actor_id BIGINT,
  actor_name VARCHAR(80),
  undone_at TIMESTAMP NULL,
  reversed_adjustment_id BIGINT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_inventory_tenant FOREIGN KEY (tenant_id) REFERENCES saas_tenants(id),
  CONSTRAINT fk_inventory_product FOREIGN KEY (product_id) REFERENCES saas_products(id)
);

CREATE TABLE saas_order_refunds (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  order_id BIGINT NOT NULL,
  order_no VARCHAR(40) NOT NULL,
  refund_no VARCHAR(48) NOT NULL,
  amount_cent BIGINT NOT NULL,
  reason VARCHAR(200) NOT NULL,
  status VARCHAR(24) NOT NULL,
  idempotency_key VARCHAR(96),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_refund_tenant FOREIGN KEY (tenant_id) REFERENCES saas_tenants(id),
  CONSTRAINT fk_refund_order FOREIGN KEY (order_id) REFERENCES saas_orders(id),
  CONSTRAINT uk_refund_idempotency UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE saas_points_ledger (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  member_id BIGINT NOT NULL,
  change_amount BIGINT NOT NULL,
  reason VARCHAR(200) NOT NULL,
  ref_id VARCHAR(80),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_points_tenant FOREIGN KEY (tenant_id) REFERENCES saas_tenants(id),
  CONSTRAINT fk_points_member FOREIGN KEY (member_id) REFERENCES saas_members(id)
);

CREATE INDEX idx_inventory_tenant_product ON saas_inventory_adjustments (tenant_id, product_id, created_at);
CREATE INDEX idx_refunds_tenant_order ON saas_order_refunds (tenant_id, order_id, created_at);
CREATE INDEX idx_points_tenant_member ON saas_points_ledger (tenant_id, member_id, created_at);



-- V3__engagement_modules.sql
CREATE TABLE saas_coupon_templates (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  name VARCHAR(40) NOT NULL,
  threshold_cent BIGINT NOT NULL DEFAULT 0,
  amount_cent BIGINT NOT NULL,
  valid_days INT NOT NULL DEFAULT 30,
  limit_per_member INT NOT NULL DEFAULT 1,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_coupon_tpl_tenant FOREIGN KEY (tenant_id) REFERENCES saas_tenants(id)
);

CREATE TABLE saas_coupons (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  template_id BIGINT NOT NULL,
  member_id BIGINT NOT NULL,
  name VARCHAR(40) NOT NULL,
  threshold_cent BIGINT NOT NULL,
  amount_cent BIGINT NOT NULL,
  status VARCHAR(24) NOT NULL,
  expire_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reserved_order_id BIGINT,
  used_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_coupon_tenant FOREIGN KEY (tenant_id) REFERENCES saas_tenants(id),
  CONSTRAINT fk_coupon_tpl FOREIGN KEY (template_id) REFERENCES saas_coupon_templates(id),
  CONSTRAINT fk_coupon_member FOREIGN KEY (member_id) REFERENCES saas_members(id)
);

CREATE TABLE saas_group_buys (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  product_id BIGINT NOT NULL,
  title VARCHAR(80) NOT NULL,
  group_price_cent BIGINT NOT NULL,
  min_participants INT NOT NULL,
  max_participants INT NOT NULL,
  status VARCHAR(24) NOT NULL,
  start_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  end_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  success_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_group_tenant FOREIGN KEY (tenant_id) REFERENCES saas_tenants(id),
  CONSTRAINT fk_group_product FOREIGN KEY (product_id) REFERENCES saas_products(id)
);

CREATE TABLE saas_group_buy_participants (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  group_buy_id BIGINT NOT NULL,
  member_id BIGINT NOT NULL,
  role VARCHAR(24) NOT NULL,
  joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_group_participant_group FOREIGN KEY (group_buy_id) REFERENCES saas_group_buys(id),
  CONSTRAINT fk_group_participant_member FOREIGN KEY (member_id) REFERENCES saas_members(id),
  CONSTRAINT uk_group_participant UNIQUE (group_buy_id, member_id)
);

CREATE TABLE saas_forms (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  title VARCHAR(80) NOT NULL,
  description VARCHAR(300),
  fields_json TEXT NOT NULL,
  status VARCHAR(24) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_form_tenant FOREIGN KEY (tenant_id) REFERENCES saas_tenants(id)
);

CREATE TABLE saas_form_submissions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  form_id BIGINT NOT NULL,
  member_id BIGINT NOT NULL,
  answers_json TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_submission_tenant FOREIGN KEY (tenant_id) REFERENCES saas_tenants(id),
  CONSTRAINT fk_submission_form FOREIGN KEY (form_id) REFERENCES saas_forms(id),
  CONSTRAINT fk_submission_member FOREIGN KEY (member_id) REFERENCES saas_members(id),
  CONSTRAINT uk_form_member UNIQUE (form_id, member_id)
);

CREATE TABLE saas_appointment_services (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  name VARCHAR(40) NOT NULL,
  price_cent BIGINT NOT NULL DEFAULT 0,
  duration_minutes INT NOT NULL DEFAULT 60,
  capacity_per_slot INT NOT NULL DEFAULT 1,
  slots_json TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_appt_service_tenant FOREIGN KEY (tenant_id) REFERENCES saas_tenants(id)
);

CREATE TABLE saas_appointments (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  service_id BIGINT NOT NULL,
  service_name VARCHAR(40) NOT NULL,
  member_id BIGINT NOT NULL,
  appointment_date VARCHAR(10) NOT NULL,
  slot VARCHAR(10) NOT NULL,
  note VARCHAR(100),
  status VARCHAR(24) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cancelled_at TIMESTAMP NULL,
  completed_at TIMESTAMP NULL,
  CONSTRAINT fk_appt_tenant FOREIGN KEY (tenant_id) REFERENCES saas_tenants(id),
  CONSTRAINT fk_appt_service FOREIGN KEY (service_id) REFERENCES saas_appointment_services(id),
  CONSTRAINT fk_appt_member FOREIGN KEY (member_id) REFERENCES saas_members(id)
);

CREATE TABLE saas_subscription_authorizations (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  member_id BIGINT NOT NULL,
  decisions_json TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sub_auth_tenant FOREIGN KEY (tenant_id) REFERENCES saas_tenants(id),
  CONSTRAINT fk_sub_auth_member FOREIGN KEY (member_id) REFERENCES saas_members(id)
);

CREATE TABLE saas_notification_outbox (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  member_id BIGINT,
  event VARCHAR(40) NOT NULL,
  title VARCHAR(80),
  template_id VARCHAR(128),
  page VARCHAR(200),
  payload_json TEXT,
  status VARCHAR(24) NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMP NULL,
  error VARCHAR(500),
  sent_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_outbox_tenant FOREIGN KEY (tenant_id) REFERENCES saas_tenants(id)
);

CREATE INDEX idx_coupons_tenant_member ON saas_coupons (tenant_id, member_id, status);
CREATE INDEX idx_group_buys_tenant_status ON saas_group_buys (tenant_id, status, end_at);
CREATE INDEX idx_forms_tenant_status ON saas_forms (tenant_id, status);
CREATE INDEX idx_appointments_tenant_slot ON saas_appointments (tenant_id, service_id, appointment_date, slot, status);
CREATE INDEX idx_outbox_tenant_status ON saas_notification_outbox (tenant_id, status, next_attempt_at);

