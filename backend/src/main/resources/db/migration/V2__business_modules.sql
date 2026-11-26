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

