-- ══════════════════════════════════════════════════════════════════════════════
-- 0079 — Fleet RLS lockdown: USING(true) → permission + site checked in the DB
-- ══════════════════════════════════════════════════════════════════════════════
-- 0063/0066/0067 shipped fleet tables with fully permissive policies (any
-- authenticated user could read/write everything). This replaces them with
-- the meals/HR pattern: every operation requires the matching fleet.*
-- permission scoped to the row's site_id, enforced server-side.

BEGIN;

-- ── 1. Generic permission helper (module-agnostic twin of _has_hr_permission)
CREATE OR REPLACE FUNCTION public._has_permission(p_code TEXT, p_site_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
      FROM user_roles ur
      JOIN role_permissions rp ON rp.role_id = ur.role_id
      JOIN permissions p       ON p.id = rp.permission_id
     WHERE ur.user_id = auth.uid()
       AND p.code = p_code
       AND (ur.site_id IS NULL OR ur.site_id = p_site_id)
  );
$$;

-- ── 2. Seed fleet permissions if missing (respects the (module, action)
--      unique constraint and the 5-value action check). Grants mirror the
--      fuel module so nobody who can work today gets locked out. Additive
--      and idempotent — existing grants are untouched.
INSERT INTO permissions (code, module, action) VALUES
  ('fleet.view',   'fleet', 'View'),
  ('fleet.create', 'fleet', 'Create'),
  ('fleet.edit',   'fleet', 'Edit'),
  ('fleet.delete', 'fleet', 'Delete')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, p_new.id
  FROM role_permissions rp
  JOIN permissions p_old ON p_old.id = rp.permission_id
  JOIN permissions p_new ON p_new.module = 'fleet' AND p_new.action = p_old.action
 WHERE p_old.module = 'fuel'
ON CONFLICT DO NOTHING;

-- ── 3. Replace permissive policies on every site-scoped fleet table ─────────
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'fleet_assets', 'fleet_status_history', 'fleet_assignments',
    'fleet_inspection_templates', 'fleet_inspections', 'fleet_inspection_items',
    'fleet_trips', 'fleet_work_orders', 'fleet_maintenance',
    'fleet_maintenance_parts', 'fleet_compliance', 'fleet_documents',
    'fleet_meter_readings', 'fleet_drivers', 'fleet_tyres',
    'fleet_accidents', 'fleet_settings', 'fleet_contractor_equipment'
  ] LOOP
    -- Drop both naming variants used by 0063/0066 and 0067
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', tbl || '_read',   tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', tbl || '_insert', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', tbl || '_update', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', tbl || '_delete', tbl);
    EXECUTE format('DROP POLICY IF EXISTS fleet_contractor_eq_read ON %I',   tbl);
    EXECUTE format('DROP POLICY IF EXISTS fleet_contractor_eq_insert ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS fleet_contractor_eq_update ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS fleet_contractor_eq_delete ON %I', tbl);

    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT TO authenticated
       USING (public._has_permission(''fleet.view'', site_id))', tbl || '_read', tbl);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT TO authenticated
       WITH CHECK (public._has_permission(''fleet.create'', site_id))', tbl || '_insert', tbl);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR UPDATE TO authenticated
       USING (public._has_permission(''fleet.edit'', site_id))
       WITH CHECK (public._has_permission(''fleet.edit'', site_id))', tbl || '_update', tbl);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR DELETE TO authenticated
       USING (public._has_permission(''fleet.delete'', site_id))', tbl || '_delete', tbl);
  END LOOP;
END $$;

-- ── 4. fleet_asset_types: global lookup — open read, writes need fleet.edit
--      on any site
DROP POLICY IF EXISTS fleet_asset_types_read  ON fleet_asset_types;
DROP POLICY IF EXISTS fleet_asset_types_write ON fleet_asset_types;
CREATE POLICY fleet_asset_types_read ON fleet_asset_types
  FOR SELECT TO authenticated USING (true);
CREATE POLICY fleet_asset_types_write ON fleet_asset_types
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM user_roles ur
      JOIN role_permissions rp ON rp.role_id = ur.role_id
      JOIN permissions p ON p.id = rp.permission_id
     WHERE ur.user_id = auth.uid() AND p.code = 'fleet.edit'))
  WITH CHECK (EXISTS (
    SELECT 1 FROM user_roles ur
      JOIN role_permissions rp ON rp.role_id = ur.role_id
      JOIN permissions p ON p.id = rp.permission_id
     WHERE ur.user_id = auth.uid() AND p.code = 'fleet.edit'));

INSERT INTO public.schema_migrations (filename)
VALUES ('0079_fleet_rls_lockdown.sql') ON CONFLICT (filename) DO NOTHING;

COMMIT;
