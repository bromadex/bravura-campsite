-- ── 0053: Fix tank_calibrations RLS for global roles ─────────────────────────
-- Migration 0047 fixed RLS for fuel_requests, fuel_deliveries, etc. to use the
-- NULL-safe _user_at_site() helper, but missed tank_calibrations.
-- Super Admins (site_id IS NULL in user_roles) could not read calibration data
-- because the old policy used `site_id IN (SELECT site_id FROM user_roles ...)`
-- which never matches NULL.

-- Drop old policies that use the broken site_id IN (...) pattern
DROP POLICY IF EXISTS "tank_calibrations_select" ON tank_calibrations;
DROP POLICY IF EXISTS "tank_calibrations_insert" ON tank_calibrations;
DROP POLICY IF EXISTS "tank_calibrations_delete" ON tank_calibrations;

-- SELECT: any user who can see the tank's site can read its calibration
CREATE POLICY "tank_calibrations_select" ON tank_calibrations
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM fuel_tanks ft
      WHERE ft.id = tank_calibrations.tank_id
        AND (
          ft.site_id IN (SELECT ur.site_id FROM user_roles ur WHERE ur.user_id = auth.uid() AND ur.site_id IS NOT NULL)
          OR EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = auth.uid() AND ur.site_id IS NULL)
        )
    )
  );

-- INSERT: fuel.edit holders
CREATE POLICY "tank_calibrations_insert" ON tank_calibrations
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM fuel_tanks ft
      WHERE ft.id = tank_calibrations.tank_id
        AND (
          ft.site_id IN (SELECT ur.site_id FROM user_roles ur WHERE ur.user_id = auth.uid() AND ur.site_id IS NOT NULL)
          OR EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = auth.uid() AND ur.site_id IS NULL)
        )
    )
  );

-- DELETE: fuel.edit holders
CREATE POLICY "tank_calibrations_delete" ON tank_calibrations
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM fuel_tanks ft
      WHERE ft.id = tank_calibrations.tank_id
        AND (
          ft.site_id IN (SELECT ur.site_id FROM user_roles ur WHERE ur.user_id = auth.uid() AND ur.site_id IS NOT NULL)
          OR EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = auth.uid() AND ur.site_id IS NULL)
        )
    )
  );
