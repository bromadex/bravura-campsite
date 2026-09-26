-- 0248 Fuel F2 (#70): daily reconciliation, dip corrections, pump shifts, month-end loss/gain.
-- Each dip is compared with the book (previous dip + moves since) by trg_fuel_dip_gap (0246). Here:
--  * a gap over the tank's tolerance needs a reason (anyone with fuel.edit) and a sign-off (fuel.approve);
--    fuel.approve holders are notified when it happens.
--  * a mistyped dip is corrected with fuel_dip_correct (old/new value + reason in fuel_dip_corrections);
--    the next dip's gap is recomputed.
--  * pump shifts: totaliser read at open and close; pump litres vs litres recorded on that pump.
--  * month-end: fuel_month_close posts the month's net dip gaps per tank as a Stores count (source 'fuel')
--    and to the ledger as fuel_loss / fuel_gain, once every big gap is signed off. Finance is told.

ALTER TABLE fuel_dip_readings
  ADD COLUMN IF NOT EXISTS gap_status text NOT NULL DEFAULT 'ok',
  ADD COLUMN IF NOT EXISTS gap_reason text,
  ADD COLUMN IF NOT EXISTS gap_explained_by uuid,
  ADD COLUMN IF NOT EXISTS gap_signed_by uuid,
  ADD COLUMN IF NOT EXISTS gap_signed_at timestamptz,
  ADD COLUMN IF NOT EXISTS month_close_id uuid;
ALTER TABLE fuel_dip_readings DROP CONSTRAINT IF EXISTS fuel_dip_gap_status_chk;
ALTER TABLE fuel_dip_readings ADD CONSTRAINT fuel_dip_gap_status_chk CHECK (gap_status IN ('ok','needs_reason','explained','signed_off'));

ALTER TABLE fuel_tanks ADD COLUMN IF NOT EXISTS stores_from timestamptz;
UPDATE fuel_tanks k SET stores_from = COALESCE((SELECT min(m.created_at) FROM inventory_movements m
   WHERE m.warehouse_id = k.warehouse_id AND m.movement_type = 'opening' AND m.source_module = 'fuel'), now())
 WHERE stores_from IS NULL;

CREATE TABLE IF NOT EXISTS fuel_dip_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dip_id uuid NOT NULL REFERENCES fuel_dip_readings(id),
  site_id uuid NOT NULL,
  old_litres numeric, new_litres numeric, old_mm numeric, new_mm numeric,
  reason text NOT NULL,
  corrected_by uuid DEFAULT auth.uid(), corrected_at timestamptz DEFAULT now());
ALTER TABLE fuel_dip_corrections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fdc_select ON fuel_dip_corrections;
CREATE POLICY fdc_select ON fuel_dip_corrections FOR SELECT TO authenticated
  USING (_user_has_fuel_perm(site_id, ARRAY['fuel.view','fuel.create','fuel.edit']));

CREATE TABLE IF NOT EXISTS fuel_pump_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL,
  pump_id uuid NOT NULL REFERENCES fuel_pumps(id),
  shift_date date NOT NULL DEFAULT CURRENT_DATE,
  shift text,
  open_reading numeric NOT NULL, opened_by uuid DEFAULT auth.uid(), opened_at timestamptz DEFAULT now(),
  close_reading numeric, closed_by uuid, closed_at timestamptz, close_date date,
  pump_litres numeric, recorded_litres numeric, gap_litres numeric,
  reason text, status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','cancelled')),
  is_archived boolean NOT NULL DEFAULT false);
ALTER TABLE fuel_pump_shifts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fps_select ON fuel_pump_shifts;
CREATE POLICY fps_select ON fuel_pump_shifts FOR SELECT TO authenticated
  USING (_user_has_fuel_perm(site_id, ARRAY['fuel.view','fuel.create','fuel.edit']));

CREATE TABLE IF NOT EXISTS fuel_month_closes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL, tank_id uuid NOT NULL REFERENCES fuel_tanks(id),
  month date NOT NULL, litres numeric NOT NULL, value numeric NOT NULL,
  dips int NOT NULL, movement_id uuid, journal_id uuid,
  closed_by uuid DEFAULT auth.uid(), closed_at timestamptz DEFAULT now(),
  UNIQUE (tank_id, month));
