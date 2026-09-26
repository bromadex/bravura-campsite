-- 0244 — Fleet A6 (#67): small assets issued to people + Ask Bravura + fleet alerts.
--  • small_assets (tag, serial, value, condition, status, optional fixed_asset_id) + small_asset_issues (who has it, signed name,
--    due back, condition out/in). Writes only through small_asset_save / _issue / _return / _count. Rights: fleet.* or assets.*.
--  • exit_records: clearance can't be completed while the person still holds small assets (trg_exit_small_assets).
--  • pg_cron small-asset-overdue 05:15 UTC → small_asset_overdue_notify() once per loan.
--  • Ask Bravura: ai_small_assets (who has / what does X hold / overdue), ai_fleet_costs (cost per hour/km), proposals
--    small_asset_issue / small_asset_return / fleet_job / fleet_meter confirmed through ai_action_confirm.
--  • _ai_alerts_fleet: machine down 2+ days, service overdue, papers expiring ≤14 d, small asset overdue → _ai_alerts_core.

CREATE OR REPLACE FUNCTION public._sa_can(p_action text, p_site uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _has_permission('fleet.' || p_action, p_site) OR _has_permission('assets.' || p_action, p_site);
$$;

CREATE TABLE IF NOT EXISTS small_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES sites(id),
  tag_number text NOT NULL,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'tool',
  serial_number text,
  make text,
  model text,
  value numeric NOT NULL DEFAULT 0 CHECK (value >= 0),
  purchase_date date,
  condition text NOT NULL DEFAULT 'good' CHECK (condition IN ('new','good','fair','damaged','unserviceable')),
  status text NOT NULL DEFAULT 'in_store' CHECK (status IN ('in_store','issued','in_repair','lost','retired')),
  location text,
  fixed_asset_id uuid REFERENCES fixed_assets(id),
  last_counted_at timestamptz,
  notes text,
  is_archived boolean NOT NULL DEFAULT false,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, tag_number)
);
CREATE TABLE IF NOT EXISTS small_asset_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES small_assets(id),
  site_id uuid NOT NULL REFERENCES sites(id),
  employee_id uuid NOT NULL REFERENCES employees(id),
  issued_at timestamptz NOT NULL DEFAULT now(),
  issued_by uuid DEFAULT auth.uid(),
  due_back date,
  signed_name text NOT NULL,
  condition_out text,
  notes text,
  returned_at timestamptz,
  returned_to uuid,
  condition_in text,
  return_notes text,
  status text NOT NULL DEFAULT 'out' CHECK (status IN ('out','returned','lost')),
  overdue_notified date
);
CREATE INDEX IF NOT EXISTS small_asset_issues_open ON small_asset_issues (employee_id) WHERE status = 'out';
CREATE UNIQUE INDEX IF NOT EXISTS small_asset_one_open ON small_asset_issues (asset_id) WHERE status = 'out';
ALTER TABLE small_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE small_asset_issues ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS small_assets_read ON small_assets;
CREATE POLICY small_assets_read ON small_assets FOR SELECT TO authenticated USING (_sa_can('view', site_id) OR _has_permission('hr.view', site_id));
DROP POLICY IF EXISTS small_asset_issues_read ON small_asset_issues;
CREATE POLICY small_asset_issues_read ON small_asset_issues FOR SELECT TO authenticated USING (_sa_can('view', site_id) OR _has_permission('hr.view', site_id));

