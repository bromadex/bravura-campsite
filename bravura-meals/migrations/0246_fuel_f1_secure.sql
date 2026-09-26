-- 0246 — Fuel F1 part 1 (#69): secure and consistent.
--  • Security: fuel.* permissions instead of "anyone at the site" (site_write ALL) on transactions, tanks, pumps, operators,
--    types, settings, finance mapping, calibrations. No hard deletes anywhere (delete policies dropped).
--  • One delivery = one record: fuel_deliveries.transaction_id links the companion delivery transaction; fuel_delivery_save /
--    fuel_delivery_void write both in one step, with a tank-capacity check. Existing deliveries linked; the four Apr–May
--    deliveries get their missing transactions (history, before go-live — nothing posts).
--  • Transfers count: transfer_out / transfer_in move tank levels (issuance-tracked tanks); fuel_transfer RPC writes the pair.
--  • Dip gap: every dip gets system_level_litres (previous dip + deliveries − issues ± transfers since) and variance;
--    fuel_tanks.dip_tolerance_litres (default 120 L ≈ ±2 cm on the Kamativi Main Tank). Existing 50 dips back-filled.
--  • fuel_tank_position(site): last dip, movements since, book level now, days of cover.

-- ── Security ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._fuel_any(p_codes text[]) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id
                  WHERE ur.user_id = auth.uid() AND p.code = ANY (p_codes));
$$;

DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT tablename, policyname FROM pg_policies
            WHERE schemaname = 'public'
              AND ((tablename IN ('fuel_transactions','fuel_tanks','fuel_pumps','fuel_operators','fuel_vehicles','fuel_equipment') AND policyname = 'site_write')
                OR (tablename = 'fuel_types' AND policyname = 'fuel_types: auth write')
                OR (tablename = 'fuel_settings' AND policyname = 'fuel_settings_write')
                OR (tablename = 'fuel_finance_mapping' AND policyname = 'fuel_finance_mapping_write')
                OR (tablename = 'tank_calibrations' AND policyname IN ('tank_calibrations_delete','tank_calibrations_insert'))
                OR policyname IN ('fuel_transactions_delete','fuel_deliveries_delete','fuel_dip_readings_delete'))
  LOOP EXECUTE format('DROP POLICY %I ON %I', r.policyname, r.tablename); END LOOP;
END $$;

CREATE POLICY fuel_transactions_insert ON fuel_transactions FOR INSERT TO authenticated
  WITH CHECK (_user_has_fuel_perm(site_id, ARRAY['fuel.create','fuel.edit']));
CREATE POLICY fuel_tanks_insert ON fuel_tanks FOR INSERT TO authenticated WITH CHECK (_user_has_fuel_perm(site_id, ARRAY['fuel.edit']));
CREATE POLICY fuel_tanks_update ON fuel_tanks FOR UPDATE TO authenticated USING (_user_has_fuel_perm(site_id, ARRAY['fuel.edit']));
CREATE POLICY fuel_pumps_insert ON fuel_pumps FOR INSERT TO authenticated WITH CHECK (_user_has_fuel_perm(site_id, ARRAY['fuel.edit']));
CREATE POLICY fuel_pumps_update ON fuel_pumps FOR UPDATE TO authenticated USING (_user_has_fuel_perm(site_id, ARRAY['fuel.edit']));
CREATE POLICY fuel_operators_insert ON fuel_operators FOR INSERT TO authenticated WITH CHECK (_user_has_fuel_perm(site_id, ARRAY['fuel.create','fuel.edit']));
CREATE POLICY fuel_operators_update ON fuel_operators FOR UPDATE TO authenticated USING (_user_has_fuel_perm(site_id, ARRAY['fuel.edit']));
CREATE POLICY fuel_types_insert ON fuel_types FOR INSERT TO authenticated WITH CHECK (_fuel_any(ARRAY['fuel.edit']));
CREATE POLICY fuel_types_update ON fuel_types FOR UPDATE TO authenticated USING (_fuel_any(ARRAY['fuel.edit']));
CREATE POLICY fuel_settings_insert ON fuel_settings FOR INSERT TO authenticated WITH CHECK (_user_has_fuel_perm(site_id, ARRAY['fuel.edit']));
CREATE POLICY fuel_settings_update ON fuel_settings FOR UPDATE TO authenticated USING (_user_has_fuel_perm(site_id, ARRAY['fuel.edit']));
CREATE POLICY fuel_finance_mapping_insert ON fuel_finance_mapping FOR INSERT TO authenticated WITH CHECK (_user_has_fuel_perm(site_id, ARRAY['fuel.edit']));
CREATE POLICY fuel_finance_mapping_update ON fuel_finance_mapping FOR UPDATE TO authenticated USING (_user_has_fuel_perm(site_id, ARRAY['fuel.edit']));

