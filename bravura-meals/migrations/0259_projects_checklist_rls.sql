-- 0259 Projects (#76): checklist / dependency / label rows follow the task's access (_pj_task_can),
-- so private to-dos and assignees (not only site role holders) can tick their own checklists.
DROP POLICY IF EXISTS ptc_select ON project_task_checklist;
DROP POLICY IF EXISTS ptc_insert ON project_task_checklist;
DROP POLICY IF EXISTS ptc_update ON project_task_checklist;
DROP POLICY IF EXISTS ptc_delete ON project_task_checklist;
CREATE POLICY ptc_select ON project_task_checklist FOR SELECT USING (_pj_task_can('view', task_id));
CREATE POLICY ptc_insert ON project_task_checklist FOR INSERT WITH CHECK (_pj_task_can('edit', task_id));
CREATE POLICY ptc_update ON project_task_checklist FOR UPDATE USING (_pj_task_can('edit', task_id));
CREATE POLICY ptc_delete ON project_task_checklist FOR DELETE USING (_pj_task_can('edit', task_id));

DROP POLICY IF EXISTS ptd_select ON project_task_dependencies;
DROP POLICY IF EXISTS ptd_insert ON project_task_dependencies;
DROP POLICY IF EXISTS ptd_delete ON project_task_dependencies;
CREATE POLICY ptd_select ON project_task_dependencies FOR SELECT USING (_pj_task_can('view', task_id));
CREATE POLICY ptd_insert ON project_task_dependencies FOR INSERT WITH CHECK (_pj_task_can('edit', task_id));
CREATE POLICY ptd_delete ON project_task_dependencies FOR DELETE USING (_pj_task_can('edit', task_id));

INSERT INTO schema_migrations (filename) VALUES ('0259_projects_checklist_rls.sql') ON CONFLICT DO NOTHING;
