-- ── 0048: Bulk fuel issuance support ─────────────────────────────────────────
-- Adds a batch_id column to fuel_transactions so bulk issuances can be grouped,
-- and creates an RPC that inserts all rows in a single database transaction.
-- If any row fails validation the entire batch is rolled back.

BEGIN;

-- ── 1. batch_id column ──────────────────────────────────────────────────────
ALTER TABLE fuel_transactions
  ADD COLUMN IF NOT EXISTS batch_id UUID;

CREATE INDEX IF NOT EXISTS idx_fuel_txn_batch
  ON fuel_transactions (batch_id) WHERE batch_id IS NOT NULL;

COMMENT ON COLUMN fuel_transactions.batch_id IS
  'Groups rows created during a single bulk issuance. NULL for single-issue transactions.';

-- ── 2. Atomic bulk-insert RPC ───────────────────────────────────────────────
-- Accepts a JSONB array of issuance rows, validates stock, inserts all within
-- a single transaction, updates each tank level, and returns the created rows.

CREATE OR REPLACE FUNCTION public.rpc_bulk_fuel_issuance(
  p_site_id        UUID,
  p_tank_id        UUID,
  p_batch_id       UUID,
  p_authorised_by  TEXT,
  p_reason         TEXT,
  p_rows           JSONB   -- array of { transaction_date, time, vehicle_id, equipment_id, litres, operator_id, notes }
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
  -- Auth check
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Permission check via existing helper
  IF NOT public._user_has_fuel_perm(p_site_id, ARRAY['fuel.create']) THEN
    RAISE EXCEPTION 'Missing fuel.create permission';
  END IF;

  -- Validate tank exists and get current level
  SELECT current_level_litres, capacity_litres
    INTO v_tank_level, v_tank_cap
    FROM fuel_tanks
   WHERE id = p_tank_id AND site_id = p_site_id;

  IF v_tank_level IS NULL THEN
    RAISE EXCEPTION 'Tank not found or does not belong to this site';
  END IF;

  -- Pre-calculate total litres requested
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

  -- Insert each row
  v_idx := 0;
  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_idx := v_idx + 1;
    v_litres := (v_row->>'litres')::NUMERIC;
    v_level_before := v_tank_level;
    v_tank_level := v_tank_level - v_litres;
    v_txn_number := 'ISS-' || extract(epoch FROM clock_timestamp())::BIGINT || '-' || v_idx;

    INSERT INTO fuel_transactions (
      site_id, transaction_number, transaction_date, tank_id,
      transaction_type, vehicle_id, equipment_id, operator_id,
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
      NULLIF(v_row->>'vehicle_id', '')::UUID,
      NULLIF(v_row->>'equipment_id', '')::UUID,
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
      'vehicle_id', v_row->>'vehicle_id',
      'equipment_id', v_row->>'equipment_id',
      'operator_id', v_row->>'operator_id',
      'transaction_date', COALESCE(v_row->>'transaction_date', CURRENT_DATE::TEXT)
    );
  END LOOP;

  -- Update tank level
  UPDATE fuel_tanks
     SET current_level_litres = v_tank_level
   WHERE id = p_tank_id;

  -- Return results with batch summary
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

REVOKE ALL ON FUNCTION public.rpc_bulk_fuel_issuance(UUID, UUID, UUID, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_bulk_fuel_issuance(UUID, UUID, UUID, TEXT, TEXT, JSONB) TO authenticated;

COMMIT;
