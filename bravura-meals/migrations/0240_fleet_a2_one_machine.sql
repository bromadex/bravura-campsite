-- 0240 — Fleet A2 (#63): one machine record.
--  • Specifications per machine type category (fleet_type_specs) stored in fleet_assets.specs (jsonb),
--    seeded from the old generator-only columns (columns kept, no longer shown).
--  • Capitalise a machine into Fixed Assets in one step (fleet_capitalise), optionally from the GRN line it
--    was received on: that posts asset_capitalised_grn (Dr 1610 / Cr 1320 — the value the GRN put in stock).
--  • Book value on the machine (fleet_machine_book).
--  • Move a machine between sites (fleet_transfer_site, fleet_site_transfers): the fixed asset moves too and
--    the book value posts through 2500 (asset_transfer_out[_accum] at the sender, asset_transfer_in[_accum] at the receiver).

-- ── Specs ─────────────────────────────────────────────────────────────────────
ALTER TABLE fleet_assets ADD COLUMN IF NOT EXISTS specs jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS fleet_type_specs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,              -- fleet_asset_types.category
  key text NOT NULL,
  label text NOT NULL,
  unit text,
  input text NOT NULL DEFAULT 'number' CHECK (input IN ('number','text')),
  sort_order int NOT NULL DEFAULT 0,
  is_archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (category, key)
);
ALTER TABLE fleet_type_specs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fleet_type_specs_read ON fleet_type_specs;
CREATE POLICY fleet_type_specs_read ON fleet_type_specs FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id
          WHERE ur.user_id = auth.uid() AND p.code IN ('fleet.view','fleet.edit')));
DROP POLICY IF EXISTS fleet_type_specs_write ON fleet_type_specs;
CREATE POLICY fleet_type_specs_write ON fleet_type_specs FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id
          WHERE ur.user_id = auth.uid() AND p.code = 'fleet.edit'));
DROP POLICY IF EXISTS fleet_type_specs_update ON fleet_type_specs;
CREATE POLICY fleet_type_specs_update ON fleet_type_specs FOR UPDATE TO authenticated USING (
  EXISTS (SELECT 1 FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id
          WHERE ur.user_id = auth.uid() AND p.code = 'fleet.edit'));

INSERT INTO fleet_type_specs (category, key, label, unit, input, sort_order) VALUES
  ('generator','kva_rating','Rating','kVA','number',1), ('generator','engine_type','Engine',NULL,'text',2),
  ('generator','engine_serial','Engine serial',NULL,'text',3), ('generator','alternator_make','Alternator make',NULL,'text',4),
  ('generator','alternator_model','Alternator model',NULL,'text',5), ('generator','alternator_serial','Alternator serial',NULL,'text',6),
  ('generator','voltage','Voltage','V','number',7), ('generator','phase','Phase',NULL,'number',8),
  ('generator','frequency','Frequency','Hz','number',9), ('generator','rated_amps','Rated current','A','number',10),
  ('generator','power_factor','Power factor',NULL,'number',11), ('generator','rpm','Speed','rpm','number',12),
  ('generator','avr_type','AVR',NULL,'text',13), ('generator','cooling_method','Cooling',NULL,'text',14),
  ('vehicle','tare_weight','Tare weight','kg','number',1), ('vehicle','gross_vehicle_mass','Gross vehicle mass','kg','number',2),
  ('vehicle','payload','Payload','t','number',3),
  ('heavy_equipment','operating_weight','Operating weight','t','number',1), ('heavy_equipment','engine_power','Engine power','kW','number',2),
  ('heavy_equipment','bucket_capacity','Bucket / body capacity','m³','number',3),
  ('pump','flow_rate','Flow','m³/h','number',1), ('pump','head','Head','m','number',2), ('pump','power','Power','kW','number',3),
  ('trailer','payload','Payload','t','number',1), ('trailer','axles','Axles',NULL,'number',2),
  ('other','power','Power','kW','number',1)
ON CONFLICT (category, key) DO NOTHING;

