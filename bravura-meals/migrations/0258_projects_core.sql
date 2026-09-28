-- 0258 Projects rewrite (#76) — PJ-A core + PJ-B workspace + PJ-D time → payroll + PJ-F health.
-- Task numbers KEY-12, one status model synced with board columns, private to-dos, watchers, comments,
-- record links ("make a task" from any record), a DocShare folder per project and per task,
-- time entries (timer, crew sheet, approval) feeding payroll overtime, project health + weekly updates,
-- personal notes, and RPCs for workspace / home. RLS via _pj_can (projects.* at the project's site).

-- ── projects ────────────────────────────────────────────────────────────────
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS key text,
  ADD COLUMN IF NOT EXISTS task_seq int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS health text CHECK (health IN ('on_track','at_risk','off_track')),
  ADD COLUMN IF NOT EXISTS health_note text,
  ADD COLUMN IF NOT EXISTS health_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS ds_folder_id uuid REFERENCES ds_folders(id),
  ADD COLUMN IF NOT EXISTS is_template boolean NOT NULL DEFAULT false;

-- ── tasks ───────────────────────────────────────────────────────────────────
ALTER TABLE project_tasks
  ALTER COLUMN project_id DROP NOT NULL,
  ALTER COLUMN column_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS task_no int,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'todo'
    CHECK (status IN ('todo','in_progress','review','blocked','done','cancelled')),
  ADD COLUMN IF NOT EXISTS owner_user uuid,          -- private to-do (no project)
  ADD COLUMN IF NOT EXISTS stage_since timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS ds_folder_id uuid REFERENCES ds_folders(id),
  ADD COLUMN IF NOT EXISTS recurrence text CHECK (recurrence IN ('daily','weekly','monthly')),
  ADD COLUMN IF NOT EXISTS recur_until date,
  ADD COLUMN IF NOT EXISTS blocked_reason text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
DO $$ BEGIN
  ALTER TABLE project_tasks ADD CONSTRAINT project_tasks_owner_chk CHECK (project_id IS NOT NULL OR owner_user IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS project_tasks_assignee_idx ON project_tasks (assigned_to) WHERE NOT is_archived;
CREATE INDEX IF NOT EXISTS project_tasks_owner_idx ON project_tasks (owner_user) WHERE owner_user IS NOT NULL;

CREATE TABLE IF NOT EXISTS project_task_watchers (
  task_id uuid NOT NULL REFERENCES project_tasks(id),
  user_id uuid NOT NULL,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (task_id, user_id)
);
CREATE TABLE IF NOT EXISTS project_task_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES project_tasks(id),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  body text NOT NULL,
  edited_at timestamptz,
  is_archived boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ptc_task_idx ON project_task_comments (task_id, created_at);
-- task ↔ any ERP record (PO, incident, machine, bill, employee …); link = '/module/page:<id>'
CREATE TABLE IF NOT EXISTS project_task_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES project_tasks(id),
  record_table text NOT NULL,
  record_id text NOT NULL,
  label text,
  link text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz DEFAULT now(),
  is_archived boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS ptl_record_idx ON project_task_links (record_table, record_id) WHERE NOT is_archived;

-- ── time ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES sites(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  task_id uuid REFERENCES project_tasks(id),
  employee_id uuid NOT NULL REFERENCES employees(id),
  work_date date NOT NULL,
  hours numeric(6,2) NOT NULL DEFAULT 0 CHECK (hours >= 0 AND hours <= 24),
  overtime_hours numeric(6,2) NOT NULL DEFAULT 0 CHECK (overtime_hours >= 0 AND overtime_hours <= 24),
  activity text NOT NULL DEFAULT 'work',
  note text,
  running_since timestamptz,                         -- live timer
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('running','submitted','approved','rejected')),
  reject_reason text,
  approved_by uuid, approved_at timestamptz,
  cost_rate numeric(12,4),                            -- $/h at approval
  cost numeric(14,2),
  entered_by uuid DEFAULT auth.uid(),
  crew_sheet boolean NOT NULL DEFAULT false,
  is_archived boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pte_emp_idx ON project_time_entries (employee_id, work_date) WHERE NOT is_archived;
CREATE INDEX IF NOT EXISTS pte_proj_idx ON project_time_entries (project_id, work_date) WHERE NOT is_archived;

-- ── health updates + personal notes ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  health text NOT NULL CHECK (health IN ('on_track','at_risk','off_track')),
  progress numeric(5,2),
  note text NOT NULL,
  measured jsonb,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz DEFAULT now(),
  is_archived boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS workspace_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  body text NOT NULL,
  color text,
  pinned boolean NOT NULL DEFAULT false,
  is_archived boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE OR REPLACE FUNCTION _pj_my_employee() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT pr.employee_id FROM profiles pr WHERE pr.id = auth.uid()),
    (SELECT e.id FROM employees e JOIN auth.users u ON u.id = auth.uid()
      WHERE lower(e.email) = lower(u.email) AND NOT COALESCE(e.is_archived, false) LIMIT 1))
$$;

-- ── access helper ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION _pj_can(p_action text, p_project uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM projects p WHERE p.id = p_project AND (
      _has_permission('projects.' || p_action, p.site_id)
      OR (p.department_id IS NOT NULL AND _has_permission('dept.' || p_action, p.site_id))
      OR (p_action IN ('view','edit') AND EXISTS (SELECT 1 FROM project_members m
            WHERE m.project_id = p.id AND m.user_id = auth.uid() AND COALESCE(m.is_active, true)
              AND (p_action = 'view' OR COALESCE(m.can_edit_tasks, true))))))
$$;
CREATE OR REPLACE FUNCTION _pj_task_can(p_action text, p_task uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM project_tasks t WHERE t.id = p_task AND (
    (t.project_id IS NULL AND t.owner_user = auth.uid())
    OR (t.project_id IS NOT NULL AND (_pj_can(p_action, t.project_id)
        OR (p_action IN ('view','edit') AND auth.uid() IN (t.assigned_to, t.reporter, t.created_by))))))
$$;

-- ── RLS (reads for clients; writes go through the RPCs below or the existing screens) ────────
DROP POLICY IF EXISTS pt_select ON project_tasks;
DROP POLICY IF EXISTS pt_insert ON project_tasks;
DROP POLICY IF EXISTS pt_update ON project_tasks;
DROP POLICY IF EXISTS pt_delete ON project_tasks;
CREATE POLICY pt_select ON project_tasks FOR SELECT USING (
  (project_id IS NULL AND owner_user = auth.uid()) OR (project_id IS NOT NULL AND _pj_can('view', project_id))
  OR auth.uid() IN (assigned_to, reporter));
CREATE POLICY pt_insert ON project_tasks FOR INSERT WITH CHECK (
  (project_id IS NULL AND owner_user = auth.uid()) OR (project_id IS NOT NULL AND _pj_can('edit', project_id)));
CREATE POLICY pt_update ON project_tasks FOR UPDATE USING (
  (project_id IS NULL AND owner_user = auth.uid()) OR (project_id IS NOT NULL AND _pj_can('edit', project_id))
  OR auth.uid() = assigned_to);

ALTER TABLE project_task_watchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_task_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_task_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_time_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ptw_sel ON project_task_watchers;
CREATE POLICY ptw_sel ON project_task_watchers FOR SELECT USING (user_id = auth.uid() OR _pj_task_can('view', task_id));
DROP POLICY IF EXISTS ptcm_sel ON project_task_comments;
CREATE POLICY ptcm_sel ON project_task_comments FOR SELECT USING (_pj_task_can('view', task_id));
DROP POLICY IF EXISTS ptlk_sel ON project_task_links;
CREATE POLICY ptlk_sel ON project_task_links FOR SELECT USING (_pj_task_can('view', task_id));
DROP POLICY IF EXISTS pte_sel ON project_time_entries;
CREATE POLICY pte_sel ON project_time_entries FOR SELECT USING (
  entered_by = auth.uid() OR employee_id = _pj_my_employee() OR _pj_can('view', project_id) OR _has_hr_permission('hr.view', site_id));
DROP POLICY IF EXISTS pu_sel ON project_updates;
CREATE POLICY pu_sel ON project_updates FOR SELECT USING (_pj_can('view', project_id));
DROP POLICY IF EXISTS wn_all ON workspace_notes;
CREATE POLICY wn_all ON workspace_notes FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ── keys + numbers backfill ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION _pj_make_key(p_name text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(NULLIF(left(string_agg(left(w, 1), ''), 4), ''), 'PRJ')
  FROM regexp_split_to_table(upper(regexp_replace(COALESCE(p_name,''), '[^A-Za-z0-9 ]', ' ', 'g')), '\s+') w
  WHERE w <> '' AND w NOT IN ('AND','THE','OF','FOR')
$$;
UPDATE projects SET key = _pj_make_key(name) WHERE key IS NULL;

WITH n AS (
  SELECT id, row_number() OVER (PARTITION BY project_id ORDER BY created_at, id) rn
  FROM project_tasks WHERE project_id IS NOT NULL AND task_no IS NULL)
UPDATE project_tasks t SET task_no = n.rn FROM n WHERE n.id = t.id;
UPDATE projects p SET task_seq = GREATEST(p.task_seq, COALESCE((SELECT max(task_no) FROM project_tasks t WHERE t.project_id = p.id), 0));

-- status from the board column
UPDATE project_tasks t SET status = CASE WHEN c.is_done_column THEN 'done' WHEN c.position = 0 THEN 'todo' ELSE 'in_progress' END
FROM project_board_columns c WHERE c.id = t.column_id;

-- ── task triggers: number, status ↔ column, stage clock, activity ───────────
CREATE OR REPLACE FUNCTION trg_pj_task_before() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _col project_board_columns%ROWTYPE;
BEGIN
  IF NEW.project_id IS NOT NULL AND NEW.task_no IS NULL THEN
    UPDATE projects SET task_seq = task_seq + 1 WHERE id = NEW.project_id RETURNING task_seq INTO NEW.task_no;
  END IF;
  IF NEW.project_id IS NOT NULL THEN
    IF TG_OP = 'INSERT' OR NEW.column_id IS DISTINCT FROM OLD.column_id THEN
      -- column moved (board drag) → status follows
      IF NEW.column_id IS NOT NULL THEN
        SELECT * INTO _col FROM project_board_columns WHERE id = NEW.column_id;
        IF _col.is_done_column THEN NEW.status := 'done';
        ELSIF TG_OP = 'UPDATE' AND NEW.status = 'done' THEN NEW.status := CASE WHEN _col.position = 0 THEN 'todo' ELSE 'in_progress' END;
        ELSIF _col.position = 0 AND NEW.status NOT IN ('blocked','cancelled') THEN NEW.status := 'todo';
        ELSIF _col.position > 0 AND NEW.status = 'todo' THEN NEW.status := 'in_progress';
        END IF;
      END IF;
    END IF;
    IF (TG_OP = 'INSERT' AND NEW.column_id IS NULL) OR (TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status AND NEW.column_id IS NOT DISTINCT FROM OLD.column_id) THEN
      -- status changed (list / workspace) → move to a matching column
      SELECT id INTO NEW.column_id FROM project_board_columns WHERE project_id = NEW.project_id
       ORDER BY CASE
         WHEN NEW.status = 'done' AND is_done_column THEN 0
         WHEN NEW.status = 'todo' AND NOT is_done_column THEN position
         WHEN NEW.status NOT IN ('done','todo') AND NOT is_done_column AND position > 0 THEN position
         WHEN NOT is_done_column THEN 100 + position ELSE 1000 END
       LIMIT 1;
    END IF;
  END IF;
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.stage_since := now();
    IF NEW.status = 'done' THEN NEW.completed_date := COALESCE(NEW.completed_date, now()); NEW.percent_complete := 100;
    ELSIF TG_OP = 'UPDATE' AND OLD.status = 'done' THEN NEW.completed_date := NULL; END IF;
    IF NEW.status = 'in_progress' AND NEW.actual_start IS NULL THEN NEW.actual_start := current_date; END IF;
    IF NEW.status = 'done' AND NEW.actual_end IS NULL THEN NEW.actual_end := current_date; END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_pj_task_before ON project_tasks;
CREATE TRIGGER trg_pj_task_before BEFORE INSERT OR UPDATE ON project_tasks FOR EACH ROW EXECUTE FUNCTION trg_pj_task_before();

-- notify assignee + watchers; record in project_activity
CREATE OR REPLACE FUNCTION trg_pj_task_after() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _p projects%ROWTYPE; _ref text; _link text; _u uuid; _msg text;
BEGIN
  IF NEW.project_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO _p FROM projects WHERE id = NEW.project_id;
  _ref := COALESCE(_p.key, 'PRJ') || '-' || NEW.task_no;
  _link := '/projects/pj_detail_' || NEW.project_id || ':board:' || NEW.id;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO project_activity (project_id, actor_id, action_type, entity_type, entity_id, new_values, message)
    VALUES (NEW.project_id, auth.uid(), 'created', 'task', NEW.id, jsonb_build_object('title', NEW.title), 'Created ' || _ref || ' ' || NEW.title);
  ELSE
    IF NEW.status IS DISTINCT FROM OLD.status OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to OR NEW.due_date IS DISTINCT FROM OLD.due_date THEN
      INSERT INTO project_activity (project_id, actor_id, action_type, entity_type, entity_id, old_values, new_values, message)
      VALUES (NEW.project_id, auth.uid(), 'updated', 'task', NEW.id,
        jsonb_build_object('status', OLD.status, 'assigned_to', OLD.assigned_to, 'due_date', OLD.due_date),
        jsonb_build_object('status', NEW.status, 'assigned_to', NEW.assigned_to, 'due_date', NEW.due_date),
        _ref || ': ' || concat_ws(', ',
          CASE WHEN NEW.status IS DISTINCT FROM OLD.status THEN OLD.status || ' → ' || NEW.status END,
          CASE WHEN NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN 'reassigned' END,
          CASE WHEN NEW.due_date IS DISTINCT FROM OLD.due_date THEN 'due ' || COALESCE(NEW.due_date::text, 'cleared') END));
    END IF;
  END IF;
  -- assignee told when given the task
  IF NEW.assigned_to IS NOT NULL AND NEW.assigned_to IS DISTINCT FROM auth.uid()
     AND (TG_OP = 'INSERT' OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to) THEN
    INSERT INTO notifications (site_id, user_id, type, title, message, link, category)
    VALUES (_p.site_id, NEW.assigned_to, 'task_assigned', 'Task for you: ' || _ref, NEW.title, _link, 'general');
    INSERT INTO project_task_watchers (task_id, user_id) VALUES (NEW.id, NEW.assigned_to) ON CONFLICT DO NOTHING;
  END IF;
  -- watchers told when status changes
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    _msg := NEW.title || ' is now ' || replace(NEW.status, '_', ' ');
    FOR _u IN SELECT user_id FROM project_task_watchers WHERE task_id = NEW.id AND user_id IS DISTINCT FROM auth.uid() LOOP
      INSERT INTO notifications (site_id, user_id, type, title, message, link, category)
      VALUES (_p.site_id, _u, 'task_status', _ref || ' ' || replace(NEW.status, '_', ' '), _msg, _link, 'general');
    END LOOP;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.created_by IS NOT NULL THEN
    INSERT INTO project_task_watchers (task_id, user_id) VALUES (NEW.id, NEW.created_by) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_pj_task_after ON project_tasks;
CREATE TRIGGER trg_pj_task_after AFTER INSERT OR UPDATE ON project_tasks FOR EACH ROW EXECUTE FUNCTION trg_pj_task_after();

-- ── DocShare: a folder per project, a sub-folder per task ───────────────────
CREATE OR REPLACE FUNCTION _pj_project_folder(p_project uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _p projects%ROWTYPE; _root uuid; _f uuid;
BEGIN
  SELECT * INTO _p FROM projects WHERE id = p_project;
  IF _p.ds_folder_id IS NOT NULL THEN RETURN _p.ds_folder_id; END IF;
  SELECT id INTO _root FROM ds_folders WHERE site_id = _p.site_id AND parent_id IS NULL AND name = 'Projects' AND NOT COALESCE(is_archived, false) LIMIT 1;
  IF _root IS NULL THEN
    INSERT INTO ds_folders (site_id, name, created_by) VALUES (_p.site_id, 'Projects', auth.uid()) RETURNING id INTO _root;
  END IF;
  INSERT INTO ds_folders (site_id, name, parent_id, project_id, created_by)
  VALUES (_p.site_id, COALESCE(_p.key || ' · ', '') || _p.name, _root, _p.id, auth.uid()) RETURNING id INTO _f;
  UPDATE projects SET ds_folder_id = _f WHERE id = _p.id;
  RETURN _f;
END $$;

CREATE OR REPLACE FUNCTION _pj_task_folder(p_task uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _t project_tasks%ROWTYPE; _p projects%ROWTYPE; _parent uuid; _f uuid;
BEGIN
  SELECT * INTO _t FROM project_tasks WHERE id = p_task;
  IF _t.ds_folder_id IS NOT NULL OR _t.project_id IS NULL THEN RETURN _t.ds_folder_id; END IF;
  SELECT * INTO _p FROM projects WHERE id = _t.project_id;
  _parent := _pj_project_folder(_p.id);
  INSERT INTO ds_folders (site_id, name, parent_id, project_id, created_by)
  VALUES (_p.site_id, COALESCE(_p.key, 'PRJ') || '-' || _t.task_no || ' ' || left(_t.title, 80), _parent, _p.id, auth.uid())
  RETURNING id INTO _f;
  UPDATE project_tasks SET ds_folder_id = _f WHERE id = _t.id;
  RETURN _f;
END $$;

CREATE OR REPLACE FUNCTION trg_pj_folders() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_TABLE_NAME = 'projects' THEN
    IF NEW.ds_folder_id IS NULL AND NOT NEW.is_template THEN PERFORM _pj_project_folder(NEW.id); END IF;
  ELSIF NEW.project_id IS NOT NULL AND NEW.ds_folder_id IS NULL THEN
    PERFORM _pj_task_folder(NEW.id);
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_pj_project_folder ON projects;
CREATE TRIGGER trg_pj_project_folder AFTER INSERT ON projects FOR EACH ROW EXECUTE FUNCTION trg_pj_folders();
DROP TRIGGER IF EXISTS trg_pj_task_folder ON project_tasks;
CREATE TRIGGER trg_pj_task_folder AFTER INSERT ON project_tasks FOR EACH ROW EXECUTE FUNCTION trg_pj_folders();

-- files attached to a task (LinkedDocuments → ds_attach_file) land in the task's folder
CREATE OR REPLACE FUNCTION trg_pj_doc_to_folder() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _t project_tasks%ROWTYPE; _f uuid;
BEGIN
  IF NEW.linked_table = 'project_tasks' THEN
    SELECT * INTO _t FROM project_tasks WHERE id = NEW.linked_id::uuid;
    IF _t.project_id IS NOT NULL THEN
      _f := _pj_task_folder(_t.id);
      UPDATE ds_documents SET folder_id = _f, project_id = _t.project_id WHERE id = NEW.document_id AND folder_id IS NULL;
    END IF;
  ELSIF NEW.linked_table = 'projects' THEN
    _f := _pj_project_folder(NEW.linked_id::uuid);
    UPDATE ds_documents SET folder_id = _f, project_id = NEW.linked_id::uuid WHERE id = NEW.document_id AND folder_id IS NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_pj_doc_to_folder ON ds_document_links;
CREATE TRIGGER trg_pj_doc_to_folder AFTER INSERT ON ds_document_links FOR EACH ROW EXECUTE FUNCTION trg_pj_doc_to_folder();

-- backfill folders for existing projects / tasks
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT id FROM projects WHERE ds_folder_id IS NULL AND NOT COALESCE(is_archived, false) LOOP PERFORM _pj_project_folder(r.id); END LOOP;
  FOR r IN SELECT id FROM project_tasks WHERE ds_folder_id IS NULL AND project_id IS NOT NULL AND NOT COALESCE(is_archived, false) LOOP PERFORM _pj_task_folder(r.id); END LOOP;
END $$;

-- ── task RPCs ───────────────────────────────────────────────────────────────
-- p: id?, project_id?, title, description, status, priority, assigned_to, start_date, due_date,
--    estimated_hours, phase_id, parent_task_id, is_milestone, recurrence, recur_until, blocked_reason,
--    link {record_table, record_id, label, link}
CREATE OR REPLACE FUNCTION pj_task_save(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid := NULLIF(p->>'id','')::uuid; _proj uuid := NULLIF(p->>'project_id','')::uuid; _t project_tasks%ROWTYPE;
BEGIN
  IF _id IS NULL THEN
    IF COALESCE(trim(p->>'title'), '') = '' THEN RAISE EXCEPTION 'Give the task a title'; END IF;
    IF _proj IS NOT NULL AND NOT _pj_can('edit', _proj) THEN RAISE EXCEPTION 'No access to add tasks on this project'; END IF;
    INSERT INTO project_tasks (project_id, owner_user, title, description, status, priority, assigned_to, reporter,
      start_date, due_date, estimated_hours, phase_id, parent_task_id, is_milestone, recurrence, recur_until, blocked_reason,
      created_by, position)
    VALUES (_proj, CASE WHEN _proj IS NULL THEN auth.uid() END, trim(p->>'title'), p->>'description',
      COALESCE(NULLIF(p->>'status',''), 'todo'), COALESCE(NULLIF(p->>'priority',''), 'medium'),
      COALESCE(NULLIF(p->>'assigned_to','')::uuid, CASE WHEN _proj IS NULL THEN auth.uid() END), auth.uid(),
      NULLIF(p->>'start_date','')::date, NULLIF(p->>'due_date','')::date, NULLIF(p->>'estimated_hours','')::numeric,
      NULLIF(p->>'phase_id','')::uuid, NULLIF(p->>'parent_task_id','')::uuid, COALESCE((p->>'is_milestone')::boolean, false),
      NULLIF(p->>'recurrence',''), NULLIF(p->>'recur_until','')::date, p->>'blocked_reason', auth.uid(),
      COALESCE((SELECT max(position) + 1 FROM project_tasks WHERE project_id = _proj), 0))
    RETURNING * INTO _t;
  ELSE
    IF NOT _pj_task_can('edit', _id) THEN RAISE EXCEPTION 'No access to change this task'; END IF;
    UPDATE project_tasks SET
      title = COALESCE(NULLIF(trim(p->>'title'),''), title),
      description = CASE WHEN p ? 'description' THEN p->>'description' ELSE description END,
      status = COALESCE(NULLIF(p->>'status',''), status),
      priority = COALESCE(NULLIF(p->>'priority',''), priority),
      assigned_to = CASE WHEN p ? 'assigned_to' THEN NULLIF(p->>'assigned_to','')::uuid ELSE assigned_to END,
      start_date = CASE WHEN p ? 'start_date' THEN NULLIF(p->>'start_date','')::date ELSE start_date END,
      due_date = CASE WHEN p ? 'due_date' THEN NULLIF(p->>'due_date','')::date ELSE due_date END,
      estimated_hours = CASE WHEN p ? 'estimated_hours' THEN NULLIF(p->>'estimated_hours','')::numeric ELSE estimated_hours END,
      phase_id = CASE WHEN p ? 'phase_id' THEN NULLIF(p->>'phase_id','')::uuid ELSE phase_id END,
      is_milestone = COALESCE((p->>'is_milestone')::boolean, is_milestone),
      recurrence = CASE WHEN p ? 'recurrence' THEN NULLIF(p->>'recurrence','') ELSE recurrence END,
      recur_until = CASE WHEN p ? 'recur_until' THEN NULLIF(p->>'recur_until','')::date ELSE recur_until END,
      blocked_reason = CASE WHEN p ? 'blocked_reason' THEN p->>'blocked_reason' ELSE blocked_reason END,
      percent_complete = COALESCE(NULLIF(p->>'percent_complete','')::numeric, percent_complete)
    WHERE id = _id RETURNING * INTO _t;
    IF _t.status = 'blocked' AND COALESCE(trim(_t.blocked_reason), '') = '' THEN RAISE EXCEPTION 'Say what is blocking it'; END IF;
  END IF;
  IF p ? 'link' AND COALESCE(p->'link'->>'record_id', '') <> '' THEN
    INSERT INTO project_task_links (task_id, record_table, record_id, label, link)
    VALUES (_t.id, p->'link'->>'record_table', p->'link'->>'record_id', p->'link'->>'label', p->'link'->>'link');
  END IF;
  RETURN jsonb_build_object('id', _t.id, 'task_no', _t.task_no, 'status', _t.status,
    'ref', (SELECT key FROM projects WHERE id = _t.project_id) || '-' || _t.task_no);
END $$;

-- recurring: when a recurring task is done, the next one is created
CREATE OR REPLACE FUNCTION trg_pj_recur() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _step interval; _next date;
BEGIN
  IF NEW.recurrence IS NULL OR NEW.status <> 'done' OR OLD.status = 'done' THEN RETURN NEW; END IF;
  _step := CASE NEW.recurrence WHEN 'daily' THEN interval '1 day' WHEN 'weekly' THEN interval '7 days' ELSE interval '1 month' END;
  _next := (COALESCE(NEW.due_date, current_date) + _step)::date;
  IF NEW.recur_until IS NOT NULL AND _next > NEW.recur_until THEN RETURN NEW; END IF;
  INSERT INTO project_tasks (project_id, owner_user, title, description, priority, assigned_to, reporter, start_date, due_date,
    estimated_hours, phase_id, recurrence, recur_until, created_by, position, status)
  VALUES (NEW.project_id, NEW.owner_user, NEW.title, NEW.description, NEW.priority, NEW.assigned_to, NEW.reporter,
    CASE WHEN NEW.start_date IS NOT NULL THEN (NEW.start_date + _step)::date END, _next,
    NEW.estimated_hours, NEW.phase_id, NEW.recurrence, NEW.recur_until, NEW.created_by, NEW.position, 'todo');
  UPDATE project_tasks SET recurrence = NULL WHERE id = NEW.id;   -- only the newest copy repeats
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_pj_recur ON project_tasks;
CREATE TRIGGER trg_pj_recur AFTER UPDATE OF status ON project_tasks FOR EACH ROW EXECUTE FUNCTION trg_pj_recur();

CREATE OR REPLACE FUNCTION pj_task_comment(p_task uuid, p_body text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid; _t project_tasks%ROWTYPE; _p projects%ROWTYPE; _u uuid; _m text;
BEGIN
  IF NOT _pj_task_can('view', p_task) THEN RAISE EXCEPTION 'No access to this task'; END IF;
  IF COALESCE(trim(p_body), '') = '' THEN RAISE EXCEPTION 'Write something'; END IF;
  INSERT INTO project_task_comments (task_id, body) VALUES (p_task, trim(p_body)) RETURNING id INTO _id;
  INSERT INTO project_task_watchers (task_id, user_id) VALUES (p_task, auth.uid()) ON CONFLICT DO NOTHING;
  SELECT * INTO _t FROM project_tasks WHERE id = p_task;
  IF _t.project_id IS NOT NULL THEN
    SELECT * INTO _p FROM projects WHERE id = _t.project_id;
    SELECT COALESCE(full_name, username) INTO _m FROM profiles WHERE id = auth.uid();
    FOR _u IN SELECT user_id FROM project_task_watchers WHERE task_id = p_task AND user_id <> auth.uid() LOOP
      INSERT INTO notifications (site_id, user_id, type, title, message, link, category)
      VALUES (_p.site_id, _u, 'task_comment', COALESCE(_m, 'Someone') || ' on ' || _p.key || '-' || _t.task_no,
        left(p_body, 200), '/projects/pj_detail_' || _p.id || ':board:' || _t.id, 'general');
    END LOOP;
  END IF;
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION pj_watch(p_task uuid, p_on boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT _pj_task_can('view', p_task) THEN RAISE EXCEPTION 'No access to this task'; END IF;
  IF p_on THEN INSERT INTO project_task_watchers (task_id, user_id) VALUES (p_task, auth.uid()) ON CONFLICT DO NOTHING;
  ELSE DELETE FROM project_task_watchers WHERE task_id = p_task AND user_id = auth.uid(); END IF;
  RETURN p_on;
END $$;

-- tasks linked to a record (shown on that record's page)
CREATE OR REPLACE FUNCTION pj_tasks_for_record(p_table text, p_id text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', t.id, 'ref', COALESCE(p.key, 'TODO') || COALESCE('-' || t.task_no, ''),
    'title', t.title, 'status', t.status, 'due_date', t.due_date, 'project_id', t.project_id,
    'assignee', (SELECT COALESCE(full_name, username) FROM profiles WHERE id = t.assigned_to)) ORDER BY t.created_at DESC), '[]')
  FROM project_task_links l JOIN project_tasks t ON t.id = l.task_id LEFT JOIN projects p ON p.id = t.project_id
  WHERE l.record_table = p_table AND l.record_id = p_id AND NOT l.is_archived AND NOT COALESCE(t.is_archived, false)
    AND _pj_task_can('view', t.id)
$$;

-- ── time: rate, timer, entries, crew sheet, approval ────────────────────────
CREATE OR REPLACE FUNCTION _pj_hour_rate(p_emp uuid, p_date date) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ROUND(COALESCE((SELECT es.basic_salary FROM employee_salary es WHERE es.employee_id = p_emp AND es.effective_date <= p_date
    ORDER BY es.effective_date DESC LIMIT 1), 0)
    / NULLIF(22 * COALESCE((SELECT s.ot_hours_per_day FROM hr_statutory_settings s JOIN employees e ON e.site_id = s.site_id WHERE e.id = p_emp), 8), 0), 4)
$$;


-- p: [{id?, project_id, task_id?, employee_id?, work_date, hours, overtime_hours, activity, note}], crew = supervisor sheet
CREATE OR REPLACE FUNCTION pj_time_save(p_rows jsonb, p_crew boolean DEFAULT false) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb; _proj projects%ROWTYPE; _emp uuid; _me uuid := _pj_my_employee(); _n int := 0; _id uuid;
BEGIN
  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    SELECT * INTO _proj FROM projects WHERE id = NULLIF(r->>'project_id','')::uuid;
    IF _proj.id IS NULL THEN RAISE EXCEPTION 'Pick a project'; END IF;
    _emp := COALESCE(NULLIF(r->>'employee_id','')::uuid, _me);
    IF _emp IS NULL THEN RAISE EXCEPTION 'Your login is not linked to an employee record — ask HR to link it'; END IF;
    IF _emp IS DISTINCT FROM _me AND NOT _pj_can('edit', _proj.id) THEN RAISE EXCEPTION 'Only project editors can log time for other people'; END IF;
    IF NOT _pj_can('view', _proj.id) THEN RAISE EXCEPTION 'No access to %', _proj.name; END IF;
    IF COALESCE((r->>'hours')::numeric, 0) + COALESCE((r->>'overtime_hours')::numeric, 0) <= 0 THEN CONTINUE; END IF;
    _id := NULLIF(r->>'id','')::uuid;
    IF _id IS NOT NULL THEN
      UPDATE project_time_entries SET task_id = NULLIF(r->>'task_id','')::uuid, work_date = (r->>'work_date')::date,
        hours = COALESCE((r->>'hours')::numeric, 0), overtime_hours = COALESCE((r->>'overtime_hours')::numeric, 0),
        activity = COALESCE(NULLIF(r->>'activity',''), activity), note = r->>'note', status = 'submitted', reject_reason = NULL
      WHERE id = _id AND status IN ('submitted','rejected') AND (entered_by = auth.uid() OR _pj_can('edit', project_id));
      IF NOT FOUND THEN RAISE EXCEPTION 'That entry is approved already or not yours'; END IF;
    ELSE
      INSERT INTO project_time_entries (site_id, project_id, task_id, employee_id, work_date, hours, overtime_hours, activity, note, crew_sheet)
      VALUES (_proj.site_id, _proj.id, NULLIF(r->>'task_id','')::uuid, _emp, COALESCE(NULLIF(r->>'work_date','')::date, current_date),
        COALESCE((r->>'hours')::numeric, 0), COALESCE((r->>'overtime_hours')::numeric, 0), COALESCE(NULLIF(r->>'activity',''), 'work'),
        r->>'note', p_crew);
    END IF;
    _n := _n + 1;
  END LOOP;
  IF _n > 0 THEN
    PERFORM _notify_permission(_proj.site_id, 'projects.approve', 'time_submitted', 'Time to approve',
      _n || ' time entr' || CASE WHEN _n = 1 THEN 'y' ELSE 'ies' END || ' on ' || _proj.name, '/projects/pj_time:approve', 'approval');
  END IF;
  RETURN _n;
END $$;

CREATE OR REPLACE FUNCTION pj_timer(p_task uuid, p_start boolean, p_note text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _me uuid := _pj_my_employee(); _t project_tasks%ROWTYPE; _r project_time_entries%ROWTYPE; _h numeric;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Your login is not linked to an employee record — ask HR to link it'; END IF;
  -- stop whatever is running first
  FOR _r IN SELECT * FROM project_time_entries WHERE employee_id = _me AND status = 'running' LOOP
    _h := ROUND(EXTRACT(EPOCH FROM now() - _r.running_since) / 3600.0, 2);
    UPDATE project_time_entries SET hours = LEAST(24, GREATEST(0.01, _h)), running_since = NULL, status = 'submitted',
      note = COALESCE(p_note, note) WHERE id = _r.id;
  END LOOP;
  IF NOT p_start THEN RETURN jsonb_build_object('running', false, 'hours', _h); END IF;
  SELECT * INTO _t FROM project_tasks WHERE id = p_task;
  IF _t.project_id IS NULL THEN RAISE EXCEPTION 'Timers are for project tasks'; END IF;
  IF NOT _pj_task_can('view', p_task) THEN RAISE EXCEPTION 'No access to this task'; END IF;
  INSERT INTO project_time_entries (site_id, project_id, task_id, employee_id, work_date, hours, running_since, status)
  SELECT p.site_id, p.id, _t.id, _me, current_date, 0, now(), 'running' FROM projects p WHERE p.id = _t.project_id
  RETURNING * INTO _r;
  IF _t.status = 'todo' THEN UPDATE project_tasks SET status = 'in_progress' WHERE id = _t.id; END IF;
  RETURN jsonb_build_object('running', true, 'id', _r.id, 'since', _r.running_since);
END $$;

CREATE OR REPLACE FUNCTION pj_time_decide(p_ids uuid[], p_approve boolean, p_reason text DEFAULT NULL) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r project_time_entries%ROWTYPE; _n int := 0; _rate numeric;
BEGIN
  IF NOT p_approve AND COALESCE(trim(p_reason), '') = '' THEN RAISE EXCEPTION 'Give a reason for sending it back'; END IF;
  FOR _r IN SELECT * FROM project_time_entries WHERE id = ANY(p_ids) AND status = 'submitted' AND NOT is_archived LOOP
    IF NOT _pj_can('approve', _r.project_id) THEN RAISE EXCEPTION 'You cannot approve time on this project'; END IF;
    IF _r.employee_id = _pj_my_employee() THEN RAISE EXCEPTION 'Someone else must approve your own time'; END IF;
    IF p_approve THEN
      _rate := _pj_hour_rate(_r.employee_id, _r.work_date);
      UPDATE project_time_entries SET status = 'approved', approved_by = auth.uid(), approved_at = now(), cost_rate = _rate,
        cost = ROUND(_rate * (_r.hours + _r.overtime_hours * COALESCE((SELECT ot_rate_normal FROM hr_statutory_settings WHERE site_id = _r.site_id), 1.5)), 2)
      WHERE id = _r.id;
    ELSE
      UPDATE project_time_entries SET status = 'rejected', reject_reason = p_reason, approved_by = auth.uid(), approved_at = now() WHERE id = _r.id;
      INSERT INTO notifications (site_id, user_id, type, title, message, link, category)
      VALUES (_r.site_id, _r.entered_by, 'time_rejected', 'Time sent back', p_reason, '/projects/pj_time', 'general');
    END IF;
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END $$;

-- list for the time screen: mine / to approve / crew (by date range)
CREATE OR REPLACE FUNCTION pj_time_list(p_site uuid, p_scope text, p_from date, p_to date) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', e.id, 'project_id', e.project_id, 'project', p.name, 'key', p.key,
    'task_id', e.task_id, 'task', CASE WHEN t.id IS NOT NULL THEN p.key || '-' || t.task_no || ' ' || t.title END,
    'employee_id', e.employee_id, 'employee', em.name, 'work_date', e.work_date, 'hours', e.hours, 'overtime_hours', e.overtime_hours,
    'activity', e.activity, 'note', e.note, 'status', e.status, 'reject_reason', e.reject_reason, 'cost', e.cost,
    'running_since', e.running_since, 'crew_sheet', e.crew_sheet) ORDER BY e.work_date DESC, em.name), '[]')
  FROM project_time_entries e JOIN projects p ON p.id = e.project_id JOIN employees em ON em.id = e.employee_id
  LEFT JOIN project_tasks t ON t.id = e.task_id
  WHERE NOT e.is_archived AND e.site_id = p_site AND e.work_date BETWEEN p_from AND p_to
    AND CASE p_scope
      WHEN 'mine' THEN e.employee_id = _pj_my_employee() OR e.entered_by = auth.uid()
      WHEN 'approve' THEN e.status = 'submitted' AND _pj_can('approve', e.project_id)
      ELSE _pj_can('view', e.project_id) END
$$;

-- ── payroll: approved project overtime is paid ──────────────────────────────
DO $$ DECLARE _def text; _new text; _pt text; BEGIN
  _def := pg_get_functiondef('hr_run_payroll(uuid,integer,integer,integer)'::regprocedure);
  _pt := ' FROM project_time_entries pt WHERE pt.employee_id = e.id AND pt.status = ''approved'' AND NOT pt.is_archived AND pt.work_date BETWEEN _start AND _end AND NOT EXISTS (SELECT 1 FROM attendance_logs a2 WHERE a2.employee_id = e.id AND a2.date = pt.work_date AND a2.approval_status = ''approved'' AND COALESCE(a2.overtime_hours, 0) > 0))';
  _new := replace(_def, 'AND a.date BETWEEN _start AND _end) AS ot_normal,',
    'AND a.date BETWEEN _start AND _end) + (SELECT COALESCE(SUM(pt.overtime_hours) FILTER (WHERE EXTRACT(DOW FROM pt.work_date) <> 0 AND NOT _is_public_holiday(p_site_id, pt.work_date)), 0)' || _pt || ' AS ot_normal,');
  _new := replace(_new, 'AND a.date BETWEEN _start AND _end) AS ot_sunday,',
    'AND a.date BETWEEN _start AND _end) + (SELECT COALESCE(SUM(pt.overtime_hours) FILTER (WHERE EXTRACT(DOW FROM pt.work_date) = 0 AND NOT _is_public_holiday(p_site_id, pt.work_date)), 0)' || _pt || ' AS ot_sunday,');
  _new := replace(_new, 'AND a.date BETWEEN _start AND _end) AS ot_holiday',
    'AND a.date BETWEEN _start AND _end) + (SELECT COALESCE(SUM(pt.overtime_hours) FILTER (WHERE _is_public_holiday(p_site_id, pt.work_date)), 0)' || _pt || ' AS ot_holiday');
  IF position('project_time_entries' in _def) > 0 THEN RETURN; END IF;  -- already patched
  IF (length(_new) - length(_def)) < 1200 THEN RAISE EXCEPTION 'hr_run_payroll patch did not apply'; END IF;
  EXECUTE _new;
END $$;

-- ── money + health ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION pj_money(p_project uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH gl AS (
    SELECT COALESCE(SUM(l.debit - l.credit), 0) amt
    FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
    WHERE l.project_id = p_project AND j.status = 'posted' AND NOT COALESCE(j.is_archived, false)
      AND lower(a.account_type) = 'expense'),
  lab AS (SELECT COALESCE(SUM(cost), 0) amt, COALESCE(SUM(hours + overtime_hours), 0) hrs FROM project_time_entries
          WHERE project_id = p_project AND status = 'approved' AND NOT is_archived),
  com AS (SELECT COALESCE(SUM(GREATEST(0, pl.quantity - COALESCE(pl.received_qty, 0)) * pl.unit_cost), 0) amt
          FROM purchase_orders po JOIN po_lines pl ON pl.po_id = po.id
          WHERE po.project_id = p_project AND po.status IN ('sent','partially_received','pending_approval') AND NOT COALESCE(pl.is_archived, false))
  SELECT jsonb_build_object('budget', COALESCE(p.budget, 0), 'spent_gl', gl.amt, 'labour', lab.amt, 'hours', lab.hrs,
    'committed', com.amt, 'actual', gl.amt + lab.amt,
    'used_pct', CASE WHEN COALESCE(p.budget, 0) > 0 THEN ROUND(100 * (gl.amt + lab.amt + com.amt) / p.budget, 1) END)
  FROM projects p, gl, lab, com WHERE p.id = p_project
$$;

CREATE OR REPLACE FUNCTION pj_health(p_project uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _p projects%ROWTYPE; _open int; _over int; _stuck int; _late_ms int; _done int; _all int; _m jsonb; _h text := 'on_track';
        _why text[] := '{}'; _prog numeric;
BEGIN
  SELECT * INTO _p FROM projects WHERE id = p_project;
  SELECT count(*) FILTER (WHERE status NOT IN ('done','cancelled')),
         count(*) FILTER (WHERE status NOT IN ('done','cancelled') AND due_date < current_date),
         count(*) FILTER (WHERE status IN ('in_progress','review','blocked') AND stage_since < now() - interval '14 days'),
         count(*) FILTER (WHERE is_milestone AND status NOT IN ('done','cancelled') AND due_date < current_date),
         count(*) FILTER (WHERE status = 'done'), count(*) FILTER (WHERE status <> 'cancelled')
    INTO _open, _over, _stuck, _late_ms, _done, _all
  FROM project_tasks WHERE project_id = p_project AND NOT COALESCE(is_archived, false) AND parent_task_id IS NULL;
  _prog := CASE WHEN _all > 0 THEN ROUND(100.0 * _done / _all, 1) ELSE 0 END;
  _m := pj_money(p_project);
  IF _p.target_end_date < current_date AND _open > 0 THEN _h := 'off_track'; _why := _why || 'past the target end date'; END IF;
  IF _open > 0 AND _over::numeric / _open > 0.25 THEN _h := 'off_track'; _why := _why || (_over || ' of ' || _open || ' open tasks overdue');
  ELSIF _over > 0 THEN IF _h = 'on_track' THEN _h := 'at_risk'; END IF; _why := _why || (_over || ' overdue'); END IF;
  IF _late_ms > 0 THEN IF _h = 'on_track' THEN _h := 'at_risk'; END IF; _why := _why || (_late_ms || ' milestone(s) late'); END IF;
  IF (_m->>'used_pct')::numeric > 100 THEN _h := 'off_track'; _why := _why || ('over budget (' || (_m->>'used_pct') || '%)');
  ELSIF (_m->>'used_pct')::numeric >= 90 THEN IF _h = 'on_track' THEN _h := 'at_risk'; END IF; _why := _why || ((_m->>'used_pct') || '% of budget used'); END IF;
  IF _stuck > 0 THEN IF _h = 'on_track' THEN _h := 'at_risk'; END IF; _why := _why || (_stuck || ' stuck 14+ days'); END IF;
  RETURN jsonb_build_object('measured', _h, 'reasons', to_jsonb(_why), 'set', _p.health, 'set_note', _p.health_note,
    'health', COALESCE(_p.health, _h), 'progress', _prog, 'open', _open, 'overdue', _over, 'stuck', _stuck,
    'late_milestones', _late_ms, 'done', _done, 'total', _all, 'money', _m);
END $$;

-- weekly update (Odoo-style) — also sets / clears the manual health
CREATE OR REPLACE FUNCTION pj_update_post(p_project uuid, p_health text, p_note text, p_override boolean DEFAULT false) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid; _m jsonb;
BEGIN
  IF NOT _pj_can('edit', p_project) THEN RAISE EXCEPTION 'No access to post updates on this project'; END IF;
  IF COALESCE(trim(p_note), '') = '' THEN RAISE EXCEPTION 'Write a short note — what happened, what is next'; END IF;
  _m := pj_health(p_project);
  INSERT INTO project_updates (project_id, health, progress, note, measured)
  VALUES (p_project, COALESCE(p_health, _m->>'measured'), (_m->>'progress')::numeric, trim(p_note), _m) RETURNING id INTO _id;
  UPDATE projects SET health = CASE WHEN p_override THEN p_health ELSE NULL END,
    health_note = CASE WHEN p_override THEN trim(p_note) ELSE NULL END, health_set_at = now() WHERE id = p_project;
  RETURN _id;
END $$;

-- ── portfolio (PJ01) ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION pj_home(p_site uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _rows jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'rank')::int, x->>'name'), '[]') INTO _rows FROM (
    SELECT jsonb_build_object('id', p.id, 'key', p.key, 'code', p.project_code, 'name', p.name, 'status', p.status,
      'color', p.cover_color, 'start_date', p.start_date, 'target_end_date', p.target_end_date,
      'manager', (SELECT COALESCE(full_name, username) FROM profiles WHERE id = p.project_manager),
      'department_id', p.department_id, 'h', h,
      'last_update', (SELECT jsonb_build_object('note', u.note, 'health', u.health, 'at', u.created_at)
                      FROM project_updates u WHERE u.project_id = p.id AND NOT u.is_archived ORDER BY u.created_at DESC LIMIT 1),
      'rank', CASE h->>'health' WHEN 'off_track' THEN 0 WHEN 'at_risk' THEN 1 ELSE 2 END) x
    FROM projects p CROSS JOIN LATERAL pj_health(p.id) h
    WHERE p.site_id = p_site AND NOT COALESCE(p.is_archived, false) AND NOT p.is_template
      AND COALESCE(p.status, 'active') NOT IN ('cancelled') AND _pj_can('view', p.id)) s;
  RETURN jsonb_build_object('projects', _rows,
    'hours_week', (SELECT COALESCE(SUM(hours + overtime_hours), 0) FROM project_time_entries WHERE site_id = p_site AND NOT is_archived
                   AND status IN ('submitted','approved') AND work_date >= date_trunc('week', current_date)::date),
    'time_to_approve', (SELECT count(*) FROM project_time_entries e WHERE e.site_id = p_site AND e.status = 'submitted' AND NOT e.is_archived
                   AND _pj_can('approve', e.project_id)),
    'due_week', (SELECT count(*) FROM project_tasks t JOIN projects p ON p.id = t.project_id WHERE p.site_id = p_site
                   AND t.status NOT IN ('done','cancelled') AND NOT COALESCE(t.is_archived, false)
                   AND t.due_date BETWEEN current_date AND current_date + 7 AND _pj_can('view', p.id)),
    'workload', (SELECT COALESCE(jsonb_agg(w ORDER BY (w->>'open')::int DESC), '[]') FROM (
       SELECT jsonb_build_object('user_id', t.assigned_to, 'name', (SELECT COALESCE(full_name, username) FROM profiles WHERE id = t.assigned_to),
         'open', count(*), 'overdue', count(*) FILTER (WHERE t.due_date < current_date),
         'hours_left', COALESCE(SUM(t.estimated_hours) FILTER (WHERE t.estimated_hours IS NOT NULL), 0)) w
       FROM project_tasks t JOIN projects p ON p.id = t.project_id
       WHERE p.site_id = p_site AND t.assigned_to IS NOT NULL AND t.status NOT IN ('done','cancelled') AND NOT COALESCE(t.is_archived, false)
         AND _pj_can('view', p.id)
       GROUP BY t.assigned_to LIMIT 12) q));
END $$;

-- ── My workspace ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION pj_my_workspace() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _me uuid := auth.uid(); _emp uuid := _pj_my_employee();
BEGIN
  RETURN jsonb_build_object(
    'tasks', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', t.id, 'ref', COALESCE(p.key || '-' || t.task_no, 'To-do'),
        'title', t.title, 'status', t.status, 'priority', t.priority, 'due_date', t.due_date, 'start_date', t.start_date,
        'project_id', t.project_id, 'project', p.name, 'color', p.cover_color, 'private', t.project_id IS NULL,
        'is_milestone', t.is_milestone, 'estimated_hours', t.estimated_hours, 'stage_since', t.stage_since,
        'blocked_reason', t.blocked_reason, 'recurrence', t.recurrence,
        'checklist', (SELECT jsonb_build_object('done', count(*) FILTER (WHERE checked), 'all', count(*)) FROM project_task_checklist c WHERE c.task_id = t.id),
        'links', (SELECT COALESCE(jsonb_agg(jsonb_build_object('label', l.label, 'link', l.link)), '[]') FROM project_task_links l WHERE l.task_id = t.id AND NOT l.is_archived),
        'mine', t.assigned_to = _me) ORDER BY t.due_date NULLS LAST, t.created_at), '[]')
      FROM project_tasks t LEFT JOIN projects p ON p.id = t.project_id
      WHERE NOT COALESCE(t.is_archived, false) AND (t.status NOT IN ('done','cancelled') OR t.completed_date > now() - interval '3 days')
        AND (t.assigned_to = _me OR (t.project_id IS NULL AND t.owner_user = _me))),
    'watching', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', t.id, 'ref', p.key || '-' || t.task_no, 'title', t.title,
        'status', t.status, 'due_date', t.due_date, 'project_id', t.project_id, 'project', p.name,
        'assignee', (SELECT COALESCE(full_name, username) FROM profiles WHERE id = t.assigned_to)) ORDER BY t.updated_at DESC), '[]')
      FROM project_task_watchers w JOIN project_tasks t ON t.id = w.task_id JOIN projects p ON p.id = t.project_id
      WHERE w.user_id = _me AND t.assigned_to IS DISTINCT FROM _me AND NOT COALESCE(t.is_archived, false) AND t.status NOT IN ('done','cancelled')),
    'notes', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'body', body, 'color', color, 'pinned', pinned, 'updated_at', updated_at)
        ORDER BY pinned DESC, updated_at DESC), '[]') FROM workspace_notes WHERE user_id = _me AND NOT is_archived),
    'inbox', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', n.id, 'title', n.title, 'message', n.message, 'link', n.link,
        'at', n.created_at, 'read', n.is_read) ORDER BY n.created_at DESC), '[]')
      FROM (SELECT * FROM notifications WHERE user_id = _me AND NOT COALESCE(is_archived, false)
            AND type IN ('task_assigned','task_status','task_comment','time_rejected') ORDER BY created_at DESC LIMIT 30) n),
    'approvals', (SELECT count(*) FROM approval_inbox()),
    'time_to_approve', (SELECT count(*) FROM project_time_entries e WHERE e.status = 'submitted' AND NOT e.is_archived AND _pj_can('approve', e.project_id)),
    'timer', (SELECT jsonb_build_object('id', e.id, 'task_id', e.task_id, 'since', e.running_since,
        'task', p.key || '-' || t.task_no || ' ' || t.title)
      FROM project_time_entries e JOIN project_tasks t ON t.id = e.task_id JOIN projects p ON p.id = e.project_id
      WHERE e.employee_id = _emp AND e.status = 'running' LIMIT 1),
    'hours_week', (SELECT COALESCE(SUM(hours + overtime_hours), 0) FROM project_time_entries WHERE employee_id = _emp AND NOT is_archived
      AND status <> 'rejected' AND work_date >= date_trunc('week', current_date)::date),
    'has_employee', _emp IS NOT NULL);
