-- 0260 Projects (#76) round 2: baseline, templates, Ask Bravura (read + propose task), project alerts.

-- ── baseline: freeze today's plan (Gantt shows it as the grey bar) ─────────
CREATE OR REPLACE FUNCTION pj_set_baseline(p_project uuid) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n int; _b uuid; _no int;
BEGIN
  IF NOT _pj_can('edit', p_project) THEN RAISE EXCEPTION 'No access to change this project'; END IF;
  UPDATE project_tasks SET baseline_start = COALESCE(start_date, due_date), baseline_end = COALESCE(due_date, start_date)
   WHERE project_id = p_project AND NOT COALESCE(is_archived, false) AND COALESCE(start_date, due_date) IS NOT NULL;
  GET DIAGNOSTICS _n = ROW_COUNT;
  -- keep a numbered snapshot too (existing baseline tables)
  SELECT COALESCE(max(baseline_number), 0) + 1 INTO _no FROM project_baselines WHERE project_id = p_project;
  UPDATE project_baselines SET is_current = false WHERE project_id = p_project;
  INSERT INTO project_baselines (project_id, baseline_number, name, snapshot_date, is_current, created_by)
  VALUES (p_project, _no, 'Baseline ' || _no, current_date, true, auth.uid()) RETURNING id INTO _b;
  INSERT INTO baseline_task_snapshots (baseline_id, task_id, planned_start, planned_end, planned_cost, planned_progress)
  SELECT _b, id, baseline_start, baseline_end, planned_cost, percent_complete FROM project_tasks
   WHERE project_id = p_project AND NOT COALESCE(is_archived, false) AND baseline_start IS NOT NULL;
  RETURN _n;
END $$;

-- ── templates: a project with is_template = true; tasks keep day offsets from the template start ──
CREATE OR REPLACE FUNCTION pj_template_save(p_project uuid, p_name text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _p projects%ROWTYPE; _t uuid; _start date; _col record; _ph record; _tk record;
        _colmap jsonb := '{}'; _phmap jsonb := '{}'; _tkmap jsonb := '{}'; _new uuid;
BEGIN
  SELECT * INTO _p FROM projects WHERE id = p_project;
  IF NOT _has_permission('projects.create', _p.site_id) THEN RAISE EXCEPTION 'No access to make templates'; END IF;
  _start := COALESCE(_p.start_date, (SELECT min(COALESCE(start_date, due_date)) FROM project_tasks WHERE project_id = p_project), current_date);
  INSERT INTO projects (site_id, project_code, name, description, project_type, status, priority, start_date, budget, cover_color, is_template, created_by, key)
  VALUES (_p.site_id, 'TPL-' || upper(substr(md5(random()::text), 1, 5)), COALESCE(NULLIF(trim(p_name), ''), _p.name || ' (template)'), _p.description,
    _p.project_type, 'planning', _p.priority, _start, _p.budget, _p.cover_color, true, auth.uid(), 'TPL')
  RETURNING id INTO _t;
  FOR _col IN SELECT * FROM project_board_columns WHERE project_id = p_project ORDER BY position LOOP
    INSERT INTO project_board_columns (project_id, name, position, color, wip_limit, is_done_column)
    VALUES (_t, _col.name, _col.position, _col.color, _col.wip_limit, _col.is_done_column) RETURNING id INTO _new;
    _colmap := _colmap || jsonb_build_object(_col.id::text, _new);
  END LOOP;
  FOR _ph IN SELECT * FROM project_phases WHERE project_id = p_project ORDER BY sequence LOOP
    INSERT INTO project_phases (project_id, name, description, sequence, status, start_date, end_date, budget_allocation, weight, color, is_milestone)
    VALUES (_t, _ph.name, _ph.description, _ph.sequence, 'pending', _ph.start_date, _ph.end_date, _ph.budget_allocation, _ph.weight, _ph.color, _ph.is_milestone)
    RETURNING id INTO _new;
    _phmap := _phmap || jsonb_build_object(_ph.id::text, _new);
  END LOOP;
  FOR _tk IN SELECT * FROM project_tasks WHERE project_id = p_project AND NOT COALESCE(is_archived, false) AND status <> 'cancelled'
             ORDER BY parent_task_id NULLS FIRST, task_no LOOP
    INSERT INTO project_tasks (project_id, column_id, phase_id, parent_task_id, title, description, position, priority, start_date, due_date,
      estimated_hours, is_milestone, status, created_by)
    VALUES (_t, (_colmap->>(SELECT id FROM project_board_columns WHERE project_id = p_project ORDER BY position LIMIT 1)::text)::uuid,
      (_phmap->>_tk.phase_id::text)::uuid, (_tkmap->>_tk.parent_task_id::text)::uuid, _tk.title, _tk.description, _tk.position, _tk.priority,
      _tk.start_date, _tk.due_date, _tk.estimated_hours, _tk.is_milestone, 'todo', auth.uid())
    RETURNING id INTO _new;
    _tkmap := _tkmap || jsonb_build_object(_tk.id::text, _new);
    INSERT INTO project_task_checklist (task_id, title, position)
    SELECT _new, title, position FROM project_task_checklist WHERE task_id = _tk.id;
  END LOOP;
  INSERT INTO project_task_dependencies (task_id, depends_on_id, dependency_type)
  SELECT (_tkmap->>d.task_id::text)::uuid, (_tkmap->>d.depends_on_id::text)::uuid, d.dependency_type
    FROM project_task_dependencies d WHERE _tkmap ? d.task_id::text AND _tkmap ? d.depends_on_id::text;
  RETURN _t;
END $$;

-- new project from a template: dates shift so the template start becomes p_start
CREATE OR REPLACE FUNCTION pj_project_from_template(p_template uuid, p_name text, p_code text, p_start date, p_site uuid,
  p_manager uuid DEFAULT NULL, p_budget numeric DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _tp projects%ROWTYPE; _p uuid; _shift int; _col record; _ph record; _tk record;
        _colmap jsonb := '{}'; _phmap jsonb := '{}'; _tkmap jsonb := '{}'; _new uuid; _first uuid;
BEGIN
  SELECT * INTO _tp FROM projects WHERE id = p_template AND is_template;
  IF _tp.id IS NULL THEN RAISE EXCEPTION 'Template not found'; END IF;
  IF NOT _has_permission('projects.create', p_site) THEN RAISE EXCEPTION 'No access to create projects at this site'; END IF;
  IF COALESCE(trim(p_name), '') = '' THEN RAISE EXCEPTION 'Give the project a name'; END IF;
  _shift := COALESCE(p_start, current_date) - COALESCE(_tp.start_date, current_date);
  INSERT INTO projects (site_id, project_code, name, description, project_type, status, priority, start_date, target_end_date, budget,
    project_manager, cover_color, created_by)
  VALUES (p_site, COALESCE(NULLIF(trim(p_code), ''), 'PRJ-' || to_char(now(), 'YYMMDD-HH24MI')), trim(p_name), _tp.description, _tp.project_type,
    'planning', _tp.priority, COALESCE(p_start, current_date),
    (SELECT max(COALESCE(due_date, start_date)) + _shift FROM project_tasks WHERE project_id = p_template),
    COALESCE(p_budget, _tp.budget), COALESCE(p_manager, auth.uid()), _tp.cover_color, auth.uid())
  RETURNING id INTO _p;
  UPDATE projects SET key = _pj_make_key(trim(p_name)) WHERE id = _p;
  FOR _col IN SELECT * FROM project_board_columns WHERE project_id = p_template ORDER BY position LOOP
    INSERT INTO project_board_columns (project_id, name, position, color, wip_limit, is_done_column)
    VALUES (_p, _col.name, _col.position, _col.color, _col.wip_limit, _col.is_done_column) RETURNING id INTO _new;
    _colmap := _colmap || jsonb_build_object(_col.id::text, _new);
    IF _first IS NULL THEN _first := _new; END IF;
  END LOOP;
  IF _first IS NULL THEN   -- template had no board: standard columns
    INSERT INTO project_board_columns (project_id, name, position, is_done_column) VALUES (_p, 'To do', 0, false) RETURNING id INTO _first;
    INSERT INTO project_board_columns (project_id, name, position, is_done_column) VALUES (_p, 'In progress', 1, false), (_p, 'Review', 2, false), (_p, 'Done', 3, true);
  END IF;
  FOR _ph IN SELECT * FROM project_phases WHERE project_id = p_template ORDER BY sequence LOOP
    INSERT INTO project_phases (project_id, name, description, sequence, status, start_date, end_date, budget_allocation, weight, color, is_milestone)
    VALUES (_p, _ph.name, _ph.description, _ph.sequence, 'pending', _ph.start_date + _shift, _ph.end_date + _shift, _ph.budget_allocation, _ph.weight, _ph.color, _ph.is_milestone)
    RETURNING id INTO _new;
    _phmap := _phmap || jsonb_build_object(_ph.id::text, _new);
  END LOOP;
  FOR _tk IN SELECT * FROM project_tasks WHERE project_id = p_template AND NOT COALESCE(is_archived, false) ORDER BY parent_task_id NULLS FIRST, task_no LOOP
    INSERT INTO project_tasks (project_id, column_id, phase_id, parent_task_id, title, description, position, priority, start_date, due_date,
      estimated_hours, is_milestone, status, created_by)
    VALUES (_p, _first, (_phmap->>_tk.phase_id::text)::uuid, (_tkmap->>_tk.parent_task_id::text)::uuid, _tk.title, _tk.description, _tk.position,
      _tk.priority, _tk.start_date + _shift, _tk.due_date + _shift, _tk.estimated_hours, _tk.is_milestone, 'todo', auth.uid())
    RETURNING id INTO _new;
    _tkmap := _tkmap || jsonb_build_object(_tk.id::text, _new);
    INSERT INTO project_task_checklist (task_id, title, position) SELECT _new, title, position FROM project_task_checklist WHERE task_id = _tk.id;
  END LOOP;
  INSERT INTO project_task_dependencies (task_id, depends_on_id, dependency_type)
  SELECT (_tkmap->>d.task_id::text)::uuid, (_tkmap->>d.depends_on_id::text)::uuid, d.dependency_type
    FROM project_task_dependencies d WHERE _tkmap ? d.task_id::text AND _tkmap ? d.depends_on_id::text;
  RETURN _p;
END $$;

CREATE OR REPLACE FUNCTION pj_templates(p_site uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'description', p.description,
    'tasks', (SELECT count(*) FROM project_tasks t WHERE t.project_id = p.id AND NOT COALESCE(t.is_archived, false)),
    'phases', (SELECT count(*) FROM project_phases ph WHERE ph.project_id = p.id),
    'days', (SELECT max(COALESCE(due_date, start_date)) - min(COALESCE(start_date, due_date)) + 1 FROM project_tasks t WHERE t.project_id = p.id)) ORDER BY p.name), '[]')
  FROM projects p WHERE p.is_template AND NOT COALESCE(p.is_archived, false) AND _has_permission('projects.view', p.site_id)
    AND (p.site_id = p_site OR _has_permission('projects.view', p_site))
$$;

-- templates stay out of DocShare folders, portfolio and alerts
CREATE OR REPLACE FUNCTION trg_pj_folders() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_TABLE_NAME = 'projects' THEN
    IF NEW.ds_folder_id IS NULL AND NOT NEW.is_template THEN PERFORM _pj_project_folder(NEW.id); END IF;
  ELSIF NEW.project_id IS NOT NULL AND NEW.ds_folder_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND is_template) THEN
    PERFORM _pj_task_folder(NEW.id);
  END IF;
  RETURN NULL;
