-- 0239 — Fleet A1 "make it correct" (issue #62).
--  • Fuel issues carry their price: unit price = last delivery price into that tank (the same rule Finance already uses in
--    gl_fuel_value), total = litres × price. Back-filled on the 135 existing issues without re-posting the ledger.
--  • Meters from fuel: km (vehicles) or hours (machines) typed at a fill go into fleet_meter_readings and update the machine.
--    A reading below the last one, or a jump over the site's limit, is saved but flagged. "Meter broken" is allowed with a note.
--    Readings are optional until fleet_settings.meter_required_from (default 1 Nov 2026, user 25 Sep), then required.
--  • One status set (the words the fleet screens use): operational · standby · maintenance · awaiting_parts · grounded ·
--    decommissioned. "active" → operational (and kept that way by a trigger).
--  • Archive only: no DELETE on fleet tables.
--  • Papers: Compliance is the one place; the machine's licence / insurance / roadworthy dates follow the latest record there.
--  • fleet_meter_gaps(site): machines with no reading for 7+ days, when and by whom they were last fuelled.

-- ── Columns ───────────────────────────────────────────────────────────────────
ALTER TABLE fuel_transactions ADD COLUMN IF NOT EXISTS hours_reading numeric;
ALTER TABLE fuel_transactions ADD COLUMN IF NOT EXISTS meter_broken boolean NOT NULL DEFAULT false;
ALTER TABLE fuel_transactions ADD COLUMN IF NOT EXISTS meter_note text;
ALTER TABLE fleet_settings ADD COLUMN IF NOT EXISTS meter_required_from date DEFAULT DATE '2026-11-01';
ALTER TABLE fleet_settings ADD COLUMN IF NOT EXISTS max_km_jump numeric DEFAULT 5000;
ALTER TABLE fleet_settings ADD COLUMN IF NOT EXISTS max_hours_jump numeric DEFAULT 300;

CREATE OR REPLACE FUNCTION public._fleet_setting_date(p_site uuid) RETURNS date
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT meter_required_from FROM fleet_settings WHERE site_id = p_site LIMIT 1), DATE '2026-11-01');
$$;

-- ── Fuel price + meter rule (before the row is saved) ─────────────────────────
CREATE OR REPLACE FUNCTION public.trg_fuel_price_and_meter() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _cat text;
BEGIN
  IF NEW.transaction_type <> 'issuance' THEN RETURN NEW; END IF;
  -- Price at the last delivery into this tank (fallback: last delivery at the site).
  IF COALESCE(NEW.unit_price, 0) <= 0 THEN
    SELECT d.unit_price INTO NEW.unit_price FROM fuel_transactions d
     WHERE d.site_id = NEW.site_id AND d.transaction_type = 'delivery' AND NOT COALESCE(d.is_deleted, false) AND COALESCE(d.unit_price, 0) > 0
       AND (NEW.tank_id IS NULL OR d.tank_id = NEW.tank_id) AND d.transaction_date <= COALESCE(NEW.transaction_date, current_date)
     ORDER BY d.transaction_date DESC, d.created_at DESC LIMIT 1;
  END IF;
  IF COALESCE(NEW.unit_price, 0) > 0 AND (TG_OP = 'INSERT' OR COALESCE(NEW.total_cost, 0) = 0
       OR NEW.litres IS DISTINCT FROM OLD.litres OR NEW.unit_price IS DISTINCT FROM OLD.unit_price) THEN
    NEW.total_cost := round(COALESCE(NEW.litres, 0) * NEW.unit_price, 2);
  END IF;
  -- Meters: required from the site's date (new fills only), unless the meter is marked broken with a note.
  IF TG_OP = 'INSERT' AND NEW.fleet_asset_id IS NOT NULL AND NOT COALESCE(NEW.is_deleted, false)
     AND COALESCE(NEW.transaction_date, current_date) >= _fleet_setting_date(NEW.site_id)
     AND NEW.odometer_km IS NULL AND NEW.hours_reading IS NULL THEN
    IF NEW.meter_broken THEN
      IF COALESCE(trim(NEW.meter_note), '') = '' THEN RAISE EXCEPTION 'Say what is wrong with the meter'; END IF;
    ELSE
      SELECT t.category INTO _cat FROM fleet_assets a LEFT JOIN fleet_asset_types t ON t.id = a.asset_type_id WHERE a.id = NEW.fleet_asset_id;
      RAISE EXCEPTION 'Enter the % reading (required from %), or tick "Meter broken"',
        CASE WHEN _cat = 'vehicle' THEN 'odometer (km)' ELSE 'hour meter' END, to_char(_fleet_setting_date(NEW.site_id), 'DD Mon YYYY');
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_fuel_txn_0_price ON fuel_transactions;
CREATE TRIGGER trg_fuel_txn_0_price BEFORE INSERT OR UPDATE ON fuel_transactions FOR EACH ROW EXECUTE FUNCTION trg_fuel_price_and_meter();

