-- 0250 Fuel F4 (#72): issue at the pump.
-- fuel_pump_issue(p) is what the attendant phone screen (FU21) sends, also from its offline queue (idempotent on client_ref):
--   machine, driver (fuel operator), litres, km/hours (rule from 0239), optional pump meter start/end, and the driver's typed
--   name as signature — which replaces the acknowledgement step. Rules, each overridable only with a written reason:
--   LICENCE      the driver's licence is missing/expired (fuel_operators, else fleet_drivers)
--   SECOND_FILL  the same machine was filled less than fuel_settings.second_fill_hours ago (default 4 h)
--   ALLOWANCE    the fill takes the machine's or its department's weekly/monthly allowance over 100%
--   Allowance alerts at 80 / 90 / 100% go to fuel.approve once per allowance and period.
-- Hired plant: hired_vehicles / hired_equipment.fuel_paid_by ('bravura' | 'contractor'); a fill for a machine whose contract
--   says the contractor pays is flagged recharge_status 'pending' → deducted from their bill (fuel_recharge_mark).
-- fuel_pump_check(p) runs the same rules read-only so the screen can ask for reasons before sending.

ALTER TABLE fuel_transactions
  ADD COLUMN IF NOT EXISTS client_ref text,
  ADD COLUMN IF NOT EXISTS issued_at timestamptz,
  ADD COLUMN IF NOT EXISTS signed_by_name text,
  ADD COLUMN IF NOT EXISTS signed_at timestamptz,
  ADD COLUMN IF NOT EXISTS second_fill_reason text,
  ADD COLUMN IF NOT EXISTS licence_note text,
  ADD COLUMN IF NOT EXISTS allowance_note text,
  ADD COLUMN IF NOT EXISTS recharge_contractor_id uuid,
  ADD COLUMN IF NOT EXISTS recharge_status text,
  ADD COLUMN IF NOT EXISTS recharge_ref text,
  ADD COLUMN IF NOT EXISTS recharge_marked_by uuid,
  ADD COLUMN IF NOT EXISTS recharge_marked_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS fuel_transactions_client_ref_uq ON fuel_transactions (client_ref) WHERE client_ref IS NOT NULL;
ALTER TABLE fuel_transactions DROP CONSTRAINT IF EXISTS fuel_txn_recharge_status_chk;
ALTER TABLE fuel_transactions ADD CONSTRAINT fuel_txn_recharge_status_chk CHECK (recharge_status IS NULL OR recharge_status IN ('pending','deducted','waived'));

ALTER TABLE hired_vehicles  ADD COLUMN IF NOT EXISTS fuel_paid_by text NOT NULL DEFAULT 'bravura';
ALTER TABLE hired_equipment ADD COLUMN IF NOT EXISTS fuel_paid_by text NOT NULL DEFAULT 'bravura';
ALTER TABLE hired_vehicles  DROP CONSTRAINT IF EXISTS hired_vehicles_fuel_paid_by_chk;
ALTER TABLE hired_vehicles  ADD CONSTRAINT hired_vehicles_fuel_paid_by_chk CHECK (fuel_paid_by IN ('bravura','contractor'));
ALTER TABLE hired_equipment DROP CONSTRAINT IF EXISTS hired_equipment_fuel_paid_by_chk;
ALTER TABLE hired_equipment ADD CONSTRAINT hired_equipment_fuel_paid_by_chk CHECK (fuel_paid_by IN ('bravura','contractor'));
-- "fuel included" in the hire rate means the contractor supplies the fuel
UPDATE hired_vehicles  SET fuel_paid_by = 'contractor' WHERE fuel_included AND fuel_paid_by = 'bravura';
UPDATE hired_equipment SET fuel_paid_by = 'contractor' WHERE fuel_included AND fuel_paid_by = 'bravura';

ALTER TABLE fuel_settings ADD COLUMN IF NOT EXISTS second_fill_hours numeric NOT NULL DEFAULT 4;

CREATE TABLE IF NOT EXISTS fuel_allowances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL,
  fleet_asset_id uuid REFERENCES fleet_assets(id),
  department_id uuid REFERENCES departments(id),
  period text NOT NULL CHECK (period IN ('week','month')),
  litres numeric NOT NULL CHECK (litres > 0),
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid DEFAULT auth.uid(), created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  CHECK ((fleet_asset_id IS NULL) <> (department_id IS NULL)));
ALTER TABLE fuel_allowances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fa_select ON fuel_allowances;
CREATE POLICY fa_select ON fuel_allowances FOR SELECT TO authenticated
  USING (_user_has_fuel_perm(site_id, ARRAY['fuel.view','fuel.create','fuel.edit']));

