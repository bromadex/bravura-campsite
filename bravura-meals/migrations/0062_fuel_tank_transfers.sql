-- ── 0062: Tank-to-tank fuel transfers ─────────────────────────────────────────
-- Adds transfer_out / transfer_in transaction types so fuel can be moved
-- between tanks (e.g. main tank → 210L drums). Both the INSERT trigger
-- (fuel_update_tank_level) and the UPDATE trigger (_fuel_recalc_tank_level)
-- are patched to handle the new types.

-- ─── 1. Patch the INSERT trigger to handle transfers ──────────────────────
-- transfer_out = subtract from source tank (same as issuance)
-- transfer_in  = add to destination tank (same as delivery)

CREATE OR REPLACE FUNCTION fuel_update_tank_level()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.transaction_type IN ('issuance', 'transfer_out') THEN
    UPDATE fuel_tanks
    SET current_level_litres = GREATEST(0, current_level_litres - NEW.litres),
        updated_at           = now()
    WHERE id = NEW.tank_id;

  ELSIF NEW.transaction_type IN ('delivery', 'transfer_in') THEN
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

-- ─── 2. Patch the UPDATE trigger to handle transfers + soft-delete ────────

CREATE OR REPLACE FUNCTION _fuel_recalc_tank_level()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _old_effect NUMERIC(12,3);
  _new_effect NUMERIC(12,3);
BEGIN
  _old_effect := CASE
    WHEN OLD.is_deleted THEN 0
    WHEN OLD.transaction_type IN ('issuance', 'transfer_out') THEN -OLD.litres
    WHEN OLD.transaction_type IN ('delivery', 'transfer_in', 'adjustment', 'dip_correction') THEN OLD.litres
    ELSE 0
  END;

  _new_effect := CASE
    WHEN NEW.is_deleted THEN 0
    WHEN NEW.transaction_type IN ('issuance', 'transfer_out') THEN -NEW.litres
    WHEN NEW.transaction_type IN ('delivery', 'transfer_in', 'adjustment', 'dip_correction') THEN NEW.litres
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
