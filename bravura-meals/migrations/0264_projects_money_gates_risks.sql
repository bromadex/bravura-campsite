-- 0264 Projects (#76) round 4: real costs, budget per phase, change orders that move the budget, stage gates,
-- risks (SHEQ risk register), Friday prompt + no-update reminder, area-code roll-up.

-- ── phases: stage gate fields ───────────────────────────────────────────────
ALTER TABLE project_phases
  ADD COLUMN IF NOT EXISTS gate_closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS gate_closed_by uuid,
  ADD COLUMN IF NOT EXISTS gate_note text,
  ADD COLUMN IF NOT EXISTS leftover_budget numeric(14,2);

-- ── change orders: applied once, with before/after ─────────────────────────
ALTER TABLE project_change_orders
  ADD COLUMN IF NOT EXISTS applied_at timestamptz,
  ADD COLUMN IF NOT EXISTS budget_before numeric(14,2),
  ADD COLUMN IF NOT EXISTS budget_after numeric(14,2),
  ADD COLUMN IF NOT EXISTS end_before date,
  ADD COLUMN IF NOT EXISTS end_after date,
  ADD COLUMN IF NOT EXISTS decision_note text;

-- ── real costs per project ──────────────────────────────────────────────────
-- GL expense lines tagged with the project (bills, Stores issues, fuel, hired plant, petty cash …) by account group,
-- approved labour (project time), committed = open PO lines; per phase = labour on that phase's tasks + phase budget.
CREATE OR REPLACE FUNCTION pj_costs(p_project uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _p projects%ROWTYPE;
BEGIN
  IF NOT _pj_can('view', p_project) THEN RAISE EXCEPTION 'No access to this project'; END IF;
  SELECT * INTO _p FROM projects WHERE id = p_project;
  RETURN jsonb_build_object(
    'budget', COALESCE(_p.budget, 0),
    'by_category', (SELECT COALESCE(jsonb_agg(jsonb_build_object('category', cat, 'amount', amt) ORDER BY amt DESC), '[]') FROM (
        SELECT CASE WHEN a.code LIKE '61%' THEN 'Fuel & lubricants' WHEN a.code LIKE '62%' THEN 'Staff costs'
                    WHEN a.code LIKE '63%' THEN 'Parts & repairs' WHEN a.code LIKE '65%' THEN 'Contractors & hired plant'
                    WHEN a.code LIKE '66%' THEN 'Materials & consumables' WHEN a.code LIKE '64%' THEN 'Camp & catering'
                    ELSE 'Other' END cat, SUM(l.debit - l.credit) amt
        FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
        WHERE l.project_id = p_project AND j.status = 'posted' AND NOT COALESCE(j.is_archived, false) AND a.account_type = 'Expense'
        GROUP BY 1
        UNION ALL
        SELECT 'Labour (approved time)', SUM(cost) FROM project_time_entries WHERE project_id = p_project AND status = 'approved' AND NOT is_archived
        HAVING SUM(cost) IS NOT NULL) x WHERE amt <> 0),
    'committed', (SELECT COALESCE(SUM(GREATEST(0, pl.quantity - COALESCE(pl.received_qty, 0)) * pl.unit_cost), 0)
        FROM purchase_orders po JOIN po_lines pl ON pl.po_id = po.id
        WHERE po.project_id = p_project AND po.status IN ('sent','partially_received','pending_approval') AND NOT COALESCE(pl.is_archived, false)),
    'open_pos', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', po.id, 'number', po.po_number, 'status', po.status, 'supplier',
        (SELECT supplier_name FROM procurement_suppliers s WHERE s.id = po.supplier_id), 'open', o.amt)), '[]')
        FROM purchase_orders po CROSS JOIN LATERAL (SELECT SUM(GREATEST(0, pl.quantity - COALESCE(pl.received_qty, 0)) * pl.unit_cost) amt
          FROM po_lines pl WHERE pl.po_id = po.id AND NOT COALESCE(pl.is_archived, false)) o
        WHERE po.project_id = p_project AND po.status IN ('sent','partially_received','pending_approval') AND o.amt > 0),
    'recent', (SELECT COALESCE(jsonb_agg(r ORDER BY r->>'date' DESC), '[]') FROM (
        SELECT jsonb_build_object('date', j.entry_date, 'ref', j.entry_number, 'what', COALESCE(l.description, j.description), 'account', a.name,
          'amount', l.debit - l.credit) r
        FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
        WHERE l.project_id = p_project AND j.status = 'posted' AND NOT COALESCE(j.is_archived, false) AND a.account_type = 'Expense'
        ORDER BY j.entry_date DESC LIMIT 25) q),
    'phases', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', ph.id, 'name', ph.name, 'sequence', ph.sequence, 'status', ph.status,
        'budget', COALESCE(ph.budget_allocation, 0), 'labour', COALESCE(lab.amt, 0), 'hours', COALESCE(lab.hrs, 0),
        'tasks', tk.total, 'open', tk.open, 'gate_closed_at', ph.gate_closed_at, 'gate_note', ph.gate_note, 'leftover', ph.leftover_budget,
        'start_date', ph.start_date, 'end_date', ph.end_date) ORDER BY ph.sequence), '[]')
        FROM project_phases ph
        LEFT JOIN LATERAL (SELECT SUM(e.cost) amt, SUM(e.hours + e.overtime_hours) hrs FROM project_time_entries e JOIN project_tasks t ON t.id = e.task_id
                           WHERE t.phase_id = ph.id AND e.status = 'approved' AND NOT e.is_archived) lab ON true
        LEFT JOIN LATERAL (SELECT count(*) total, count(*) FILTER (WHERE status NOT IN ('done','cancelled')) open FROM project_tasks t
                           WHERE t.phase_id = ph.id AND NOT COALESCE(t.is_archived, false)) tk ON true
        WHERE ph.project_id = p_project),
    'money', pj_money(p_project));
