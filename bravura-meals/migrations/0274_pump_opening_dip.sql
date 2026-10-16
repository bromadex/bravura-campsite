-- 0274 (user, 16 Oct 2026: "as for single fills, you can just deal with opening dip").
-- Single fills (FU21 Issue fuel → fuel_pump_issue) from a dipstick tank: the first fill of the day needs the opening dip (mm).
-- If no non-archived dip exists for that tank on the fill's day, the fill is refused with 'OPENING_DIP:' unless p.opening_dip_mm
-- is given; the dip is saved to the dipstick log one minute before the fill (litres from tank_calibrations). Later fills that day
-- go straight through. Back-dated fills (imports) are not checked. Drums / bowsers (level_tracking_method 'issuance') are exempt. No closing dip for single fills.

CREATE OR REPLACE FUNCTION _fuel_pump_opening_dip(p_tank uuid, p_at timestamptz, p_mm numeric) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _t fuel_tanks%ROWTYPE; _day date := (p_at AT TIME ZONE 'Africa/Harare')::date; _l numeric; _dip_at timestamp; _id uuid;
BEGIN
  SELECT * INTO _t FROM fuel_tanks WHERE id = p_tank;
  IF _t.level_tracking_method = 'issuance' THEN RETURN NULL; END IF;
  -- only live fills: back-dated entries (paper-slip imports, old queued fills) can't take a dip now
  IF _day < (now() AT TIME ZONE 'Africa/Harare')::date AND p_mm IS NULL THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM fuel_dip_readings WHERE tank_id = p_tank AND NOT COALESCE(is_archived, false) AND reading_date = _day) THEN
    RETURN NULL;
  END IF;
  IF p_mm IS NULL THEN
    RAISE EXCEPTION 'OPENING_DIP: No dip for % today yet — take the opening dip before this first fill', _t.name;
  END IF;
  IF p_mm < 0 THEN RAISE EXCEPTION 'The dip cannot be negative'; END IF;
  _l := _fuel_mm_to_litres(p_tank, p_mm);
  IF _l IS NULL THEN RAISE EXCEPTION 'This tank has no dip calibration table, so the dip cannot be turned into litres.'; END IF;
  _dip_at := (p_at AT TIME ZONE 'Africa/Harare') - interval '1 minute';
  INSERT INTO fuel_dip_readings (site_id, tank_id, reading_date, reading_time, dip_mm, level_litres, recorded_by, recorded_by_name, notes)
  VALUES (_t.site_id, p_tank, _dip_at::date, _dip_at::time, p_mm, round(_l, 1), auth.uid(),
    (SELECT COALESCE(full_name, username) FROM profiles WHERE id = auth.uid()), 'Opening dip (Issue fuel)')
  RETURNING id INTO _id;
  RETURN _id;
END $$;

-- fuel_pump_issue: same as 0250 + opening dip check after the permission/litres checks.
CREATE OR REPLACE FUNCTION public.fuel_pump_issue(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _ref text := NULLIF(trim(p->>'client_ref'), ''); _tank fuel_tanks%ROWTYPE; _asset fleet_assets%ROWTYPE; _id uuid; _no text;
        _q numeric := NULLIF(p->>'litres','')::numeric; _at timestamptz := COALESCE(NULLIF(p->>'issued_at','')::timestamptz, now());
        _chk jsonb; _pr jsonb; _code text; _sign text := NULLIF(trim(p->>'signed_by_name'), ''); r record; _lvl int; _pct numeric;
        _rc uuid; _dip uuid;
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

  _dip := _fuel_pump_opening_dip(_tank.id, _at, NULLIF(p->>'opening_dip_mm','')::numeric);

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
  RETURN jsonb_build_object('id', _id, 'number', _no, 'recharge', _chk->'recharge', 'allowances', _chk->'allowances', 'opening_dip_id', _dip);
END $function$;

INSERT INTO schema_migrations (filename) VALUES ('0274_pump_opening_dip.sql') ON CONFLICT DO NOTHING;
