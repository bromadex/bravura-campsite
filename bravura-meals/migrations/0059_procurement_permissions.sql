-- ── 0059: Procurement permission codes ──────────────────────────────────────
-- Seed the permission codes for the new Procurement module.
-- Uses the same loop pattern as 0033 to avoid column-order issues.

DO $$
DECLARE
  proc_perms text[] := ARRAY[
    'procurement.view','procurement.create','procurement.edit','procurement.delete'
  ];
  perm text;
  perm_id uuid;
  role_sa uuid;
BEGIN
  FOREACH perm IN ARRAY proc_perms LOOP
    INSERT INTO permissions (code)
    SELECT perm
    WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = perm);
  END LOOP;

  UPDATE permissions SET module = 'procurement', description = 'View suppliers and procurement data'   WHERE code = 'procurement.view';
  UPDATE permissions SET module = 'procurement', description = 'Create suppliers and requisitions'     WHERE code = 'procurement.create';
  UPDATE permissions SET module = 'procurement', description = 'Edit suppliers and requisitions'       WHERE code = 'procurement.edit';
  UPDATE permissions SET module = 'procurement', description = 'Delete/deactivate procurement data'    WHERE code = 'procurement.delete';

  -- Grant all procurement permissions to System Admin
  FOR role_sa IN SELECT id FROM roles WHERE name IN ('System Admin', 'System Administrator') LOOP
    FOREACH perm IN ARRAY proc_perms LOOP
      SELECT id INTO perm_id FROM permissions WHERE code = perm;
      IF perm_id IS NOT NULL THEN
        INSERT INTO role_permissions (role_id, permission_id)
        VALUES (role_sa, perm_id)
        ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;
  END LOOP;
END $$;
