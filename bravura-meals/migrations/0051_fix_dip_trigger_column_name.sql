-- ── 0051: Fix dip snapshot trigger after column rename ───────────────────────
-- Migration 0023 renamed reading_litres → level_litres but the trigger
-- fuel_update_dip_snapshot (from 0020) still references NEW.reading_litres.
-- This recreates the trigger function with the correct column name.
--
-- Also: the dip end reading is the physical ground truth of what is in the
-- tank, so this trigger now also updates current_level_litres to match the
-- dip end measurement (using level_end_litres if available, falling back to
-- level_litres for legacy rows).

CREATE OR REPLACE FUNCTION fuel_update_dip_snapshot()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  _dip_level NUMERIC(12,3);
BEGIN
  _dip_level := COALESCE(NEW.level_end_litres, NEW.level_litres);

  UPDATE fuel_tanks
  SET last_dip_date       = NEW.reading_date,
      last_dip_reading    = _dip_level,
      current_level_litres = _dip_level,
      updated_at          = now()
  WHERE id = NEW.tank_id
    AND (last_dip_date IS NULL OR NEW.reading_date >= last_dip_date);
  RETURN NEW;
END;
$$;