-- p: {id?, site_id, tag_number?, name, category, serial_number, make, model, value, purchase_date, condition, location, notes, fixed_asset_id, status?}
CREATE OR REPLACE FUNCTION public.small_asset_save(p jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid := NULLIF(p->>'id', '')::uuid; _site uuid := (p->>'site_id')::uuid; _old small_assets%ROWTYPE;
BEGIN
  IF _id IS NOT NULL THEN
    SELECT * INTO _old FROM small_assets WHERE id = _id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Item not found'; END IF;
    _site := _old.site_id;
    IF NOT _sa_can('edit', _site) THEN RAISE EXCEPTION 'You do not have permission to edit small assets'; END IF;
    IF p ? 'status' AND p->>'status' <> _old.status AND (_old.status = 'issued' OR p->>'status' = 'issued') THEN
      RAISE EXCEPTION 'Use Issue / Take back to change who has it';
    END IF;
    UPDATE small_assets SET name = COALESCE(NULLIF(trim(p->>'name'), ''), name), category = COALESCE(NULLIF(p->>'category', ''), category),
           serial_number = NULLIF(p->>'serial_number', ''), make = NULLIF(p->>'make', ''), model = NULLIF(p->>'model', ''),
           value = COALESCE(NULLIF(p->>'value', '')::numeric, value), purchase_date = NULLIF(p->>'purchase_date', '')::date,
           condition = COALESCE(NULLIF(p->>'condition', ''), condition), location = NULLIF(p->>'location', ''), notes = NULLIF(p->>'notes', ''),
           fixed_asset_id = NULLIF(p->>'fixed_asset_id', '')::uuid, status = COALESCE(NULLIF(p->>'status', ''), status),
           is_archived = COALESCE((p->>'is_archived')::boolean, is_archived), updated_at = now()
     WHERE id = _id;
    RETURN _id;
  END IF;
  IF NOT (_sa_can('create', _site) OR _sa_can('edit', _site)) THEN RAISE EXCEPTION 'You do not have permission to add small assets'; END IF;
  IF COALESCE(trim(p->>'name'), '') = '' THEN RAISE EXCEPTION 'Name the item'; END IF;
  INSERT INTO small_assets (site_id, tag_number, name, category, serial_number, make, model, value, purchase_date, condition, location, notes, fixed_asset_id)
  VALUES (_site, COALESCE(NULLIF(trim(p->>'tag_number'), ''), doc_next_number(_site, 'SA')), trim(p->>'name'), COALESCE(NULLIF(p->>'category', ''), 'tool'),
          NULLIF(p->>'serial_number', ''), NULLIF(p->>'make', ''), NULLIF(p->>'model', ''), COALESCE(NULLIF(p->>'value', '')::numeric, 0),
          NULLIF(p->>'purchase_date', '')::date, COALESCE(NULLIF(p->>'condition', ''), 'good'), NULLIF(p->>'location', ''), NULLIF(p->>'notes', ''),
          NULLIF(p->>'fixed_asset_id', '')::uuid)
  RETURNING id INTO _id;
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.small_asset_issue(p_asset_id uuid, p_employee_id uuid, p_signed_name text, p_due_back date DEFAULT NULL, p_notes text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _a small_assets%ROWTYPE; _e employees%ROWTYPE; _id uuid;
BEGIN
  SELECT * INTO _a FROM small_assets WHERE id = p_asset_id FOR UPDATE;
  IF NOT FOUND OR _a.is_archived THEN RAISE EXCEPTION 'Item not found'; END IF;
  IF NOT (_sa_can('create', _a.site_id) OR _sa_can('edit', _a.site_id)) THEN RAISE EXCEPTION 'You do not have permission to issue small assets'; END IF;
  IF _a.status <> 'in_store' THEN RAISE EXCEPTION '% is % — take it back first', _a.tag_number, replace(_a.status, '_', ' '); END IF;
  IF _a.condition = 'unserviceable' THEN RAISE EXCEPTION '% is unserviceable', _a.tag_number; END IF;
  SELECT * INTO _e FROM employees WHERE id = p_employee_id;
  IF NOT FOUND OR _e.status <> 'active' THEN RAISE EXCEPTION 'Choose an active employee'; END IF;
  IF COALESCE(trim(p_signed_name), '') = '' THEN RAISE EXCEPTION 'The person must sign (type their name)'; END IF;
  INSERT INTO small_asset_issues (asset_id, site_id, employee_id, due_back, signed_name, condition_out, notes)
  VALUES (_a.id, _a.site_id, _e.id, p_due_back, trim(p_signed_name), _a.condition, NULLIF(trim(p_notes), ''))
  RETURNING id INTO _id;
  UPDATE small_assets SET status = 'issued', updated_at = now() WHERE id = _a.id;
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.small_asset_return(p_asset_id uuid, p_condition text, p_notes text DEFAULT NULL, p_lost boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _a small_assets%ROWTYPE;
BEGIN
  SELECT * INTO _a FROM small_assets WHERE id = p_asset_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item not found'; END IF;
  IF NOT (_sa_can('create', _a.site_id) OR _sa_can('edit', _a.site_id)) THEN RAISE EXCEPTION 'You do not have permission to take items back'; END IF;
  IF _a.status <> 'issued' THEN RAISE EXCEPTION '% is not out with anyone', _a.tag_number; END IF;
  IF NOT p_lost AND COALESCE(p_condition, '') NOT IN ('new','good','fair','damaged','unserviceable') THEN RAISE EXCEPTION 'Say what condition it came back in'; END IF;
  IF p_lost AND COALESCE(trim(p_notes), '') = '' THEN RAISE EXCEPTION 'Say what happened to it'; END IF;
  UPDATE small_asset_issues SET status = CASE WHEN p_lost THEN 'lost' ELSE 'returned' END, returned_at = now(), returned_to = auth.uid(),
         condition_in = CASE WHEN p_lost THEN NULL ELSE p_condition END, return_notes = NULLIF(trim(p_notes), '')
   WHERE asset_id = _a.id AND status = 'out';
  UPDATE small_assets SET status = CASE WHEN p_lost THEN 'lost' WHEN p_condition IN ('damaged','unserviceable') THEN 'in_repair' ELSE 'in_store' END,
         condition = CASE WHEN p_lost THEN condition ELSE p_condition END, updated_at = now()
   WHERE id = _a.id;
END $$;

-- Periodic count: found / not found, condition, where it is.
CREATE OR REPLACE FUNCTION public.small_asset_count(p_asset_id uuid, p_found boolean, p_condition text DEFAULT NULL, p_location text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _a small_assets%ROWTYPE;
BEGIN
  SELECT * INTO _a FROM small_assets WHERE id = p_asset_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item not found'; END IF;
  IF NOT _sa_can('edit', _a.site_id) THEN RAISE EXCEPTION 'You do not have permission to count small assets'; END IF;
  UPDATE small_assets SET last_counted_at = now(), condition = COALESCE(NULLIF(p_condition, ''), condition), location = COALESCE(NULLIF(p_location, ''), location),
         notes = CASE WHEN p_found THEN notes ELSE concat_ws(E'\n', notes, 'Not found at count ' || to_char(now(), 'DD Mon YYYY')) END, updated_at = now()
   WHERE id = _a.id;
END $$;

CREATE OR REPLACE FUNCTION public.small_assets_list(p_site_id uuid) RETURNS TABLE
  (id uuid, tag_number text, name text, category text, serial_number text, make text, model text, value numeric, purchase_date date,
   condition text, status text, location text, fixed_asset_id uuid, last_counted_at timestamptz, notes text,
   holder_id uuid, holder text, holder_number text, issued_at timestamptz, due_back date, signed_name text, overdue boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.id, a.tag_number, a.name, a.category, a.serial_number, a.make, a.model, a.value, a.purchase_date, a.condition, a.status, a.location,
         a.fixed_asset_id, a.last_counted_at, a.notes, e.id, e.name, e.employee_number, i.issued_at, i.due_back, i.signed_name,
         i.due_back IS NOT NULL AND i.due_back < CURRENT_DATE
    FROM small_assets a
    LEFT JOIN small_asset_issues i ON i.asset_id = a.id AND i.status = 'out'
    LEFT JOIN employees e ON e.id = i.employee_id
   WHERE a.site_id = p_site_id AND NOT a.is_archived AND (_sa_can('view', p_site_id) OR _has_permission('hr.view', p_site_id))
   ORDER BY a.tag_number;
$$;

CREATE OR REPLACE FUNCTION public.small_asset_history(p_asset_id uuid) RETURNS TABLE
  (issued_at timestamptz, employee text, signed_name text, due_back date, condition_out text, returned_at timestamptz, condition_in text, status text, notes text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT i.issued_at, e.name, i.signed_name, i.due_back, i.condition_out, i.returned_at, i.condition_in, i.status, concat_ws(' · ', i.notes, i.return_notes)
    FROM small_asset_issues i JOIN employees e ON e.id = i.employee_id
   WHERE i.asset_id = p_asset_id AND (_sa_can('view', i.site_id) OR _has_permission('hr.view', i.site_id))
   ORDER BY i.issued_at DESC;
$$;

-- What a person holds (employee profile, exit checklist).
CREATE OR REPLACE FUNCTION public.small_assets_held(p_employee_id uuid) RETURNS TABLE
  (asset_id uuid, tag_number text, name text, serial_number text, value numeric, issued_at timestamptz, due_back date, overdue boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.id, a.tag_number, a.name, a.serial_number, a.value, i.issued_at, i.due_back, i.due_back IS NOT NULL AND i.due_back < CURRENT_DATE
    FROM small_asset_issues i JOIN small_assets a ON a.id = i.asset_id
   WHERE i.employee_id = p_employee_id AND i.status = 'out' AND (_sa_can('view', i.site_id) OR _has_permission('hr.view', i.site_id))
   ORDER BY i.issued_at;
$$;

-- Exit clearance waits for everything to come back.
CREATE OR REPLACE FUNCTION public.trg_exit_small_assets() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _list text;
BEGIN
  IF (NEW.clearance_completed IS TRUE AND COALESCE(OLD.clearance_completed, false) IS FALSE)
     OR (NEW.status IN ('completed','cleared','closed') AND COALESCE(OLD.status, '') NOT IN ('completed','cleared','closed')) THEN
    SELECT string_agg(a.tag_number || ' ' || a.name, ', ') INTO _list
      FROM small_asset_issues i JOIN small_assets a ON a.id = i.asset_id WHERE i.employee_id = NEW.employee_id AND i.status = 'out';
    IF _list IS NOT NULL THEN
      RAISE EXCEPTION 'Clearance blocked — still holding: %. Take the items back (or mark them lost) first.', _list;
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_exit_small_assets ON exit_records;
CREATE TRIGGER trg_exit_small_assets BEFORE UPDATE ON exit_records FOR EACH ROW EXECUTE FUNCTION trg_exit_small_assets();

CREATE OR REPLACE FUNCTION public.small_asset_overdue_notify() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r RECORD; _n int := 0;
BEGIN
  FOR _r IN SELECT i.id, i.site_id, a.tag_number, a.name, e.name AS who, i.due_back
              FROM small_asset_issues i JOIN small_assets a ON a.id = i.asset_id JOIN employees e ON e.id = i.employee_id
             WHERE i.status = 'out' AND i.due_back < CURRENT_DATE AND i.overdue_notified IS DISTINCT FROM i.due_back LOOP
    PERFORM _notify_permission(_r.site_id, 'fleet.edit', 'small_asset_overdue', 'Not returned: ' || _r.tag_number || ' ' || _r.name,
      _r.who || ' — was due back ' || to_char(_r.due_back, 'DD Mon YYYY'), '/fleet/fleet_small_assets', 'reminder');
    UPDATE small_asset_issues SET overdue_notified = _r.due_back WHERE id = _r.id;
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END $$;
REVOKE EXECUTE ON FUNCTION public.small_asset_overdue_notify() FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  PERFORM cron.unschedule('small-asset-overdue') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'small-asset-overdue');
  PERFORM cron.schedule('small-asset-overdue', '15 5 * * *', 'SELECT public.small_asset_overdue_notify()');
EXCEPTION WHEN undefined_table OR invalid_schema_name THEN NULL;
END $$;

-- ── Ask Bravura ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ai_small_assets(p_site_ids uuid[], p_query text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _sites uuid[] := (SELECT array_agg(s) FROM unnest(COALESCE(NULLIF(p_site_ids, '{}'), (SELECT array_agg(id) FROM sites))) s
                           WHERE _sa_can('view', s) OR _has_permission('hr.view', s));
        _q text := NULLIF(trim(COALESCE(p_query, '')), '');
BEGIN
  IF _sites IS NULL THEN RETURN jsonb_build_object('error', 'You cannot see small assets'); END IF;
  RETURN jsonb_build_object(
    'matching_items', (SELECT COALESCE(jsonb_agg(jsonb_build_object('tag', a.tag_number, 'name', a.name, 'serial', a.serial_number, 'status', a.status,
          'condition', a.condition, 'holder', e.name, 'since', i.issued_at::date, 'due_back', i.due_back, 'site', s.name)), '[]')
        FROM small_assets a JOIN sites s ON s.id = a.site_id LEFT JOIN small_asset_issues i ON i.asset_id = a.id AND i.status = 'out'
        LEFT JOIN employees e ON e.id = i.employee_id
       WHERE a.site_id = ANY (_sites) AND NOT a.is_archived AND _q IS NOT NULL
         AND (a.tag_number ILIKE '%' || _q || '%' OR a.name ILIKE '%' || _q || '%' OR a.serial_number ILIKE '%' || _q || '%')),
    'held_by_person', (SELECT COALESCE(jsonb_agg(jsonb_build_object('person', e.name, 'employee_number', e.employee_number, 'tag', a.tag_number,
          'name', a.name, 'since', i.issued_at::date, 'due_back', i.due_back)), '[]')
        FROM small_asset_issues i JOIN small_assets a ON a.id = i.asset_id JOIN employees e ON e.id = i.employee_id
       WHERE i.site_id = ANY (_sites) AND i.status = 'out' AND _q IS NOT NULL AND (e.name ILIKE '%' || _q || '%' OR e.employee_number ILIKE _q)),
    'overdue', (SELECT COALESCE(jsonb_agg(jsonb_build_object('tag', a.tag_number, 'name', a.name, 'person', e.name, 'due_back', i.due_back)), '[]')
        FROM small_asset_issues i JOIN small_assets a ON a.id = i.asset_id JOIN employees e ON e.id = i.employee_id
       WHERE i.site_id = ANY (_sites) AND i.status = 'out' AND i.due_back < CURRENT_DATE),
    'totals', (SELECT jsonb_build_object('items', count(*), 'issued', count(*) FILTER (WHERE status = 'issued'), 'in_store', count(*) FILTER (WHERE status = 'in_store'),
          'lost', count(*) FILTER (WHERE status = 'lost'), 'value', round(sum(value), 2)) FROM small_assets WHERE site_id = ANY (_sites) AND NOT is_archived));
END $$;

CREATE OR REPLACE FUNCTION public.ai_fleet_costs(p_site_ids uuid[], p_from date DEFAULT NULL, p_to date DEFAULT NULL, p_machine text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _sites uuid[] := _ai_sites_for('fleet.view', p_site_ids); _from date := COALESCE(p_from, CURRENT_DATE - 29); _to date := COALESCE(p_to, CURRENT_DATE);
BEGIN
  IF _sites IS NULL THEN RETURN jsonb_build_object('error', 'You cannot see fleet costs'); END IF;
  RETURN jsonb_build_object('from', _from, 'to', _to, 'note', 'Running cost = fuel + Stores parts + workshop bills. Hours/km from meter readings in the period. tco = purchase + lifetime running − book value.',
    'machines', (SELECT COALESCE(jsonb_agg(to_jsonb(c) || jsonb_build_object('site', s.name) ORDER BY c.running_cost DESC), '[]')
      FROM unnest(_sites) sid JOIN sites s ON s.id = sid, LATERAL fleet_machine_costs(sid, _from, _to) c
     WHERE p_machine IS NULL OR c.machine ILIKE '%' || p_machine || '%'));
END $$;

CREATE OR REPLACE FUNCTION public._ai_find_machine(p_site uuid, p_text text) RETURNS fleet_assets
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM fleet_assets WHERE site_id = p_site AND NOT COALESCE(is_archived, false) AND COALESCE(trim(p_text), '') <> ''
     AND (fleet_number ILIKE trim(p_text) OR asset_number ILIKE trim(p_text) OR registration ILIKE trim(p_text)
          OR description ILIKE '%' || trim(p_text) || '%' OR fleet_number ILIKE '%' || trim(p_text) || '%' OR asset_number ILIKE '%' || trim(p_text) || '%')
   ORDER BY (fleet_number ILIKE trim(p_text) OR asset_number ILIKE trim(p_text) OR registration ILIKE trim(p_text)) DESC, length(COALESCE(description, '')) LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.ai_prepare_small_asset(p_site_ids uuid[], p_action text, p_item text, p_person text DEFAULT NULL,
  p_due_back date DEFAULT NULL, p_condition text DEFAULT NULL, p_notes text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _site uuid := p_site_ids[1]; _a small_assets%ROWTYPE; _e RECORD; _holder text;
BEGIN
  IF _site IS NULL THEN RETURN jsonb_build_object('error', 'Say which site'); END IF;
  IF NOT (_sa_can('create', _site) OR _sa_can('edit', _site)) THEN RETURN jsonb_build_object('error', 'You cannot issue or take back small assets here'); END IF;
  SELECT * INTO _a FROM small_assets WHERE site_id = _site AND NOT is_archived
     AND (tag_number ILIKE trim(p_item) OR serial_number ILIKE trim(p_item) OR name ILIKE '%' || trim(p_item) || '%')
   ORDER BY (tag_number ILIKE trim(p_item)) DESC, (status = CASE WHEN p_action = 'return' THEN 'issued' ELSE 'in_store' END) DESC LIMIT 1;
  IF _a.id IS NULL THEN RETURN jsonb_build_object('error', 'No small asset matching "' || COALESCE(p_item, '') || '"'); END IF;
  IF p_action = 'return' THEN
    IF _a.status <> 'issued' THEN RETURN jsonb_build_object('error', _a.tag_number || ' is not out with anyone'); END IF;
    SELECT e.name INTO _holder FROM small_asset_issues i JOIN employees e ON e.id = i.employee_id WHERE i.asset_id = _a.id AND i.status = 'out';
    RETURN jsonb_build_object('site_id', _site, 'asset_id', _a.id, 'item', _a.tag_number || ' ' || _a.name, 'from', _holder,
      'condition', COALESCE(NULLIF(p_condition, ''), 'good'), 'notes', NULLIF(trim(p_notes), ''));
  END IF;
  IF _a.status <> 'in_store' THEN RETURN jsonb_build_object('error', _a.tag_number || ' is ' || replace(_a.status, '_', ' ')); END IF;
  SELECT id, name, employee_number INTO _e FROM employees WHERE site_id = _site AND status = 'active'
     AND (name ILIKE '%' || trim(COALESCE(p_person, '')) || '%' OR employee_number ILIKE trim(COALESCE(p_person, ''))) AND COALESCE(trim(p_person), '') <> ''
   ORDER BY length(name) LIMIT 1;
  IF _e.id IS NULL THEN RETURN jsonb_build_object('error', 'No active employee matching "' || COALESCE(p_person, '') || '"'); END IF;
  -- Through Ask Bravura the person confirming (store / fleet clerk) vouches for the hand-over; the holder's name is recorded as signed.
  RETURN jsonb_build_object('site_id', _site, 'asset_id', _a.id, 'item', _a.tag_number || ' ' || _a.name, 'employee_id', _e.id, 'to', _e.name,
    'signed_name', _e.name || ' (hand-over confirmed in Ask Bravura)', 'due_back', p_due_back, 'notes', NULLIF(trim(p_notes), ''));
END $$;

CREATE OR REPLACE FUNCTION public.ai_prepare_fleet_job(p_site_ids uuid[], p_machine text, p_fault text, p_priority text DEFAULT 'medium') RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _site uuid := p_site_ids[1]; _m fleet_assets%ROWTYPE;
BEGIN
  IF _site IS NULL OR NOT (_has_permission('fleet.create', _site) OR _has_permission('fleet.edit', _site)) THEN RETURN jsonb_build_object('error', 'You cannot open jobs here'); END IF;
  _m := _ai_find_machine(_site, p_machine);
  IF _m.id IS NULL THEN RETURN jsonb_build_object('error', 'No machine matching "' || COALESCE(p_machine, '') || '"'); END IF;
  IF COALESCE(trim(p_fault), '') = '' THEN RETURN jsonb_build_object('error', 'Say what is wrong'); END IF;
  RETURN jsonb_build_object('site_id', _site, 'asset_id', _m.id, 'machine', COALESCE(_m.fleet_number, _m.asset_number) || COALESCE(' ' || _m.description, ''),
    'fault', trim(p_fault), 'priority', CASE WHEN p_priority IN ('low','medium','high','critical') THEN p_priority ELSE 'medium' END);
END $$;

CREATE OR REPLACE FUNCTION public.ai_prepare_fleet_meter(p_site_ids uuid[], p_machine text, p_km numeric DEFAULT NULL, p_hours numeric DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _site uuid := p_site_ids[1]; _m fleet_assets%ROWTYPE;
BEGIN
  IF _site IS NULL OR NOT (_has_permission('fleet.create', _site) OR _has_permission('fleet.edit', _site)) THEN RETURN jsonb_build_object('error', 'You cannot record readings here'); END IF;
  _m := _ai_find_machine(_site, p_machine);
  IF _m.id IS NULL THEN RETURN jsonb_build_object('error', 'No machine matching "' || COALESCE(p_machine, '') || '"'); END IF;
  IF p_km IS NULL AND p_hours IS NULL THEN RETURN jsonb_build_object('error', 'Give the km or the hour meter reading'); END IF;
  RETURN jsonb_build_object('site_id', _site, 'asset_id', _m.id, 'machine', COALESCE(_m.fleet_number, _m.asset_number) || COALESCE(' ' || _m.description, ''),
    'km', p_km, 'hours', p_hours, 'last_km', _m.current_odometer_km, 'last_hours', _m.current_hours,
    'warning', CASE WHEN p_km < _m.current_odometer_km OR p_hours < _m.current_hours THEN 'Lower than the last reading — it will be flagged' END);
END $$;

-- Confirm the new proposal kinds (patch ai_action_confirm in place).
DO $$ DECLARE d text; BEGIN
  d := pg_get_functiondef('ai_action_confirm(uuid)'::regprocedure);
  IF position('small_asset_issue' in d) = 0 THEN
    d := replace(d, $x$  END IF;
  _res := _res || jsonb_build_object('site_id', _a.site_id);$x$, $x$  ELSIF _a.kind = 'small_asset_issue' THEN
    _id := small_asset_issue((_p->>'asset_id')::uuid, (_p->>'employee_id')::uuid, _p->>'signed_name', NULLIF(_p->>'due_back', '')::date, _p->>'notes');
    _res := jsonb_build_object('message', (_p->>'item') || ' issued to ' || (_p->>'to'), 'path', '/fleet/fleet_small_assets');
  ELSIF _a.kind = 'small_asset_return' THEN
    PERFORM small_asset_return((_p->>'asset_id')::uuid, _p->>'condition', _p->>'notes', false);
    _res := jsonb_build_object('message', (_p->>'item') || ' back from ' || COALESCE(_p->>'from', 'the holder') || ' (' || (_p->>'condition') || ')', 'path', '/fleet/fleet_small_assets');
  ELSIF _a.kind = 'fleet_job' THEN
    INSERT INTO fleet_work_orders (site_id, asset_id, fault_description, priority, status, requested_by, notes, created_by)
    VALUES ((_p->>'site_id')::uuid, (_p->>'asset_id')::uuid, _p->>'fault', _p->>'priority', 'scheduled', auth.uid(), 'Opened via Ask Bravura', auth.uid())
    RETURNING id INTO _id;
    _res := jsonb_build_object('message', 'Job ' || (SELECT work_order_number FROM fleet_work_orders WHERE id = _id) || ' opened for ' || (_p->>'machine'),
      'path', '/fleet/fleet_maintenance', 'record_table', 'fleet_work_orders', 'record_id', _id);
  ELSIF _a.kind = 'fleet_meter' THEN
    IF NULLIF(_p->>'km', '') IS NOT NULL THEN
      INSERT INTO fleet_meter_readings (site_id, asset_id, reading_type, reading_value, reading_date, source, recorded_by, is_flagged, flag_reason)
      SELECT fa.site_id, fa.id, 'odometer', (_p->>'km')::numeric, CURRENT_DATE, 'ask', auth.uid(), (_p->>'km')::numeric < COALESCE(fa.current_odometer_km, 0),
             CASE WHEN (_p->>'km')::numeric < COALESCE(fa.current_odometer_km, 0) THEN 'Lower than the last reading' END FROM fleet_assets fa WHERE fa.id = (_p->>'asset_id')::uuid;
      UPDATE fleet_assets SET current_odometer_km = (_p->>'km')::numeric WHERE id = (_p->>'asset_id')::uuid AND (_p->>'km')::numeric >= COALESCE(current_odometer_km, 0);
    END IF;
    IF NULLIF(_p->>'hours', '') IS NOT NULL THEN
      INSERT INTO fleet_meter_readings (site_id, asset_id, reading_type, reading_value, reading_date, source, recorded_by, is_flagged, flag_reason)
      SELECT fa.site_id, fa.id, 'hours', (_p->>'hours')::numeric, CURRENT_DATE, 'ask', auth.uid(), (_p->>'hours')::numeric < COALESCE(fa.current_hours, 0),
             CASE WHEN (_p->>'hours')::numeric < COALESCE(fa.current_hours, 0) THEN 'Lower than the last reading' END FROM fleet_assets fa WHERE fa.id = (_p->>'asset_id')::uuid;
      UPDATE fleet_assets SET current_hours = (_p->>'hours')::numeric WHERE id = (_p->>'asset_id')::uuid AND (_p->>'hours')::numeric >= COALESCE(current_hours, 0);
    END IF;
    _res := jsonb_build_object('message', 'Reading saved for ' || (_p->>'machine'), 'path', '/fleet/fleet_meter_readings');
  END IF;
  _res := _res || jsonb_build_object('site_id', _a.site_id);$x$);
    IF position('small_asset_issue' in d) = 0 THEN RAISE EXCEPTION 'ai_action_confirm patch point not found'; END IF;
    EXECUTE d;
  END IF;
END $$;

-- Fleet alerts for the daily brief / cron.
CREATE OR REPLACE FUNCTION public._ai_alerts_fleet(p_sites uuid[]) RETURNS TABLE
  (key text, site_id uuid, kind text, perm text, severity text, title text, detail text, link text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT 'fleetdown:' || fa.id || ':' || h.since::date, fa.site_id, 'machine_down', 'fleet.view', 'warning',
         'Down ' || (CURRENT_DATE - h.since::date) || ' days: ' || COALESCE(fa.fleet_number, fa.asset_number) || COALESCE(' ' || fa.description, ''),
         replace(fa.status, '_', ' ') || ' since ' || to_char(h.since, 'DD Mon'), '/fleet/fleet_maintenance'
    FROM fleet_assets fa
    JOIN LATERAL (SELECT max(created_at) AS since FROM fleet_status_history x WHERE x.asset_id = fa.id AND x.new_status = fa.status) h ON true
   WHERE fa.site_id = ANY (p_sites) AND fa.status IN ('maintenance','grounded','awaiting_parts') AND h.since < now() - interval '2 days'
  UNION ALL
  SELECT 'pmover:' || d.asset_id || ':' || d.plan_id || ':' || to_char(CURRENT_DATE, 'IYYY-IW'), s, 'service_overdue', 'fleet.view', 'warning',
         'Service overdue: ' || d.asset_label, d.plan_name || ' — ' || d.pct_used || '% of interval used', '/fleet/fleet_preventive'
    FROM unnest(p_sites) s, LATERAL _fleet_pm_due_core(s) d WHERE d.state = 'overdue' AND d.open_wo_id IS NULL
  UNION ALL
  SELECT 'papers:' || fa.id || ':' || v.k || ':' || v.d, fa.site_id, 'papers_expiring', 'fleet.view', CASE WHEN v.d < CURRENT_DATE THEN 'critical' ELSE 'warning' END,
         initcap(v.k) || CASE WHEN v.d < CURRENT_DATE THEN ' expired: ' ELSE ' expires: ' END || COALESCE(fa.fleet_number, fa.asset_number),
         to_char(v.d, 'DD Mon YYYY'), '/fleet/fleet_compliance'
    FROM fleet_assets fa, LATERAL (VALUES ('licence', fa.licence_expiry), ('insurance', fa.insurance_expiry), ('roadworthy', fa.roadworthy_expiry)) v(k, d)
   WHERE fa.site_id = ANY (p_sites) AND NOT COALESCE(fa.is_archived, false) AND fa.status <> 'decommissioned' AND v.d <= CURRENT_DATE + 14
  UNION ALL
  SELECT 'saover:' || i.id, i.site_id, 'small_asset_overdue', 'fleet.view', 'warning',
         'Not returned: ' || a.tag_number || ' ' || a.name, e.name || ' — due ' || to_char(i.due_back, 'DD Mon'), '/fleet/fleet_small_assets'
    FROM small_asset_issues i JOIN small_assets a ON a.id = i.asset_id JOIN employees e ON e.id = i.employee_id
   WHERE i.site_id = ANY (p_sites) AND i.status = 'out' AND i.due_back < CURRENT_DATE;
$$;

CREATE OR REPLACE FUNCTION public._ai_alerts_core(p_sites uuid[]) RETURNS TABLE
  (key text, site_id uuid, kind text, perm text, severity text, title text, detail text, link text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM _ai_alerts_base(p_sites) UNION ALL SELECT * FROM _ai_alerts_stock(p_sites) UNION ALL SELECT * FROM _ai_alerts_fleet(p_sites);
$$;

GRANT EXECUTE ON FUNCTION public.small_asset_save(jsonb), public.small_asset_issue(uuid, uuid, text, date, text), public.small_asset_return(uuid, text, text, boolean),
  public.small_asset_count(uuid, boolean, text, text), public.small_assets_list(uuid), public.small_asset_history(uuid), public.small_assets_held(uuid),
  public.ai_small_assets(uuid[], text), public.ai_fleet_costs(uuid[], date, date, text), public.ai_prepare_small_asset(uuid[], text, text, text, date, text, text),
  public.ai_prepare_fleet_job(uuid[], text, text, text), public.ai_prepare_fleet_meter(uuid[], text, numeric, numeric) TO authenticated;

INSERT INTO schema_migrations (filename) VALUES ('0244_fleet_a6_small_assets.sql') ON CONFLICT DO NOTHING;
