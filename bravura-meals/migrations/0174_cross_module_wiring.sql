-- Migration: 0174_cross_module_wiring
-- Add missing project_id columns + ds_document_links table for cross-module wiring.

-- ── purchase_orders.project_id ──────────────────────────────────────────────
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_project ON purchase_orders(project_id);

-- ── casual_timesheets.project_id ────────────────────────────────────────────
ALTER TABLE casual_timesheets
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id);
CREATE INDEX IF NOT EXISTS idx_casual_timesheets_project ON casual_timesheets(project_id);

-- ── fleet_dispatches.project_id (conditional — table may not exist) ─────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'fleet_dispatches') THEN
    EXECUTE 'ALTER TABLE fleet_dispatches ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_fleet_dispatches_project ON fleet_dispatches(project_id)';
  END IF;
END
$$;

-- ── ds_document_links ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ds_document_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES ds_documents(id) ON DELETE CASCADE,
  linked_table text NOT NULL,
  linked_id uuid NOT NULL,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  UNIQUE(document_id, linked_table, linked_id)
);
CREATE INDEX IF NOT EXISTS idx_ds_doc_links_linked ON ds_document_links(linked_table, linked_id);

-- RLS for ds_document_links
ALTER TABLE ds_document_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY ds_doc_links_select ON ds_document_links FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM ds_documents d
    WHERE d.id = ds_document_links.document_id
      AND _has_permission('ds.view', d.site_id)
  )
);

CREATE POLICY ds_doc_links_insert ON ds_document_links FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM ds_documents d
    WHERE d.id = ds_document_links.document_id
      AND _has_permission('ds.create', d.site_id)
  )
);

CREATE POLICY ds_doc_links_delete ON ds_document_links FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM ds_documents d
    WHERE d.id = ds_document_links.document_id
      AND _has_permission('ds.edit', d.site_id)
  )
);

-- ── Self-record ─────────────────────────────────────────────────────────────
INSERT INTO schema_migrations (filename)
VALUES ('0174_cross_module_wiring.sql')
ON CONFLICT DO NOTHING;
