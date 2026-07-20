-- Migration: 0087_fix_projects_insert_rls
-- Fix ambiguous site_id reference in projects INSERT policy

DROP POLICY IF EXISTS proj_insert ON projects;

CREATE POLICY proj_insert ON projects FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = auth.uid()
      AND p.code = 'projects.create'
      AND ur.site_id = projects.site_id
  ));

INSERT INTO schema_migrations (filename) VALUES ('0087_fix_projects_insert_rls.sql') ON CONFLICT DO NOTHING;
