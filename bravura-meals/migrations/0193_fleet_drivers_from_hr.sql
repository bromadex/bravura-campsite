-- 0193: Employees whose designation is a driver or machine operator appear on Fleet → Drivers automatically.
-- Matches "driver" or "operator" in the designation name (batch plant operators excluded — fixed plant, not fleet).
-- Existing driver records are never removed; licence details are filled in on the Drivers page.
CREATE OR REPLACE FUNCTION _is_driver_designation(p_designation_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM designations d WHERE d.id = p_designation_id
                  AND (d.name ILIKE '%driver%' OR (d.name ILIKE '%operator%' AND d.name NOT ILIKE '%batch plant%')))
$$;

CREATE OR REPLACE FUNCTION _fleet_sync_driver(p_employee_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _e employees%ROWTYPE;
BEGIN
  SELECT * INTO _e FROM employees WHERE id = p_employee_id;
  IF NOT FOUND OR _e.status <> 'active' OR _e.site_id IS NULL OR NOT _is_driver_designation(_e.designation_id) THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM fleet_drivers WHERE employee_id = _e.id AND site_id = _e.site_id AND NOT COALESCE(is_archived, false)) THEN RETURN; END IF;
  INSERT INTO fleet_drivers (site_id, employee_id, is_active, notes)
  VALUES (_e.site_id, _e.id, true, 'Added from HR (designation). Add licence details.');
END;
$$;

CREATE OR REPLACE FUNCTION fleet_sync_drivers_from_hr(p_site_id UUID)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id UUID; _n INT := 0;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT _has_permission('fleet.edit', p_site_id) THEN RAISE EXCEPTION 'You do not have permission to manage drivers'; END IF;
  FOR _id IN SELECT e.id FROM employees e WHERE e.site_id = p_site_id AND e.status = 'active' AND _is_driver_designation(e.designation_id)
               AND NOT EXISTS (SELECT 1 FROM fleet_drivers d WHERE d.employee_id = e.id AND d.site_id = e.site_id AND NOT COALESCE(d.is_archived, false)) LOOP
    PERFORM _fleet_sync_driver(_id); _n := _n + 1;
  END LOOP;
  RETURN _n;
END;
$$;
REVOKE ALL ON FUNCTION fleet_sync_drivers_from_hr(UUID), _fleet_sync_driver(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION fleet_sync_drivers_from_hr(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION trg_employee_driver_sync() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM _fleet_sync_driver(NEW.id);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;   -- never block HR saves
END;
$$;
DROP TRIGGER IF EXISTS trg_employee_driver_sync ON employees;
CREATE TRIGGER trg_employee_driver_sync AFTER INSERT OR UPDATE OF designation_id, status, site_id ON employees
  FOR EACH ROW EXECUTE FUNCTION trg_employee_driver_sync();

-- Backfill every site now.
DO $$ DECLARE s UUID; BEGIN
  FOR s IN SELECT id FROM sites LOOP PERFORM fleet_sync_drivers_from_hr(s); END LOOP;
END $$;

INSERT INTO schema_migrations (filename) VALUES ('0193_fleet_drivers_from_hr.sql') ON CONFLICT DO NOTHING;
