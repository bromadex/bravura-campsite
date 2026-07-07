-- ── 0059: Procurement permission codes ──────────────────────────────────────
-- Seed the permission codes for the new Procurement module.

INSERT INTO permissions (code, description, module) VALUES
  ('procurement.view',   'View suppliers and procurement data', 'procurement'),
  ('procurement.create', 'Create suppliers and requisitions',   'procurement'),
  ('procurement.edit',   'Edit suppliers and requisitions',     'procurement'),
  ('procurement.delete', 'Delete/deactivate procurement data',  'procurement')
ON CONFLICT (code) DO NOTHING;

-- Grant all procurement permissions to the System Admin role
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'System Admin'
  AND p.module = 'procurement'
ON CONFLICT DO NOTHING;
