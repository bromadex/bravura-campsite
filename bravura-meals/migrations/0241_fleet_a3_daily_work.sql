-- 0241 — Fleet A3 (#64): daily work.
--  • Pre-start checks: fleet_prestart_template(asset) (site/type template, else a default list per type category),
--    fleet_prestart_submit(p) — idempotent by client_ref so a phone can queue offline and resend.
--    Readings go to fleet_meter_readings (source 'prestart', same backwards/jump flags as fuel fills).
--  • A failed item raises a defect (fleet_defects); any failure raises one draft work order for the machine.
--    A failed critical item grounds the machine when fleet_settings.auto_ground_on_fail.
--  • Work order = the job; fleet_wo_complete writes the maintenance record (completion) with parts from Stores
--    issues to the WO, workshop bills from POs linked to the WO, and labour. Defects close; the machine goes back
--    to operational when no other job is open.
--  • Downtime clock: WO in progress → machine 'maintenance', waiting for parts → 'awaiting_parts' (status history
--    already drives fleet_downtime).

ALTER TABLE fleet_inspections ADD COLUMN IF NOT EXISTS client_ref text;
ALTER TABLE fleet_inspections ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'inspection';
CREATE UNIQUE INDEX IF NOT EXISTS fleet_inspections_client_ref_uq ON fleet_inspections (client_ref) WHERE client_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS fleet_defects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES sites(id),
  asset_id uuid NOT NULL REFERENCES fleet_assets(id),
  inspection_id uuid REFERENCES fleet_inspections(id),
  work_order_id uuid REFERENCES fleet_work_orders(id),
  item_label text NOT NULL,
  category text,
  critical boolean NOT NULL DEFAULT false,
  notes text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_work','fixed','deferred','not_a_fault')),
  reported_by uuid DEFAULT auth.uid(),
  reported_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  is_archived boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS fleet_defects_asset_idx ON fleet_defects (asset_id, status);
ALTER TABLE fleet_defects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fleet_defects_read ON fleet_defects;
CREATE POLICY fleet_defects_read ON fleet_defects FOR SELECT TO authenticated USING (_has_permission('fleet.view', site_id));
DROP POLICY IF EXISTS fleet_defects_update ON fleet_defects;
CREATE POLICY fleet_defects_update ON fleet_defects FOR UPDATE TO authenticated USING (_has_permission('fleet.edit', site_id));
-- Inserts only through fleet_prestart_submit.

CREATE OR REPLACE FUNCTION public.fleet_prestart_template(p_asset_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _a RECORD; _t fleet_inspection_templates%ROWTYPE;
BEGIN
  SELECT fa.*, t.category INTO _a FROM fleet_assets fa LEFT JOIN fleet_asset_types t ON t.id = fa.asset_type_id WHERE fa.id = p_asset_id;
  IF NOT FOUND OR NOT _has_permission('fleet.view', _a.site_id) THEN RETURN NULL; END IF;
  SELECT * INTO _t FROM fleet_inspection_templates
   WHERE is_active AND (asset_type_id = _a.asset_type_id OR asset_type_id IS NULL) AND (site_id = _a.site_id OR site_id IS NULL)
   ORDER BY (asset_type_id IS NOT NULL) DESC, (site_id IS NOT NULL) DESC, created_at DESC LIMIT 1;
  IF FOUND AND jsonb_array_length(COALESCE(_t.items, '[]')) > 0 THEN
    RETURN jsonb_build_object('template_id', _t.id, 'name', _t.name, 'items', _t.items, 'category', _a.category);
  END IF;
  RETURN jsonb_build_object('template_id', NULL, 'name', 'Standard pre-start', 'category', _a.category, 'items',
    CASE _a.category
      WHEN 'generator' THEN '[{"label":"Engine oil level","category":"Engine","critical":true},{"label":"Coolant level","category":"Engine","critical":true},
        {"label":"Fuel level and no leaks","category":"Fuel","critical":true},{"label":"Battery and terminals","category":"Electrical","critical":false},
        {"label":"Earth connection","category":"Electrical","critical":true},{"label":"Guards and covers in place","category":"Safety","critical":true},
        {"label":"Fire extinguisher","category":"Safety","critical":true},{"label":"No oil or water leaks","category":"Engine","critical":false},
        {"label":"Control panel alarms clear","category":"Electrical","critical":false}]'::jsonb
      WHEN 'heavy_equipment' THEN '[{"label":"Engine oil level","category":"Engine","critical":true},{"label":"Coolant level","category":"Engine","critical":true},
        {"label":"Hydraulic oil level and hoses","category":"Hydraulics","critical":true},{"label":"Brakes (service and park)","category":"Brakes","critical":true},
        {"label":"Steering","category":"Controls","critical":true},{"label":"Tyres / tracks and undercarriage","category":"Running gear","critical":false},
        {"label":"Bucket, teeth and pins","category":"Attachments","critical":false},{"label":"Lights and beacon","category":"Electrical","critical":false},
        {"label":"Reverse alarm and horn","category":"Safety","critical":true},{"label":"Seat belt","category":"Safety","critical":true},
        {"label":"ROPS / cab, mirrors and glass","category":"Safety","critical":true},{"label":"Fire extinguisher","category":"Safety","critical":true},
        {"label":"No leaks under the machine","category":"Engine","critical":false}]'::jsonb
      ELSE '[{"label":"Engine oil level","category":"Engine","critical":true},{"label":"Coolant level","category":"Engine","critical":true},
        {"label":"Brakes (foot and hand)","category":"Brakes","critical":true},{"label":"Steering","category":"Controls","critical":true},
        {"label":"Tyres and wheel nuts","category":"Tyres","critical":true},{"label":"Lights, indicators and hazards","category":"Electrical","critical":false},
        {"label":"Horn and reverse alarm","category":"Safety","critical":false},{"label":"Seat belts","category":"Safety","critical":true},
        {"label":"Mirrors, windscreen and wipers","category":"Body","critical":false},{"label":"Fire extinguisher and first aid kit","category":"Safety","critical":true},
        {"label":"No leaks under the vehicle","category":"Engine","critical":false},{"label":"Load secured / tailgate","category":"Body","critical":false}]'::jsonb
    END);
