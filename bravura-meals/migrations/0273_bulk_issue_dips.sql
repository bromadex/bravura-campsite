-- 0273 (user, 16 Oct 2026): batch issuance must carry the opening and closing dip. Wendy dips before a bulk issue, issues, dips again.
-- rpc_bulk_fuel_issuance_v2 takes p_dip_open_mm / p_dip_close_mm. On a dipstick tank both are required (refuses to save without them);
-- drums (level_tracking_method 'issuance') are exempt. The two readings become ONE dipstick-log row (start → end, litres from
-- tank_calibrations, same interpolation as the dip screen) saved in the same transaction as the issues. The issues are stamped
-- issued_at = one minute before the closing dip so the dip-gap check compares the closing dip with the book after these issues.

CREATE OR REPLACE FUNCTION _fuel_mm_to_litres(p_tank uuid, p_mm numeric) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH c AS (SELECT dip_mm::numeric mm, level_litres::numeric l FROM tank_calibrations
              WHERE tank_id = p_tank AND NOT COALESCE(is_archived, false)),
       lo AS (SELECT * FROM c WHERE mm <= p_mm ORDER BY mm DESC LIMIT 1),
       hi AS (SELECT * FROM c WHERE mm >= p_mm ORDER BY mm ASC LIMIT 1)
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM c) THEN NULL
    WHEN NOT EXISTS (SELECT 1 FROM lo) THEN (SELECT l FROM c ORDER BY mm LIMIT 1)
    WHEN NOT EXISTS (SELECT 1 FROM hi) THEN (SELECT l FROM c ORDER BY mm DESC LIMIT 1)
    WHEN (SELECT mm FROM hi) = (SELECT mm FROM lo) THEN (SELECT l FROM lo)
    ELSE (SELECT l FROM lo) + (p_mm - (SELECT mm FROM lo)) / ((SELECT mm FROM hi) - (SELECT mm FROM lo)) * ((SELECT l FROM hi) - (SELECT l FROM lo)) END
$$;