-- Copy the old columns into specs (only keys not already set).
UPDATE fleet_assets fa SET specs = jsonb_strip_nulls(jsonb_build_object(
    'kva_rating', fa.kva_rating, 'engine_type', fa.engine_type, 'engine_serial', fa.engine_serial,
    'alternator_make', fa.alternator_make, 'alternator_model', fa.alternator_model, 'alternator_serial', fa.alternator_serial,
    'voltage', fa.voltage, 'phase', fa.phase, 'frequency', fa.frequency, 'rated_amps', fa.rated_amps,
    'power_factor', fa.power_factor, 'rpm', fa.rpm, 'avr_type', fa.avr_type, 'cooling_method', fa.cooling_method,
    'tare_weight', fa.tare_weight, 'gross_vehicle_mass', fa.gross_vehicle_mass)) || fa.specs
 WHERE fa.specs = '{}'::jsonb;

-- ── Posting rules ─────────────────────────────────────────────────────────────
DO $$ DECLARE d text; BEGIN
  SELECT pg_get_constraintdef(oid) INTO d FROM pg_constraint WHERE conname = 'gl_posting_rules_event_code_check';
  IF d IS NOT NULL AND position('asset_transfer_out' in d) = 0 THEN
    ALTER TABLE gl_posting_rules DROP CONSTRAINT gl_posting_rules_event_code_check;
    EXECUTE 'ALTER TABLE gl_posting_rules ADD CONSTRAINT gl_posting_rules_event_code_check '
      || replace(d, '''asset_capitalised''::text,', '''asset_capitalised''::text, ''asset_capitalised_grn''::text, ''asset_transfer_out''::text, ''asset_transfer_out_accum''::text, ''asset_transfer_in''::text, ''asset_transfer_in_accum''::text,');
  END IF;
END $$;
INSERT INTO gl_posting_rules (site_id, event_code, debit_account_id, credit_account_id, is_active)
SELECT fs.site_id, v.ev, (SELECT id FROM accounts WHERE site_id = fs.site_id AND code = v.dr), (SELECT id FROM accounts WHERE site_id = fs.site_id AND code = v.cr), true
  FROM finance_setup fs CROSS JOIN (VALUES ('asset_capitalised_grn','1610','1320'), ('asset_transfer_out','2500','1610'),
       ('asset_transfer_out_accum','1690','2500'), ('asset_transfer_in','1610','2500'), ('asset_transfer_in_accum','2500','1690')) v(ev, dr, cr)
 WHERE NOT EXISTS (SELECT 1 FROM gl_posting_rules r WHERE r.site_id = fs.site_id AND r.event_code = v.ev AND NOT r.is_archived)
   AND EXISTS (SELECT 1 FROM accounts WHERE site_id = fs.site_id AND code = v.dr) AND EXISTS (SELECT 1 FROM accounts WHERE site_id = fs.site_id AND code = v.cr);
DO $$ DECLARE d text; BEGIN
  d := pg_get_functiondef('finance_rule_template()'::regprocedure);
  IF position('asset_transfer_out' in d) = 0 THEN
    d := replace(d, '(''asset_capitalised'',''1610'',''1650''),', '(''asset_capitalised'',''1610'',''1650''), (''asset_capitalised_grn'',''1610'',''1320''), (''asset_transfer_out'',''2500'',''1610''), (''asset_transfer_out_accum'',''1690'',''2500''), (''asset_transfer_in'',''1610'',''2500''), (''asset_transfer_in_accum'',''2500'',''1690''),');
    EXECUTE d;
  END IF;
END $$;

-- ── Capitalise from the machine ──────────────────────────────────────────────
ALTER TABLE fixed_assets ADD COLUMN IF NOT EXISTS source_grn_line_id uuid REFERENCES grn_lines(id);

CREATE OR REPLACE FUNCTION public.fa_capitalise(p_asset_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _a fixed_assets%ROWTYPE;
BEGIN
  SELECT * INTO _a FROM fixed_assets WHERE id = p_asset_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Asset not found'; END IF;
  IF NOT _has_permission('assets.approve', _a.site_id) THEN RAISE EXCEPTION 'You do not have permission to capitalise assets'; END IF;
  IF _a.status <> 'draft' THEN RAISE EXCEPTION 'This asset is already %', _a.status; END IF;
  IF _a.cost <= 0 THEN RAISE EXCEPTION 'Enter the asset''s cost first'; END IF;
  IF _a.acquisition_date IS NULL THEN RAISE EXCEPTION 'Enter the acquisition date first'; END IF;
  IF _a.method = 'straight_line' AND _a.useful_life_months IS NULL THEN RAISE EXCEPTION 'Enter the useful life (months)'; END IF;
  IF _a.method = 'reducing_balance' AND _a.rate_pct IS NULL THEN RAISE EXCEPTION 'Enter the annual depreciation rate'; END IF;
  IF _a.salvage_value > _a.cost THEN RAISE EXCEPTION 'Salvage value can''t exceed cost'; END IF;
  PERFORM set_config('app.fa_rpc', 'on', true);
  UPDATE fixed_assets SET status = 'active', capitalised_at = now(),
         depreciation_start = COALESCE(depreciation_start, date_trunc('month', acquisition_date)::date) WHERE id = p_asset_id;
  PERFORM set_config('app.fa_rpc', 'off', true);
  INSERT INTO asset_movements (site_id, asset_id, change_type, after, created_by)
  VALUES (_a.site_id, _a.id, 'capitalised', jsonb_build_object('cost', _a.cost, 'grn_line_id', _a.source_grn_line_id), auth.uid());
  -- Received on a GRN: the value already sits in stock (1320), so move it to fixed assets rather than asset clearing.
  PERFORM gl_auto_post(_a.site_id, CASE WHEN _a.source_grn_line_id IS NOT NULL THEN 'asset_capitalised_grn' ELSE 'asset_capitalised' END,
                       'fixed_assets', _a.id, _a.acquisition_date, _a.cost, 'Capitalised ' || _a.asset_code || ' ' || _a.name);
END $$;

-- GRN lines at this site that could be this machine (non-stock lines, not already capitalised).
CREATE OR REPLACE FUNCTION public.fleet_capitalise_sources(p_asset_id uuid) RETURNS TABLE
  (grn_line_id uuid, grn_number text, po_number text, supplier text, received_date date, description text, qty numeric, amount numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT gl.id, g.grn_number, po.po_number, s.supplier_name, g.received_date, gl.item_description,
         gl.quantity_received, round(COALESCE(gl.quantity_received, 0) * COALESCE(gl.unit_price, 0), 2)
    FROM fleet_assets fa
    JOIN goods_received_notes g ON g.site_id = fa.site_id
    JOIN grn_lines gl ON gl.grn_id = g.id
    LEFT JOIN purchase_orders po ON po.id = g.po_id
    LEFT JOIN procurement_suppliers s ON s.id = g.supplier_id
   WHERE fa.id = p_asset_id AND _has_permission('assets.create', fa.site_id)
     AND gl.item_id IS NULL AND COALESCE(gl.quantity_received, 0) > 0
     AND NOT EXISTS (SELECT 1 FROM fixed_assets x WHERE x.source_grn_line_id = gl.id AND NOT x.is_archived)
   ORDER BY g.received_date DESC NULLS LAST
   LIMIT 100;
$$;

CREATE OR REPLACE FUNCTION public.fleet_capitalise(p_asset_id uuid, p jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _f fleet_assets%ROWTYPE; _gl RECORD; _id uuid; _cost numeric; _date date;
BEGIN
  SELECT * INTO _f FROM fleet_assets WHERE id = p_asset_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Machine not found'; END IF;
  IF EXISTS (SELECT 1 FROM fixed_assets WHERE fleet_asset_id = _f.id AND NOT is_archived AND status IN ('draft','active')) THEN
    RAISE EXCEPTION 'This machine is already in the fixed asset register';
  END IF;
  _cost := NULLIF(p->>'cost', '')::numeric;
  _date := NULLIF(p->>'acquisition_date', '')::date;
  IF NULLIF(p->>'grn_line_id', '') IS NOT NULL THEN
    SELECT gl.*, g.site_id AS g_site, g.received_date INTO _gl
      FROM grn_lines gl JOIN goods_received_notes g ON g.id = gl.grn_id WHERE gl.id = (p->>'grn_line_id')::uuid;
    IF NOT FOUND OR _gl.g_site <> _f.site_id THEN RAISE EXCEPTION 'That receipt is not at this machine''s site'; END IF;
    IF _gl.item_id IS NOT NULL THEN RAISE EXCEPTION 'That line went into stores as a stock item — pick the line the machine was received on'; END IF;
    IF EXISTS (SELECT 1 FROM fixed_assets WHERE source_grn_line_id = _gl.id AND NOT is_archived) THEN
      RAISE EXCEPTION 'That receipt line is already capitalised';
    END IF;
    _cost := COALESCE(_cost, round(COALESCE(_gl.quantity_received, 0) * COALESCE(_gl.unit_price, 0), 2));
    _date := COALESCE(_date, _gl.received_date);
  END IF;
  _id := fa_create_asset(_f.site_id, jsonb_build_object(
    'name', TRIM(CONCAT_WS(' ', COALESCE(_f.fleet_number, _f.asset_number), _f.make, _f.model, NULLIF('(' || _f.registration || ')', '()'))),
    'category_id', p->>'category_id', 'fleet_asset_id', _f.id, 'serial_number', COALESCE(_f.serial_number, _f.vin),
    'location', _f.location, 'department_id', _f.department_id, 'cost_centre_id', _f.cost_centre_id, 'project_id', _f.project_id,
    'acquisition_date', _date, 'cost', _cost, 'salvage_value', COALESCE(NULLIF(p->>'salvage_value', ''), _f.salvage_value::text),
    'method', p->>'method', 'useful_life_months', p->>'useful_life_months', 'rate_pct', p->>'rate_pct', 'notes', p->>'notes'));
  UPDATE fixed_assets SET source_grn_line_id = NULLIF(p->>'grn_line_id', '')::uuid WHERE id = _id;
  UPDATE fleet_assets SET purchase_cost = COALESCE(purchase_cost, _cost), purchase_date = COALESCE(purchase_date, _date) WHERE id = _f.id;
  IF COALESCE((p->>'capitalise')::boolean, true) THEN PERFORM fa_capitalise(_id); END IF;
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.fleet_machine_book(p_asset_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'fixed_asset', (SELECT jsonb_build_object('id', x.id, 'code', x.asset_code, 'status', x.status, 'cost', x.cost,
        'accumulated', x.accumulated_depreciation, 'book_value', x.cost - x.accumulated_depreciation,
        'method', x.method, 'useful_life_months', x.useful_life_months, 'rate_pct', x.rate_pct,
        'acquisition_date', x.acquisition_date, 'capitalised_at', x.capitalised_at,
        'last_period', (SELECT max(period) FROM asset_depreciation d WHERE d.asset_id = x.id),
        'grn', (SELECT g.grn_number FROM grn_lines gl JOIN goods_received_notes g ON g.id = gl.grn_id WHERE gl.id = x.source_grn_line_id))
      FROM fixed_assets x WHERE x.fleet_asset_id = fa.id AND NOT x.is_archived ORDER BY x.created_at DESC LIMIT 1),
    'transfers', (SELECT COALESCE(jsonb_agg(jsonb_build_object('date', t.transfer_date, 'from', sf.name, 'to', st.name,
        'book_value', t.book_value, 'notes', t.notes) ORDER BY t.created_at DESC), '[]'::jsonb)
      FROM fleet_site_transfers t JOIN sites sf ON sf.id = t.from_site_id JOIN sites st ON st.id = t.to_site_id WHERE t.asset_id = fa.id))
  FROM fleet_assets fa WHERE fa.id = p_asset_id AND _has_permission('fleet.view', fa.site_id);
$$;

-- ── Move between sites ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fleet_site_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES fleet_assets(id),
  fixed_asset_id uuid REFERENCES fixed_assets(id),
  from_site_id uuid NOT NULL REFERENCES sites(id),
  to_site_id uuid NOT NULL REFERENCES sites(id),
  transfer_date date NOT NULL DEFAULT CURRENT_DATE,
  cost numeric NOT NULL DEFAULT 0,
  accumulated numeric NOT NULL DEFAULT 0,
  book_value numeric NOT NULL DEFAULT 0,
  notes text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE fleet_site_transfers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fleet_site_transfers_read ON fleet_site_transfers;
CREATE POLICY fleet_site_transfers_read ON fleet_site_transfers FOR SELECT TO authenticated
  USING (_has_permission('fleet.view', from_site_id) OR _has_permission('fleet.view', to_site_id));
-- No insert/update/delete policies: written only by fleet_transfer_site.

CREATE OR REPLACE FUNCTION public.fleet_transfer_site(p_asset_id uuid, p_to_site uuid, p_date date DEFAULT CURRENT_DATE, p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _f fleet_assets%ROWTYPE; _x fixed_assets%ROWTYPE; _t uuid; _cat uuid; _desc text; _book numeric := 0;
BEGIN
  SELECT * INTO _f FROM fleet_assets WHERE id = p_asset_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Machine not found'; END IF;
  IF _f.site_id = p_to_site THEN RAISE EXCEPTION 'The machine is already at that site'; END IF;
  IF NOT _has_permission('fleet.edit', _f.site_id) OR NOT _has_permission('fleet.edit', p_to_site) THEN
    RAISE EXCEPTION 'You need Fleet edit rights at both sites to move a machine';
  END IF;
  p_date := COALESCE(p_date, CURRENT_DATE);
  SELECT * INTO _x FROM fixed_assets WHERE fleet_asset_id = _f.id AND NOT is_archived AND status IN ('draft','active') ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF FOUND THEN _book := _x.cost - _x.accumulated_depreciation; END IF;

  INSERT INTO fleet_site_transfers (asset_id, fixed_asset_id, from_site_id, to_site_id, transfer_date, cost, accumulated, book_value, notes)
  VALUES (_f.id, _x.id, _f.site_id, p_to_site, p_date, COALESCE(_x.cost, 0), COALESCE(_x.accumulated_depreciation, 0), _book, NULLIF(TRIM(p_notes), ''))
  RETURNING id INTO _t;

  -- Site-specific links don't travel.
  UPDATE fleet_assets SET site_id = p_to_site, department_id = NULL, department_name = NULL, cost_centre_id = NULL,
         project_id = NULL, current_operator_id = NULL, updated_at = now() WHERE id = _f.id;

  IF _x.id IS NOT NULL THEN
    SELECT c2.id INTO _cat FROM asset_categories c1 JOIN asset_categories c2 ON lower(c2.name) = lower(c1.name) AND c2.site_id = p_to_site AND NOT c2.is_archived
     WHERE c1.id = _x.category_id LIMIT 1;
    PERFORM set_config('app.fa_rpc', 'on', true);
    UPDATE fixed_assets SET site_id = p_to_site, category_id = _cat, department_id = NULL, cost_centre_id = NULL, project_id = NULL,
           custodian_employee_id = NULL WHERE id = _x.id;
    PERFORM set_config('app.fa_rpc', 'off', true);
    INSERT INTO asset_movements (site_id, asset_id, change_type, before, after, notes, created_by)
    VALUES (p_to_site, _x.id, 'transferred', jsonb_build_object('site_id', _f.site_id), jsonb_build_object('site_id', p_to_site, 'book_value', _book), p_notes, auth.uid());
    IF _x.status = 'active' THEN
      _desc := 'Machine ' || _x.asset_code || ' moved ' || (SELECT name FROM sites WHERE id = _f.site_id) || ' → ' || (SELECT name FROM sites WHERE id = p_to_site);
      PERFORM gl_auto_post(_f.site_id, 'asset_transfer_out', 'fleet_site_transfers', _t, p_date, _x.cost, _desc);
      PERFORM gl_auto_post(_f.site_id, 'asset_transfer_out_accum', 'fleet_site_transfers', _t, p_date, _x.accumulated_depreciation, _desc);
      PERFORM gl_auto_post(p_to_site, 'asset_transfer_in', 'fleet_site_transfers', _t, p_date, _x.cost, _desc);
      PERFORM gl_auto_post(p_to_site, 'asset_transfer_in_accum', 'fleet_site_transfers', _t, p_date, _x.accumulated_depreciation, _desc);
    END IF;
  END IF;
  RETURN jsonb_build_object('transfer_id', _t, 'book_value', _book, 'fixed_asset', _x.asset_code);
END $$;

GRANT EXECUTE ON FUNCTION public.fleet_capitalise(uuid, jsonb), public.fleet_capitalise_sources(uuid), public.fleet_machine_book(uuid),
  public.fleet_transfer_site(uuid, uuid, date, text) TO authenticated;

INSERT INTO schema_migrations (filename) VALUES ('0240_fleet_a2_one_machine.sql') ON CONFLICT DO NOTHING;