ALTER TABLE fuel_month_closes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fmc_select ON fuel_month_closes;
CREATE POLICY fmc_select ON fuel_month_closes FOR SELECT TO authenticated
  USING (_user_has_fuel_perm(site_id, ARRAY['fuel.view','fuel.create','fuel.edit']) OR _has_permission('finance.view', site_id));

-- gap check + status + alert
CREATE OR REPLACE FUNCTION public.trg_fuel_dip_gap()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _prev record; _tol numeric; _tank text;
BEGIN
  IF NEW.level_litres IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.month_close_id IS NOT NULL AND NEW.level_litres IS DISTINCT FROM OLD.level_litres THEN
    RAISE EXCEPTION 'This dip is in a closed fuel month and cannot be changed';
  END IF;
  SELECT reading_date, level_litres INTO _prev FROM fuel_dip_readings
   WHERE tank_id = NEW.tank_id AND NOT is_archived AND id <> NEW.id
     AND (reading_date < NEW.reading_date OR (reading_date = NEW.reading_date AND COALESCE(reading_time, '00:00') < COALESCE(NEW.reading_time, '23:59')))
   ORDER BY reading_date DESC, reading_time DESC NULLS LAST, created_at DESC LIMIT 1;
  IF _prev.reading_date IS NULL THEN
    NEW.system_level_litres := NULL; NEW.variance_litres := NULL; NEW.variance_percent := NULL; NEW.gap_status := 'ok'; RETURN NEW;
  END IF;
  NEW.system_level_litres := round(_prev.level_litres + _fuel_moves(NEW.tank_id, _prev.reading_date, NEW.reading_date), 1);
  NEW.variance_litres := round(NEW.level_litres - NEW.system_level_litres, 1);
  NEW.variance_percent := CASE WHEN NEW.system_level_litres > 0 THEN round(100 * NEW.variance_litres / NEW.system_level_litres, 2) END;
  IF TG_OP = 'UPDATE' AND NEW.variance_litres IS NOT DISTINCT FROM OLD.variance_litres THEN RETURN NEW; END IF;
  SELECT COALESCE(dip_tolerance_litres, 120), name INTO _tol, _tank FROM fuel_tanks WHERE id = NEW.tank_id;
  IF abs(NEW.variance_litres) <= _tol THEN
    NEW.gap_status := 'ok';
  ELSE
    NEW.gap_status := 'needs_reason'; NEW.gap_signed_by := NULL; NEW.gap_signed_at := NULL;
    IF NOT NEW.is_archived AND NEW.reading_date >= CURRENT_DATE - 3 THEN
      PERFORM _notify_permission(NEW.site_id, 'fuel.approve', 'warning', 'Fuel dip gap: ' || _tank,
        _tank || ' dip on ' || to_char(NEW.reading_date, 'DD Mon') || ' is ' || NEW.level_litres || ' L, the book says ' || NEW.system_level_litres
        || ' L (' || CASE WHEN NEW.variance_litres > 0 THEN '+' ELSE '' END || NEW.variance_litres || ' L). Needs a reason and sign-off.',
        'fuel_reconciliation', 'reminder');
    END IF;
  END IF;
  RETURN NEW;
END $function$;

-- statuses for dips already in the table
UPDATE fuel_dip_readings d SET gap_status = CASE WHEN abs(d.variance_litres) > COALESCE(k.dip_tolerance_litres, 120) THEN 'needs_reason' ELSE 'ok' END
  FROM fuel_tanks k WHERE k.id = d.tank_id AND d.variance_litres IS NOT NULL;

