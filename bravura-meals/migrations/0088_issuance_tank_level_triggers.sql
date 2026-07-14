-- 0088: Make tank levels self-maintaining for issuance-tracked tanks.
--
-- Bug: deleting (soft-deleting) a fuel issuance never restored the tank
-- level. Root cause: trg_fuel_transactions_recalc / trg_fuel_update_tank_level
-- exist but their functions were empty stubs (RETURN NEW), and the bulk
-- issuance RPC updated fuel_tanks manually — so inserts deducted fuel, but
-- edits and soft-deletes changed nothing.
--
-- Design (applies ONLY to tanks with level_tracking_method = 'issuance';
-- dipstick tanks remain driven by dip readings):
--   • INSERT trigger deducts issuances. Deliveries are NOT handled on insert
--     because FuelReceipts confirms them client-side (adding on insert too
--     would double-count).
--   • UPDATE trigger applies the delta between the row's old and new effect,
--     covering soft-delete (restore), un-delete (re-deduct), litres edits,
--     and tank moves — for both issuances and deliveries.
--   • rpc_bulk_fuel_issuance no longer updates fuel_tanks directly; the
--     insert trigger does it row by row.
--   • One-time correction: recompute issuance-tracked tank levels as
--     deliveries − issuances over non-deleted transactions.

BEGIN;

-- Effect of a transaction row on its tank's level (issuance-tracked only)
CREATE OR REPLACE FUNCTION public._fuel_txn_level_effect(
  p_type TEXT, p_litres NUMERIC, p_deleted BOOLEAN
) RETURNS NUMERIC
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN COALESCE(p_deleted, false) THEN 0
    WHEN p_type = 'issuance' THEN -COALESCE(p_litres, 0)
    WHEN p_type = 'delivery' THEN  COALESCE(p_litres, 0)
    ELSE 0
  END;
$$;

CREATE OR REPLACE FUNCTION public.fuel_update_tank_level()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Insert: deduct issuances on issuance-tracked tanks.
  -- Deliveries are confirmed client-side (FuelReceipts) — skip them here.
  IF NEW.transaction_type = 'issuance' AND NOT COALESCE(NEW.is_deleted, false) THEN
    UPDATE fuel_tanks
       SET current_level_litres = current_level_litres - NEW.litres,
           updated_at = NOW()
     WHERE id = NEW.tank_id
       AND level_tracking_method = 'issuance';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public._fuel_recalc_tank_level()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_effect NUMERIC := public._fuel_txn_level_effect(OLD.transaction_type, OLD.litres, OLD.is_deleted);
  v_new_effect NUMERIC := public._fuel_txn_level_effect(NEW.transaction_type, NEW.litres, NEW.is_deleted);
BEGIN
  IF NEW.tank_id IS DISTINCT FROM OLD.tank_id THEN
    -- moved tanks: remove old effect from old tank, apply new effect to new tank
    UPDATE fuel_tanks
       SET current_level_litres = current_level_litres - v_old_effect,
           updated_at = NOW()
     WHERE id = OLD.tank_id AND level_tracking_method = 'issuance';
    UPDATE fuel_tanks
       SET current_level_litres = current_level_litres + v_new_effect,
           updated_at = NOW()
     WHERE id = NEW.tank_id AND level_tracking_method = 'issuance';
  ELSIF v_new_effect <> v_old_effect THEN
    UPDATE fuel_tanks
       SET current_level_litres = current_level_litres + (v_new_effect - v_old_effect),
           updated_at = NOW()
     WHERE id = NEW.tank_id AND level_tracking_method = 'issuance';
  END IF;
  RETURN NEW;
END;
$$;

-- Bulk issuance RPC: stop updating fuel_tanks directly (the insert trigger
-- now deducts per row). Body otherwise identical to 0074.
CREATE OR REPLACE FUNCTION public.rpc_bulk_fuel_issuance(
  p_site_id        UUID,
  p_tank_id        UUID,
  p_batch_id       UUID,
  p_authorised_by  TEXT,
  p_reason         TEXT,
  p_rows           JSONB
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
  v_tracking    TEXT;
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

  SELECT current_level_litres, capacity_litres, level_tracking_method
    INTO v_tank_level, v_tank_cap, v_tracking
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

  -- Tank level is maintained by trg_fuel_update_tank_level for
  -- issuance-tracked tanks. For dipstick tanks the level stays dip-driven,
  -- matching single-entry behaviour.

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

-- One-time correction for issuance-tracked tanks (restores fuel from
-- previously soft-deleted issuances that were never credited back).
UPDATE fuel_tanks t
   SET current_level_litres = (
     SELECT COALESCE(SUM(public._fuel_txn_level_effect(x.transaction_type, x.litres, x.is_deleted)), 0)
       FROM fuel_transactions x
      WHERE x.tank_id = t.id
   ),
   updated_at = NOW()
 WHERE t.level_tracking_method = 'issuance';

INSERT INTO schema_migrations (filename)
VALUES ('0088_issuance_tank_level_triggers.sql')
ON CONFLICT DO NOTHING;

COMMIT;
