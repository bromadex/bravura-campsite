-- ── 0056: Tank level updated by dip readings only (not flowmeter issuances) ──
-- The flowmeter is inaccurate so issuances should NOT adjust current_level_litres.
-- Dip readings are the physical ground truth.
-- Deliveries still add to tank level since they are measured quantities.

-- ─── 1. Replace fuel_update_tank_level() — skip issuance ───────────────────

CREATE OR REPLACE FUNCTION fuel_update_tank_level()
RETURNS TRIGGER AS $$
BEGIN
  -- Issuances no longer affect tank level — dip readings are the source of truth
  IF NEW.transaction_type = 'issuance' THEN
    RETURN NEW;
  END IF;

  IF NEW.transaction_type = 'delivery' THEN
    UPDATE fuel_tanks
    SET current_level_litres = current_level_litres + NEW.litres,
        updated_at           = now()
    WHERE id = NEW.tank_id;

  ELSIF NEW.transaction_type IN ('adjustment', 'dip_correction') THEN
    UPDATE fuel_tanks
    SET current_level_litres = current_level_litres + NEW.litres,
        updated_at           = now()
    WHERE id = NEW.tank_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─── 2. Replace _fuel_recalc_tank_level() — skip issuance on edit ──────────

CREATE OR REPLACE FUNCTION _fuel_recalc_tank_level()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _old_effect NUMERIC(12,3);
  _new_effect NUMERIC(12,3);
BEGIN
  _old_effect := CASE
    WHEN OLD.transaction_type = 'issuance' THEN 0  -- no longer tracked
    WHEN OLD.transaction_type IN ('delivery', 'adjustment', 'dip_correction') THEN OLD.litres
    ELSE 0
  END;

  _new_effect := CASE
    WHEN NEW.transaction_type = 'issuance' THEN 0  -- no longer tracked
    WHEN NEW.transaction_type IN ('delivery', 'adjustment', 'dip_correction') THEN NEW.litres
    ELSE 0
  END;

  IF OLD.tank_id IS DISTINCT FROM NEW.tank_id THEN
    UPDATE fuel_tanks
    SET current_level_litres = GREATEST(0, current_level_litres - _old_effect),
        updated_at = now()
    WHERE id = OLD.tank_id;

    UPDATE fuel_tanks
    SET current_level_litres = GREATEST(0, current_level_litres + _new_effect),
        updated_at = now()
    WHERE id = NEW.tank_id;
  ELSE
    UPDATE fuel_tanks
    SET current_level_litres = GREATEST(0, current_level_litres + (_new_effect - _old_effect)),
        updated_at = now()
    WHERE id = NEW.tank_id;
  END IF;

  RETURN NEW;
END;
$$;

-- ─── 3. Replace fuel_bulk_issuance() — remove tank level update ────────────
-- The bulk function currently sets current_level_litres directly.
-- We still validate stock levels (warn if issuing more than available) but
-- no longer deduct from the tank — the next dip reading will set the truth.

CREATE OR REPLACE FUNCTION fuel_bulk_issuance(
  p_site_id    UUID,
  p_tank_id    UUID,
  p_rows       JSONB,
  p_authorised_by TEXT DEFAULT NULL,
  p_reason     TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_id   UUID := auth.uid();
  v_tank_level NUMERIC(12,3);
  v_tank_cap  NUMERIC(12,3);
  v_total     NUMERIC(12,3) := 0;
  v_litres    NUMERIC(12,3);
  v_level_before NUMERIC(12,3);
  v_row       JSONB;
  v_idx       INT := 0;
  v_batch_id  UUID := gen_random_uuid();
  v_txn_number TEXT;
  v_new_id    UUID;
  v_ids       UUID[] := '{}';
  v_results   JSONB := '[]'::JSONB;
  v_tank_level_running NUMERIC(12,3);
BEGIN
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
  v_tank_level_running := v_tank_level;
  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_idx := v_idx + 1;
    v_litres := (v_row->>'litres')::NUMERIC;
    v_level_before := v_tank_level_running;
    v_tank_level_running := v_tank_level_running - v_litres;
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
      v_tank_level_running,
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

  -- No longer update tank level — dip readings are the source of truth
  -- tank_level_before/after columns still record the calculated values for audit

  RETURN jsonb_build_object(
    'batch_id',      p_batch_id,
    'total_litres',  v_total,
    'count',         v_idx,
    'tank_id',       p_tank_id,
    'transactions',  v_results
  );
END;
$$;
