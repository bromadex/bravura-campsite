-- 0086_project_tasks.sql
-- Board columns, tasks, labels, checklists, dependencies for project management

-- ── Board columns ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_board_columns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INT NOT NULL,
  color TEXT,
  wip_limit INT,
  is_done_column BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(project_id, position)
);

ALTER TABLE project_board_columns ENABLE ROW LEVEL SECURITY;

CREATE POLICY pbc_select ON project_board_columns FOR SELECT
  USING (EXISTS (SELECT 1 FROM projects pr WHERE pr.id = project_id AND pr.site_id IN (SELECT site_id FROM user_roles WHERE user_id = auth.uid())));

CREATE POLICY pbc_insert ON project_board_columns FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM projects pr
    JOIN user_roles ur ON ur.site_id = pr.site_id
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE pr.id = project_id AND ur.user_id = auth.uid() AND p.code = 'projects.edit'
  ));

CREATE POLICY pbc_update ON project_board_columns FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM projects pr
    JOIN user_roles ur ON ur.site_id = pr.site_id
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE pr.id = project_board_columns.project_id AND ur.user_id = auth.uid() AND p.code = 'projects.edit'
  ));

CREATE POLICY pbc_delete ON project_board_columns FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM projects pr
    JOIN user_roles ur ON ur.site_id = pr.site_id
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE pr.id = project_board_columns.project_id AND ur.user_id = auth.uid() AND p.code = 'projects.edit'
  ));

-- ── Tasks ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  column_id UUID NOT NULL REFERENCES project_board_columns(id),
  phase_id UUID REFERENCES project_phases(id),
  parent_task_id UUID REFERENCES project_tasks(id),
  title TEXT NOT NULL,
  description TEXT,
  position INT NOT NULL,
  priority TEXT CHECK (priority IN ('low','medium','high','critical')) DEFAULT 'medium',
  assigned_to UUID,
  reporter UUID REFERENCES auth.users(id),
  due_date DATE,
  start_date DATE,
  completed_date TIMESTAMPTZ,
  estimated_hours NUMERIC(8,2),
  actual_hours NUMERIC(8,2),
  cover_image_url TEXT,
  is_archived BOOLEAN DEFAULT false,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

CREATE INDEX idx_project_tasks_col_pos ON project_tasks(project_id, column_id, position);
CREATE INDEX idx_project_tasks_assigned ON project_tasks(assigned_to, completed_date);

ALTER TABLE project_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY pt_select ON project_tasks FOR SELECT
  USING (EXISTS (SELECT 1 FROM projects pr WHERE pr.id = project_id AND pr.site_id IN (SELECT site_id FROM user_roles WHERE user_id = auth.uid())));

CREATE POLICY pt_insert ON project_tasks FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM projects pr
    JOIN user_roles ur ON ur.site_id = pr.site_id
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE pr.id = project_id AND ur.user_id = auth.uid() AND p.code = 'projects.edit'
  ));

CREATE POLICY pt_update ON project_tasks FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM projects pr
    JOIN user_roles ur ON ur.site_id = pr.site_id
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE pr.id = project_tasks.project_id AND ur.user_id = auth.uid() AND p.code = 'projects.edit'
  ));

CREATE POLICY pt_delete ON project_tasks FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM projects pr
    JOIN user_roles ur ON ur.site_id = pr.site_id
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE pr.id = project_tasks.project_id AND ur.user_id = auth.uid() AND p.code = 'projects.edit'
  ));

-- ── Task labels (junction) ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_task_labels (
  task_id UUID NOT NULL REFERENCES project_tasks(id) ON DELETE CASCADE,
  label_id UUID NOT NULL REFERENCES project_labels(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, label_id)
);

ALTER TABLE project_task_labels ENABLE ROW LEVEL SECURITY;

CREATE POLICY ptl_select ON project_task_labels FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM project_tasks pt
    JOIN projects pr ON pr.id = pt.project_id
    WHERE pt.id = task_id AND pr.site_id IN (SELECT site_id FROM user_roles WHERE user_id = auth.uid())
  ));

