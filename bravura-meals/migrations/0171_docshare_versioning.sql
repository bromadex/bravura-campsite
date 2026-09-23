-- 0171: DocShare Phase 2 — Controlled Documents & Versioning
-- Apply in Supabase SQL editor

BEGIN;

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
CREATE POLICY ds_versions_select ON ds_versions FOR SELECT USING (
  EXISTS (SELECT 1 FROM ds_documents d WHERE d.id = document_id AND _has_permission('ds.view', d.site_id))
);
CREATE POLICY ds_versions_insert ON ds_versions FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM ds_documents d WHERE d.id = document_id AND _has_permission('ds.create', d.site_id))
);
CREATE POLICY ds_versions_update ON ds_versions FOR UPDATE USING (
  EXISTS (SELECT 1 FROM ds_documents d WHERE d.id = document_id AND _has_permission('ds.edit', d.site_id))
);

-- ds_review_requests: join through ds_versions → ds_documents for site_id
CREATE POLICY ds_review_select ON ds_review_requests FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM ds_versions v
    JOIN ds_documents d ON d.id = v.document_id
    WHERE v.id = version_id AND _has_permission('ds.view', d.site_id)
  )
);
CREATE POLICY ds_review_insert ON ds_review_requests FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM ds_versions v
    JOIN ds_documents d ON d.id = v.document_id
    WHERE v.id = version_id AND _has_permission('ds.approve', d.site_id)
  )
);
CREATE POLICY ds_review_update ON ds_review_requests FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM ds_versions v
    JOIN ds_documents d ON d.id = v.document_id
    WHERE v.id = version_id AND _has_permission('ds.approve', d.site_id)
  )
);

-- ds_acknowledgements: join through ds_versions → ds_documents for site_id
CREATE POLICY ds_ack_select ON ds_acknowledgements FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM ds_versions v
    JOIN ds_documents d ON d.id = v.document_id
    WHERE v.id = version_id AND _has_permission('ds.view', d.site_id)
  )
);
CREATE POLICY ds_ack_insert ON ds_acknowledgements FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM ds_versions v
    JOIN ds_documents d ON d.id = v.document_id
    WHERE v.id = version_id AND _has_permission('ds.approve', d.site_id)
  )
);
CREATE POLICY ds_ack_update ON ds_acknowledgements FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM ds_versions v
    JOIN ds_documents d ON d.id = v.document_id
    WHERE v.id = version_id AND _has_permission('ds.view', d.site_id)
  )
);

INSERT INTO schema_migrations (filename) VALUES ('0171_docshare_versioning.sql') ON CONFLICT DO NOTHING;

COMMIT;