CREATE TABLE IF NOT EXISTS fuel_allowance_alerts (
  allowance_id uuid NOT NULL REFERENCES fuel_allowances(id), period_start date NOT NULL, level int NOT NULL,
  sent_at timestamptz DEFAULT now(), PRIMARY KEY (allowance_id, period_start, level));
ALTER TABLE fuel_allowance_alerts ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION _fuel_period_start(p_period text, p_date date) RETURNS date
LANGUAGE sql IMMUTABLE AS $$ SELECT CASE WHEN p_period = 'week' THEN date_trunc('week', p_date)::date ELSE date_trunc('month', p_date)::date END $$;

-- allowances that apply to a machine on a date, with litres used so far in the period (excluding p_exclude)
CREATE OR REPLACE FUNCTION _fuel_allowance_use(p_asset uuid, p_date date, p_exclude uuid DEFAULT NULL)
RETURNS TABLE(allowance_id uuid, label text, period text, period_start date, litres numeric, used numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT a.id,
         CASE WHEN a.fleet_asset_id IS NOT NULL THEN COALESCE(fa.fleet_number, fa.registration, fa.description, 'Machine') ELSE d.name END
           || ' ' || a.period || 'ly allowance',
         a.period, _fuel_period_start(a.period, p_date), a.litres,
         COALESCE((SELECT sum(t.litres) FROM fuel_transactions t LEFT JOIN fleet_assets x ON x.id = t.fleet_asset_id
                    WHERE t.transaction_type = 'issuance' AND NOT COALESCE(t.is_deleted, false) AND t.id IS DISTINCT FROM p_exclude
                      AND t.transaction_date >= _fuel_period_start(a.period, p_date)
                      AND t.transaction_date < _fuel_period_start(a.period, p_date) + CASE WHEN a.period = 'week' THEN interval '7 days' ELSE interval '1 month' END
                      AND (t.fleet_asset_id = a.fleet_asset_id OR (a.department_id IS NOT NULL AND x.department_id = a.department_id))), 0)
    FROM fleet_assets m
    JOIN fuel_allowances a ON a.is_active AND a.site_id = m.site_id AND (a.fleet_asset_id = m.id OR a.department_id = m.department_id)
    LEFT JOIN fleet_assets fa ON fa.id = a.fleet_asset_id
    LEFT JOIN departments d ON d.id = a.department_id
   WHERE m.id = p_asset;
$$;

-- hired plant whose contract says the contractor pays for fuel
CREATE OR REPLACE FUNCTION _fuel_recharge_contractor(p_asset uuid, p_date date) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT contractor_id FROM (
    SELECT contractor_id, start_date, end_date, fuel_paid_by, is_archived FROM hired_vehicles WHERE fleet_asset_id = p_asset
    UNION ALL
    SELECT contractor_id, start_date, end_date, fuel_paid_by, is_archived FROM hired_equipment WHERE fleet_asset_id = p_asset) h
   WHERE fuel_paid_by = 'contractor' AND NOT COALESCE(is_archived, false)
     AND (start_date IS NULL OR start_date <= p_date) AND (end_date IS NULL OR end_date >= p_date)
   LIMIT 1;
$$;

-- the rules, read-only: returns {problems:[{code,message}], info:{...}}
CREATE OR REPLACE FUNCTION fuel_pump_check(p jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _asset uuid := NULLIF(p->>'fleet_asset_id','')::uuid; _op uuid := NULLIF(p->>'operator_id','')::uuid;
        _q numeric := COALESCE(NULLIF(p->>'litres','')::numeric, 0); _at timestamptz := COALESCE(NULLIF(p->>'issued_at','')::timestamptz, now());
        _site uuid; _hours numeric; _last record; _lic date; _probs jsonb := '[]'::jsonb; _allow jsonb := '[]'::jsonb; r record; _pct numeric;
        _rc uuid; _rcname text; _name text;
BEGIN
  SELECT site_id INTO _site FROM fleet_assets WHERE id = _asset;
  _site := COALESCE(_site, NULLIF(p->>'site_id','')::uuid);
  IF _site IS NULL OR NOT _user_has_fuel_perm(_site, ARRAY['fuel.create','fuel.edit']) THEN RAISE EXCEPTION 'No access'; END IF;
  IF _op IS NOT NULL THEN
    SELECT COALESCE(o.licence_expiry, (SELECT max(d.licence_expiry) FROM fleet_drivers d WHERE d.employee_id = o.employee_id AND NOT COALESCE(d.is_archived, false))),
           e.name INTO _lic, _name
      FROM fuel_operators o LEFT JOIN employees e ON e.id = o.employee_id WHERE o.id = _op;
    IF _lic IS NULL OR _lic < _at::date THEN
      _probs := _probs || jsonb_build_object('code', 'LICENCE', 'message',
        COALESCE(_name, 'This driver') || CASE WHEN _lic IS NULL THEN ' has no licence on record' ELSE ' — licence expired ' || to_char(_lic, 'DD Mon YYYY') END);
    END IF;
  END IF;
  IF _asset IS NOT NULL THEN
    SELECT COALESCE(second_fill_hours, 4) INTO _hours FROM fuel_settings WHERE site_id = _site;
    _hours := COALESCE(_hours, 4);
    SELECT t.litres, COALESCE(t.issued_at, t.created_at) AS at INTO _last FROM fuel_transactions t
     WHERE t.fleet_asset_id = _asset AND t.transaction_type = 'issuance' AND NOT COALESCE(t.is_deleted, false)
       AND t.client_ref IS DISTINCT FROM NULLIF(p->>'client_ref','')
       AND COALESCE(t.issued_at, t.created_at) BETWEEN _at - make_interval(secs => (_hours * 3600)::int) AND _at + interval '1 minute'
     ORDER BY COALESCE(t.issued_at, t.created_at) DESC LIMIT 1;
    IF _last.at IS NOT NULL THEN
      _probs := _probs || jsonb_build_object('code', 'SECOND_FILL', 'message',
        'Already filled ' || round(_last.litres) || ' L at ' || to_char(_last.at AT TIME ZONE 'Africa/Harare', 'HH24:MI DD Mon') || ' (less than ' || _hours || ' h ago)');
    END IF;
    FOR r IN SELECT * FROM _fuel_allowance_use(_asset, _at::date) LOOP
      _pct := round(100 * (r.used + _q) / r.litres);
      _allow := _allow || jsonb_build_object('label', r.label, 'litres', r.litres, 'used', r.used, 'after', r.used + _q, 'pct', _pct);
      IF r.used + _q > r.litres THEN
        _probs := _probs || jsonb_build_object('code', 'ALLOWANCE', 'message',
          r.label || ': ' || round(r.used) || ' of ' || round(r.litres) || ' L used — this fill takes it to ' || _pct || '%');
      END IF;
    END LOOP;
    _rc := _fuel_recharge_contractor(_asset, _at::date);
    IF _rc IS NOT NULL THEN SELECT name INTO _rcname FROM contractors WHERE id = _rc; END IF;
  END IF;
  RETURN jsonb_build_object('problems', _probs, 'allowances', _allow,
    'recharge', CASE WHEN _rc IS NOT NULL THEN jsonb_build_object('contractor_id', _rc, 'contractor', _rcname) END);
END $$;

CREATE OR REPLACE FUNCTION fuel_pump_issue(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _ref text := NULLIF(trim(p->>'client_ref'), ''); _tank fuel_tanks%ROWTYPE; _asset fleet_assets%ROWTYPE; _id uuid; _no text;
        _q numeric := NULLIF(p->>'litres','')::numeric; _at timestamptz := COALESCE(NULLIF(p->>'issued_at','')::timestamptz, now());
        _chk jsonb; _pr jsonb; _code text; _sign text := NULLIF(trim(p->>'signed_by_name'), ''); r record; _lvl int; _pct numeric;
        _rc uuid;
BEGIN
  IF _ref IS NOT NULL THEN
    SELECT id, transaction_number INTO _id, _no FROM fuel_transactions WHERE client_ref = _ref;
    IF _id IS NOT NULL THEN RETURN jsonb_build_object('id', _id, 'number', _no, 'duplicate', true); END IF;
  END IF;
  SELECT * INTO _tank FROM fuel_tanks WHERE id = NULLIF(p->>'tank_id','')::uuid;
  IF _tank.id IS NULL THEN RAISE EXCEPTION 'Choose the tank or bowser'; END IF;
  IF NOT _user_has_fuel_perm(_tank.site_id, ARRAY['fuel.create','fuel.edit']) THEN RAISE EXCEPTION 'You do not have permission to issue fuel'; END IF;
  IF COALESCE(_q, 0) <= 0 THEN RAISE EXCEPTION 'Enter the litres'; END IF;
  IF _sign IS NULL THEN RAISE EXCEPTION 'The driver must sign by typing their name'; END IF;
  SELECT * INTO _asset FROM fleet_assets WHERE id = NULLIF(p->>'fleet_asset_id','')::uuid;
  IF _asset.id IS NULL AND COALESCE(trim(p->>'asset_description'), '') = '' THEN RAISE EXCEPTION 'Choose the machine'; END IF;
  IF _asset.id IS NOT NULL AND _asset.site_id <> _tank.site_id THEN RAISE EXCEPTION 'That machine is at another site'; END IF;
  IF NULLIF(p->>'meter_end','') IS NOT NULL AND NULLIF(p->>'meter_start','') IS NOT NULL
     AND abs(((p->>'meter_end')::numeric - (p->>'meter_start')::numeric) - _q) > GREATEST(2, _q * 0.02) THEN
    RAISE EXCEPTION 'Pump meter shows % L but % L was entered', (p->>'meter_end')::numeric - (p->>'meter_start')::numeric, _q;
  END IF;

  _chk := fuel_pump_check(p || jsonb_build_object('site_id', _tank.site_id));
  FOR _pr IN SELECT * FROM jsonb_array_elements(_chk->'problems') LOOP
    _code := _pr->>'code';
    IF (_code = 'LICENCE' AND COALESCE(trim(p->>'licence_note'), '') = '')
       OR (_code = 'SECOND_FILL' AND COALESCE(trim(p->>'second_fill_reason'), '') = '')
       OR (_code = 'ALLOWANCE' AND COALESCE(trim(p->>'allowance_note'), '') = '') THEN
      RAISE EXCEPTION '%: % — give a reason to go ahead', _code, _pr->>'message';
    END IF;
  END LOOP;
  _rc := NULLIF(_chk->'recharge'->>'contractor_id', '')::uuid;

  INSERT INTO fuel_transactions (site_id, transaction_number, transaction_date, tank_id, pump_id, transaction_type, fleet_asset_id, asset_description,
    operator_id, litres, meter_start, meter_end, odometer_km, hours_reading, meter_broken, meter_note, notes, created_by,
    acknowledgement_status, client_ref, issued_at, signed_by_name, signed_at, second_fill_reason, licence_note, allowance_note,
    cost_centre_id, project_id, recharge_contractor_id, recharge_status)
  VALUES (_tank.site_id, _fuel_next_no(_tank.site_id, 'issuance'), (_at AT TIME ZONE 'Africa/Harare')::date, _tank.id, NULLIF(p->>'pump_id','')::uuid, 'issuance',
    _asset.id, COALESCE(NULLIF(trim(p->>'asset_description'), ''), concat_ws(' ', _asset.fleet_number, _asset.registration, _asset.description)),
    NULLIF(p->>'operator_id','')::uuid, _q, NULLIF(p->>'meter_start','')::numeric, NULLIF(p->>'meter_end','')::numeric,
    NULLIF(p->>'odometer_km','')::numeric, NULLIF(p->>'hours_reading','')::numeric, COALESCE((p->>'meter_broken')::boolean, false),
    NULLIF(trim(p->>'meter_note'), ''), NULLIF(trim(p->>'notes'), ''), auth.uid(),
    'not_required', _ref, _at, _sign, now(), NULLIF(trim(p->>'second_fill_reason'), ''), NULLIF(trim(p->>'licence_note'), ''),
    NULLIF(trim(p->>'allowance_note'), ''), _asset.cost_centre_id, _asset.project_id, _rc, CASE WHEN _rc IS NOT NULL THEN 'pending' END)
  RETURNING id, transaction_number INTO _id, _no;

  -- allowance alerts at 80 / 90 / 100 %, once per allowance and period
  IF _asset.id IS NOT NULL THEN
    FOR r IN SELECT * FROM _fuel_allowance_use(_asset.id, (_at AT TIME ZONE 'Africa/Harare')::date) LOOP
      _pct := 100 * r.used / r.litres;
      _lvl := CASE WHEN _pct >= 100 THEN 100 WHEN _pct >= 90 THEN 90 WHEN _pct >= 80 THEN 80 END;
      IF _lvl IS NOT NULL THEN
        INSERT INTO fuel_allowance_alerts (allowance_id, period_start, level) VALUES (r.allowance_id, r.period_start, _lvl) ON CONFLICT DO NOTHING;
        IF FOUND THEN
          PERFORM _notify_permission(_tank.site_id, 'fuel.approve', 'warning', 'Fuel allowance ' || _lvl || '%',
            r.label || ': ' || round(r.used) || ' of ' || round(r.litres) || ' L used (' || round(_pct) || '%).', 'fuel_allowances', 'reminder');
        END IF;
      END IF;
    END LOOP;
  END IF;
  RETURN jsonb_build_object('id', _id, 'number', _no, 'recharge', _chk->'recharge', 'allowances', _chk->'allowances');
END $$;

-- everything the phone needs to work offline
CREATE OR REPLACE FUNCTION fuel_pump_lists(p_site uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT _user_has_fuel_perm(p_site, ARRAY['fuel.create','fuel.edit']) THEN RAISE EXCEPTION 'No access'; END IF;
  RETURN jsonb_build_object(
    'tanks', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'name', name) ORDER BY name), '[]') FROM fuel_tanks WHERE site_id = p_site AND NOT COALESCE(is_archived, false)),
    'pumps', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'tank_id', tank_id, 'meter', current_meter_reading) ORDER BY name), '[]')
                FROM fuel_pumps WHERE site_id = p_site AND NOT COALESCE(is_archived, false)),
    'machines', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', a.id, 'label', concat_ws(' · ', a.fleet_number, a.registration, a.description),
                   'category', t.category, 'hired', _fuel_recharge_contractor(a.id, CURRENT_DATE) IS NOT NULL,
                   'km', a.current_odometer_km, 'hours', a.current_hours) ORDER BY a.fleet_number NULLS LAST, a.description), '[]')
                FROM fleet_assets a LEFT JOIN fleet_asset_types t ON t.id = a.asset_type_id
               WHERE a.site_id = p_site AND NOT COALESCE(a.is_archived, false) AND a.status NOT IN ('disposed','sold','written_off')),
    'drivers', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', o.id, 'name', e.name, 'number', e.employee_number,
                   'licence_expiry', COALESCE(o.licence_expiry, (SELECT max(d.licence_expiry) FROM fleet_drivers d WHERE d.employee_id = o.employee_id AND NOT COALESCE(d.is_archived, false)))) ORDER BY e.name), '[]')
                FROM fuel_operators o JOIN employees e ON e.id = o.employee_id WHERE o.site_id = p_site AND o.is_active),
    'meter_required_from', _fleet_setting_date(p_site),
    'second_fill_hours', COALESCE((SELECT second_fill_hours FROM fuel_settings WHERE site_id = p_site), 4));