CREATE OR REPLACE FUNCTION rpc_bulk_fuel_issuance_v2(p_site_id uuid, p_tank_id uuid, p_batch_id uuid, p_authorised_by text, p_reason text,
  p_rows jsonb, p_dip_open_mm numeric DEFAULT NULL, p_dip_close_mm numeric DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id uuid; v_total numeric(12,3) := 0; v_tank_level numeric(12,3); v_tank_cap numeric(12,3); v_tracking text;
  v_row jsonb; v_idx int := 0; v_txn_number text; v_litres numeric(12,3); v_level_before numeric(12,3);
  v_results jsonb := '[]'::jsonb; v_new_id uuid; v_ids uuid[] := '{}';
  v_date date; v_now_local timestamp := (now() AT TIME ZONE 'Africa/Harare'); v_dip_at timestamp; v_issued_at timestamptz;
  v_open_l numeric; v_close_l numeric; v_dip_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public._user_has_fuel_perm(p_site_id, ARRAY['fuel.create']) THEN RAISE EXCEPTION 'Missing fuel.create permission'; END IF;
  SELECT current_level_litres, capacity_litres, level_tracking_method INTO v_tank_level, v_tank_cap, v_tracking
    FROM fuel_tanks WHERE id = p_tank_id AND site_id = p_site_id;
  IF v_tank_level IS NULL THEN RAISE EXCEPTION 'Tank not found or does not belong to this site'; END IF;

  -- dips: required on dipstick tanks
  IF v_tracking <> 'issuance' THEN
    IF p_dip_open_mm IS NULL OR p_dip_close_mm IS NULL THEN
      RAISE EXCEPTION 'DIPS_REQUIRED: Enter the opening dip (before issuing) and the closing dip (after issuing) for this tank.';
    END IF;
    IF p_dip_open_mm < 0 OR p_dip_close_mm < 0 THEN RAISE EXCEPTION 'Dip readings cannot be negative'; END IF;
    IF p_dip_close_mm > p_dip_open_mm THEN
      RAISE EXCEPTION 'The closing dip (% mm) is higher than the opening dip (% mm) — fuel only went out. Check the readings.', p_dip_close_mm, p_dip_open_mm;
    END IF;
    v_open_l := _fuel_mm_to_litres(p_tank_id, p_dip_open_mm);
    v_close_l := _fuel_mm_to_litres(p_tank_id, p_dip_close_mm);
    IF v_open_l IS NULL OR v_close_l IS NULL THEN RAISE EXCEPTION 'This tank has no dip calibration table, so the dips cannot be turned into litres.'; END IF;
    -- for a dipstick tank the opening dip is the truth for "is there enough fuel"
    v_tank_level := v_open_l;
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_litres := (v_row->>'litres')::numeric;
    IF v_litres IS NULL OR v_litres <= 0 THEN RAISE EXCEPTION 'Row % has invalid litres', v_idx; END IF;
    v_total := v_total + v_litres; v_idx := v_idx + 1;
    v_date := GREATEST(COALESCE(v_date, COALESCE((v_row->>'transaction_date')::date, current_date)), COALESCE((v_row->>'transaction_date')::date, current_date));
  END LOOP;
  IF v_total > v_tank_level THEN
    RAISE EXCEPTION 'Insufficient stock: requested % L but tank has % L', round(v_total, 1), round(v_tank_level, 1);
  END IF;

  -- closing dip time: now if the batch is for today, else that day 23:59; issues one minute before it
  v_dip_at := CASE WHEN v_date = v_now_local::date THEN v_now_local ELSE v_date + time '23:59' END;
  v_issued_at := (v_dip_at - interval '1 minute') AT TIME ZONE 'Africa/Harare';

  v_idx := 0;
  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_idx := v_idx + 1;
    v_litres := (v_row->>'litres')::numeric;
    v_level_before := v_tank_level;
    v_tank_level := v_tank_level - v_litres;
    v_txn_number := 'ISS-' || extract(epoch FROM clock_timestamp())::bigint || '-' || v_idx;
    INSERT INTO fuel_transactions (
      site_id, transaction_number, transaction_date, tank_id, transaction_type, fleet_asset_id, operator_id, litres,
      tank_level_before, tank_level_after, docket_number, notes, authorised_by_name, authorisation_reason,
      acknowledgement_status, batch_id, created_by, odometer_km, hours_reading, meter_broken, meter_note, issued_at
    ) VALUES (
      p_site_id, v_txn_number, COALESCE((v_row->>'transaction_date')::date, current_date), p_tank_id, 'issuance',
      NULLIF(v_row->>'fleet_asset_id', '')::uuid, NULLIF(v_row->>'operator_id', '')::uuid, v_litres, v_level_before, v_tank_level,
      NULL, COALESCE(v_row->>'notes', ''), p_authorised_by, p_reason, 'pending', p_batch_id, v_user_id,
      NULLIF(v_row->>'odometer_km', '')::numeric, NULLIF(v_row->>'hours_reading', '')::numeric,
      COALESCE((v_row->>'meter_broken')::boolean, false), NULLIF(v_row->>'meter_note', ''),
      CASE WHEN v_tracking <> 'issuance' THEN v_issued_at END
    ) RETURNING id INTO v_new_id;
    v_ids := v_ids || v_new_id;
    v_results := v_results || jsonb_build_object('id', v_new_id, 'transaction_number', v_txn_number, 'litres', v_litres,
      'fleet_asset_id', v_row->>'fleet_asset_id', 'operator_id', v_row->>'operator_id',
      'transaction_date', COALESCE(v_row->>'transaction_date', current_date::text));
  END LOOP;

  IF v_tracking <> 'issuance' THEN
    INSERT INTO fuel_dip_readings (site_id, tank_id, reading_date, reading_time, dip_mm, level_litres,
      dip_start_mm, dip_end_mm, level_start_litres, level_end_litres, recorded_by, recorded_by_name, notes)
    VALUES (p_site_id, p_tank_id, v_dip_at::date, v_dip_at::time, p_dip_close_mm, round(v_close_l, 1),
      p_dip_open_mm, p_dip_close_mm, round(v_open_l, 1), round(v_close_l, 1), v_user_id,
      (SELECT COALESCE(full_name, username) FROM profiles WHERE id = v_user_id),
      'Batch issue ' || upper(left(p_batch_id::text, 8)) || ': ' || v_idx || ' fill(s), ' || round(v_total, 1) || ' L')
    RETURNING id INTO v_dip_id;
  END IF;

  RETURN jsonb_build_object('batch_id', p_batch_id, 'total_litres', v_total, 'row_count', v_idx,
    'tank_level_after', CASE WHEN v_tracking <> 'issuance' THEN round(v_close_l, 1) ELSE v_tank_level END,
    'transaction_ids', to_jsonb(v_ids), 'rows', v_results,
    'dip', CASE WHEN v_dip_id IS NULL THEN NULL ELSE jsonb_build_object('id', v_dip_id, 'open_litres', round(v_open_l, 1),
      'close_litres', round(v_close_l, 1), 'dip_used', round(v_open_l - v_close_l, 1), 'issued', v_total,
      'difference', round((v_open_l - v_close_l) - v_total, 1)) END);
END $$;

GRANT EXECUTE ON FUNCTION rpc_bulk_fuel_issuance_v2(uuid, uuid, uuid, text, text, jsonb, numeric, numeric) TO authenticated;

-- the old 6-argument call (no dips) still works for drums but refuses dipstick tanks
CREATE OR REPLACE FUNCTION rpc_bulk_fuel_issuance(p_site_id uuid, p_tank_id uuid, p_batch_id uuid, p_authorised_by text, p_reason text, p_rows jsonb)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $f$
  SELECT rpc_bulk_fuel_issuance_v2(p_site_id, p_tank_id, p_batch_id, p_authorised_by, p_reason, p_rows, NULL, NULL)
$f$;

INSERT INTO schema_migrations (filename) VALUES ('0273_bulk_issue_dips.sql') ON CONFLICT DO NOTHING;