CREATE OR REPLACE FUNCTION fuel_dip_explain(p_id uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _d fuel_dip_readings%ROWTYPE;
BEGIN
  SELECT * INTO _d FROM fuel_dip_readings WHERE id = p_id FOR UPDATE;
  IF _d.id IS NULL THEN RAISE EXCEPTION 'Dip not found'; END IF;
  IF NOT _user_has_fuel_perm(_d.site_id, ARRAY['fuel.edit','fuel.approve']) THEN RAISE EXCEPTION 'You do not have permission to explain dip gaps'; END IF;
  IF COALESCE(trim(p_reason), '') = '' THEN RAISE EXCEPTION 'Say what caused the gap'; END IF;
  IF _d.month_close_id IS NOT NULL THEN RAISE EXCEPTION 'This month is closed'; END IF;
  UPDATE fuel_dip_readings SET gap_reason = trim(p_reason), gap_explained_by = auth.uid(),
         gap_status = CASE WHEN gap_status = 'ok' THEN 'ok' ELSE 'explained' END, gap_signed_by = NULL, gap_signed_at = NULL
   WHERE id = p_id;
END $$;

CREATE OR REPLACE FUNCTION fuel_dip_sign_off(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _d fuel_dip_readings%ROWTYPE;
BEGIN
  SELECT * INTO _d FROM fuel_dip_readings WHERE id = p_id FOR UPDATE;
  IF _d.id IS NULL THEN RAISE EXCEPTION 'Dip not found'; END IF;
  IF NOT _user_has_fuel_perm(_d.site_id, ARRAY['fuel.approve']) THEN RAISE EXCEPTION 'Only fuel approvers can sign off a gap'; END IF;
  IF _d.gap_status = 'needs_reason' THEN RAISE EXCEPTION 'Add a reason first'; END IF;
  IF _d.gap_status <> 'explained' THEN RAISE EXCEPTION 'Nothing to sign off'; END IF;
  UPDATE fuel_dip_readings SET gap_status = 'signed_off', gap_signed_by = auth.uid(), gap_signed_at = now() WHERE id = p_id;
END $$;

CREATE OR REPLACE FUNCTION fuel_dip_correct(p_id uuid, p_litres numeric, p_mm numeric, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _d fuel_dip_readings%ROWTYPE; _next uuid;
BEGIN
  SELECT * INTO _d FROM fuel_dip_readings WHERE id = p_id FOR UPDATE;
  IF _d.id IS NULL OR _d.is_archived THEN RAISE EXCEPTION 'Dip not found'; END IF;
  IF NOT _user_has_fuel_perm(_d.site_id, ARRAY['fuel.edit','fuel.approve']) THEN RAISE EXCEPTION 'You do not have permission to correct dips'; END IF;
  IF COALESCE(trim(p_reason), '') = '' THEN RAISE EXCEPTION 'Say why the dip is being corrected'; END IF;
  IF p_litres IS NULL OR p_litres < 0 THEN RAISE EXCEPTION 'Enter the correct litres'; END IF;
  IF _d.month_close_id IS NOT NULL THEN RAISE EXCEPTION 'This dip is in a closed fuel month'; END IF;
  INSERT INTO fuel_dip_corrections (dip_id, site_id, old_litres, new_litres, old_mm, new_mm, reason)
  VALUES (p_id, _d.site_id, _d.level_litres, p_litres, _d.dip_mm, COALESCE(p_mm, _d.dip_mm), trim(p_reason));
  UPDATE fuel_dip_readings SET level_litres = p_litres, dip_mm = COALESCE(p_mm, dip_mm), updated_at = now(), updated_by = auth.uid(),
         gap_reason = NULL, gap_signed_by = NULL, gap_signed_at = NULL,
         notes = trim(COALESCE(notes, '') || ' [corrected from ' || _d.level_litres || ' L: ' || trim(p_reason) || ']')
   WHERE id = p_id;
  -- the next dip compares against this one: recompute it
  SELECT id INTO _next FROM fuel_dip_readings
   WHERE tank_id = _d.tank_id AND NOT is_archived AND id <> _d.id
     AND (reading_date > _d.reading_date OR (reading_date = _d.reading_date AND COALESCE(reading_time, '23:59') > COALESCE(_d.reading_time, '00:00')))
   ORDER BY reading_date, reading_time NULLS LAST, created_at LIMIT 1;
  IF _next IS NOT NULL THEN UPDATE fuel_dip_readings SET updated_at = now() WHERE id = _next AND month_close_id IS NULL; END IF;
END $$;
-- recompute on any update (the BEFORE trigger only fired on level changes before)
DROP TRIGGER IF EXISTS trg_fuel_dip_gap ON fuel_dip_readings;
CREATE TRIGGER trg_fuel_dip_gap BEFORE INSERT OR UPDATE ON fuel_dip_readings FOR EACH ROW EXECUTE FUNCTION trg_fuel_dip_gap();

-- the day list: every dip with book, gap and state
CREATE OR REPLACE FUNCTION fuel_recon_days(p_site uuid, p_from date, p_to date)
RETURNS TABLE(dip_id uuid, tank_id uuid, tank text, reading_date date, reading_time time, dip_mm numeric, dip_litres numeric,
  book_litres numeric, gap_litres numeric, gap_pct numeric, tolerance numeric, gap_status text, gap_reason text,
  explained_by text, signed_by text, signed_at timestamptz, closed boolean, corrections int)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT _user_has_fuel_perm(p_site, ARRAY['fuel.view','fuel.create','fuel.edit']) THEN RAISE EXCEPTION 'No access'; END IF;
  RETURN QUERY
  SELECT d.id, d.tank_id, k.name, d.reading_date, d.reading_time, d.dip_mm, d.level_litres, d.system_level_litres, d.variance_litres,
         d.variance_percent, COALESCE(k.dip_tolerance_litres, 120), d.gap_status, d.gap_reason,
         (SELECT full_name FROM profiles WHERE id = d.gap_explained_by), (SELECT full_name FROM profiles WHERE id = d.gap_signed_by),
         d.gap_signed_at, d.month_close_id IS NOT NULL, (SELECT count(*)::int FROM fuel_dip_corrections c WHERE c.dip_id = d.id)
    FROM fuel_dip_readings d JOIN fuel_tanks k ON k.id = d.tank_id
   WHERE d.site_id = p_site AND NOT d.is_archived AND d.reading_date BETWEEN p_from AND p_to
   ORDER BY d.reading_date DESC, d.reading_time DESC NULLS LAST, k.name;
END $$;

-- pump shifts
CREATE OR REPLACE FUNCTION fuel_shift_open(p_pump uuid, p_reading numeric, p_shift text DEFAULT NULL, p_date date DEFAULT CURRENT_DATE) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _p fuel_pumps%ROWTYPE; _id uuid;
BEGIN
  SELECT * INTO _p FROM fuel_pumps WHERE id = p_pump;
  IF _p.id IS NULL THEN RAISE EXCEPTION 'Pump not found'; END IF;
  IF NOT _user_has_fuel_perm(_p.site_id, ARRAY['fuel.create','fuel.edit']) THEN RAISE EXCEPTION 'You do not have permission to open pump shifts'; END IF;
  IF p_reading IS NULL OR p_reading < 0 THEN RAISE EXCEPTION 'Enter the pump meter reading'; END IF;
  IF EXISTS (SELECT 1 FROM fuel_pump_shifts WHERE pump_id = p_pump AND status = 'open') THEN RAISE EXCEPTION 'This pump already has an open shift — close it first'; END IF;
  INSERT INTO fuel_pump_shifts (site_id, pump_id, shift_date, shift, open_reading) VALUES (_p.site_id, p_pump, COALESCE(p_date, CURRENT_DATE), p_shift, p_reading)
  RETURNING id INTO _id;
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION fuel_shift_close(p_id uuid, p_reading numeric, p_reason text DEFAULT NULL, p_date date DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _s fuel_pump_shifts%ROWTYPE; _pump numeric; _rec numeric; _gap numeric; _tol numeric; _end date;
BEGIN
  SELECT * INTO _s FROM fuel_pump_shifts WHERE id = p_id FOR UPDATE;
  IF _s.id IS NULL OR _s.status <> 'open' THEN RAISE EXCEPTION 'Shift not open'; END IF;
  IF NOT _user_has_fuel_perm(_s.site_id, ARRAY['fuel.create','fuel.edit']) THEN RAISE EXCEPTION 'You do not have permission to close pump shifts'; END IF;
  IF p_reading IS NULL OR p_reading < _s.open_reading THEN RAISE EXCEPTION 'Closing reading must be at least the opening reading (%)', _s.open_reading; END IF;
  _end := COALESCE(p_date, CURRENT_DATE);
  _pump := p_reading - _s.open_reading;
  SELECT COALESCE(sum(litres), 0) INTO _rec FROM fuel_transactions
   WHERE pump_id = _s.pump_id AND transaction_type = 'issuance' AND NOT COALESCE(is_deleted, false)
     AND transaction_date BETWEEN _s.shift_date AND _end;
  _gap := _pump - _rec;
  SELECT COALESCE(k.dip_tolerance_litres, 120) INTO _tol FROM fuel_pumps p LEFT JOIN fuel_tanks k ON k.id = p.tank_id WHERE p.id = _s.pump_id;
  IF abs(_gap) > COALESCE(_tol, 120) AND COALESCE(trim(p_reason), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'needs_reason', true, 'pump_litres', _pump, 'recorded_litres', _rec, 'gap_litres', _gap);
  END IF;
  UPDATE fuel_pump_shifts SET close_reading = p_reading, closed_by = auth.uid(), closed_at = now(), close_date = _end,
         pump_litres = _pump, recorded_litres = _rec, gap_litres = _gap, reason = NULLIF(trim(COALESCE(p_reason, '')), ''), status = 'closed'
   WHERE id = p_id;
  UPDATE fuel_pumps SET current_meter_reading = p_reading WHERE id = _s.pump_id;
  IF abs(_gap) > COALESCE(_tol, 120) THEN
    PERFORM _notify_permission(_s.site_id, 'fuel.approve', 'warning', 'Pump shift gap',
      'Pump gave ' || _pump || ' L but ' || _rec || ' L were recorded (' || _gap || ' L). Reason: ' || trim(p_reason), 'fuel_reconciliation', 'reminder');
  END IF;
  RETURN jsonb_build_object('ok', true, 'pump_litres', _pump, 'recorded_litres', _rec, 'gap_litres', _gap);
END $$;

CREATE OR REPLACE FUNCTION fuel_shift_list(p_site uuid, p_from date, p_to date)
RETURNS TABLE(id uuid, pump_id uuid, pump text, shift_date date, shift text, open_reading numeric, close_reading numeric,
  pump_litres numeric, recorded_litres numeric, gap_litres numeric, reason text, status text, opened_by text, closed_by text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT _user_has_fuel_perm(p_site, ARRAY['fuel.view','fuel.create','fuel.edit']) THEN RAISE EXCEPTION 'No access'; END IF;
  RETURN QUERY SELECT s.id, s.pump_id, p.name, s.shift_date, s.shift, s.open_reading, s.close_reading, s.pump_litres, s.recorded_litres,
    s.gap_litres, s.reason, s.status, (SELECT full_name FROM profiles WHERE profiles.id = s.opened_by), (SELECT full_name FROM profiles WHERE profiles.id = s.closed_by)
    FROM fuel_pump_shifts s JOIN fuel_pumps p ON p.id = s.pump_id
   WHERE s.site_id = p_site AND NOT s.is_archived AND (s.status = 'open' OR s.shift_date BETWEEN p_from AND p_to)
   ORDER BY s.status = 'open' DESC, s.shift_date DESC, s.opened_at DESC;
END $$;

-- month-end
CREATE OR REPLACE FUNCTION fuel_month_preview(p_site uuid, p_month date)
RETURNS TABLE(tank_id uuid, tank text, dips int, gap_litres numeric, open_items int, cost_per_litre numeric, value numeric, closed boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _m date := date_trunc('month', p_month)::date;
BEGIN
  IF NOT (_user_has_fuel_perm(p_site, ARRAY['fuel.view','fuel.create','fuel.edit']) OR _has_permission('finance.view', p_site)) THEN RAISE EXCEPTION 'No access'; END IF;
  RETURN QUERY
  SELECT k.id, k.name, count(d.id)::int, COALESCE(round(sum(d.variance_litres), 1), 0),
         count(d.id) FILTER (WHERE d.gap_status IN ('needs_reason','explained'))::int,
         round(sb.valuation_rate, 4), round(COALESCE(sum(d.variance_litres), 0) * COALESCE(sb.valuation_rate, 0), 2),
         EXISTS (SELECT 1 FROM fuel_month_closes c WHERE c.tank_id = k.id AND c.month = _m)
    FROM fuel_tanks k
    LEFT JOIN fuel_types ft ON ft.id = k.fuel_type_id
    LEFT JOIN stock_balances sb ON sb.warehouse_id = k.warehouse_id AND sb.item_id = ft.item_id
    LEFT JOIN fuel_dip_readings d ON d.tank_id = k.id AND NOT d.is_archived AND d.variance_litres IS NOT NULL AND d.month_close_id IS NULL
         AND d.reading_date >= _m AND d.reading_date < (_m + interval '1 month') AND d.created_at > COALESCE(k.stores_from, '-infinity')
   WHERE k.site_id = p_site AND NOT COALESCE(k.is_archived, false)
   GROUP BY k.id, k.name, sb.valuation_rate ORDER BY k.name;
END $$;

CREATE OR REPLACE FUNCTION fuel_month_close(p_site uuid, p_month date) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _m date := date_trunc('month', p_month)::date; _end date; r record; _id uuid; _mv uuid; _je uuid; _val numeric; _item uuid;
        _total numeric := 0; _n int := 0;
BEGIN
  _end := (_m + interval '1 month - 1 day')::date;
  IF NOT _user_has_fuel_perm(p_site, ARRAY['fuel.approve']) THEN RAISE EXCEPTION 'Only fuel approvers can close a fuel month'; END IF;
  IF _end >= CURRENT_DATE THEN RAISE EXCEPTION 'The month has not ended yet'; END IF;
  IF EXISTS (SELECT 1 FROM fuel_dip_readings d JOIN fuel_tanks k ON k.id = d.tank_id WHERE d.site_id = p_site AND NOT d.is_archived
              AND d.reading_date BETWEEN _m AND _end AND d.gap_status IN ('needs_reason','explained') AND d.month_close_id IS NULL
              AND d.created_at > COALESCE(k.stores_from, '-infinity')) THEN
    RAISE EXCEPTION 'Some big gaps in this month still need a reason or sign-off';
  END IF;
  FOR r IN SELECT * FROM fuel_month_preview(p_site, _m) WHERE NOT closed AND dips > 0 LOOP
    SELECT ft.item_id INTO _item FROM fuel_tanks k JOIN fuel_types ft ON ft.id = k.fuel_type_id WHERE k.id = r.tank_id;
    INSERT INTO fuel_month_closes (site_id, tank_id, month, litres, value, dips) VALUES (p_site, r.tank_id, _m, r.gap_litres, 0, r.dips) RETURNING id INTO _id;
    _mv := NULL; _je := NULL; _val := 0;
    IF r.gap_litres <> 0 THEN
      INSERT INTO inventory_movements (item_id, warehouse_id, movement_type, quantity, unit_cost, voucher_type, voucher_no, source_module,
        source_reference_id, reason, notes, created_by, created_at)
      VALUES (_item, (SELECT warehouse_id FROM fuel_tanks WHERE id = r.tank_id), 'stock_take', r.gap_litres, 0, 'fuel_month_close',
        'FUEL-' || to_char(_m, 'YYYY-MM'), 'fuel', _id, CASE WHEN r.gap_litres < 0 THEN 'Fuel loss' ELSE 'Fuel gain' END,
        'Net dip gaps for ' || to_char(_m, 'Mon YYYY'), auth.uid(), _end::timestamptz + interval '23 hours')
      RETURNING id, abs(value) INTO _mv, _val;
      _je := gl_auto_post(p_site, CASE WHEN r.gap_litres < 0 THEN 'fuel_loss' ELSE 'fuel_gain' END, 'fuel_month_closes', _id, _end, _val,
        CASE WHEN r.gap_litres < 0 THEN 'Fuel loss ' ELSE 'Fuel gain ' END || r.tank || ' ' || to_char(_m, 'Mon YYYY') || ' — ' || abs(r.gap_litres) || ' L');
    END IF;
    UPDATE fuel_month_closes SET value = CASE WHEN r.gap_litres < 0 THEN -_val ELSE _val END, movement_id = _mv, journal_id = _je WHERE id = _id;
    UPDATE fuel_dip_readings d SET month_close_id = _id FROM fuel_tanks k
     WHERE k.id = d.tank_id AND d.tank_id = r.tank_id AND NOT d.is_archived AND d.month_close_id IS NULL
       AND d.reading_date BETWEEN _m AND _end AND d.created_at > COALESCE(k.stores_from, '-infinity');
    _total := _total + CASE WHEN r.gap_litres < 0 THEN -_val ELSE _val END; _n := _n + 1;
  END LOOP;
  IF _n = 0 THEN RAISE EXCEPTION 'Nothing to close for %', to_char(_m, 'Mon YYYY'); END IF;
  PERFORM _notify_permission(p_site, 'finance.approve', 'info', 'Fuel month closed: ' || to_char(_m, 'Mon YYYY'),
    'Net fuel ' || CASE WHEN _total < 0 THEN 'loss' ELSE 'gain' END || ' of $' || to_char(abs(_total), 'FM999,999,990.00') || ' posted for ' || _n || ' tank(s).',
    'fuel_reconciliation', 'general');
  RETURN jsonb_build_object('tanks', _n, 'value', _total);
END $$;

ALTER TABLE gl_posting_rules DROP CONSTRAINT IF EXISTS gl_posting_rules_event_code_check;
ALTER TABLE gl_posting_rules ADD CONSTRAINT gl_posting_rules_event_code_check CHECK (event_code = ANY (ARRAY['fuel_issue','fuel_delivery','fuel_loss','fuel_gain','grn_accepted','invoice_approved','invoice_paid','payroll_net','payroll_deductions','payroll_paye','payroll_nssa','payroll_nssa_employer','payroll_paid','payroll_loan_recovery','meals_approved','imtt','expense_approved','advance_settled','expense_paid','expense_paid_cash','advance_paid','advance_paid_cash','petty_cash_topup','petty_cash_expense','petty_cash_short','petty_cash_over','staff_loan_paid','asset_capitalised','asset_capitalised_grn','asset_transfer_out','asset_transfer_out_accum','asset_transfer_in','asset_transfer_in_accum','asset_depreciation','asset_disposal_accum','asset_disposal_loss','asset_disposal_proceeds','landed_cost','stock_opening','stock_transfer_out','stock_transfer_in','stock_issue','stock_issue_camp','stock_return','stock_loss','stock_gain','contractor_labour','hired_plant_usage','sheq_incident_cost','invoice_accrual','accrual_release','accrual_topup','invoice_paid_by_hq','hq_paid_for_site','petty_cash_topup_hq','hq_funded_site_cash']::text[]));

-- posting rules fuel_loss / fuel_gain where fuel is already set up: fuel stock account = fuel_issue credit,
-- loss/gain account = the site's stock_loss debit account
INSERT INTO gl_posting_rules (site_id, event_code, debit_account_id, credit_account_id, is_active, is_archived)
SELECT fi.site_id, 'fuel_loss', sl.debit_account_id, fi.credit_account_id, true, false
  FROM gl_posting_rules fi JOIN gl_posting_rules sl ON sl.site_id = fi.site_id AND sl.event_code = 'stock_loss' AND NOT sl.is_archived
 WHERE fi.event_code = 'fuel_issue' AND NOT fi.is_archived
   AND NOT EXISTS (SELECT 1 FROM gl_posting_rules x WHERE x.site_id = fi.site_id AND x.event_code = 'fuel_loss');
INSERT INTO gl_posting_rules (site_id, event_code, debit_account_id, credit_account_id, is_active, is_archived)
SELECT fi.site_id, 'fuel_gain', fi.credit_account_id, sl.debit_account_id, true, false
  FROM gl_posting_rules fi JOIN gl_posting_rules sl ON sl.site_id = fi.site_id AND sl.event_code = 'stock_loss' AND NOT sl.is_archived
 WHERE fi.event_code = 'fuel_issue' AND NOT fi.is_archived
   AND NOT EXISTS (SELECT 1 FROM gl_posting_rules x WHERE x.site_id = fi.site_id AND x.event_code = 'fuel_gain');

GRANT EXECUTE ON FUNCTION fuel_dip_explain(uuid, text), fuel_dip_sign_off(uuid), fuel_dip_correct(uuid, numeric, numeric, text),
  fuel_recon_days(uuid, date, date), fuel_shift_open(uuid, numeric, text, date), fuel_shift_close(uuid, numeric, text, date),
  fuel_shift_list(uuid, date, date), fuel_month_preview(uuid, date), fuel_month_close(uuid, date) TO authenticated;

INSERT INTO schema_migrations (filename) VALUES ('0248_fuel_f2_reconciliation.sql') ON CONFLICT DO NOTHING;
