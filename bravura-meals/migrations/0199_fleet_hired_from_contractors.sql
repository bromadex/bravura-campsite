-- 0199 fleet_hired_from_contractors — Hired plant and vehicles are recorded once, in the
-- Contractors module (hired_vehicles / hired_equipment, tied to the contractor and contract).
-- Fleet's "Contractor Equipment" screen now shows those records; fleet.view may read them.
-- fleet_contractor_equipment was empty and is frozen.

DROP POLICY IF EXISTS hired_vehicles_fleet_read ON hired_vehicles;
CREATE POLICY hired_vehicles_fleet_read ON hired_vehicles FOR SELECT TO authenticated
  USING (_has_permission('fleet.view', site_id));
DROP POLICY IF EXISTS hired_equipment_fleet_read ON hired_equipment;
CREATE POLICY hired_equipment_fleet_read ON hired_equipment FOR SELECT TO authenticated
  USING (_has_permission('fleet.view', site_id));

DROP TRIGGER IF EXISTS trg_frozen ON fleet_contractor_equipment;
CREATE TRIGGER trg_frozen BEFORE INSERT OR UPDATE ON fleet_contractor_equipment
  FOR EACH ROW EXECUTE FUNCTION trg_moved_to_sheq('Contractor equipment', 'Contractors → Hired Vehicles / Hired Equipment');

INSERT INTO schema_migrations (filename) VALUES ('0199_fleet_hired_from_contractors.sql') ON CONFLICT DO NOTHING;
