-- 0172: DocShare Phase 3 — Expiry, Compliance & Reporting
-- Apply in Supabase SQL editor

BEGIN;

-- ── Expiry rules ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ds_expiry_rules (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id       uuid NOT NULL REFERENCES ds_documents(id) UNIQUE,
  expiry_months     int NOT NULL DEFAULT 12,
  notify_days_before int NOT NULL DEFAULT 30,
  auto_archive      boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ds_expiry_document ON ds_expiry_rules(document_id);

-- ── Activity log ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ds_activity_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   uuid NOT NULL REFERENCES ds_documents(id),
  action        text NOT NULL,
  user_id       uuid REFERENCES profiles(id),
  details       jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ds_activity_document ON ds_activity_log(document_id);
CREATE INDEX IF NOT EXISTS idx_ds_activity_created ON ds_activity_log(created_at);

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE ds_expiry_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE ds_activity_log ENABLE ROW LEVEL SECURITY;

-- ds_expiry_rules: join to ds_documents for site_id
CREATE POLICY ds_expiry_select ON ds_expiry_rules FOR SELECT USING (
  EXISTS (SELECT 1 FROM ds_documents d WHERE d.id = document_id AND _has_permission('ds.view', d.site_id))
);
CREATE POLICY ds_expiry_insert ON ds_expiry_rules FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM ds_documents d WHERE d.id = document_id AND _has_permission('ds.edit', d.site_id))
);
CREATE POLICY ds_expiry_update ON ds_expiry_rules FOR UPDATE USING (
  EXISTS (SELECT 1 FROM ds_documents d WHERE d.id = document_id AND _has_permission('ds.edit', d.site_id))
);

-- ds_activity_log: join to ds_documents for site_id
CREATE POLICY ds_activity_select ON ds_activity_log FOR SELECT USING (
  EXISTS (SELECT 1 FROM ds_documents d WHERE d.id = document_id AND _has_permission('ds.view', d.site_id))
);
CREATE POLICY ds_activity_insert ON ds_activity_log FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM ds_documents d WHERE d.id = document_id AND _has_permission('ds.create', d.site_id))
);

INSERT INTO schema_migrations (filename) VALUES ('0172_docshare_expiry_reports.sql') ON CONFLICT DO NOTHING;

COMMIT;
