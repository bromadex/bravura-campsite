-- Migration: 0087_fix_projects_rls
-- Fix: user_roles.site_id is NULL for cross-site roles (Executive Admin etc.)
-- All project RLS policies now treat NULL site_id as "access to all sites"

-- ── projects table ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS proj_select ON projects;
DROP POLICY IF EXISTS proj_insert ON projects;
DROP POLICY IF EXISTS proj_update ON projects;

CREATE POLICY proj_select ON projects FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid()
      AND (ur.site_id = projects.site_id OR ur.site_id IS NULL)
  ));

CREATE POLICY proj_insert ON projects FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = auth.uid()
      AND p.code = 'projects.create'
      AND (ur.site_id = projects.site_id OR ur.site_id IS NULL)
  ));

CREATE POLICY proj_update ON projects FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = auth.uid()
      AND p.code = 'projects.edit'
      AND (ur.site_id = projects.site_id OR ur.site_id IS NULL)
  ));

-- ── project_phases ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS pp_select ON project_phases;
DROP POLICY IF EXISTS pp_insert ON project_phases;
DROP POLICY IF EXISTS pp_update ON project_phases;
DROP POLICY IF EXISTS pp_delete ON project_phases;

CREATE POLICY pp_select ON project_phases FOR SELECT
  USING (EXISTS (SELECT 1 FROM projects pr JOIN user_roles ur ON (ur.site_id = pr.site_id OR ur.site_id IS NULL) WHERE pr.id = project_id AND ur.user_id = auth.uid()));
CREATE POLICY pp_insert ON project_phases FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM projects pr JOIN user_roles ur ON (ur.site_id = pr.site_id OR ur.site_id IS NULL) JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id WHERE pr.id = project_id AND ur.user_id = auth.uid() AND p.code = 'projects.edit'));
CREATE POLICY pp_update ON project_phases FOR UPDATE
  USING (EXISTS (SELECT 1 FROM projects pr JOIN user_roles ur ON (ur.site_id = pr.site_id OR ur.site_id IS NULL) JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id WHERE pr.id = project_phases.project_id AND ur.user_id = auth.uid() AND p.code = 'projects.edit'));
CREATE POLICY pp_delete ON project_phases FOR DELETE
  USING (EXISTS (SELECT 1 FROM projects pr JOIN user_roles ur ON (ur.site_id = pr.site_id OR ur.site_id IS NULL) JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id WHERE pr.id = project_phases.project_id AND ur.user_id = auth.uid() AND p.code = 'projects.edit'));

-- ── project_members ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS pm_select ON project_members;
DROP POLICY IF EXISTS pm_insert ON project_members;
DROP POLICY IF EXISTS pm_update ON project_members;
DROP POLICY IF EXISTS pm_delete ON project_members;

CREATE POLICY pm_select ON project_members FOR SELECT
  USING (EXISTS (SELECT 1 FROM projects pr JOIN user_roles ur ON (ur.site_id = pr.site_id OR ur.site_id IS NULL) WHERE pr.id = project_id AND ur.user_id = auth.uid()));
CREATE POLICY pm_insert ON project_members FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM projects pr JOIN user_roles ur ON (ur.site_id = pr.site_id OR ur.site_id IS NULL) JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id WHERE pr.id = project_id AND ur.user_id = auth.uid() AND p.code = 'projects.edit'));
CREATE POLICY pm_update ON project_members FOR UPDATE
  USING (EXISTS (SELECT 1 FROM projects pr JOIN user_roles ur ON (ur.site_id = pr.site_id OR ur.site_id IS NULL) JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id WHERE pr.id = project_members.project_id AND ur.user_id = auth.uid() AND p.code = 'projects.edit'));
CREATE POLICY pm_delete ON project_members FOR DELETE
  USING (EXISTS (SELECT 1 FROM projects pr JOIN user_roles ur ON (ur.site_id = pr.site_id OR ur.site_id IS NULL) JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id WHERE pr.id = project_members.project_id AND ur.user_id = auth.uid() AND p.code = 'projects.edit'));

-- ── project_labels ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS pl_select ON project_labels;
DROP POLICY IF EXISTS pl_insert ON project_labels;
DROP POLICY IF EXISTS pl_delete ON project_labels;

CREATE POLICY pl_select ON project_labels FOR SELECT
  USING (EXISTS (SELECT 1 FROM projects pr JOIN user_roles ur ON (ur.site_id = pr.site_id OR ur.site_id IS NULL) WHERE pr.id = project_id AND ur.user_id = auth.uid()));
CREATE POLICY pl_insert ON project_labels FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM projects pr JOIN user_roles ur ON (ur.site_id = pr.site_id OR ur.site_id IS NULL) JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id WHERE pr.id = project_id AND ur.user_id = auth.uid() AND p.code = 'projects.edit'));
CREATE POLICY pl_delete ON project_labels FOR DELETE
  USING (EXISTS (SELECT 1 FROM projects pr JOIN user_roles ur ON (ur.site_id = pr.site_id OR ur.site_id IS NULL) JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id WHERE pr.id = project_labels.project_id AND ur.user_id = auth.uid() AND p.code = 'projects.edit'));

-- ── project_board_columns ───────────────────────────────────────────────────
DROP POLICY IF EXISTS pbc_select ON project_board_columns;
DROP POLICY IF EXISTS pbc_insert ON project_board_columns;
DROP POLICY IF EXISTS pbc_update ON project_board_columns;
DROP POLICY IF EXISTS pbc_delete ON project_board_columns;

CREATE POLICY pbc_select ON project_board_columns FOR SELECT
  USING (EXISTS (SELECT 1 FROM projects pr JOIN user_roles ur ON (ur.site_id = pr.site_id OR ur.site_id IS NULL) WHERE pr.id = project_id AND ur.user_id = auth.uid()));