END $$;

CREATE OR REPLACE FUNCTION pj_note_save(p_id uuid, p_body text, p_pinned boolean, p_color text, p_archive boolean DEFAULT false) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid := p_id;
BEGIN
  IF _id IS NULL THEN
    IF COALESCE(trim(p_body), '') = '' THEN RAISE EXCEPTION 'Empty note'; END IF;
    INSERT INTO workspace_notes (body, pinned, color) VALUES (trim(p_body), COALESCE(p_pinned, false), p_color) RETURNING id INTO _id;
  ELSE
    UPDATE workspace_notes SET body = COALESCE(NULLIF(trim(p_body), ''), body), pinned = COALESCE(p_pinned, pinned),
      color = COALESCE(p_color, color), is_archived = COALESCE(p_archive, false), updated_at = now()
    WHERE id = _id AND user_id = auth.uid();
  END IF;
  RETURN _id;
END $$;

-- ── task detail in one call (drawer) ────────────────────────────────────────
CREATE OR REPLACE FUNCTION pj_task_detail(p_task uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _t project_tasks%ROWTYPE; _p projects%ROWTYPE;
BEGIN
  IF NOT _pj_task_can('view', p_task) THEN RAISE EXCEPTION 'No access to this task'; END IF;
  SELECT * INTO _t FROM project_tasks WHERE id = p_task;
  SELECT * INTO _p FROM projects WHERE id = _t.project_id;
  RETURN to_jsonb(_t) || jsonb_build_object(
    'ref', COALESCE(_p.key || '-' || _t.task_no, 'To-do'), 'project', _p.name, 'project_key', _p.key, 'site_id', _p.site_id,
    'can_edit', _pj_task_can('edit', p_task),
    'assignee', (SELECT COALESCE(full_name, username) FROM profiles WHERE id = _t.assigned_to),
    'watching', EXISTS (SELECT 1 FROM project_task_watchers WHERE task_id = p_task AND user_id = auth.uid()),
    'watchers', (SELECT COALESCE(jsonb_agg((SELECT COALESCE(full_name, username) FROM profiles WHERE id = w.user_id)), '[]') FROM project_task_watchers w WHERE w.task_id = p_task),
    'checklist', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'checked', c.checked) ORDER BY c.position, c.created_at), '[]') FROM project_task_checklist c WHERE c.task_id = p_task),
    'subtasks', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', s.id, 'ref', _p.key || '-' || s.task_no, 'title', s.title, 'status', s.status) ORDER BY s.task_no), '[]')
                 FROM project_tasks s WHERE s.parent_task_id = p_task AND NOT COALESCE(s.is_archived, false)),
    'depends_on', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', d.id, 'ref', _p.key || '-' || x.task_no, 'title', x.title, 'status', x.status)), '[]')
                 FROM project_task_dependencies d JOIN project_tasks x ON x.id = d.depends_on_id WHERE d.task_id = p_task),
    'links', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', l.id, 'label', l.label, 'link', l.link, 'record_table', l.record_table)), '[]') FROM project_task_links l WHERE l.task_id = p_task AND NOT l.is_archived),
    'comments', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', c.id, 'body', c.body, 'at', c.created_at, 'mine', c.user_id = auth.uid(),
                   'who', (SELECT COALESCE(full_name, username) FROM profiles WHERE id = c.user_id)) ORDER BY c.created_at), '[]')
                 FROM project_task_comments c WHERE c.task_id = p_task AND NOT c.is_archived),
    'activity', (SELECT COALESCE(jsonb_agg(jsonb_build_object('message', a.message, 'at', a.created_at,
                   'who', (SELECT COALESCE(full_name, username) FROM profiles WHERE id = a.actor_id)) ORDER BY a.created_at DESC), '[]')
                 FROM (SELECT * FROM project_activity WHERE entity_id = p_task ORDER BY created_at DESC LIMIT 30) a),
    'time', (SELECT jsonb_build_object('hours', COALESCE(SUM(hours + overtime_hours), 0), 'approved', COALESCE(SUM(hours + overtime_hours) FILTER (WHERE status = 'approved'), 0))
             FROM project_time_entries WHERE task_id = p_task AND NOT is_archived AND status <> 'rejected'),
    'folder_id', _t.ds_folder_id);
END $$;

INSERT INTO schema_migrations (filename) VALUES ('0258_projects_core.sql') ON CONFLICT DO NOTHING;
