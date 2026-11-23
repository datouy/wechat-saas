-- 运行时 PostgreSQL 文档存储
-- 与 001 的业务投影并存：PgStore 使用本表承载现有文档接口，
-- 报表和严格关系约束可逐步回填到 001/002 的规范化表。

CREATE TABLE IF NOT EXISTS saas_documents (
  collection TEXT NOT NULL,
  id TEXT NOT NULL,
  doc JSONB NOT NULL,
  revision BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (collection, id)
);

CREATE INDEX IF NOT EXISTS idx_saas_documents_tenant
  ON saas_documents (collection, (doc->>'tenantId'));
CREATE INDEX IF NOT EXISTS idx_saas_documents_member
  ON saas_documents (collection, (doc->>'memberId'));
CREATE INDEX IF NOT EXISTS idx_saas_documents_status
  ON saas_documents (collection, (doc->>'status'), updated_at);
CREATE INDEX IF NOT EXISTS idx_saas_documents_due
  ON saas_documents (collection, (doc->>'nextAttemptAt'))
  WHERE doc->>'nextAttemptAt' IS NOT NULL;

CREATE OR REPLACE FUNCTION saas_protect_audit_document() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.collection = 'auditLogs' THEN
    RAISE EXCEPTION 'auditLogs is append-only';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.collection = 'auditLogs' THEN
    IF COALESCE(OLD.doc->>'hash', '') <> '' THEN
      RAISE EXCEPTION 'sealed auditLogs are append-only';
    END IF;
    IF (NEW.doc - ARRAY['sequence','previousHash','version','hash']) <>
       (OLD.doc - ARRAY['sequence','previousHash','version','hash']) THEN
      RAISE EXCEPTION 'legacy audit sealing may only add chain metadata';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_saas_documents_audit_guard ON saas_documents;
CREATE TRIGGER trg_saas_documents_audit_guard
BEFORE UPDATE OR DELETE ON saas_documents
FOR EACH ROW EXECUTE FUNCTION saas_protect_audit_document();

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  checksum TEXT NOT NULL
);
