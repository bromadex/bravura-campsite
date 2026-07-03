-- ── 0051: Fix dip snapshot trigger after column rename ───────────────────────
-- Migration 0023 renamed reading_litres → level_litres but the trigger
-- fuel_update_dip_snapshot (from 0020) still references NEW.reading_litres.
-- This recreates the trigger function with the correct column name.

CREATE OR REPLACE FUNCTION fuel_update_dip_snapshot()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE fuel_tanks
  SET last_dip_date    = NEW.reading_date,
      last_dip_reading = NEW.level_litres,
      updated_at       = now()
  WHERE id = NEW.tank_id
    AND (last_dip_date IS NULL OR NEW.reading_date >= last_dip_date);
  RETURN NEW;
END;
$$;