END $$;

-- ── stage gate: close a phase (all tasks done, or a reason), record leftover budget ──
CREATE OR REPLACE FUNCTION pj_phase_close(p_phase uuid, p_note text, p_force boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _ph project_phases%ROWTYPE; _open int; _spent numeric; _left numeric;
BEGIN
  SELECT * INTO _ph FROM project_phases WHERE id = p_phase;
  IF NOT _pj_can('approve', _ph.project_id) AND NOT _pj_can('edit', _ph.project_id) THEN RAISE EXCEPTION 'No access to close phases on this project'; END IF;
  IF _ph.gate_closed_at IS NOT NULL THEN RAISE EXCEPTION 'This phase is already closed'; END IF;
  SELECT count(*) INTO _open FROM project_tasks WHERE phase_id = p_phase AND NOT COALESCE(is_archived, false) AND status NOT IN ('done','cancelled');
  IF _open > 0 AND NOT p_force THEN RAISE EXCEPTION 'OPEN_TASKS:%', _open; END IF;
  IF _open > 0 AND COALESCE(trim(p_note), '') = '' THEN RAISE EXCEPTION 'Say why the phase is closing with % open task(s)', _open; END IF;
  SELECT COALESCE(SUM(e.cost), 0) INTO _spent FROM project_time_entries e JOIN project_tasks t ON t.id = e.task_id
   WHERE t.phase_id = p_phase AND e.status = 'approved' AND NOT e.is_archived;
  _left := COALESCE(_ph.budget_allocation, 0) - _spent;
  UPDATE project_phases SET status = 'completed', gate_closed_at = now(), gate_closed_by = auth.uid(), gate_note = NULLIF(trim(p_note), ''),
    leftover_budget = _left, end_date = COALESCE(end_date, current_date) WHERE id = p_phase;
  INSERT INTO project_activity (project_id, actor_id, action_type, entity_type, entity_id, message)
  VALUES (_ph.project_id, auth.uid(), 'phase_closed', 'phase', p_phase,
    'Stage gate: ' || _ph.name || ' closed' || CASE WHEN _open > 0 THEN ' with ' || _open || ' open task(s)' ELSE '' END ||
    ' — leftover budget $' || to_char(_left, 'FM999,999,990.00'));
  RETURN jsonb_build_object('leftover', _left, 'open', _open);
END $$;

-- ── change orders: approving moves the budget / end date once ───────────────
CREATE OR REPLACE FUNCTION pj_change_order_decide(p_id uuid, p_approve boolean, p_note text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _c project_change_orders%ROWTYPE; _p projects%ROWTYPE; _nb numeric; _ne date;
BEGIN
  SELECT * INTO _c FROM project_change_orders WHERE id = p_id;
  IF NOT _pj_can('approve', _c.project_id) THEN RAISE EXCEPTION 'You cannot approve change orders on this project'; END IF;
  IF _c.status NOT IN ('draft','submitted','under_review') THEN RAISE EXCEPTION 'This change order is already %', _c.status; END IF;
  IF NOT p_approve THEN
    IF COALESCE(trim(p_note), '') = '' THEN RAISE EXCEPTION 'Give a reason for rejecting it'; END IF;
    UPDATE project_change_orders SET status = 'rejected', approved_by = auth.uid(), approved_date = current_date, decision_note = p_note, updated_at = now() WHERE id = p_id;
    RETURN jsonb_build_object('status', 'rejected');
  END IF;
  SELECT * INTO _p FROM projects WHERE id = _c.project_id FOR UPDATE;
  _nb := COALESCE(_p.budget, 0) + CASE WHEN _c.impact_type IN ('cost','cost_and_schedule','scope') THEN COALESCE(_c.cost_impact, 0) ELSE 0 END;
  _ne := CASE WHEN _c.impact_type IN ('schedule','cost_and_schedule','scope') AND COALESCE(_c.schedule_impact_days, 0) <> 0 AND _p.target_end_date IS NOT NULL
              THEN _p.target_end_date + _c.schedule_impact_days ELSE _p.target_end_date END;
  UPDATE projects SET budget = _nb, target_end_date = _ne WHERE id = _p.id;
  UPDATE project_change_orders SET status = 'approved', approved_by = auth.uid(), approved_date = current_date, decision_note = p_note,
    applied_at = now(), budget_before = _p.budget, budget_after = _nb, end_before = _p.target_end_date, end_after = _ne, updated_at = now()
   WHERE id = p_id;
  INSERT INTO project_activity (project_id, actor_id, action_type, entity_type, entity_id, old_values, new_values, message)
  VALUES (_p.id, auth.uid(), 'change_order_approved', 'change_order', p_id,
    jsonb_build_object('budget', _p.budget, 'target_end_date', _p.target_end_date), jsonb_build_object('budget', _nb, 'target_end_date', _ne),
    'Change order ' || COALESCE(_c.change_order_number, '') || ' approved: budget ' || COALESCE(_p.budget, 0) || ' → ' || _nb ||
    CASE WHEN _ne IS DISTINCT FROM _p.target_end_date THEN ', end ' || COALESCE(_p.target_end_date::text, '—') || ' → ' || _ne ELSE '' END);
  RETURN jsonb_build_object('status', 'approved', 'budget', _nb, 'target_end_date', _ne);
END $$;

-- ── risks: the SHEQ risk register rows tagged with the project ──────────────
CREATE OR REPLACE FUNCTION pj_risks(p_project uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', r.id, 'number', r.risk_number, 'title', r.title, 'hazard', r.hazard, 'level', r.risk_level,
    'score', r.inherent_risk, 'residual', r.residual_risk, 'residual_level', r.residual_risk_level, 'status', r.status, 'review_date', r.review_date,
    'controls', r.existing_controls, 'owner', (SELECT COALESCE(full_name, username) FROM profiles WHERE id = r.owner_id))
    ORDER BY r.inherent_risk DESC NULLS LAST), '[]')
  FROM sheq_risk_register r WHERE r.project_id = p_project AND NOT COALESCE(r.is_archived, false) AND r.status <> 'archived' AND _pj_can('view', p_project)