END $$;
UPDATE projects SET key = 'TPL' WHERE is_template AND key IS NULL;

-- ── Ask Bravura: read ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION ai_projects(p_site_ids uuid[], p_search text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _sites uuid[] := _ai_sites_for('projects.view', p_site_ids);
BEGIN
  RETURN jsonb_build_object(
    'projects', (SELECT COALESCE(jsonb_agg(jsonb_build_object('key', p.key, 'name', p.name, 'status', p.status, 'target_end', p.target_end_date,
        'health', h->>'health', 'why', h->'reasons', 'progress_pct', h->'progress', 'open_tasks', h->'open', 'overdue', h->'overdue',
        'budget', h->'money'->'budget', 'spent', h->'money'->'actual', 'committed', h->'money'->'committed', 'hours', h->'money'->'hours',
        'link', '/projects/pj_detail_' || p.id)), '[]')
      FROM projects p CROSS JOIN LATERAL pj_health(p.id) h
      WHERE p.site_id = ANY (_sites) AND NOT COALESCE(p.is_archived, false) AND NOT p.is_template AND COALESCE(p.status, '') <> 'cancelled'
        AND (p_search IS NULL OR p.name ILIKE '%' || p_search || '%' OR p.key ILIKE p_search OR p.project_code ILIKE '%' || p_search || '%')),
    'late_tasks', (SELECT COALESCE(jsonb_agg(x ORDER BY x->>'due'), '[]') FROM (
      SELECT jsonb_build_object('ref', p.key || '-' || t.task_no, 'title', t.title, 'project', p.name, 'due', t.due_date, 'status', t.status,
        'who', (SELECT COALESCE(full_name, username) FROM profiles WHERE id = t.assigned_to), 'link', '/projects/pj_detail_' || p.id || ':board:' || t.id) x
      FROM project_tasks t JOIN projects p ON p.id = t.project_id
      WHERE p.site_id = ANY (_sites) AND NOT p.is_template AND NOT COALESCE(t.is_archived, false) AND t.status NOT IN ('done','cancelled')
        AND t.due_date < current_date AND (p_search IS NULL OR p.name ILIKE '%' || p_search || '%' OR p.key ILIKE p_search
          OR EXISTS (SELECT 1 FROM profiles pr WHERE pr.id = t.assigned_to AND pr.full_name ILIKE '%' || p_search || '%'))
      ORDER BY t.due_date LIMIT 40) q),
    'workload', (SELECT COALESCE(jsonb_agg(w ORDER BY (w->>'open')::int DESC), '[]') FROM (
      SELECT jsonb_build_object('who', (SELECT COALESCE(full_name, username) FROM profiles WHERE id = t.assigned_to), 'open', count(*),
        'overdue', count(*) FILTER (WHERE t.due_date < current_date), 'due_this_week', count(*) FILTER (WHERE t.due_date BETWEEN current_date AND current_date + 7)) w
      FROM project_tasks t JOIN projects p ON p.id = t.project_id
      WHERE p.site_id = ANY (_sites) AND NOT p.is_template AND t.assigned_to IS NOT NULL AND t.status NOT IN ('done','cancelled') AND NOT COALESCE(t.is_archived, false)
      GROUP BY t.assigned_to LIMIT 15) q),
    'my_tasks', (SELECT COALESCE(jsonb_agg(jsonb_build_object('ref', COALESCE(p.key || '-' || t.task_no, 'to-do'), 'title', t.title, 'due', t.due_date, 'status', t.status)
        ORDER BY t.due_date NULLS LAST), '[]')
      FROM project_tasks t LEFT JOIN projects p ON p.id = t.project_id
      WHERE NOT COALESCE(t.is_archived, false) AND t.status NOT IN ('done','cancelled') AND (t.assigned_to = auth.uid() OR t.owner_user = auth.uid())));
END $$;

-- ── Ask Bravura: propose a task (card → person confirms) ────────────────────
CREATE OR REPLACE FUNCTION ai_prepare_task(p_site_ids uuid[], p_title text, p_project text DEFAULT NULL, p_assignee text DEFAULT NULL,
  p_due date DEFAULT NULL, p_priority text DEFAULT 'medium', p_notes text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _site uuid := p_site_ids[1]; _p projects%ROWTYPE; _who uuid; _who_name text;
BEGIN
  IF COALESCE(trim(p_title), '') = '' THEN RETURN jsonb_build_object('error', 'Say what the task is'); END IF;
  IF COALESCE(trim(p_project), '') <> '' THEN
    SELECT * INTO _p FROM projects WHERE site_id = _site AND NOT is_template AND NOT COALESCE(is_archived, false)
      AND (key ILIKE trim(p_project) OR project_code ILIKE trim(p_project) OR name ILIKE '%' || trim(p_project) || '%')
    ORDER BY (key ILIKE trim(p_project)) DESC LIMIT 1;
    IF _p.id IS NULL THEN RETURN jsonb_build_object('error', 'No project matching "' || p_project || '"'); END IF;
    IF NOT _pj_can('edit', _p.id) THEN RETURN jsonb_build_object('error', 'You cannot add tasks to ' || _p.name); END IF;
  END IF;
  IF COALESCE(trim(p_assignee), '') <> '' AND lower(trim(p_assignee)) NOT IN ('me', 'myself') THEN
    SELECT id, COALESCE(full_name, username) INTO _who, _who_name FROM profiles
     WHERE NOT COALESCE(is_suspended, false) AND (full_name ILIKE '%' || trim(p_assignee) || '%' OR username ILIKE trim(p_assignee) || '%')
     ORDER BY length(full_name) LIMIT 1;
    IF _who IS NULL THEN RETURN jsonb_build_object('error', 'No user called "' || p_assignee || '"'); END IF;
    IF _p.id IS NULL AND _who <> auth.uid() THEN RETURN jsonb_build_object('error', 'To give a task to someone else, say which project it belongs to'); END IF;
  END IF;
  RETURN jsonb_build_object('title', trim(p_title), 'project', _p.name, 'project_key', _p.key, 'assignee', COALESCE(_who_name, 'you'),
    'due', p_due, 'priority', CASE WHEN p_priority IN ('low','medium','high','critical') THEN p_priority ELSE 'medium' END,
    'task', jsonb_strip_nulls(jsonb_build_object('title', trim(p_title), 'project_id', _p.id, 'assigned_to', COALESCE(_who, auth.uid()),
      'due_date', p_due, 'priority', CASE WHEN p_priority IN ('low','medium','high','critical') THEN p_priority ELSE 'medium' END, 'description', p_notes)));
END $$;

DO $$ DECLARE _d text; _n text; BEGIN
  _d := pg_get_functiondef('ai_action_confirm(uuid)'::regprocedure);
  IF position('project_task' in _d) > 0 THEN RETURN; END IF;
  _n := replace(_d, '  ELSIF _a.kind = ''fleet_job'' THEN',
'  ELSIF _a.kind = ''project_task'' THEN
    _res := pj_task_save(_p->''task'');
    _id := (_res->>''id'')::uuid;
    _res := jsonb_build_object(''message'', ''Task '' || COALESCE(_res->>''ref'', ''(to-do)'') || '' made: '' || (_p->>''title''),
      ''path'', ''/projects/pj_workspace:'' || _id, ''record_table'', ''project_tasks'', ''record_id'', _id);
  ELSIF _a.kind = ''fleet_job'' THEN');
  IF _n = _d THEN RAISE EXCEPTION 'ai_action_confirm patch did not apply'; END IF;
  EXECUTE _n;
END $$;

-- ── alerts (cron 04:30 + Your day): off-track projects, stuck work, budget, time waiting ──
CREATE OR REPLACE FUNCTION _ai_alerts_projects(p_sites uuid[])
RETURNS TABLE(key text, site_id uuid, kind text, perm text, severity text, title text, detail text, link text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT 'pjhealth:' || p.id || ':' || (h->>'health') || ':' || to_char(current_date, 'IYYY-IW'), p.site_id, 'project_health', 'projects.view',
         CASE WHEN h->>'health' = 'off_track' THEN 'critical' ELSE 'warning' END,
         CASE WHEN h->>'health' = 'off_track' THEN 'Off track: ' ELSE 'At risk: ' END || p.name,
         COALESCE((SELECT string_agg(r, ', ') FROM jsonb_array_elements_text(h->'reasons') r), ''), '/projects/pj_detail_' || p.id
    FROM projects p CROSS JOIN LATERAL pj_health(p.id) h
   WHERE p.site_id = ANY (p_sites) AND NOT p.is_template AND NOT COALESCE(p.is_archived, false)
     AND COALESCE(p.status, 'active') NOT IN ('completed','cancelled','on_hold') AND h->>'health' IN ('off_track','at_risk')
  UNION ALL
  SELECT 'pjstuck:' || t.id || ':' || t.stage_since::date, p.site_id, 'task_stuck', 'projects.edit', 'warning',
         'Stuck ' || (current_date - t.stage_since::date) || ' days: ' || p.key || '-' || t.task_no || ' ' || t.title,
         replace(t.status, '_', ' ') || COALESCE(' — ' || t.blocked_reason, ''), '/projects/pj_detail_' || p.id || ':board:' || t.id
    FROM project_tasks t JOIN projects p ON p.id = t.project_id
   WHERE p.site_id = ANY (p_sites) AND NOT p.is_template AND NOT COALESCE(t.is_archived, false)
     AND t.status IN ('in_progress','review','blocked') AND t.stage_since < now() - interval '14 days'
  UNION ALL
  SELECT 'pjtime:' || e.project_id || ':' || current_date, e.site_id, 'time_waiting', 'projects.approve', 'warning',
         count(*) || ' time entries waiting over 3 days', max(p.name), '/projects/pj_time:approve'
    FROM project_time_entries e JOIN projects p ON p.id = e.project_id
   WHERE e.site_id = ANY (p_sites) AND e.status = 'submitted' AND NOT e.is_archived AND e.created_at < now() - interval '3 days'
   GROUP BY e.project_id, e.site_id
$$;

CREATE OR REPLACE FUNCTION _ai_alerts_core(p_sites uuid[])
RETURNS TABLE(key text, site_id uuid, kind text, perm text, severity text, title text, detail text, link text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT * FROM _ai_alerts_base(p_sites) UNION ALL SELECT * FROM _ai_alerts_stock(p_sites) UNION ALL SELECT * FROM _ai_alerts_fleet(p_sites)
  UNION ALL SELECT * FROM _ai_alerts_fuel(p_sites) UNION ALL SELECT * FROM _ai_alerts_projects(p_sites);
$function$;

INSERT INTO schema_migrations (filename) VALUES ('0260_projects_gantt_templates_ai.sql') ON CONFLICT DO NOTHING;
