-- 0196 fuel_uses_fleet — Fuel shares Fleet's asset and driver records.
-- Fuel issues already record fleet_asset_id; fuel_vehicles / fuel_equipment are empty legacy
-- tables, so they are frozen. Every active Fleet driver is automatically authorised to draw
-- fuel (fuel_operators stays as the wider list: machine operators who are not drivers).

DROP TRIGGER IF EXISTS trg_frozen ON fuel_vehicles;
CREATE TRIGGER trg_frozen BEFORE INSERT OR UPDATE ON fuel_vehicles
  FOR EACH ROW EXECUTE FUNCTION trg_moved_to_sheq('Fuel vehicle', 'Fleet → Assets');
DROP TRIGGER IF EXISTS trg_frozen ON fuel_equipment;
CREATE TRIGGER trg_frozen BEFORE INSERT OR UPDATE ON fuel_equipment
  FOR EACH ROW EXECUTE FUNCTION trg_moved_to_sheq('Fuel equipment', 'Fleet → Assets');

CREATE OR REPLACE FUNCTION trg_driver_to_fuel_operator() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.employee_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.is_active AND NOT COALESCE(NEW.is_archived, false) THEN
    INSERT INTO fuel_operators (site_id, employee_id, licence_number, licence_expiry, is_active, activated_at, created_by)
    VALUES (NEW.site_id, NEW.employee_id, NEW.licence_number, NEW.licence_expiry, true, now(), NEW.created_by)
    ON CONFLICT (site_id, employee_id) DO UPDATE
      SET licence_number = COALESCE(EXCLUDED.licence_number, fuel_operators.licence_number),
          licence_expiry = COALESCE(EXCLUDED.licence_expiry, fuel_operators.licence_expiry),
          is_active = true, deactivated_at = NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_driver_fuel_operator ON fleet_drivers;
CREATE TRIGGER trg_driver_fuel_operator AFTER INSERT OR UPDATE ON fleet_drivers
  FOR EACH ROW EXECUTE FUNCTION trg_driver_to_fuel_operator();

-- Backfill: current drivers become operators.
INSERT INTO fuel_operators (site_id, employee_id, licence_number, licence_expiry, is_active, activated_at)
SELECT d.site_id, d.employee_id, d.licence_number, d.licence_expiry, true, now()
  FROM fleet_drivers d
 WHERE d.employee_id IS NOT NULL AND d.is_active AND NOT COALESCE(d.is_archived, false)
ON CONFLICT (site_id, employee_id) DO NOTHING;

INSERT INTO schema_migrations (filename) VALUES ('0196_fuel_uses_fleet.sql') ON CONFLICT DO NOTHING;