-- ── Meter readings from fuel (after the row is saved) ─────────────────────────
CREATE OR REPLACE FUNCTION public.trg_fuel_to_meter() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _a fleet_assets%ROWTYPE; _jkm numeric; _jh numeric; _flag boolean; _why text;
BEGIN
  IF NEW.transaction_type <> 'issuance' OR NEW.fleet_asset_id IS NULL OR COALESCE(NEW.is_deleted, false) THEN RETURN NEW; END IF;
  IF NEW.odometer_km IS NULL AND NEW.hours_reading IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO _a FROM fleet_assets WHERE id = NEW.fleet_asset_id;
  SELECT COALESCE(max_km_jump, 5000), COALESCE(max_hours_jump, 300) INTO _jkm, _jh FROM fleet_settings WHERE site_id = NEW.site_id LIMIT 1;
  _jkm := COALESCE(_jkm, 5000); _jh := COALESCE(_jh, 300);
  IF NEW.odometer_km IS NOT NULL THEN
    _flag := COALESCE(_a.current_odometer_km, 0) > 0 AND (NEW.odometer_km < _a.current_odometer_km OR NEW.odometer_km - _a.current_odometer_km > _jkm);
    _why := CASE WHEN NOT _flag THEN NULL WHEN NEW.odometer_km < _a.current_odometer_km THEN 'Lower than the last reading (' || _a.current_odometer_km || ' km)'
                 ELSE 'Jump of ' || (NEW.odometer_km - _a.current_odometer_km) || ' km since the last reading' END;
    INSERT INTO fleet_meter_readings (site_id, asset_id, reading_type, reading_value, reading_date, reading_time, source, is_flagged, flag_reason, notes, recorded_by)
    VALUES (NEW.site_id, NEW.fleet_asset_id, 'odometer', NEW.odometer_km, COALESCE(NEW.transaction_date, current_date), localtime, 'fuel', _flag, _why,
            'Fuel ' || COALESCE(NEW.transaction_number, ''), NEW.created_by);
    IF NOT _flag THEN UPDATE fleet_assets SET current_odometer_km = GREATEST(COALESCE(current_odometer_km, 0), NEW.odometer_km), updated_at = now() WHERE id = _a.id; END IF;
  END IF;
  IF NEW.hours_reading IS NOT NULL THEN
    _flag := COALESCE(_a.current_hours, 0) > 0 AND (NEW.hours_reading < _a.current_hours OR NEW.hours_reading - _a.current_hours > _jh);
    _why := CASE WHEN NOT _flag THEN NULL WHEN NEW.hours_reading < _a.current_hours THEN 'Lower than the last reading (' || _a.current_hours || ' h)'
                 ELSE 'Jump of ' || (NEW.hours_reading - _a.current_hours) || ' h since the last reading' END;
    INSERT INTO fleet_meter_readings (site_id, asset_id, reading_type, reading_value, reading_date, reading_time, source, is_flagged, flag_reason, notes, recorded_by)
    VALUES (NEW.site_id, NEW.fleet_asset_id, 'hours', NEW.hours_reading, COALESCE(NEW.transaction_date, current_date), localtime, 'fuel', _flag, _why,
            'Fuel ' || COALESCE(NEW.transaction_number, ''), NEW.created_by);
    IF NOT _flag THEN UPDATE fleet_assets SET current_hours = GREATEST(COALESCE(current_hours, 0), NEW.hours_reading), updated_at = now() WHERE id = _a.id; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_fuel_to_meter ON fuel_transactions;