ALTER TABLE tank_calibrations ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false;
ALTER TABLE tank_calibrations ADD COLUMN IF NOT EXISTS archived_at timestamptz;
CREATE POLICY tank_calibrations_insert ON tank_calibrations FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM fuel_tanks ft WHERE ft.id = tank_id AND _user_has_fuel_perm(ft.site_id, ARRAY['fuel.edit'])));
CREATE POLICY tank_calibrations_update ON tank_calibrations FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM fuel_tanks ft WHERE ft.id = tank_id AND _user_has_fuel_perm(ft.site_id, ARRAY['fuel.edit'])));

-- ── Transfers move tank levels ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._fuel_txn_level_effect(p_type text, p_litres numeric, p_deleted boolean) RETURNS numeric
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN COALESCE(p_deleted, false) THEN 0
    WHEN p_type IN ('issuance','transfer_out') THEN -COALESCE(p_litres, 0)
    WHEN p_type IN ('delivery','transfer_in')  THEN  COALESCE(p_litres, 0)
    ELSE 0
  END;
$$;
-- The insert trigger only handled issuance; make inserts use the same effect as updates.
CREATE OR REPLACE FUNCTION public.fuel_update_tank_level() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _e numeric := _fuel_txn_level_effect(NEW.transaction_type, NEW.litres, NEW.is_deleted);
BEGIN
  IF _e <> 0 THEN
    UPDATE fuel_tanks SET current_level_litres = GREATEST(current_level_litres + _e, 0), updated_at = now()
     WHERE id = NEW.tank_id AND level_tracking_method = 'issuance';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public._fuel_next_no(p_site uuid, p_type text) RETURNS text
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  SELECT doc_next_number(p_site, CASE p_type WHEN 'delivery' THEN 'FD' WHEN 'transfer_out' THEN 'FT' WHEN 'transfer_in' THEN 'FT' ELSE 'FI' END);
$$;