END $$;

-- allowances
CREATE OR REPLACE FUNCTION fuel_allowance_save(p jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _id uuid := NULLIF(p->>'id','')::uuid; _site uuid := (p->>'site_id')::uuid;
BEGIN
  IF NOT _user_has_fuel_perm(_site, ARRAY['fuel.approve']) THEN RAISE EXCEPTION 'Only fuel approvers can set allowances'; END IF;
  IF _id IS NULL THEN
    INSERT INTO fuel_allowances (site_id, fleet_asset_id, department_id, period, litres, notes)
    VALUES (_site, NULLIF(p->>'fleet_asset_id','')::uuid, NULLIF(p->>'department_id','')::uuid, p->>'period', (p->>'litres')::numeric, NULLIF(trim(p->>'notes'), ''))
    RETURNING id INTO _id;
  ELSE
    UPDATE fuel_allowances SET period = p->>'period', litres = (p->>'litres')::numeric, notes = NULLIF(trim(p->>'notes'), ''),
           is_active = COALESCE((p->>'is_active')::boolean, is_active), updated_at = now()
     WHERE id = _id AND site_id = _site;
  END IF;
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION fuel_allowance_list(p_site uuid, p_date date DEFAULT CURRENT_DATE)
RETURNS TABLE(id uuid, target text, kind text, period text, litres numeric, used numeric, pct numeric, is_active boolean, notes text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT _user_has_fuel_perm(p_site, ARRAY['fuel.view','fuel.create','fuel.edit']) THEN RAISE EXCEPTION 'No access'; END IF;
  RETURN QUERY
  SELECT a.id, COALESCE(concat_ws(' · ', m.fleet_number, m.registration, m.description), d.name),
         CASE WHEN a.fleet_asset_id IS NOT NULL THEN 'Machine' ELSE 'Department' END, a.period, a.litres, u.used,
         round(100 * u.used / a.litres), a.is_active, a.notes
    FROM fuel_allowances a LEFT JOIN fleet_assets m ON m.id = a.fleet_asset_id LEFT JOIN departments d ON d.id = a.department_id
    CROSS JOIN LATERAL (SELECT COALESCE(sum(t.litres), 0) used FROM fuel_transactions t LEFT JOIN fleet_assets x ON x.id = t.fleet_asset_id
                         WHERE t.transaction_type = 'issuance' AND NOT COALESCE(t.is_deleted, false)
                           AND t.transaction_date >= _fuel_period_start(a.period, p_date)
                           AND t.transaction_date < _fuel_period_start(a.period, p_date) + CASE WHEN a.period = 'week' THEN interval '7 days' ELSE interval '1 month' END
                           AND (t.fleet_asset_id = a.fleet_asset_id OR (a.department_id IS NOT NULL AND x.department_id = a.department_id))) u
   WHERE a.site_id = p_site
   ORDER BY a.is_active DESC, 7 DESC NULLS LAST;
END $$;

-- hired plant recharges
CREATE OR REPLACE FUNCTION fuel_recharge_list(p_site uuid, p_status text DEFAULT 'pending')
RETURNS TABLE(id uuid, transaction_number text, transaction_date date, contractor text, machine text, litres numeric, value numeric,
  status text, ref text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT (_user_has_fuel_perm(p_site, ARRAY['fuel.view','fuel.create','fuel.edit']) OR _has_permission('finance.view', p_site)) THEN RAISE EXCEPTION 'No access'; END IF;
  RETURN QUERY
  SELECT t.id, t.transaction_number, t.transaction_date, c.name, t.asset_description, t.litres, t.total_cost, t.recharge_status, t.recharge_ref
    FROM fuel_transactions t LEFT JOIN contractors c ON c.id = t.recharge_contractor_id
   WHERE t.site_id = p_site AND t.recharge_contractor_id IS NOT NULL AND NOT COALESCE(t.is_deleted, false)
     AND (p_status IS NULL OR t.recharge_status = p_status)
   ORDER BY c.name, t.transaction_date;
END $$;

CREATE OR REPLACE FUNCTION fuel_recharge_mark(p_ids uuid[], p_status text, p_ref text) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _n int;
BEGIN
  IF p_status NOT IN ('deducted','waived','pending') THEN RAISE EXCEPTION 'Unknown status'; END IF;
  IF COALESCE(trim(p_ref), '') = '' AND p_status <> 'pending' THEN RAISE EXCEPTION 'Give the bill number (deducted) or the reason (waived)'; END IF;
  UPDATE fuel_transactions t SET recharge_status = p_status, recharge_ref = NULLIF(trim(p_ref), ''), recharge_marked_by = auth.uid(), recharge_marked_at = now()
   WHERE t.id = ANY(p_ids) AND t.recharge_contractor_id IS NOT NULL
     AND (_user_has_fuel_perm(t.site_id, ARRAY['fuel.approve']) OR _has_permission('finance.approve', t.site_id));
  GET DIAGNOSTICS _n = ROW_COUNT;
  IF _n = 0 THEN RAISE EXCEPTION 'Nothing marked — check your rights'; END IF;
  RETURN _n;
END $$;

-- flag recharges on fills keyed in the office too
CREATE OR REPLACE FUNCTION trg_fuel_recharge_flag() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.transaction_type = 'issuance' AND NEW.fleet_asset_id IS NOT NULL AND NEW.recharge_contractor_id IS NULL THEN
    NEW.recharge_contractor_id := _fuel_recharge_contractor(NEW.fleet_asset_id, COALESCE(NEW.transaction_date, CURRENT_DATE));
    IF NEW.recharge_contractor_id IS NOT NULL THEN NEW.recharge_status := 'pending'; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_fuel_recharge_flag ON fuel_transactions;
CREATE TRIGGER trg_fuel_recharge_flag BEFORE INSERT ON fuel_transactions FOR EACH ROW EXECUTE FUNCTION trg_fuel_recharge_flag();

GRANT EXECUTE ON FUNCTION fuel_pump_check(jsonb), fuel_pump_issue(jsonb), fuel_pump_lists(uuid), fuel_allowance_save(jsonb),
  fuel_allowance_list(uuid, date), fuel_recharge_list(uuid, text), fuel_recharge_mark(uuid[], text, text) TO authenticated;

INSERT INTO schema_migrations (filename) VALUES ('0250_fuel_f4_pump_issue.sql') ON CONFLICT DO NOTHING;
