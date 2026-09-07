-- 0157: Department Workspaces Phase 5 & 6
-- Cross-module links, task approvals, configurable buckets/labels, templates

BEGIN;

-- ── Phase 5: Cross-module link columns on dept_tasks ─────────────────────────
ALTER TABLE dept_tasks ADD COLUMN IF NOT EXISTS linked_po_id UUID;
ALTER TABLE dept_tasks ADD COLUMN IF NOT EXISTS linked_fleet_asset_id UUID;
ALTER TABLE dept_tasks ADD COLUMN IF NOT EXISTS linked_fuel_transaction_id UUID;
ALTER TABLE dept_tasks ADD COLUMN IF NOT EXISTS approved BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE dept_tasks ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES auth.users(id);
ALTER TABLE dept_tasks ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE dept_tasks ADD COLUMN IF NOT EXISTS estimated_cost NUMERIC(12,2) DEFAULT 0;
ALTER TABLE dept_tasks ADD COLUMN IF NOT EXISTS actual_cost NUMERIC(12,2) DEFAULT 0;

-- ── Phase 5: Budget tracking on dept_projects ────────────────────────────────
ALTER TABLE dept_projects ADD COLUMN IF NOT EXISTS budget NUMERIC(14,2) DEFAULT 0;
ALTER TABLE dept_projects ADD COLUMN IF NOT EXISTS spent NUMERIC(14,2) DEFAULT 0;

-- ── Phase 6: Configurable buckets and labels per department ──────────────────
ALTER TABLE departments ADD COLUMN IF NOT EXISTS custom_buckets TEXT[] DEFAULT '{"Initiating","Planning","Executing","Monitoring & Controlling","Closing"}';
ALTER TABLE departments ADD COLUMN IF NOT EXISTS custom_labels TEXT[] DEFAULT '{}';
ALTER TABLE departments ADD COLUMN IF NOT EXISTS document_categories TEXT[] DEFAULT '{"SOP","Drawing","Report","Correspondence","General"}';

-- ── Phase 6: Template projects ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dept_project_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  default_buckets TEXT[] DEFAULT '{"Initiating","Planning","Executing","Monitoring & Controlling","Closing"}',
  template_tasks JSONB DEFAULT '[]',
  is_archived   BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dept_templates_dept_idx ON dept_project_templates(department_id);
ALTER TABLE dept_project_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY dept_templates_read ON dept_project_templates FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM departments d WHERE d.id = department_id AND _has_permission('dept.view', d.site_id)
  ));
CREATE POLICY dept_templates_write ON dept_project_templates FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM departments d WHERE d.id = department_id AND _has_permission('dept.edit', d.site_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM departments d WHERE d.id = department_id AND _has_permission('dept.edit', d.site_id)
  ));

-- ── Phase 5: Overdue task notification view ──────────────────────────────────
CREATE OR REPLACE VIEW dept_overdue_tasks AS
SELECT t.*, p.name AS project_name, p.site_id, p.department_id,
       d.name AS department_name, d.color AS department_color,
       e.first_name || ' ' || e.last_name AS assignee_name
FROM dept_tasks t
JOIN dept_projects p ON p.id = t.project_id
JOIN departments d ON d.id = p.department_id
LEFT JOIN employees e ON e.id = t.assigned_to
WHERE t.is_archived = false
  AND t.status != 'completed'
  AND t.due_date IS NOT NULL
  AND t.due_date < CURRENT_DATE;

INSERT INTO schema_migrations (filename) VALUES ('0157_dept_phase5_6.sql') ON CONFLICT DO NOTHING;

COMMIT;
