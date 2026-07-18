-- 0098 — PPE issue tracking for HR module
-- Tracks personal protective equipment issued to employees, with optional
-- link to inventory items for automatic stock deduction.

BEGIN;

CREATE TABLE IF NOT EXISTS ppe_issues (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id                 UUID NOT NULL REFERENCES sites(id),
  employee_id             UUID NOT NULL REFERENCES employees(id),
  item_id                 UUID REFERENCES items(id),
  item_description        TEXT NOT NULL,
  quantity                INTEGER NOT NULL DEFAULT 1,
  date_issued             DATE NOT NULL DEFAULT CURRENT_DATE,
  expected_replacement_date DATE,
  date_returned           DATE,
  status                  TEXT NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'due_replacement', 'returned')),
  notes                   TEXT,
  issued_by               UUID REFERENCES auth.users(id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ppe_site ON ppe_issues(site_id);
CREATE INDEX IF NOT EXISTS idx_ppe_employee ON ppe_issues(employee_id);
CREATE INDEX IF NOT EXISTS idx_ppe_status ON ppe_issues(status);

ALTER TABLE ppe_issues ENABLE ROW LEVEL SECURITY;

CREATE POLICY ppe_issues_select ON ppe_issues FOR SELECT
  USING (_has_permission('hr.view', site_id));

CREATE POLICY ppe_issues_insert ON ppe_issues FOR INSERT
  WITH CHECK (_has_permission('hr.create', site_id));

CREATE POLICY ppe_issues_update ON ppe_issues FOR UPDATE
  USING (_has_permission('hr.edit', site_id));

-- Trigger for updated_at
CREATE TRIGGER set_ppe_issues_updated_at
  BEFORE UPDATE ON ppe_issues
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

INSERT INTO schema_migrations (filename) VALUES ('0098_ppe_issues.sql')
ON CONFLICT DO NOTHING;

COMMIT;
