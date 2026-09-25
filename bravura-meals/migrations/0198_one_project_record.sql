-- 0198 one_project_record — Department projects become ordinary rows in `projects`
-- (tagged with department_id), so costs tagged to a project (fuel, POs, journals,
-- concrete, fleet work orders…) and the department's task board all point at one record.
-- dept_projects was empty; it is frozen. dept_tasks / dept_documents now reference projects.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES departments(id);
CREATE INDEX IF NOT EXISTS projects_department_idx ON projects (department_id) WHERE department_id IS NOT NULL;

-- Project codes are assigned automatically when left blank (KAM-PRJ-2026-0001).
CREATE OR REPLACE FUNCTION trg_project_code() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.project_code IS NULL OR btrim(NEW.project_code) = '' THEN
    NEW.project_code := doc_next_number(NEW.site_id, 'PRJ', COALESCE(NEW.start_date, CURRENT_DATE));
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_project_code ON projects;
CREATE TRIGGER trg_project_code BEFORE INSERT ON projects FOR EACH ROW EXECUTE FUNCTION trg_project_code();

-- Department managers (dept.edit) may create and edit their own department's projects.
DROP POLICY IF EXISTS proj_dept_insert ON projects;
CREATE POLICY proj_dept_insert ON projects FOR INSERT TO authenticated
  WITH CHECK (department_id IS NOT NULL AND _has_permission('dept.edit', site_id));
DROP POLICY IF EXISTS proj_dept_update ON projects;
CREATE POLICY proj_dept_update ON projects FOR UPDATE TO authenticated
  USING (department_id IS NOT NULL AND _has_permission('dept.edit', site_id))
  WITH CHECK (department_id IS NOT NULL AND _has_permission('dept.edit', site_id));

-- Tasks and documents hang off the shared project record.
ALTER TABLE dept_tasks DROP CONSTRAINT IF EXISTS dept_tasks_project_id_fkey;
ALTER TABLE dept_tasks ADD CONSTRAINT dept_tasks_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id);
ALTER TABLE dept_documents DROP CONSTRAINT IF EXISTS dept_documents_project_id_fkey;
ALTER TABLE dept_documents ADD CONSTRAINT dept_documents_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id);

DROP POLICY IF EXISTS dept_tasks_read ON dept_tasks;
CREATE POLICY dept_tasks_read ON dept_tasks FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM projects p WHERE p.id = dept_tasks.project_id AND _has_permission('dept.view', p.site_id)));
DROP POLICY IF EXISTS dept_tasks_write ON dept_tasks;
CREATE POLICY dept_tasks_write ON dept_tasks FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM projects p WHERE p.id = dept_tasks.project_id AND _has_permission('dept.edit', p.site_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM projects p WHERE p.id = dept_tasks.project_id AND _has_permission('dept.edit', p.site_id)));

DROP TRIGGER IF EXISTS trg_frozen ON dept_projects;
CREATE TRIGGER trg_frozen BEFORE INSERT OR UPDATE ON dept_projects
  FOR EACH ROW EXECUTE FUNCTION trg_moved_to_sheq('Department project', 'Projects (one shared project record)');

INSERT INTO schema_migrations (filename) VALUES ('0198_one_project_record.sql') ON CONFLICT DO NOTHING;