$$;

CREATE OR REPLACE FUNCTION pj_risk_add(p_project uuid, p jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _p projects%ROWTYPE; _id uuid; _l int := LEAST(5, GREATEST(1, COALESCE((p->>'likelihood')::int, 3))); _s int := LEAST(5, GREATEST(1, COALESCE((p->>'severity')::int, 3)));
BEGIN
  SELECT * INTO _p FROM projects WHERE id = p_project;
  IF NOT _pj_can('edit', p_project) THEN RAISE EXCEPTION 'No access to add risks on this project'; END IF;
  IF COALESCE(trim(p->>'title'), '') = '' THEN RAISE EXCEPTION 'Name the risk'; END IF;
  INSERT INTO sheq_risk_register (site_id, risk_number, title, hazard, consequence, existing_controls, likelihood, severity, risk_level,
    project_id, owner_id, review_date, status)
  VALUES (_p.site_id, sheq_next_number(_p.site_id, 'RSK', 'sheq_risk_register'), trim(p->>'title'), COALESCE(NULLIF(trim(p->>'hazard'), ''), trim(p->>'title')), p->>'consequence', p->>'controls', _l, _s,
    CASE WHEN _l * _s >= 20 THEN 'critical' WHEN _l * _s >= 12 THEN 'high' WHEN _l * _s >= 6 THEN 'medium' ELSE 'low' END,
    p_project, NULLIF(p->>'owner_id', '')::uuid, NULLIF(p->>'review_date', '')::date, 'active')
  RETURNING id INTO _id;
  RETURN _id;
END $$;

-- ── area-code roll-up (AC-49 …) ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION pj_area_rollup(p_project uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'sort')::numeric NULLS LAST, x->>'area'), '[]') FROM (
    SELECT jsonb_build_object('area', COALESCE('AC-' || t.area_code, 'No area'),
      'sort', CASE WHEN t.area_code ~ '^\d+' THEN substring(t.area_code from '^\d+')::numeric END,
      'tasks', count(*), 'done', count(*) FILTER (WHERE t.status = 'done'), 'open', count(*) FILTER (WHERE t.status NOT IN ('done','cancelled')),
      'overdue', count(*) FILTER (WHERE t.status NOT IN ('done','cancelled') AND t.due_date < current_date),
      'blocked', count(*) FILTER (WHERE t.status = 'blocked'),
      'hours', COALESCE(SUM((SELECT SUM(e.hours + e.overtime_hours) FROM project_time_entries e WHERE e.task_id = t.id AND e.status = 'approved' AND NOT e.is_archived)), 0),
      'labour', COALESCE(SUM((SELECT SUM(e.cost) FROM project_time_entries e WHERE e.task_id = t.id AND e.status = 'approved' AND NOT e.is_archived)), 0),
      'titles', string_agg(t.title, ' · ' ORDER BY t.task_no)) x
    FROM project_tasks t
    WHERE t.project_id = p_project AND NOT COALESCE(t.is_archived, false) AND t.status <> 'cancelled' AND _pj_can('view', p_project)
    GROUP BY COALESCE('AC-' || t.area_code, 'No area'), CASE WHEN t.area_code ~ '^\d+' THEN substring(t.area_code from '^\d+')::numeric END) q