CREATE POLICY ptl_insert ON project_task_labels FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM project_tasks pt
    JOIN projects pr ON pr.id = pt.project_id
    JOIN user_roles ur ON ur.site_id = pr.site_id
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE pt.id = task_id AND ur.user_id = auth.uid() AND p.code = 'projects.edit'
  ));

CREATE POLICY ptl_delete ON project_task_labels FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM project_tasks pt
    JOIN projects pr ON pr.id = pt.project_id
    JOIN user_roles ur ON ur.site_id = pr.site_id
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE pt.id = project_task_labels.task_id AND ur.user_id = auth.uid() AND p.code = 'projects.edit'
  ));

-- ── Task checklist ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_task_checklist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES project_tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  checked BOOLEAN DEFAULT false,
  position INT NOT NULL,
  assigned_to UUID,
  due_date DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE project_task_checklist ENABLE ROW LEVEL SECURITY;

CREATE POLICY ptc_select ON project_task_checklist FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM project_tasks pt
    JOIN projects pr ON pr.id = pt.project_id
    WHERE pt.id = task_id AND pr.site_id IN (SELECT site_id FROM user_roles WHERE user_id = auth.uid())
  ));

CREATE POLICY ptc_insert ON project_task_checklist FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM project_tasks pt
    JOIN projects pr ON pr.id = pt.project_id
    JOIN user_roles ur ON ur.site_id = pr.site_id
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE pt.id = task_id AND ur.user_id = auth.uid() AND p.code = 'projects.edit'
  ));

CREATE POLICY ptc_update ON project_task_checklist FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM project_tasks pt
    JOIN projects pr ON pr.id = pt.project_id
    JOIN user_roles ur ON ur.site_id = pr.site_id
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE pt.id = project_task_checklist.task_id AND ur.user_id = auth.uid() AND p.code = 'projects.edit'
  ));

CREATE POLICY ptc_delete ON project_task_checklist FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM project_tasks pt
    JOIN projects pr ON pr.id = pt.project_id
    JOIN user_roles ur ON ur.site_id = pr.site_id
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE pt.id = project_task_checklist.task_id AND ur.user_id = auth.uid() AND p.code = 'projects.edit'
  ));

-- ── Task dependencies ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_task_dependencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES project_tasks(id) ON DELETE CASCADE,
  depends_on_id UUID NOT NULL REFERENCES project_tasks(id) ON DELETE CASCADE,
  dependency_type TEXT CHECK (dependency_type IN ('blocks','is_blocked_by','related_to')) DEFAULT 'blocks',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(task_id, depends_on_id),
  CHECK(task_id != depends_on_id)
);

ALTER TABLE project_task_dependencies ENABLE ROW LEVEL SECURITY;

CREATE POLICY ptd_select ON project_task_dependencies FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM project_tasks pt
    JOIN projects pr ON pr.id = pt.project_id
    WHERE pt.id = task_id AND pr.site_id IN (SELECT site_id FROM user_roles WHERE user_id = auth.uid())
  ));

CREATE POLICY ptd_insert ON project_task_dependencies FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM project_tasks pt
    JOIN projects pr ON pr.id = pt.project_id
    JOIN user_roles ur ON ur.site_id = pr.site_id
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE pt.id = task_id AND ur.user_id = auth.uid() AND p.code = 'projects.edit'
  ));

CREATE POLICY ptd_delete ON project_task_dependencies FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM project_tasks pt
    JOIN projects pr ON pr.id = pt.project_id
    JOIN user_roles ur ON ur.site_id = pr.site_id
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE pt.id = project_task_dependencies.task_id AND ur.user_id = auth.uid() AND p.code = 'projects.edit'
  ));

INSERT INTO schema_migrations (filename) VALUES ('0086_project_tasks.sql') ON CONFLICT DO NOTHING;
