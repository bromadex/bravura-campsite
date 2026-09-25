-- 0195: Apply DocShare phases 2–3 (0171, 0172 were never applied) + make DocShare the single document store.
-- 0171: DocShare Phase 2 — Controlled Documents & Versioning
-- Apply in Supabase SQL editor



-- ── Versions ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ds_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id     uuid NOT NULL REFERENCES ds_documents(id),
  version_number  int NOT NULL,
  file_path       text,
  file_name       text,
  file_size       bigint,
  change_summary  text,
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_review','approved','superseded')),
  uploaded_by     uuid REFERENCES profiles(id),
  reviewed_by     uuid REFERENCES profiles(id),
  approved_by     uuid REFERENCES profiles(id),
  approved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ds_versions_document ON ds_versions(document_id);
CREATE INDEX IF NOT EXISTS idx_ds_versions_uploaded_by ON ds_versions(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_ds_versions_status ON ds_versions(status);

-- ── Review requests ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ds_review_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id    uuid NOT NULL REFERENCES ds_versions(id),
  reviewer_id   uuid NOT NULL REFERENCES profiles(id),
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','changes_requested')),
  comments      text,
  responded_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ds_review_version ON ds_review_requests(version_id);
CREATE INDEX IF NOT EXISTS idx_ds_review_reviewer ON ds_review_requests(reviewer_id);

-- ── Acknowledgements ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ds_acknowledgements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id      uuid NOT NULL REFERENCES ds_versions(id),
  user_id         uuid NOT NULL REFERENCES profiles(id),
  acknowledged_at timestamptz,
  required_by     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ds_ack_version ON ds_acknowledgements(version_id);
CREATE INDEX IF NOT EXISTS idx_ds_ack_user ON ds_acknowledgements(user_id);

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE ds_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ds_review_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE ds_acknowledgements ENABLE ROW LEVEL SECURITY;

-- ds_versions: join to ds_documents for site_id
DROP POLICY IF EXISTS ds_versions_select ON ds_versions;
CREATE POLICY ds_versions_select ON ds_versions FOR SELECT USING (
  EXISTS (SELECT 1 FROM ds_documents d WHERE d.id = document_id AND _has_permission('ds.view', d.site_id))
);
DROP POLICY IF EXISTS ds_versions_insert ON ds_versions;
CREATE POLICY ds_versions_insert ON ds_versions FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM ds_documents d WHERE d.id = document_id AND _has_permission('ds.create', d.site_id))
);
DROP POLICY IF EXISTS ds_versions_update ON ds_versions;
CREATE POLICY ds_versions_update ON ds_versions FOR UPDATE USING (
  EXISTS (SELECT 1 FROM ds_documents d WHERE d.id = document_id AND _has_permission('ds.edit', d.site_id))
);

-- ds_review_requests: join through ds_versions → ds_documents for site_id
DROP POLICY IF EXISTS ds_review_select ON ds_review_requests;
CREATE POLICY ds_review_select ON ds_review_requests FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM ds_versions v
    JOIN ds_documents d ON d.id = v.document_id
    WHERE v.id = version_id AND _has_permission('ds.view', d.site_id)
  )
);
DROP POLICY IF EXISTS ds_review_insert ON ds_review_requests;
CREATE POLICY ds_review_insert ON ds_review_requests FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM ds_versions v
    JOIN ds_documents d ON d.id = v.document_id
    WHERE v.id = version_id AND _has_permission('ds.approve', d.site_id)
  )
);
DROP POLICY IF EXISTS ds_review_update ON ds_review_requests;
CREATE POLICY ds_review_update ON ds_review_requests FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM ds_versions v
    JOIN ds_documents d ON d.id = v.document_id
    WHERE v.id = version_id AND _has_permission('ds.approve', d.site_id)
  )
);

-- ds_acknowledgements: join through ds_versions → ds_documents for site_id
DROP POLICY IF EXISTS ds_ack_select ON ds_acknowledgements;
CREATE POLICY ds_ack_select ON ds_acknowledgements FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM ds_versions v
    JOIN ds_documents d ON d.id = v.document_id
    WHERE v.id = version_id AND _has_permission('ds.view', d.site_id)
  )
);
DROP POLICY IF EXISTS ds_ack_insert ON ds_acknowledgements;
CREATE POLICY ds_ack_insert ON ds_acknowledgements FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM ds_versions v
    JOIN ds_documents d ON d.id = v.document_id
    WHERE v.id = version_id AND _has_permission('ds.approve', d.site_id)
  )
);
-- (fixed in 0195: only the person themselves can mark their acknowledgement)
DROP POLICY IF EXISTS ds_ack_update ON ds_acknowledgements;
CREATE POLICY ds_ack_update ON ds_acknowledgements FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