CREATE POLICY pbc_insert ON project_board_columns FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM projects pr JOIN user_roles ur ON (ur.site_id = pr.site_id OR ur.site_id IS NULL) JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id WHERE pr.id = project_id AND ur.user_id = auth.uid() AND p.code = 'projects.edit'));
CREATE POLICY pbc_update ON project_board_columns FOR UPDATE
  USING (EXISTS (SELECT 1 FROM projects pr JOIN user_roles ur ON (ur.site_id = pr.site_id OR ur.site_id IS NULL) JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id WHERE pr.id = project_board_columns.project_id AND ur.user_id = auth.uid() AND p.code = 'projects.edit'));
CREATE POLICY pbc_delete ON project_board_columns FOR DELETE
  USING (EXISTS (SELECT 1 FROM projects pr JOIN user_roles ur ON (ur.site_id = pr.site_id OR ur.site_id IS NULL) JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id WHERE pr.id = project_board_columns.project_id AND ur.user_id = auth.uid() AND p.code = 'projects.edit'));

-- ── project_tasks ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS pt_select ON project_tasks;
DROP POLICY IF EXISTS pt_insert ON project_tasks;
DROP POLICY IF EXISTS pt_update ON project_tasks;

CREATE POLICY pt_select ON project_tasks FOR SELECT
  USING (EXISTS (SELECT 1 FROM projects pr JOIN user_roles ur ON (ur.site_id = pr.site_id OR ur.site_id IS NULL) WHERE pr.id = project_id AND ur.user_id = auth.uid()));
CREATE POLICY pt_insert ON project_tasks FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM projects pr JOIN user_roles ur ON (ur.site_id = pr.site_id OR ur.site_id IS NULL) JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id WHERE pr.id = project_id AND ur.user_id = auth.uid() AND p.code = 'projects.edit'));
CREATE POLICY pt_update ON project_tasks FOR UPDATE
  USING (EXISTS (SELECT 1 FROM projects pr JOIN user_roles ur ON (ur.site_id = pr.site_id OR ur.site_id IS NULL) JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id WHERE pr.id = project_tasks.project_id AND ur.user_id = auth.uid() AND p.code = 'projects.edit'));

-- ── project_task_labels ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS ptl_select ON project_task_labels;
DROP POLICY IF EXISTS ptl_insert ON project_task_labels;
DROP POLICY IF EXISTS ptl_delete ON project_task_labels;

CREATE POLICY ptl_select ON project_task_labels FOR SELECT
  USING (EXISTS (SELECT 1 FROM project_tasks pt JOIN projects pr ON pr.id = pt.project_id JOIN user_roles ur ON (ur.site_id = pr.site_id OR ur.site_id IS NULL) WHERE pt.id = task_id AND ur.user_id = auth.uid()));
CREATE POLICY ptl_insert ON project_task_labels FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM project_tasks pt JOIN projects pr ON pr.id = pt.project_id JOIN user_roles ur ON (ur.site_id = pr.site_id OR ur.site_id IS NULL) JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id WHERE pt.id = task_id AND ur.user_id = auth.uid() AND p.code = 'projects.edit'));
CREATE POLICY ptl_delete ON project_task_labels FOR DELETE
  USING (EXISTS (SELECT 1 FROM project_tasks pt JOIN projects pr ON pr.id = pt.project_id JOIN user_roles ur ON (ur.site_id = pr.site_id OR ur.site_id IS NULL) JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id WHERE pt.id = project_task_labels.task_id AND ur.user_id = auth.uid() AND p.code = 'projects.edit'));

-- ── project_task_checklist ──────────────────────────────────────────────────
DROP POLICY IF EXISTS ptc_select ON project_task_checklist;
DROP POLICY IF EXISTS ptc_insert ON project_task_checklist;
DROP POLICY IF EXISTS ptc_update ON project_task_checklist;
DROP POLICY IF EXISTS ptc_delete ON project_task_checklist;

CREATE POLICY ptc_select ON project_task_checklist FOR SELECT
  USING (EXISTS (SELECT 1 FROM project_tasks pt JOIN projects pr ON pr.id = pt.project_id JOIN user_roles ur ON (ur.site_id = pr.site_id OR ur.site_id IS NULL) WHERE pt.id = task_id AND ur.user_id = auth.uid()));
CREATE POLICY ptc_insert ON project_task_checklist FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM project_tasks pt JOIN projects pr ON pr.id = pt.project_id JOIN user_roles ur ON (ur.site_id = pr.site_id OR ur.site_id IS NULL) JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id WHERE pt.id = task_id AND ur.user_id = auth.uid() AND p.code = 'projects.edit'));
CREATE POLICY ptc_update ON project_task_checklist FOR UPDATE
  USING (EXISTS (SELECT 1 FROM project_tasks pt JOIN projects pr ON pr.id = pt.project_id JOIN user_roles ur ON (ur.site_id = pr.site_id OR ur.site_id IS NULL) JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id WHERE pt.id = project_task_checklist.task_id AND ur.user_id = auth.uid() AND p.code = 'projects.edit'));
CREATE POLICY ptc_delete ON project_task_checklist FOR DELETE
  USING (EXISTS (SELECT 1 FROM project_tasks pt JOIN projects pr ON pr.id = pt.project_id JOIN user_roles ur ON (ur.site_id = pr.site_id OR ur.site_id IS NULL) JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id WHERE pt.id = project_task_checklist.task_id AND ur.user_id = auth.uid() AND p.code = 'projects.edit'));

INSERT INTO schema_migrations (filename) VALUES ('0087_fix_projects_rls.sql') ON CONFLICT DO NOTHING;
