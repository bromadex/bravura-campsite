-- ── 0074: two RPC updates found during the full cross-check ──────────────────
-- 1. rpc_bulk_fuel_issuance now writes fleet_asset_id. The client's vehicle
--    and equipment pickers are backed by fleet_assets, so the old vehicle_id/
--    equipment_id inserts either violated the FK to fuel_vehicles (for assets
--    created after the fleet migration) or left fleet_asset_id null, hiding
--    the rows from the consumption analytics.
-- 2. reopen_meal_submission_for_flag now also reopens 'queried' submissions
--    even when the flag has since been resolved — the queried status itself
--    is the signal that the entry needs correction; requiring a still-open
--    flag left the officer with an editable-looking grid whose saves failed.

BEGIN;

-- ── 1. Bulk issuance: fleet_asset_id ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_bulk_fuel_issuance(
  p_site_id        UUID,
  p_tank_id        UUID,
  p_batch_id       UUID,
  p_authorised_by  TEXT,
  p_reason         TEXT,
  p_rows           JSONB   -- array of { transaction_date, time, fleet_asset_id, litres, operator_id, notes }
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id     UUID;
  v_total       NUMERIC(12,3) := 0;
  v_tank_level  NUMERIC(12,3);
  v_tank_cap    NUMERIC(12,3);
  v_row         JSONB;
  v_idx         INT := 0;
  v_txn_number  TEXT;
  v_litres      NUMERIC(12,3);
  v_level_before NUMERIC(12,3);
  v_results     JSONB := '[]'::JSONB;
  v_new_id      UUID;
  v_ids         UUID[] := '{}';
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public._user_has_fuel_perm(p_site_id, ARRAY['fuel.create']) THEN
    RAISE EXCEPTION 'Missing fuel.create permission';
  END IF;

  SELECT current_level_litres, capacity_litres
    INTO v_tank_level, v_tank_cap
    FROM fuel_tanks
   WHERE id = p_tank_id AND site_id = p_site_id;

  IF v_tank_level IS NULL THEN
    RAISE EXCEPTION 'Tank not found or does not belong to this site';
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_litres := (v_row->>'litres')::NUMERIC;
    IF v_litres IS NULL OR v_litres <= 0 THEN
      RAISE EXCEPTION 'Row % has invalid litres', v_idx;
    END IF;
    v_total := v_total + v_litres;
    v_idx := v_idx + 1;
  END LOOP;

  IF v_total > v_tank_level THEN
    RAISE EXCEPTION 'Insufficient stock: requested %.1f L but tank has %.1f L',
      v_total, v_tank_level;
  END IF;

  v_idx := 0;
  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_idx := v_idx + 1;
    v_litres := (v_row->>'litres')::NUMERIC;
    v_level_before := v_tank_level;
    v_tank_level := v_tank_level - v_litres;
    v_txn_number := 'ISS-' || extract(epoch FROM clock_timestamp())::BIGINT || '-' || v_idx;

    INSERT INTO fuel_transactions (
      site_id, transaction_number, transaction_date, tank_id,
      transaction_type, fleet_asset_id, operator_id,
      litres, tank_level_before, tank_level_after,
      docket_number, notes,
      authorised_by_name, authorisation_reason, acknowledgement_status,
      batch_id, created_by
    ) VALUES (
      p_site_id,
      v_txn_number,
      COALESCE((v_row->>'transaction_date')::DATE, CURRENT_DATE),
      p_tank_id,
      'issuance',
      NULLIF(v_row->>'fleet_asset_id', '')::UUID,
      NULLIF(v_row->>'operator_id', '')::UUID,
      v_litres,
      v_level_before,
      v_tank_level,
      NULL,
      COALESCE(v_row->>'notes', ''),
      p_authorised_by,
      p_reason,
      'pending',
      p_batch_id,
      v_user_id
    )
    RETURNING id INTO v_new_id;

    v_ids := v_ids || v_new_id;

    v_results := v_results || jsonb_build_object(
      'id', v_new_id,
      'transaction_number', v_txn_number,
      'litres', v_litres,
      'fleet_asset_id', v_row->>'fleet_asset_id',
      'operator_id', v_row->>'operator_id',
      'transaction_date', COALESCE(v_row->>'transaction_date', CURRENT_DATE::TEXT)
    );
  END LOOP;

  UPDATE fuel_tanks
     SET current_level_litres = v_tank_level
   WHERE id = p_tank_id;

  RETURN jsonb_build_object(
    'batch_id',      p_batch_id,
    'total_litres',  v_total,
    'row_count',     v_idx,
    'tank_level_after', v_tank_level,
    'transaction_ids', to_jsonb(v_ids),
    'rows',          v_results
  );
END;
$$;

-- ── 2. Reopen: allow 'queried' even after the flag is resolved ───────────────
CREATE OR REPLACE FUNCTION public.reopen_meal_submission_for_flag(
  p_submission_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_site_id uuid;
  v_status  text;
  v_open_flags int;
  v_prev_counts jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT site_id, status INTO v_site_id, v_status
    FROM public.daily_submissions
   WHERE id = p_submission_id;
  IF v_site_id IS NULL THEN
    RAISE EXCEPTION 'Submission not found';
  END IF;

  IF NOT public._has_meal_permission('meals.create', v_site_id) THEN
    RAISE EXCEPTION 'You do not have permission to edit meals on this site';
  END IF;

  IF v_status = 'draft' THEN
    RETURN;  -- already editable, no-op
  END IF;

  -- 'queried' is inherently reopenable (it only arises from a kitchen flag);
  -- submitted/approved still require a currently-open flag.
  IF v_status <> 'queried' THEN
    SELECT COUNT(*) INTO v_open_flags
      FROM public.flags
     WHERE submission_id = p_submission_id AND status = 'open';
    IF v_open_flags = 0 THEN
      RAISE EXCEPTION 'This submission has no open flags; it cannot be reopened.';
    END IF;
  END IF;

  SELECT jsonb_build_object(
    'b', COALESCE(SUM(CASE WHEN had_breakfast THEN 1 ELSE 0 END), 0),
    'l', COALESCE(SUM(CASE WHEN had_lunch     THEN 1 ELSE 0 END), 0),
    's', COALESCE(SUM(CASE WHEN had_supper    THEN 1 ELSE 0 END), 0),
    'actor', auth.uid(),
    'reason', 'reopened_via_flag',
    'at', NOW()
  ) INTO v_prev_counts
    FROM public.meal_logs
   WHERE submission_id = p_submission_id;

  UPDATE public.daily_submissions
     SET status = 'draft',
         approved_at = NULL,
         approved_by = NULL,
         previous_counts = v_prev_counts
   WHERE id = p_submission_id;
END;
$$;

COMMIT;
