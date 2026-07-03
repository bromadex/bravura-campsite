-- ── 0053: Fix tank_calibrations RLS for global roles ─────────────────────────
-- Migration 0047 fixed RLS for fuel_requests, fuel_deliveries, etc. to use the
-- NULL-safe _user_at_site() helper, but missed tank_calibrations.
-- Super Admins (site_id IS NULL in user_roles) could not read calibration data
-- because the old policy used `site_id IN (SELECT site_id FROM user_roles ...)`
-- which never matches NULL.

BEGIN;

DROP POLICY IF EXISTS "tank_calibrations_select" ON tank_calibrations;
DROP POLICY IF EXISTS "tank_calibrations_insert" ON tank_calibrations;
DROP POLICY IF EXISTS "tank_calibrations_delete" ON tank_calibrations;

CREATE POLICY "tank_calibrations_select" ON tank_calibrations
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM fuel_tanks ft
      WHERE ft.id = tank_calibrations.tank_id
        AND public._user_at_site(ft.site_id)
    )
  );

CREATE POLICY "tank_calibrations_insert" ON tank_calibrations
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM fuel_tanks ft
      WHERE ft.id = tank_calibrations.tank_id
        AND public._user_has_fuel_perm(ft.site_id, ARRAY['fuel.edit'])
    )
  );

CREATE POLICY "tank_calibrations_delete" ON tank_calibrations
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM fuel_tanks ft
      WHERE ft.id = tank_calibrations.tank_id
        AND public._user_has_fuel_perm(ft.site_id, ARRAY['fuel.edit'])
    )
  );

COMMIT;
