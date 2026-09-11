-- 0089: Fix dip trigger to actually call the function that updates current_level_litres.
--
-- Bug: Migration 0051 created fuel_update_dip_snapshot() (which updates
-- current_level_litres from dip readings) but never repointed the trigger.
-- The trigger trg_fuel_update_last_dip still calls the original
-- fuel_update_last_dip() from 0020, which only sets last_dip_date and
-- last_dip_reading — so current_level_litres never reflects dip readings.
--
-- Fix: rebind the trigger to fuel_update_dip_snapshot() and add SECURITY
-- DEFINER so it can update fuel_tanks regardless of the caller's RLS.
-- Then recompute current_level_litres for all dipstick-tracked tanks from
-- their most recent non-deleted dip reading.

BEGIN;

-- Harden the function with SECURITY DEFINER (matches 0088 pattern)
CREATE OR REPLACE FUNCTION public.fuel_update_dip_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _dip_level NUMERIC(12,3);
BEGIN
  _dip_level := COALESCE(NEW.level_end_litres, NEW.level_litres);

  UPDATE fuel_tanks
  SET last_dip_date        = NEW.reading_date,
      last_dip_reading     = _dip_level,
      current_level_litres = _dip_level,
      updated_at           = now()
  WHERE id = NEW.tank_id
    AND (last_dip_date IS NULL OR NEW.reading_date >= last_dip_date);
  RETURN NEW;
END;
$$;

-- Rebind the trigger to the correct function
DROP TRIGGER IF EXISTS trg_fuel_update_last_dip ON fuel_dip_readings;
CREATE TRIGGER trg_fuel_update_last_dip
  AFTER INSERT ON fuel_dip_readings
  FOR EACH ROW EXECUTE FUNCTION fuel_update_dip_snapshot();

-- One-time correction: set current_level_litres from the most recent dip
-- reading for each dipstick-tracked tank.
UPDATE fuel_tanks t
   SET current_level_litres = sub.dip_level,
       updated_at = NOW()
  FROM (
    SELECT DISTINCT ON (d.tank_id)
           d.tank_id,
           COALESCE(d.level_end_litres, d.level_litres) AS dip_level
      FROM fuel_dip_readings d
     WHERE COALESCE(d.is_archived, false) = false
     ORDER BY d.tank_id, d.reading_date DESC, d.created_at DESC
  ) sub
 WHERE t.id = sub.tank_id
   AND t.level_tracking_method = 'dipstick';

INSERT INTO schema_migrations (filename)
VALUES ('0089_fix_dip_trigger_binding.sql')
ON CONFLICT DO NOTHING;

COMMIT;