END $$;

-- p: {client_ref, asset_id, template_id, operator_id, inspection_date, odometer_km, hours, notes,
--     items:[{label, category, critical, result:'pass'|'fail'|'na', notes}]}
CREATE OR REPLACE FUNCTION public.fleet_prestart_submit(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _a fleet_assets%ROWTYPE; _ins uuid; _i jsonb; _fails int := 0; _crit int := 0; _wo uuid; _won text; _set fleet_settings%ROWTYPE;
        _km numeric := NULLIF(p->>'odometer_km', '')::numeric; _hr numeric := NULLIF(p->>'hours', '')::numeric;
        _date date := COALESCE(NULLIF(p->>'inspection_date', '')::date, CURRENT_DATE); _list text := '';
BEGIN
  IF NULLIF(p->>'client_ref', '') IS NOT NULL THEN
    SELECT id INTO _ins FROM fleet_inspections WHERE client_ref = p->>'client_ref';
    IF FOUND THEN RETURN jsonb_build_object('inspection_id', _ins, 'duplicate', true); END IF;
  END IF;
  SELECT * INTO _a FROM fleet_assets WHERE id = (p->>'asset_id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Choose the machine'; END IF;
  IF NOT (_has_permission('fleet.create', _a.site_id) OR _has_permission('fleet.edit', _a.site_id)) THEN
    RAISE EXCEPTION 'You do not have permission to record checks at this site';
  END IF;
  IF jsonb_array_length(COALESCE(p->'items', '[]')) = 0 THEN RAISE EXCEPTION 'Tick the checklist first'; END IF;
  SELECT * INTO _set FROM fleet_settings WHERE site_id = _a.site_id;

  FOR _i IN SELECT * FROM jsonb_array_elements(p->'items') LOOP
    IF _i->>'result' = 'fail' THEN
      _fails := _fails + 1;
      IF COALESCE((_i->>'critical')::boolean, false) THEN _crit := _crit + 1; END IF;
      _list := _list || CASE WHEN _list = '' THEN '' ELSE '; ' END || (_i->>'label') || COALESCE(' — ' || NULLIF(_i->>'notes', ''), '');
    END IF;
  END LOOP;

  INSERT INTO fleet_inspections (site_id, asset_id, template_id, operator_id, inspection_date, odometer_reading, hours_reading,
                                 overall_result, notes, created_by, client_ref, kind)
  VALUES (_a.site_id, _a.id, NULLIF(p->>'template_id', '')::uuid, NULLIF(p->>'operator_id', '')::uuid, _date, _km, _hr,
          CASE WHEN _crit > 0 THEN 'fail' WHEN _fails > 0 THEN 'conditional' ELSE 'pass' END,
          NULLIF(p->>'notes', ''), auth.uid(), NULLIF(p->>'client_ref', ''), 'prestart')
  RETURNING id INTO _ins;

  INSERT INTO fleet_inspection_items (inspection_id, item_label, category, result, notes)
  SELECT _ins, x->>'label', x->>'category', COALESCE(x->>'result', 'na'), NULLIF(x->>'notes', '')
    FROM jsonb_array_elements(p->'items') x;

  -- Meter readings (flag backwards / big jumps like fuel fills do).
  IF _km IS NOT NULL THEN
    INSERT INTO fleet_meter_readings (site_id, asset_id, reading_type, reading_value, reading_date, source, recorded_by, is_flagged, flag_reason)
    VALUES (_a.site_id, _a.id, 'odometer', _km, _date, 'prestart', auth.uid(),
            _km < COALESCE(_a.current_odometer_km, 0) OR _km - COALESCE(_a.current_odometer_km, _km) > COALESCE(_set.max_km_jump, 5000),
            CASE WHEN _km < COALESCE(_a.current_odometer_km, 0) THEN 'Lower than the last reading'
                 WHEN _km - COALESCE(_a.current_odometer_km, _km) > COALESCE(_set.max_km_jump, 5000) THEN 'Jump bigger than allowed' END);
    UPDATE fleet_assets SET current_odometer_km = _km WHERE id = _a.id
       AND _km >= COALESCE(current_odometer_km, 0) AND _km - COALESCE(current_odometer_km, _km) <= COALESCE(_set.max_km_jump, 5000);
  END IF;
  IF _hr IS NOT NULL THEN
    INSERT INTO fleet_meter_readings (site_id, asset_id, reading_type, reading_value, reading_date, source, recorded_by, is_flagged, flag_reason)
    VALUES (_a.site_id, _a.id, 'hours', _hr, _date, 'prestart', auth.uid(),
            _hr < COALESCE(_a.current_hours, 0) OR _hr - COALESCE(_a.current_hours, _hr) > COALESCE(_set.max_hours_jump, 300),
            CASE WHEN _hr < COALESCE(_a.current_hours, 0) THEN 'Lower than the last reading'
                 WHEN _hr - COALESCE(_a.current_hours, _hr) > COALESCE(_set.max_hours_jump, 300) THEN 'Jump bigger than allowed' END);
    UPDATE fleet_assets SET current_hours = _hr WHERE id = _a.id
       AND _hr >= COALESCE(current_hours, 0) AND _hr - COALESCE(current_hours, _hr) <= COALESCE(_set.max_hours_jump, 300);
  END IF;

  IF _fails > 0 THEN
    -- One open job per machine collects pre-start defects.
    SELECT id, work_order_number INTO _wo, _won FROM fleet_work_orders
     WHERE asset_id = _a.id AND COALESCE(status, '') NOT IN ('completed','cancelled','closed') AND pm_plan_id IS NULL
     ORDER BY created_at DESC LIMIT 1;
    IF _wo IS NULL THEN
      INSERT INTO fleet_work_orders (site_id, asset_id, fault_description, priority, status, requested_by, notes, created_by)
      VALUES (_a.site_id, _a.id, 'Pre-start defects: ' || _list, CASE WHEN _crit > 0 THEN 'critical' ELSE 'medium' END,
              'scheduled', auth.uid(), 'Raised from pre-start check', auth.uid())
      RETURNING id, work_order_number INTO _wo, _won;
    ELSE
      UPDATE fleet_work_orders SET fault_description = fault_description || E'\n' || 'Pre-start ' || _date || ': ' || _list,
             priority = CASE WHEN _crit > 0 THEN 'critical' ELSE priority END WHERE id = _wo;
    END IF;
    INSERT INTO fleet_defects (site_id, asset_id, inspection_id, work_order_id, item_label, category, critical, notes)
    SELECT _a.site_id, _a.id, _ins, _wo, x->>'label', x->>'category', COALESCE((x->>'critical')::boolean, false), NULLIF(x->>'notes', '')
      FROM jsonb_array_elements(p->'items') x WHERE x->>'result' = 'fail';
    IF _crit > 0 AND COALESCE(_set.auto_ground_on_fail, true) AND _a.status = 'operational' THEN
      UPDATE fleet_assets SET status = 'grounded' WHERE id = _a.id;
    END IF;
    PERFORM _notify_permission(_a.site_id, 'fleet.edit', 'fleet_defect',
      'Pre-start defect: ' || COALESCE(_a.fleet_number, _a.asset_number, _a.registration),
      _fails || ' item(s) failed' || CASE WHEN _crit > 0 THEN ' — machine grounded' ELSE '' END || '. Job ' || COALESCE(_won, ''),
      '/fleet/fleet_maintenance', 'general');
  END IF;

  RETURN jsonb_build_object('inspection_id', _ins, 'fails', _fails, 'critical', _crit, 'work_order_id', _wo, 'work_order_number', _won,
                            'grounded', _crit > 0 AND COALESCE(_set.auto_ground_on_fail, true));
END $$;

-- What a job has cost so far.
CREATE OR REPLACE FUNCTION public.fleet_wo_costs(p_wo_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'parts', COALESCE((SELECT sum(CASE WHEN m.movement_type = 'return' THEN -1 ELSE 1 END * abs(COALESCE(m.value, m.quantity * m.unit_cost, 0)))
                FROM inventory_movements m WHERE m.source_reference_id = w.id AND m.movement_type IN ('issue','return')), 0),
    'parts_lines', COALESCE((SELECT jsonb_agg(jsonb_build_object('item', i.description, 'code', i.item_code, 'qty',
                CASE WHEN m.movement_type = 'return' THEN -abs(m.quantity) ELSE abs(m.quantity) END, 'value', abs(COALESCE(m.value, m.quantity * m.unit_cost, 0)), 'voucher', m.voucher_no))
                FROM inventory_movements m JOIN items i ON i.id = m.item_id WHERE m.source_reference_id = w.id AND m.movement_type IN ('issue','return')), '[]'),
    'bills', COALESCE((SELECT sum(pi.total_amount) FROM purchase_invoices pi JOIN purchase_orders po ON po.id = pi.po_id
                WHERE po.work_order_id = w.id AND pi.status NOT IN ('cancelled','void','rejected')), 0),
    'bill_lines', COALESCE((SELECT jsonb_agg(jsonb_build_object('invoice', pi.invoice_number, 'po', po.po_number, 'amount', pi.total_amount, 'status', pi.status))
                FROM purchase_invoices pi JOIN purchase_orders po ON po.id = pi.po_id
                WHERE po.work_order_id = w.id AND pi.status NOT IN ('cancelled','void','rejected')), '[]'),
    'committed', COALESCE((SELECT sum(po.total_amount) FROM purchase_orders po WHERE po.work_order_id = w.id AND po.status NOT IN ('cancelled','rfq','rfq_sent')), 0))
  FROM fleet_work_orders w WHERE w.id = p_wo_id AND _has_permission('fleet.view', w.site_id);
$$;

-- p: {findings, labour_hours, labour_rate, other_cost, completion_date, maintenance_type}
CREATE OR REPLACE FUNCTION public.fleet_wo_complete(p_wo_id uuid, p jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _w fleet_work_orders%ROWTYPE; _c jsonb; _mid uuid; _lab numeric; _total numeric; _date date := COALESCE(NULLIF(p->>'completion_date', '')::date, CURRENT_DATE);
        _down numeric;
BEGIN
  SELECT * INTO _w FROM fleet_work_orders WHERE id = p_wo_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Job not found'; END IF;
  IF NOT _has_permission('fleet.edit', _w.site_id) THEN RAISE EXCEPTION 'You do not have permission to close jobs'; END IF;
  IF _w.status IN ('completed','cancelled') THEN RAISE EXCEPTION 'This job is already %', _w.status; END IF;
  _c := fleet_wo_costs(p_wo_id);
  _lab := COALESCE(NULLIF(p->>'labour_hours', '')::numeric, 0) * COALESCE(NULLIF(p->>'labour_rate', '')::numeric, 0);
  _total := (_c->>'parts')::numeric + (_c->>'bills')::numeric + _lab + COALESCE(NULLIF(p->>'other_cost', '')::numeric, 0);
  -- Hours the machine was down while this job was open (status history since the job was raised).
  SELECT round(EXTRACT(epoch FROM (now() - min(h.created_at))) / 3600, 1) INTO _down
    FROM fleet_status_history h WHERE h.asset_id = _w.asset_id AND h.created_at >= _w.created_at AND h.new_status IN ('maintenance','grounded','awaiting_parts');

  IF _w.asset_id IS NOT NULL THEN
    INSERT INTO fleet_maintenance (site_id, asset_id, work_order_id, maintenance_type, description, technician, estimated_cost, actual_cost,
                                   labour_hours, downtime_hours, service_date, completion_date, notes, created_by, project_id,
                                   odometer_at_service, hours_at_service)
    SELECT _w.site_id, _w.asset_id, _w.id, COALESCE(NULLIF(p->>'maintenance_type', ''), CASE WHEN _w.pm_plan_id IS NOT NULL THEN 'preventive' ELSE 'corrective' END),
           COALESCE(NULLIF(p->>'findings', ''), _w.fault_description), _w.assigned_technician, _w.cost_est, NULLIF(_total, 0),
           NULLIF(p->>'labour_hours', '')::numeric, _down, _w.created_at::date, _date, NULLIF(p->>'notes', ''), auth.uid(), _w.project_id,
           fa.current_odometer_km, fa.current_hours
      FROM fleet_assets fa WHERE fa.id = _w.asset_id
    RETURNING id INTO _mid;
    INSERT INTO fleet_maintenance_parts (maintenance_id, part_name, part_number, quantity, unit_cost, total_cost, notes)
    SELECT _mid, x->>'item', x->>'code', (x->>'qty')::numeric, CASE WHEN (x->>'qty')::numeric <> 0 THEN (x->>'value')::numeric / abs((x->>'qty')::numeric) END,
           (x->>'value')::numeric * sign((x->>'qty')::numeric), 'Stores ' || COALESCE(x->>'voucher', '')
      FROM jsonb_array_elements(_c->'parts_lines') x;
  END IF;

  UPDATE fleet_work_orders SET status = 'completed', completed_at = now(),
         notes = concat_ws(E'\n', notes, NULLIF(p->>'findings', '')) WHERE id = _w.id;
  UPDATE fleet_defects SET status = 'fixed', closed_at = now() WHERE work_order_id = _w.id AND status IN ('open','in_work');
  UPDATE fleet_assets SET status = 'operational' WHERE id = _w.asset_id AND status IN ('maintenance','grounded','awaiting_parts')
     AND NOT EXISTS (SELECT 1 FROM fleet_work_orders o WHERE o.asset_id = _w.asset_id AND o.id <> _w.id AND COALESCE(o.status, '') IN ('in_progress','waiting_for_parts'))
     AND NOT EXISTS (SELECT 1 FROM fleet_defects d WHERE d.asset_id = _w.asset_id AND d.critical AND d.status IN ('open','in_work'));
  RETURN _mid;
END $$;

-- Downtime clock follows the job.
CREATE OR REPLACE FUNCTION public.trg_fleet_wo_status_to_asset() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.asset_id IS NULL OR NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.status = 'in_progress' THEN
    UPDATE fleet_assets SET status = 'maintenance' WHERE id = NEW.asset_id AND status IN ('operational','standby','awaiting_parts');
    UPDATE fleet_defects SET status = 'in_work' WHERE work_order_id = NEW.id AND status = 'open';
  ELSIF NEW.status = 'waiting_for_parts' THEN
    UPDATE fleet_assets SET status = 'awaiting_parts' WHERE id = NEW.asset_id AND status IN ('operational','standby','maintenance');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_fleet_wo_status_to_asset ON fleet_work_orders;
CREATE TRIGGER trg_fleet_wo_status_to_asset AFTER UPDATE OF status ON fleet_work_orders
  FOR EACH ROW EXECUTE FUNCTION trg_fleet_wo_status_to_asset();

GRANT EXECUTE ON FUNCTION public.fleet_prestart_template(uuid), public.fleet_prestart_submit(jsonb), public.fleet_wo_costs(uuid),
  public.fleet_wo_complete(uuid, jsonb) TO authenticated;

INSERT INTO schema_migrations (filename) VALUES ('0241_fleet_a3_daily_work.sql') ON CONFLICT DO NOTHING;