$$;

-- ── Friday prompt to each project's team + reminder when no weekly update for 7 days ──
CREATE OR REPLACE FUNCTION pj_update_reminders() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; _n int := 0; _u uuid;
BEGIN
  FOR r IN SELECT p.* FROM projects p WHERE NOT p.is_template AND NOT COALESCE(p.is_archived, false) AND COALESCE(p.status, 'active') IN ('active','planning') LOOP
    -- Friday: everyone with open tasks on the project
    IF extract(isodow FROM current_date) = 5 THEN
      FOR _u IN SELECT DISTINCT assigned_to FROM project_tasks WHERE project_id = r.id AND assigned_to IS NOT NULL
                 AND status NOT IN ('done','cancelled') AND NOT COALESCE(is_archived, false) LOOP
        IF NOT EXISTS (SELECT 1 FROM notifications WHERE user_id = _u AND type = 'project_friday' AND link LIKE '%' || r.id || '%' AND created_at > now() - interval '3 days') THEN
          INSERT INTO notifications (site_id, user_id, type, title, message, link, category)
          VALUES (r.site_id, _u, 'project_friday', 'Friday check-in: ' || r.name,
            'What did you finish this week, and what is next? Update your tasks or add a comment.', '/projects/pj_detail_' || r.id || ':board', 'reminder');
          _n := _n + 1;
        END IF;
      END LOOP;
    END IF;
    -- no weekly update for 7 days → the project manager
    IF r.project_manager IS NOT NULL AND COALESCE((SELECT max(created_at) FROM project_updates WHERE project_id = r.id AND NOT is_archived), r.created_at) < now() - interval '7 days'
       AND NOT EXISTS (SELECT 1 FROM notifications WHERE user_id = r.project_manager AND type = 'project_update_due' AND title = 'Weekly update due: ' || r.name AND created_at > now() - interval '6 days') THEN
      INSERT INTO notifications (site_id, user_id, type, title, message, link, category)
      VALUES (r.site_id, r.project_manager, 'project_update_due', 'Weekly update due: ' || r.name,
        'No update for 7 days. Post one on the Projects portfolio (health + a short note).', '/projects/pj_dashboard', 'reminder');
      _n := _n + 1;
    END IF;
  END LOOP;
  RETURN _n;
END $$;

DO $$ BEGIN
  PERFORM cron.unschedule('project-reminders') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'project-reminders');
  PERFORM cron.schedule('project-reminders', '20 5 * * *', 'SELECT pj_update_reminders()');
END $$;

INSERT INTO schema_migrations (filename) VALUES ('0264_projects_money_gates_risks.sql') ON CONFLICT DO NOTHING;
