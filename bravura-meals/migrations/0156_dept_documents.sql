-- 0156: Department Workspaces Phase 4 — Documents table

BEGIN;

CREATE TABLE IF NOT EXISTS public.dept_documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  project_id    UUID REFERENCES dept_projects(id) ON DELETE SET NULL,
  name          TEXT NOT NULL,
  storage_path  TEXT NOT NULL,
  uploaded_by   UUID REFERENCES auth.users(id),
  category      TEXT NOT NULL DEFAULT 'General' CHECK (category IN ('SOP','Drawing','Report','Correspondence','General')),
  is_archived   BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dept_documents_dept_idx ON dept_documents(department_id);
CREATE INDEX IF NOT EXISTS dept_documents_project_idx ON dept_documents(project_id);

ALTER TABLE dept_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY dept_documents_read ON dept_documents FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM departments d WHERE d.id = department_id AND _has_permission('dept.view', d.site_id)
  ));

CREATE POLICY dept_documents_write ON dept_documents FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM departments d WHERE d.id = department_id AND _has_permission('dept.edit', d.site_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM departments d WHERE d.id = department_id AND _has_permission('dept.edit', d.site_id)
  ));

INSERT INTO schema_migrations (filename) VALUES ('0156_dept_documents.sql') ON CONFLICT DO NOTHING;

COMMIT;
