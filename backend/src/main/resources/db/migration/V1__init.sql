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

