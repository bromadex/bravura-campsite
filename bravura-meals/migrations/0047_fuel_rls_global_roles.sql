-- ── 0047: Fix fuel RLS for global (site_id IS NULL) roles ─────────────────────
-- Super admins and other global roles store user_roles.site_id as NULL,
-- but the fuel_requests / fuel_deliveries / fuel_dip_readings /
-- bowser_dispatches / fuel_reconciliations policies from 0022–0024 check
--   site_id IN (SELECT site_id FROM user_roles WHERE user_id = auth.uid())
-- which can never match a NULL row. Result: "new row violates row-level
-- security policy" for any global-role user (e.g. submitting a fuel request).
--
-- This migration introduces two NULL-safe helpers (same pattern as
-- _user_has_meals_perm from 0040) and recreates the affected policies.

BEGIN;

-- User belongs to the site (or holds a global role)
CREATE OR REPLACE FUNCTION public._user_at_site(p_site_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid()
      AND (ur.site_id IS NULL OR ur.site_id = p_site_id)
  );
$$;

-- User holds any of the given permission codes at the site (or globally)
CREATE OR REPLACE FUNCTION public._user_has_fuel_perm(p_site_id uuid, p_codes text[])
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM user_roles ur
      JOIN role_permissions rp ON rp.role_id = ur.role_id
      JOIN permissions p        ON p.id = rp.permission_id
     WHERE ur.user_id = auth.uid()
       AND (ur.site_id IS NULL OR ur.site_id = p_site_id)
       AND p.code = ANY(p_codes)
  );
$$;

REVOKE ALL ON FUNCTION public._user_at_site(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._user_at_site(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public._user_has_fuel_perm(uuid, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._user_has_fuel_perm(uuid, text[]) TO authenticated;

-- ── fuel_requests ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "fuel_requests_select" ON fuel_requests;
DROP POLICY IF EXISTS "fuel_requests_insert" ON fuel_requests;
DROP POLICY IF EXISTS "fuel_requests_update" ON fuel_requests;

CREATE POLICY "fuel_requests_select" ON fuel_requests
  FOR SELECT USING (public._user_at_site(site_id));

CREATE POLICY "fuel_requests_insert" ON fuel_requests
  FOR INSERT WITH CHECK (
    public._user_at_site(site_id)
    AND requested_by = auth.uid()
    AND created_by   = auth.uid()
  );

CREATE POLICY "fuel_requests_update" ON fuel_requests
  FOR UPDATE USING (public._user_has_fuel_perm(site_id, ARRAY['fuel.approve']));

-- ── fuel_deliveries ───────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "fuel_deliveries_select" ON fuel_deliveries;
DROP POLICY IF EXISTS "fuel_deliveries_insert" ON fuel_deliveries;
DROP POLICY IF EXISTS "fuel_deliveries_update" ON fuel_deliveries;

CREATE POLICY "fuel_deliveries_select" ON fuel_deliveries
  FOR SELECT USING (public._user_at_site(site_id));

CREATE POLICY "fuel_deliveries_insert" ON fuel_deliveries
  FOR INSERT WITH CHECK (public._user_has_fuel_perm(site_id, ARRAY['fuel.create']));

CREATE POLICY "fuel_deliveries_update" ON fuel_deliveries
  FOR UPDATE USING (public._user_has_fuel_perm(site_id, ARRAY['fuel.approve']));

-- ── fuel_dip_readings ─────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "fuel_dip_readings_select" ON fuel_dip_readings;
DROP POLICY IF EXISTS "fuel_dip_readings_insert" ON fuel_dip_readings;

CREATE POLICY "fuel_dip_readings_select" ON fuel_dip_readings
  FOR SELECT USING (public._user_at_site(site_id));

CREATE POLICY "fuel_dip_readings_insert" ON fuel_dip_readings
  FOR INSERT WITH CHECK (public._user_has_fuel_perm(site_id, ARRAY['fuel.create']));

-- ── bowser_dispatches ─────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "bowser_dispatches_select" ON bowser_dispatches;
DROP POLICY IF EXISTS "bowser_dispatches_insert" ON bowser_dispatches;
DROP POLICY IF EXISTS "bowser_dispatches_update" ON bowser_dispatches;

CREATE POLICY "bowser_dispatches_select" ON bowser_dispatches
  FOR SELECT USING (public._user_at_site(site_id));

CREATE POLICY "bowser_dispatches_insert" ON bowser_dispatches
  FOR INSERT WITH CHECK (public._user_has_fuel_perm(site_id, ARRAY['fuel.create']));

CREATE POLICY "bowser_dispatches_update" ON bowser_dispatches
  FOR UPDATE USING (public._user_has_fuel_perm(site_id, ARRAY['fuel.approve']));

-- ── fuel_reconciliations ──────────────────────────────────────────────────────

DROP POLICY IF EXISTS "fuel_reconciliations_select" ON fuel_reconciliations;
DROP POLICY IF EXISTS "fuel_reconciliations_insert" ON fuel_reconciliations;
DROP POLICY IF EXISTS "fuel_reconciliations_update" ON fuel_reconciliations;

CREATE POLICY "fuel_reconciliations_select" ON fuel_reconciliations
  FOR SELECT USING (public._user_at_site(site_id));

CREATE POLICY "fuel_reconciliations_insert" ON fuel_reconciliations
  FOR INSERT WITH CHECK (public._user_has_fuel_perm(site_id, ARRAY['fuel.create']));

CREATE POLICY "fuel_reconciliations_update" ON fuel_reconciliations
  FOR UPDATE USING (public._user_has_fuel_perm(site_id, ARRAY['fuel.approve']));

COMMIT;
