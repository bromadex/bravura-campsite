-- 0155: Department Workspaces — Phase 1 foundation tables
-- departments, department_members, dept_projects, dept_tasks

BEGIN;

-- ── departments ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.departments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id    UUID NOT NULL REFERENCES sites(id),
  name       TEXT NOT NULL,
  code       TEXT NOT NULL,
  icon       TEXT DEFAULT 'domain',
  color      TEXT DEFAULT '#1565C0',
  is_archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (site_id, code)
);
CREATE INDEX IF NOT EXISTS departments_site_idx ON departments(site_id);
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
CREATE POLICY departments_read ON departments FOR SELECT TO authenticated
  USING (_has_permission('dept.view', site_id));
CREATE POLICY departments_write ON departments FOR ALL TO authenticated
  USING (_has_permission('dept.edit', site_id))
  WITH CHECK (_has_permission('dept.edit', site_id));

-- ── department_members ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.department_members (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member','lead','manager')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, department_id)
);
CREATE INDEX IF NOT EXISTS dept_members_dept_idx ON department_members(department_id);
CREATE INDEX IF NOT EXISTS dept_members_emp_idx ON department_members(employee_id);
ALTER TABLE department_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY dept_members_read ON department_members FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM departments d WHERE d.id = department_id AND _has_permission('dept.view', d.site_id)
  ));
CREATE POLICY dept_members_write ON department_members FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM departments d WHERE d.id = department_id AND _has_permission('dept.edit', d.site_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM departments d WHERE d.id = department_id AND _has_permission('dept.edit', d.site_id)
  ));

-- ── dept_projects ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dept_projects (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  site_id       UUID NOT NULL REFERENCES sites(id),
  name          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','on_hold','cancelled')),
  priority      TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('urgent','important','medium','low')),
  start_date    DATE,
  due_date      DATE,
  description   TEXT,
  created_by    UUID REFERENCES auth.users(id),
  is_archived   BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dept_projects_dept_idx ON dept_projects(department_id);
CREATE INDEX IF NOT EXISTS dept_projects_site_idx ON dept_projects(site_id);
ALTER TABLE dept_projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY dept_projects_read ON dept_projects FOR SELECT TO authenticated
  USING (_has_permission('dept.view', site_id));
CREATE POLICY dept_projects_write ON dept_projects FOR ALL TO authenticated
  USING (_has_permission('dept.edit', site_id))
  WITH CHECK (_has_permission('dept.edit', site_id));

-- ── dept_tasks ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dept_tasks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID NOT NULL REFERENCES dept_projects(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  bucket       TEXT NOT NULL DEFAULT 'Initiating' CHECK (bucket IN ('Initiating','Planning','Executing','Monitoring & Controlling','Closing')),
  assigned_to  UUID REFERENCES employees(id),
  status       TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started','in_progress','late','completed')),
  priority     TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('urgent','important','medium','low')),
  start_date   DATE,
  due_date     DATE,
  labels       TEXT[] DEFAULT '{}',
  checklist    JSONB DEFAULT '[]',
  notes        TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  is_archived  BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dept_tasks_project_idx ON dept_tasks(project_id);
CREATE INDEX IF NOT EXISTS dept_tasks_assigned_idx ON dept_tasks(assigned_to);
ALTER TABLE dept_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY dept_tasks_read ON dept_tasks FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM dept_projects p WHERE p.id = project_id AND _has_permission('dept.view', p.site_id)
  ));
CREATE POLICY dept_tasks_write ON dept_tasks FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM dept_projects p WHERE p.id = project_id AND _has_permission('dept.edit', p.site_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM dept_projects p WHERE p.id = project_id AND _has_permission('dept.edit', p.site_id)
  ));

-- ── Permissions ──────────────────────────────────────────────────────────────
INSERT INTO permissions (code, module, action, description) VALUES
  ('dept.view',    'dept', 'View',    'View department workspaces'),
  ('dept.create',  'dept', 'Create',  'Create department projects and tasks'),
  ('dept.edit',    'dept', 'Edit',    'Edit department projects and tasks'),
  ('dept.delete',  'dept', 'Delete',  'Archive department projects and tasks'),
  ('dept.approve', 'dept', 'Approve', 'Approve department tasks and sign-offs')
ON CONFLICT (module, action) DO NOTHING;

-- ── Seed: Electrical department for Kamativi ─────────────────────────────────
INSERT INTO departments (site_id, name, code, icon, color) VALUES
  ('fe3f29ed-e1d4-44a2-b409-9a15a98eba97', 'Electrical Department', 'ELEC', 'electrical_services', '#1565C0')
ON CONFLICT (site_id, code) DO NOTHING;

-- ── Self-record ──────────────────────────────────────────────────────────────
INSERT INTO schema_migrations (filename) VALUES ('0155_department_workspaces.sql') ON CONFLICT DO NOTHING;

COMMIT;
