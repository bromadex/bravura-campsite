-- 0255: dip gaps used dates only, so a delivery on the same day as the previous dip was skipped (KAM 26 Sep: dip 17 L at 12:51,
-- delivery 10,000 L, dip after 10,015 L at 15:09 → book 17, gap +9,998). Moves now count by local time:
--   transaction time = issued_at (pump fills; deliveries now get delivery time − 1 min) else transaction_date 12:00;
--   dip time = reading_date + reading_time (no time = 23:59).
CREATE OR REPLACE FUNCTION _fuel_txn_at(t fuel_transactions) RETURNS timestamp
LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE((t.issued_at AT TIME ZONE 'Africa/Harare'), t.transaction_date + time '12:00');
$$;

CREATE OR REPLACE FUNCTION _fuel_moves_at(p_tank uuid, p_from timestamp, p_to timestamp) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(sum(_fuel_txn_level_effect(t.transaction_type, t.litres, t.is_deleted)), 0)
    FROM fuel_transactions t WHERE t.tank_id = p_tank AND _fuel_txn_at(t) > p_from AND _fuel_txn_at(t) <= p_to;
$$;

CREATE OR REPLACE FUNCTION public.trg_fuel_dip_gap()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _prev record; _tol numeric; _tank text; _at timestamp;
BEGIN
  IF NEW.level_litres IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.month_close_id IS NOT NULL AND NEW.level_litres IS DISTINCT FROM OLD.level_litres THEN
    RAISE EXCEPTION 'This dip is in a closed fuel month and cannot be changed';
  END IF;
  _at := NEW.reading_date + COALESCE(NEW.reading_time, time '23:59');
  SELECT reading_date, reading_time, level_litres, reading_date + COALESCE(reading_time, time '23:59') AS at INTO _prev FROM fuel_dip_readings
   WHERE tank_id = NEW.tank_id AND NOT is_archived AND id <> NEW.id
     AND reading_date + COALESCE(reading_time, time '23:59') < _at
   ORDER BY reading_date DESC, reading_time DESC NULLS LAST, created_at DESC LIMIT 1;
  IF _prev.reading_date IS NULL THEN
    NEW.system_level_litres := NULL; NEW.variance_litres := NULL; NEW.variance_percent := NULL; NEW.gap_status := 'ok'; RETURN NEW;
  END IF;
  NEW.system_level_litres := round(_prev.level_litres + _fuel_moves_at(NEW.tank_id, _prev.at, _at), 1);
  NEW.variance_litres := round(NEW.level_litres - NEW.system_level_litres, 1);
  NEW.variance_percent := CASE WHEN NEW.system_level_litres > 0 THEN round(100 * NEW.variance_litres / NEW.system_level_litres, 2) END;
  IF TG_OP = 'UPDATE' AND NEW.variance_litres IS NOT DISTINCT FROM OLD.variance_litres THEN RETURN NEW; END IF;
  SELECT COALESCE(dip_tolerance_litres, 120), name INTO _tol, _tank FROM fuel_tanks WHERE id = NEW.tank_id;
  IF abs(NEW.variance_litres) <= _tol THEN
    NEW.gap_status := 'ok';
  ELSE
    NEW.gap_status := 'needs_reason'; NEW.gap_signed_by := NULL; NEW.gap_signed_at := NULL;
    IF NOT NEW.is_archived AND NEW.reading_date >= CURRENT_DATE - 3 AND TG_OP = 'INSERT' THEN
      PERFORM _notify_permission(NEW.site_id, 'fuel.approve', 'warning', 'Fuel dip gap: ' || _tank,
        _tank || ' dip on ' || to_char(NEW.reading_date, 'DD Mon') || ' is ' || NEW.level_litres || ' L, the book says ' || NEW.system_level_litres
        || ' L (' || CASE WHEN NEW.variance_litres > 0 THEN '+' ELSE '' END || NEW.variance_litres || ' L). Needs a reason and sign-off.',
        'fuel_reconciliation', 'reminder');
    END IF;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public._fuel_tank_book(p_tank uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _t fuel_tanks%ROWTYPE; _dip record; _mv numeric;
BEGIN
  SELECT * INTO _t FROM fuel_tanks WHERE id = p_tank;
  SELECT reading_date, level_litres, reading_date + COALESCE(reading_time, time '23:59') AS at INTO _dip FROM fuel_dip_readings
   WHERE tank_id = p_tank AND NOT is_archived ORDER BY reading_date DESC, reading_time DESC NULLS LAST, created_at DESC LIMIT 1;
  IF _dip.reading_date IS NULL OR _t.level_tracking_method = 'issuance' THEN
    RETURN jsonb_build_object('book', COALESCE(_t.current_level_litres, 0), 'basis', 'running total', 'last_dip_date', _dip.reading_date, 'last_dip', _dip.level_litres);
  END IF;
  _mv := _fuel_moves_at(p_tank, _dip.at, (now() AT TIME ZONE 'Africa/Harare') + interval '1 day');
  RETURN jsonb_build_object('book', GREATEST(_dip.level_litres + _mv, 0), 'basis', 'last dip + movements since', 'last_dip_date', _dip.reading_date,
                            'last_dip', _dip.level_litres, 'moves_since', _mv);
END $function$;

-- deliveries carry their time (delivery time − 1 minute, so the "dip after" taken at delivery time includes them)
DO $$ DECLARE f text := pg_get_functiondef('fuel_delivery_save'::regproc); g text; BEGIN
  g := replace(f, 'supplier, docket_number, notes, created_by, grn_id)', 'supplier, docket_number, notes, created_by, grn_id, issued_at)');
  g := replace(g, 'NULLIF(trim(p->>''notes''), '''')), auth.uid(), _grn)',
    'NULLIF(trim(p->>''notes''), '''')), auth.uid(), _grn, (_date + COALESCE(NULLIF(p->>''delivery_time'','''')::time, time ''12:00'') - interval ''1 minute'') AT TIME ZONE ''Africa/Harare'')');
  g := replace(g, 'SET tank_id = _t.id, transaction_date = _date, litres = _q,',
    'SET tank_id = _t.id, transaction_date = _date, issued_at = (_date + COALESCE(NULLIF(p->>''delivery_time'','''')::time, time ''12:00'') - interval ''1 minute'') AT TIME ZONE ''Africa/Harare'', litres = _q,');
  -- the dip BEFORE also goes into the dipstick log (2 minutes before the delivery time), new deliveries only
  g := replace(g, '  IF NULLIF(p->>''dip_after'','''')::numeric IS NOT NULL AND NOT EXISTS (',
    '  IF _d.id IS NULL AND NULLIF(p->>''dip_before'','''')::numeric IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM fuel_dip_readings WHERE tank_id = _t.id AND reading_date = _date AND level_litres = (p->>''dip_before'')::numeric AND NOT is_archived) THEN
    INSERT INTO fuel_dip_readings (site_id, tank_id, reading_date, reading_time, dip_mm, dip_end_mm, level_end_litres, level_litres, notes, recorded_by, recorded_by_name)
    VALUES (_t.site_id, _t.id, _date, (COALESCE(NULLIF(p->>''delivery_time'','''')::time, time ''12:00'') - interval ''2 minutes'')::time,
            NULLIF(p->>''dip_before_mm'','''')::numeric, NULLIF(p->>''dip_before_mm'','''')::numeric, (p->>''dip_before'')::numeric, (p->>''dip_before'')::numeric,
            ''Dip before delivery'', auth.uid(), NULLIF(trim(p->>''receiving_officer''), ''''));
  END IF;
  IF NULLIF(p->>''dip_after'','''')::numeric IS NOT NULL AND NOT EXISTS (');
  IF position('Dip before delivery' in g) = 0 THEN RAISE EXCEPTION 'dip-before patch did not apply'; END IF;
  IF g = f OR position('grn_id, issued_at)' in g) = 0 OR position('issued_at = (_date' in g) = 0 THEN RAISE EXCEPTION 'patch did not apply'; END IF;
  EXECUTE g;
END $$;

-- existing deliveries: time from their delivery record's dip-after (else midday)
UPDATE fuel_transactions t SET issued_at = ((d.delivery_date + COALESCE(dr.reading_time, time '12:01') - interval '1 minute') AT TIME ZONE 'Africa/Harare')
  FROM fuel_deliveries d
  LEFT JOIN LATERAL (SELECT reading_time FROM fuel_dip_readings x WHERE x.tank_id = d.tank_id AND x.reading_date = d.delivery_date
                       AND x.level_litres = d.dip_after AND NOT x.is_archived ORDER BY x.created_at LIMIT 1) dr ON true
 WHERE d.transaction_id = t.id AND t.issued_at IS NULL;

-- recompute every dip's book and gap (month-closed ones keep theirs)
UPDATE fuel_dip_readings SET updated_at = updated_at WHERE NOT is_archived AND month_close_id IS NULL;

INSERT INTO schema_migrations (filename) VALUES ('0255_fuel_moves_by_time.sql') ON CONFLICT DO NOTHING;
