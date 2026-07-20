-- Migration: 0085_projects_foundation
-- Project module Phase 1: projects, phases, members, labels

-- ── Permissions ──────────────────────────────────────────────────────────────
INSERT INTO permissions (code, module, action, description) VALUES
  ('projects.view',   'Projects', 'View',   'View projects and dashboards'),
  ('projects.create', 'Projects', 'Create', 'Create new projects'),
  ('projects.edit',   'Projects', 'Edit',   'Edit project details and tasks'),
  ('projects.delete', 'Projects', 'Delete', 'Archive projects'),
  ('projects.approve','Projects', 'Approve','Approve project budgets and phases')
ON CONFLICT (module, action) DO NOTHING;

-- Grant all project permissions to System Admin role
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'System Admin'
  AND p.code IN ('projects.view','projects.create','projects.edit','projects.delete','projects.approve')
ON CONFLICT DO NOTHING;

-- ── Projects table ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES sites(id),
  project_code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  project_type TEXT CHECK (project_type IN ('construction','mining','maintenance','infrastructure','exploration','other')) DEFAULT 'other',
  status TEXT CHECK (status IN ('planning','active','on_hold','completed','cancelled')) DEFAULT 'planning',
  priority TEXT CHECK (priority IN ('low','medium','high','critical')) DEFAULT 'medium',
  start_date DATE,
  target_end_date DATE,
  actual_end_date DATE,
  budget NUMERIC(14,2),
  project_manager UUID,
  client TEXT,
  location TEXT,
  cover_color TEXT DEFAULT '#1B5E20',
  notes TEXT,
  is_archived BOOLEAN DEFAULT false,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  UNIQUE(site_id, project_code)
);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY proj_select ON projects FOR SELECT
  USING (site_id IN (SELECT site_id FROM user_roles WHERE user_id = auth.uid()));

CREATE POLICY proj_insert ON projects FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = auth.uid()
      AND p.code = 'projects.create' AND ur.site_id = site_id
  ));

CREATE POLICY proj_update ON projects FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = auth.uid()
      AND p.code = 'projects.edit' AND ur.site_id = projects.site_id
  ));

CREATE INDEX idx_projects_site_status ON projects(site_id, status);

-- ── Project phases ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_phases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  sequence INT NOT NULL,
  status TEXT CHECK (status IN ('pending','in_progress','completed','skipped')) DEFAULT 'pending',
  start_date DATE,
  end_date DATE,
  budget_allocation NUMERIC(14,2),
  weight INT DEFAULT 1,
  color TEXT,
  is_milestone BOOLEAN DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(project_id, sequence)
);

ALTER TABLE project_phases ENABLE ROW LEVEL SECURITY;

CREATE POLICY pp_select ON project_phases FOR SELECT
  USING (EXISTS (SELECT 1 FROM projects pr WHERE pr.id = project_id AND pr.site_id IN (SELECT site_id FROM user_roles WHERE user_id = auth.uid())));

CREATE POLICY pp_insert ON project_phases FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM projects pr
    JOIN user_roles ur ON ur.site_id = pr.site_id
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE pr.id = project_id AND ur.user_id = auth.uid() AND p.code = 'projects.edit'
  ));

CREATE POLICY pp_update ON project_phases FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM projects pr
    JOIN user_roles ur ON ur.site_id = pr.site_id
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE pr.id = project_phases.project_id AND ur.user_id = auth.uid() AND p.code = 'projects.edit'
  ));

CREATE POLICY pp_delete ON project_phases FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM projects pr
    JOIN user_roles ur ON ur.site_id = pr.site_id
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE pr.id = project_phases.project_id AND ur.user_id = auth.uid() AND p.code = 'projects.edit'
  ));

-- ── Project members ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),
  employee_id UUID,
  role TEXT NOT NULL DEFAULT 'viewer',
  can_edit_tasks BOOLEAN DEFAULT true,
  can_add_docs BOOLEAN DEFAULT true,
  can_comment BOOLEAN DEFAULT true,
  assigned_date DATE DEFAULT CURRENT_DATE,
  removed_date DATE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(project_id, user_id)
);

ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY pm_select ON project_members FOR SELECT
  USING (EXISTS (SELECT 1 FROM projects pr WHERE pr.id = project_id AND pr.site_id IN (SELECT site_id FROM user_roles WHERE user_id = auth.uid())));

CREATE POLICY pm_insert ON project_members FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM projects pr
    JOIN user_roles ur ON ur.site_id = pr.site_id
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE pr.id = project_id AND ur.user_id = auth.uid() AND p.code = 'projects.edit'
  ));

CREATE POLICY pm_update ON project_members FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM projects pr
    JOIN user_roles ur ON ur.site_id = pr.site_id
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE pr.id = project_members.project_id AND ur.user_id = auth.uid() AND p.code = 'projects.edit'
  ));

CREATE POLICY pm_delete ON project_members FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM projects pr
    JOIN user_roles ur ON ur.site_id = pr.site_id
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE pr.id = project_members.project_id AND ur.user_id = auth.uid() AND p.code = 'projects.edit'
  ));

-- ── Project labels ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#1565C0',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(project_id, name)
);

ALTER TABLE project_labels ENABLE ROW LEVEL SECURITY;

CREATE POLICY pl_select ON project_labels FOR SELECT
  USING (EXISTS (SELECT 1 FROM projects pr WHERE pr.id = project_id AND pr.site_id IN (SELECT site_id FROM user_roles WHERE user_id = auth.uid())));

CREATE POLICY pl_insert ON project_labels FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM projects pr
    JOIN user_roles ur ON ur.site_id = pr.site_id
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE pr.id = project_id AND ur.user_id = auth.uid() AND p.code = 'projects.edit'
  ));

CREATE POLICY pl_delete ON project_labels FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM projects pr
    JOIN user_roles ur ON ur.site_id = pr.site_id
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE pr.id = project_labels.project_id AND ur.user_id = auth.uid() AND p.code = 'projects.edit'
  ));

INSERT INTO schema_migrations (filename) VALUES ('0085_projects_foundation.sql') ON CONFLICT DO NOTHING;
