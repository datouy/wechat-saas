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