CREATE TRIGGER trg_fuel_to_meter AFTER INSERT ON fuel_transactions FOR EACH ROW EXECUTE FUNCTION trg_fuel_to_meter();

-- Back-fill prices on existing issues without re-posting the ledger (it already values them this way) or logging edits.
ALTER TABLE fuel_transactions DISABLE TRIGGER trg_gl_fuel_transactions;
ALTER TABLE fuel_transactions DISABLE TRIGGER trg_fuel_txn_b_audit;
ALTER TABLE fuel_transactions DISABLE TRIGGER trg_fuel_txn_a_updated_at;
UPDATE fuel_transactions t SET unit_price = p.price, total_cost = round(t.litres * p.price, 2)
  FROM (SELECT i.id, (SELECT d.unit_price FROM fuel_transactions d WHERE d.site_id = i.site_id AND d.transaction_type = 'delivery'
                        AND NOT COALESCE(d.is_deleted, false) AND COALESCE(d.unit_price, 0) > 0 AND (i.tank_id IS NULL OR d.tank_id = i.tank_id)
                        AND d.transaction_date <= i.transaction_date ORDER BY d.transaction_date DESC, d.created_at DESC LIMIT 1) price
          FROM fuel_transactions i WHERE i.transaction_type = 'issuance' AND COALESCE(i.unit_price, 0) = 0) p
 WHERE t.id = p.id AND p.price IS NOT NULL;
ALTER TABLE fuel_transactions ENABLE TRIGGER trg_gl_fuel_transactions;
ALTER TABLE fuel_transactions ENABLE TRIGGER trg_fuel_txn_b_audit;
ALTER TABLE fuel_transactions ENABLE TRIGGER trg_fuel_txn_a_updated_at;

-- ── One status set ────────────────────────────────────────────────────────────
UPDATE fleet_assets SET status = 'operational' WHERE status = 'active';
UPDATE fleet_assets SET status = 'operational' WHERE status IS NULL;
CREATE OR REPLACE FUNCTION public.trg_fleet_status_normalise() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.status := CASE lower(COALESCE(NEW.status, 'operational'))
    WHEN 'active' THEN 'operational' WHEN 'working' THEN 'operational' WHEN 'in_service' THEN 'maintenance'
    WHEN 'down' THEN 'grounded' WHEN 'disposed' THEN 'decommissioned' WHEN 'archived' THEN 'decommissioned'
    ELSE lower(NEW.status) END;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_fleet_status_normalise ON fleet_assets;
CREATE TRIGGER trg_fleet_status_normalise BEFORE INSERT OR UPDATE OF status ON fleet_assets FOR EACH ROW EXECUTE FUNCTION trg_fleet_status_normalise();
ALTER TABLE fleet_assets DROP CONSTRAINT IF EXISTS fleet_assets_status_check;
ALTER TABLE fleet_assets ADD CONSTRAINT fleet_assets_status_check
  CHECK (status IN ('operational','standby','maintenance','awaiting_parts','grounded','decommissioned'));