INSERT INTO schema_migrations (filename) VALUES ('0171_docshare_versioning.sql') ON CONFLICT DO NOTHING;



-- 0172: DocShare Phase 3 — Expiry, Compliance & Reporting
-- Apply in Supabase SQL editor



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
DROP POLICY IF EXISTS ds_expiry_select ON ds_expiry_rules;
CREATE POLICY ds_expiry_select ON ds_expiry_rules FOR SELECT USING (
  EXISTS (SELECT 1 FROM ds_documents d WHERE d.id = document_id AND _has_permission('ds.view', d.site_id))
);
DROP POLICY IF EXISTS ds_expiry_insert ON ds_expiry_rules;
CREATE POLICY ds_expiry_insert ON ds_expiry_rules FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM ds_documents d WHERE d.id = document_id AND _has_permission('ds.edit', d.site_id))
);
DROP POLICY IF EXISTS ds_expiry_update ON ds_expiry_rules;
CREATE POLICY ds_expiry_update ON ds_expiry_rules FOR UPDATE USING (
  EXISTS (SELECT 1 FROM ds_documents d WHERE d.id = document_id AND _has_permission('ds.edit', d.site_id))
);

-- ds_activity_log: join to ds_documents for site_id
DROP POLICY IF EXISTS ds_activity_select ON ds_activity_log;
CREATE POLICY ds_activity_select ON ds_activity_log FOR SELECT USING (
  EXISTS (SELECT 1 FROM ds_documents d WHERE d.id = document_id AND _has_permission('ds.view', d.site_id))
);
DROP POLICY IF EXISTS ds_activity_insert ON ds_activity_log;
CREATE POLICY ds_activity_insert ON ds_activity_log FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM ds_documents d WHERE d.id = document_id AND _has_permission('ds.create', d.site_id))
);

INSERT INTO schema_migrations (filename) VALUES ('0172_docshare_expiry_reports.sql') ON CONFLICT DO NOTHING;



-- ── 0195: DocShare is the single document store ─────────────────────
-- SHEQ Doc Control → DocShare controlled documents (category SHEQ); governance policies can link a DocShare file.
ALTER TABLE ds_documents ADD COLUMN IF NOT EXISTS document_number TEXT;
ALTER TABLE ds_documents ADD COLUMN IF NOT EXISTS document_type   TEXT;
ALTER TABLE ds_documents ADD COLUMN IF NOT EXISTS department_id   UUID;
ALTER TABLE ds_documents ADD COLUMN IF NOT EXISTS owner_id        UUID REFERENCES profiles(id);
ALTER TABLE ds_documents ADD COLUMN IF NOT EXISTS review_date     DATE;
ALTER TABLE ds_documents ADD COLUMN IF NOT EXISTS expiry_date     DATE;
CREATE UNIQUE INDEX IF NOT EXISTS uq_ds_documents_number ON ds_documents (site_id, document_number) WHERE document_number IS NOT NULL;

CREATE OR REPLACE FUNCTION trg_ds_controlled_number() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.doc_mode = 'controlled' AND NEW.document_number IS NULL AND NEW.site_id IS NOT NULL THEN
    NEW.document_number := doc_next_number(NEW.site_id, 'DOC', CURRENT_DATE);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_ds_controlled_number ON ds_documents;
CREATE TRIGGER trg_ds_controlled_number BEFORE INSERT OR UPDATE OF doc_mode ON ds_documents FOR EACH ROW EXECUTE FUNCTION trg_ds_controlled_number();

ALTER TABLE governance_documents ADD COLUMN IF NOT EXISTS ds_document_id UUID REFERENCES ds_documents(id);

-- Generic "this table is retired" guard (also used by 0194).
CREATE OR REPLACE FUNCTION trg_moved_to_sheq() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% records have moved to % — HR, SHEQ and DocShare now share one set of records.', TG_ARGV[0], TG_ARGV[1];
END;
$$;

-- Old SHEQ document register (empty) is frozen.
DROP TRIGGER IF EXISTS trg_frozen ON sheq_document_control;
CREATE TRIGGER trg_frozen BEFORE INSERT ON sheq_document_control FOR EACH ROW EXECUTE FUNCTION trg_moved_to_sheq('SHEQ controlled document', 'DocShare (ds_documents, category SHEQ)');
COMMENT ON TABLE sheq_document_control IS 'Retired (0195): use DocShare controlled documents';

UPDATE ds_documents SET document_number = doc_next_number(site_id, 'DOC', CURRENT_DATE) WHERE doc_mode = 'controlled' AND document_number IS NULL;

INSERT INTO schema_migrations (filename) VALUES ('0195_docshare_single_store.sql') ON CONFLICT DO NOTHING;