-- p: {from_tank_id, to_tank_id, litres, date, docket, notes}
CREATE OR REPLACE FUNCTION public.fuel_transfer(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _f fuel_tanks%ROWTYPE; _t fuel_tanks%ROWTYPE; _l numeric := (p->>'litres')::numeric; _d date := COALESCE(NULLIF(p->>'date','')::date, CURRENT_DATE);
        _out uuid; _no text; _pos jsonb;
BEGIN
  SELECT * INTO _f FROM fuel_tanks WHERE id = (p->>'from_tank_id')::uuid;
  SELECT * INTO _t FROM fuel_tanks WHERE id = (p->>'to_tank_id')::uuid;
  IF _f.id IS NULL OR _t.id IS NULL THEN RAISE EXCEPTION 'Choose both tanks'; END IF;
  IF _f.id = _t.id THEN RAISE EXCEPTION 'Choose two different tanks'; END IF;
  IF _f.site_id <> _t.site_id THEN RAISE EXCEPTION 'Both tanks must be at the same site'; END IF;
  IF NOT _user_has_fuel_perm(_f.site_id, ARRAY['fuel.create','fuel.edit']) THEN RAISE EXCEPTION 'You do not have permission to move fuel'; END IF;
  IF COALESCE(_l, 0) <= 0 THEN RAISE EXCEPTION 'Enter the litres'; END IF;
  _pos := _fuel_tank_book(_t.id);
  IF _t.capacity_litres IS NOT NULL AND (_pos->>'book')::numeric + _l > _t.capacity_litres * 1.02 THEN
    RAISE EXCEPTION '% holds % L and has about % L in it — % L will not fit', _t.name, _t.capacity_litres, round((_pos->>'book')::numeric), _l;
  END IF;
  _no := _fuel_next_no(_f.site_id, 'transfer_out');
  INSERT INTO fuel_transactions (site_id, transaction_number, transaction_date, tank_id, transaction_type, litres, docket_number, notes, created_by)
  VALUES (_f.site_id, _no, _d, _f.id, 'transfer_out', _l, NULLIF(p->>'docket',''), concat_ws('. ', 'To ' || _t.name, NULLIF(p->>'notes','')), auth.uid())
  RETURNING id INTO _out;
  INSERT INTO fuel_transactions (site_id, transaction_number, transaction_date, tank_id, transaction_type, litres, docket_number, notes, original_transaction_id, created_by)
  VALUES (_f.site_id, _no, _d, _t.id, 'transfer_in', _l, NULLIF(p->>'docket',''), concat_ws('. ', 'From ' || _f.name, NULLIF(p->>'notes','')), _out, auth.uid());
  RETURN jsonb_build_object('number', _no, 'litres', _l, 'from', _f.name, 'to', _t.name);
END $$;

-- ── Book level and dip gap ────────────────────────────────────────────────────
ALTER TABLE fuel_tanks ADD COLUMN IF NOT EXISTS dip_tolerance_litres numeric NOT NULL DEFAULT 120;
ALTER TABLE fuel_dip_readings ALTER COLUMN variance_percent TYPE numeric(10,2);

-- Movements in (from, to]; dates only (fills carry no time).
CREATE OR REPLACE FUNCTION public._fuel_moves(p_tank uuid, p_from date, p_to date) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(sum(_fuel_txn_level_effect(transaction_type, litres, is_deleted)), 0)
    FROM fuel_transactions WHERE tank_id = p_tank AND transaction_date > p_from AND transaction_date <= p_to;
$$;

CREATE OR REPLACE FUNCTION public._fuel_tank_book(p_tank uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _t fuel_tanks%ROWTYPE; _dip record; _mv numeric;
BEGIN
  SELECT * INTO _t FROM fuel_tanks WHERE id = p_tank;
  SELECT reading_date, level_litres INTO _dip FROM fuel_dip_readings
   WHERE tank_id = p_tank AND NOT is_archived ORDER BY reading_date DESC, reading_time DESC NULLS LAST, created_at DESC LIMIT 1;
  IF _dip.reading_date IS NULL OR _t.level_tracking_method = 'issuance' THEN
    RETURN jsonb_build_object('book', COALESCE(_t.current_level_litres, 0), 'basis', 'running total', 'last_dip_date', _dip.reading_date, 'last_dip', _dip.level_litres);
  END IF;
  _mv := _fuel_moves(p_tank, _dip.reading_date, CURRENT_DATE);
  RETURN jsonb_build_object('book', GREATEST(_dip.level_litres + _mv, 0), 'basis', 'last dip + movements since', 'last_dip_date', _dip.reading_date,
                            'last_dip', _dip.level_litres, 'moves_since', _mv);
END $$;

CREATE OR REPLACE FUNCTION public.trg_fuel_dip_gap() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _prev record;
BEGIN
  IF NEW.level_litres IS NULL THEN RETURN NEW; END IF;
  SELECT reading_date, level_litres INTO _prev FROM fuel_dip_readings
   WHERE tank_id = NEW.tank_id AND NOT is_archived AND id <> NEW.id
     AND (reading_date < NEW.reading_date OR (reading_date = NEW.reading_date AND COALESCE(reading_time, '00:00') < COALESCE(NEW.reading_time, '23:59')))
   ORDER BY reading_date DESC, reading_time DESC NULLS LAST, created_at DESC LIMIT 1;
  IF _prev.reading_date IS NULL THEN
    NEW.system_level_litres := NULL; NEW.variance_litres := NULL; NEW.variance_percent := NULL; RETURN NEW;
  END IF;
  NEW.system_level_litres := round(_prev.level_litres + _fuel_moves(NEW.tank_id, _prev.reading_date, NEW.reading_date), 1);
  NEW.variance_litres := round(NEW.level_litres - NEW.system_level_litres, 1);
  NEW.variance_percent := CASE WHEN NEW.system_level_litres > 0 THEN round(100 * NEW.variance_litres / NEW.system_level_litres, 2) END;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_fuel_dip_gap ON fuel_dip_readings;
CREATE TRIGGER trg_fuel_dip_gap BEFORE INSERT OR UPDATE OF level_litres, reading_date, reading_time, tank_id ON fuel_dip_readings
  FOR EACH ROW EXECUTE FUNCTION trg_fuel_dip_gap();

-- Back-fill the existing dips in order (only the computed columns change; the audit log records it).
DO $$ DECLARE r record; _prev record; BEGIN
  FOR r IN SELECT * FROM fuel_dip_readings WHERE NOT is_archived ORDER BY tank_id, reading_date, reading_time NULLS FIRST, created_at LOOP
    SELECT reading_date, level_litres INTO _prev FROM fuel_dip_readings
     WHERE tank_id = r.tank_id AND NOT is_archived AND id <> r.id
       AND (reading_date < r.reading_date OR (reading_date = r.reading_date AND COALESCE(reading_time, '00:00') < COALESCE(r.reading_time, '23:59')))
     ORDER BY reading_date DESC, reading_time DESC NULLS LAST, created_at DESC LIMIT 1;
    UPDATE fuel_dip_readings SET
      system_level_litres = CASE WHEN _prev.reading_date IS NOT NULL THEN round(_prev.level_litres + _fuel_moves(r.tank_id, _prev.reading_date, r.reading_date), 1) END,
      variance_litres = CASE WHEN _prev.reading_date IS NOT NULL THEN round(r.level_litres - (_prev.level_litres + _fuel_moves(r.tank_id, _prev.reading_date, r.reading_date)), 1) END
     WHERE id = r.id;
  END LOOP;
  UPDATE fuel_dip_readings SET variance_percent = round(100 * variance_litres / NULLIF(system_level_litres, 0), 2) WHERE variance_litres IS NOT NULL;
END $$;

CREATE OR REPLACE FUNCTION public.fuel_tank_position(p_site_id uuid) RETURNS TABLE
  (tank_id uuid, tank text, fuel_type text, capacity numeric, method text, last_dip_date date, last_dip numeric, book_level numeric,
   pct_full numeric, use_per_day numeric, days_cover numeric, gap_30d numeric, issued_30d numeric, tolerance numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT _user_has_fuel_perm(p_site_id, ARRAY['fuel.view','fuel.create','fuel.edit']) THEN RAISE EXCEPTION 'No access'; END IF;
  RETURN QUERY
  SELECT t.id, t.name, ft.name, t.capacity_litres, t.level_tracking_method, (b->>'last_dip_date')::date, (b->>'last_dip')::numeric,
         round((b->>'book')::numeric), round(100 * (b->>'book')::numeric / NULLIF(t.capacity_litres, 0), 0),
         round(u.l / 30.0, 0), round((b->>'book')::numeric / NULLIF(u.l / 30.0, 0), 1),
         (SELECT round(sum(variance_litres)) FROM fuel_dip_readings d WHERE d.tank_id = t.id AND NOT d.is_archived AND d.reading_date > CURRENT_DATE - 30),
         round(u.l), t.dip_tolerance_litres
    FROM fuel_tanks t
    LEFT JOIN fuel_types ft ON ft.id = t.fuel_type_id
    CROSS JOIN LATERAL (SELECT _fuel_tank_book(t.id) b) bb
    CROSS JOIN LATERAL (SELECT COALESCE(sum(litres), 0) l FROM fuel_transactions x WHERE x.tank_id = t.id AND x.transaction_type = 'issuance'
                         AND NOT COALESCE(x.is_deleted, false) AND x.transaction_date > CURRENT_DATE - 30) u
   WHERE t.site_id = p_site_id AND NOT COALESCE(t.is_archived, false)
   ORDER BY t.name;
END $$;

-- ── One delivery = one record ─────────────────────────────────────────────────
ALTER TABLE fuel_deliveries ADD COLUMN IF NOT EXISTS transaction_id uuid REFERENCES fuel_transactions(id);

-- Link existing deliveries to their companion transaction (same tank, date and litres).
UPDATE fuel_deliveries d SET transaction_id = (
  SELECT t.id FROM fuel_transactions t WHERE t.transaction_type = 'delivery' AND t.tank_id = d.tank_id AND t.transaction_date = d.delivery_date
     AND t.litres = d.quantity_delivered AND COALESCE(t.is_deleted, false) = d.is_archived
     AND NOT EXISTS (SELECT 1 FROM fuel_deliveries o WHERE o.transaction_id = t.id)
   ORDER BY t.created_at LIMIT 1)
 WHERE d.transaction_id IS NULL;

-- Deliveries with no transaction (Apr–May history): create it. Before go-live, dip-tracked tank → no GL, no level change.
DO $$ DECLARE r record; _id uuid; BEGIN
  FOR r IN SELECT * FROM fuel_deliveries WHERE transaction_id IS NULL AND NOT is_archived LOOP
    INSERT INTO fuel_transactions (site_id, transaction_number, transaction_date, tank_id, transaction_type, litres, unit_price, total_cost,
                                   supplier, docket_number, notes, created_at, created_by, edit_reason)
    VALUES (r.site_id, COALESCE(r.delivery_number, _fuel_next_no(r.site_id, 'delivery')), r.delivery_date, r.tank_id, 'delivery', r.quantity_delivered,
            r.unit_price, r.total_cost, r.supplier_name, r.delivery_note_number, 'Delivery record (history)', r.created_at, r.created_by,
            'Created from Tank Deliveries so the tank history is complete (0246)')
    RETURNING id INTO _id;
    UPDATE fuel_deliveries SET transaction_id = _id WHERE id = r.id;
  END LOOP;
END $$;

-- p: {id?, site_id, tank_id, delivery_date, supplier_name, delivery_note_number, quantity_ordered, quantity_delivered, unit_price,
--     total_cost, dip_before_mm, dip_before, dip_after_mm, dip_after, receiving_officer, notes, delivery_time}
CREATE OR REPLACE FUNCTION public.fuel_delivery_save(p jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid := NULLIF(p->>'id','')::uuid; _d fuel_deliveries%ROWTYPE; _t fuel_tanks%ROWTYPE; _q numeric := (p->>'quantity_delivered')::numeric;
        _price numeric := NULLIF(p->>'unit_price','')::numeric; _total numeric := NULLIF(p->>'total_cost','')::numeric; _tx uuid; _before numeric;
        _date date := COALESCE(NULLIF(p->>'delivery_date','')::date, CURRENT_DATE);
BEGIN
  SELECT * INTO _t FROM fuel_tanks WHERE id = (p->>'tank_id')::uuid;
  IF _t.id IS NULL THEN RAISE EXCEPTION 'Choose the tank'; END IF;
  IF NOT _user_has_fuel_perm(_t.site_id, CASE WHEN _id IS NULL THEN ARRAY['fuel.create','fuel.edit'] ELSE ARRAY['fuel.edit','fuel.approve'] END) THEN
    RAISE EXCEPTION 'You do not have permission to % deliveries', CASE WHEN _id IS NULL THEN 'record' ELSE 'change' END;
  END IF;
  IF COALESCE(_q, 0) <= 0 THEN RAISE EXCEPTION 'Enter the litres delivered'; END IF;
  IF COALESCE(trim(p->>'supplier_name'), '') = '' THEN RAISE EXCEPTION 'Enter the supplier'; END IF;
  _total := COALESCE(_total, round(_q * _price, 2));
  _price := COALESCE(_price, round(_total / _q, 4));
  -- Will it fit? Dip before the delivery if given, else the book level.
  _before := COALESCE(NULLIF(p->>'dip_before','')::numeric, (_fuel_tank_book(_t.id)->>'book')::numeric);
  IF _id IS NULL AND _t.capacity_litres IS NOT NULL AND _before + _q > _t.capacity_litres * 1.02 THEN
    RAISE EXCEPTION '% holds % L and had about % L before this delivery — % L will not fit. Check the litres or the dip.',
      _t.name, _t.capacity_litres, round(_before), _q;
  END IF;
  IF _id IS NULL THEN
    INSERT INTO fuel_transactions (site_id, transaction_number, transaction_date, tank_id, transaction_type, litres, unit_price, total_cost,
                                   supplier, docket_number, notes, created_by)
    VALUES (_t.site_id, _fuel_next_no(_t.site_id, 'delivery'), _date, _t.id, 'delivery', _q, _price, _total, trim(p->>'supplier_name'),
            NULLIF(trim(p->>'delivery_note_number'), ''), concat_ws(' | ', 'Received by: ' || NULLIF(trim(p->>'receiving_officer'), ''), NULLIF(trim(p->>'notes'), '')), auth.uid())
    RETURNING id INTO _tx;
    INSERT INTO fuel_deliveries (site_id, delivery_number, tank_id, supplier_name, delivery_note_number, delivery_date, quantity_ordered, quantity_delivered,
                                 unit_price, total_cost, dip_before, dip_after, dip_before_mm, dip_after_mm, receiving_officer, notes, status, created_by, transaction_id)
    VALUES (_t.site_id, (SELECT transaction_number FROM fuel_transactions WHERE id = _tx), _t.id, trim(p->>'supplier_name'), NULLIF(trim(p->>'delivery_note_number'), ''),
            _date, NULLIF(p->>'quantity_ordered','')::numeric, _q, _price, _total, NULLIF(p->>'dip_before','')::numeric, NULLIF(p->>'dip_after','')::numeric,
            NULLIF(p->>'dip_before_mm','')::numeric, NULLIF(p->>'dip_after_mm','')::numeric, NULLIF(trim(p->>'receiving_officer'), ''), NULLIF(trim(p->>'notes'), ''),
            'confirmed', auth.uid(), _tx)
    RETURNING id INTO _id;
  ELSE
    SELECT * INTO _d FROM fuel_deliveries WHERE id = _id FOR UPDATE;
    IF _d.id IS NULL OR _d.is_archived THEN RAISE EXCEPTION 'Delivery not found'; END IF;
    UPDATE fuel_deliveries SET tank_id = _t.id, supplier_name = trim(p->>'supplier_name'), delivery_note_number = NULLIF(trim(p->>'delivery_note_number'), ''),
           delivery_date = _date, quantity_ordered = NULLIF(p->>'quantity_ordered','')::numeric, quantity_delivered = _q, unit_price = _price, total_cost = _total,
           dip_before = NULLIF(p->>'dip_before','')::numeric, dip_after = NULLIF(p->>'dip_after','')::numeric,
           dip_before_mm = NULLIF(p->>'dip_before_mm','')::numeric, dip_after_mm = NULLIF(p->>'dip_after_mm','')::numeric,
           receiving_officer = NULLIF(trim(p->>'receiving_officer'), ''), notes = NULLIF(trim(p->>'notes'), ''), updated_by = auth.uid()
     WHERE id = _id;
    UPDATE fuel_transactions SET tank_id = _t.id, transaction_date = _date, litres = _q, unit_price = _price, total_cost = _total,
           supplier = trim(p->>'supplier_name'), docket_number = NULLIF(trim(p->>'delivery_note_number'), ''), updated_by = auth.uid(),
           edit_reason = COALESCE(NULLIF(trim(p->>'edit_reason'), ''), 'Delivery corrected')
     WHERE id = _d.transaction_id;
  END IF;
  -- A dip after the delivery is also a dip reading.
  IF NULLIF(p->>'dip_after','')::numeric IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM fuel_dip_readings WHERE tank_id = _t.id AND reading_date = _date AND level_litres = (p->>'dip_after')::numeric AND NOT is_archived) THEN
    INSERT INTO fuel_dip_readings (site_id, tank_id, reading_date, reading_time, dip_start_mm, dip_end_mm, dip_mm, level_start_litres, level_end_litres, level_litres,
                                   read_by, notes, recorded_by)
    VALUES (_t.site_id, _t.id, _date, NULLIF(p->>'delivery_time','')::time, NULLIF(p->>'dip_before_mm','')::numeric, NULLIF(p->>'dip_after_mm','')::numeric,
            NULLIF(p->>'dip_after_mm','')::numeric, NULLIF(p->>'dip_before','')::numeric, (p->>'dip_after')::numeric, (p->>'dip_after')::numeric,
            NULLIF(trim(p->>'receiving_officer'), ''), 'Dip after delivery', auth.uid());
  END IF;
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.fuel_delivery_void(p_id uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _d fuel_deliveries%ROWTYPE;
BEGIN
  SELECT * INTO _d FROM fuel_deliveries WHERE id = p_id FOR UPDATE;
  IF _d.id IS NULL OR _d.is_archived THEN RAISE EXCEPTION 'Delivery not found'; END IF;
  IF NOT _user_has_fuel_perm(_d.site_id, ARRAY['fuel.edit','fuel.approve']) THEN RAISE EXCEPTION 'You do not have permission to cancel deliveries'; END IF;
  IF COALESCE(trim(p_reason), '') = '' THEN RAISE EXCEPTION 'Say why this delivery is being cancelled'; END IF;
  UPDATE fuel_deliveries SET is_archived = true, archived_at = now(), status = 'cancelled', query_notes = trim(p_reason), updated_by = auth.uid() WHERE id = p_id;
  UPDATE fuel_transactions SET is_deleted = true, deleted_at = now(), deleted_by = auth.uid(), edit_reason = 'Delivery cancelled: ' || trim(p_reason)
   WHERE id = _d.transaction_id AND NOT COALESCE(is_deleted, false);
END $$;

GRANT EXECUTE ON FUNCTION public.fuel_transfer(jsonb), public.fuel_tank_position(uuid), public.fuel_delivery_save(jsonb),
  public.fuel_delivery_void(uuid, text) TO authenticated;

INSERT INTO schema_migrations (filename) VALUES ('0246_fuel_f1_secure.sql') ON CONFLICT DO NOTHING;