-- ── Archive only ──────────────────────────────────────────────────────────────
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public' AND cmd = 'DELETE' AND tablename LIKE 'fleet%' LOOP
    EXECUTE format('DROP POLICY %I ON %I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- ── Papers live in Compliance; the machine shows the latest expiry per kind ───
CREATE OR REPLACE FUNCTION public.trg_fleet_compliance_to_asset() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _asset uuid := COALESCE(NEW.asset_id, OLD.asset_id);
BEGIN
  IF _asset IS NULL THEN RETURN NEW; END IF;
  UPDATE fleet_assets a SET
    licence_expiry    = (SELECT max(expiry_date) FROM fleet_compliance c WHERE c.asset_id = a.id AND NOT COALESCE(c.is_archived, false) AND c.compliance_type ILIKE '%licen%'),
    insurance_expiry  = (SELECT max(expiry_date) FROM fleet_compliance c WHERE c.asset_id = a.id AND NOT COALESCE(c.is_archived, false) AND c.compliance_type ILIKE '%insur%'),
    roadworthy_expiry = (SELECT max(expiry_date) FROM fleet_compliance c WHERE c.asset_id = a.id AND NOT COALESCE(c.is_archived, false) AND c.compliance_type ILIKE '%road%'),
    updated_at = now()
   WHERE a.id = _asset;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_fleet_compliance_to_asset ON fleet_compliance;
CREATE TRIGGER trg_fleet_compliance_to_asset AFTER INSERT OR UPDATE ON fleet_compliance FOR EACH ROW EXECUTE FUNCTION trg_fleet_compliance_to_asset();

-- ── Machines with no recent reading ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fleet_meter_gaps(p_site_id uuid, p_days int DEFAULT 7)
RETURNS TABLE (asset_id uuid, machine text, category text, last_reading_date date, last_reading text, days_without int,
               last_fuel_date date, fuels_since int, last_fuelled_by text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.id, COALESCE(a.fleet_number, a.registration, a.asset_number) || COALESCE(' — ' || NULLIF(concat_ws(' ', a.make, a.model), ''), ''),
         t.category, r.reading_date, r.txt, (current_date - COALESCE(r.reading_date, a.created_at::date))::int,
         f.last_date, f.n::int, f.who
    FROM fleet_assets a LEFT JOIN fleet_asset_types t ON t.id = a.asset_type_id
    LEFT JOIN LATERAL (SELECT m.reading_date, m.reading_value || CASE m.reading_type WHEN 'odometer' THEN ' km' ELSE ' h' END txt
                         FROM fleet_meter_readings m WHERE m.asset_id = a.id AND NOT m.is_flagged ORDER BY m.reading_date DESC, m.created_at DESC LIMIT 1) r ON true
    LEFT JOIN LATERAL (SELECT max(x.transaction_date) last_date, count(*) FILTER (WHERE x.transaction_date > COALESCE(r.reading_date, DATE '1900-01-01')) n,
                              (SELECT COALESCE(e.name, p.full_name) FROM fuel_transactions y LEFT JOIN fuel_operators o ON o.id = y.operator_id
                                 LEFT JOIN employees e ON e.id = o.employee_id LEFT JOIN profiles p ON p.id = y.created_by
                                WHERE y.fleet_asset_id = a.id AND y.transaction_type = 'issuance' AND NOT COALESCE(y.is_deleted, false)
                                ORDER BY y.transaction_date DESC, y.created_at DESC LIMIT 1) who
                         FROM fuel_transactions x WHERE x.fleet_asset_id = a.id AND x.transaction_type = 'issuance' AND NOT COALESCE(x.is_deleted, false)) f ON true
   WHERE a.site_id = p_site_id AND NOT COALESCE(a.is_archived, false) AND a.status <> 'decommissioned' AND _has_permission('fleet.view', p_site_id)
     AND (r.reading_date IS NULL OR r.reading_date < current_date - p_days)
   ORDER BY f.n DESC NULLS LAST, 2;
$$;
GRANT EXECUTE ON FUNCTION fleet_meter_gaps(uuid, int) TO authenticated;

INSERT INTO schema_migrations (filename) VALUES ('0239_fleet_a1_correct.sql') ON CONFLICT DO NOTHING;
