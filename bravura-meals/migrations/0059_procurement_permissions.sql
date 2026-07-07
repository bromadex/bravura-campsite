-- ── 0059: Procurement permission codes ──────────────────────────────────────
-- Seed the permission codes for the new Procurement module.

INSERT INTO permissions (code, module, action, description) VALUES
  ('procurement.view',   'procurement', 'View',   'View suppliers and procurement data'),
  ('procurement.create', 'procurement', 'Create', 'Create suppliers and requisitions'),
  ('procurement.edit',   'procurement', 'Edit',   'Edit suppliers and requisitions'),
  ('procurement.delete', 'procurement', 'Delete', 'Delete/deactivate procurement data')
ON CONFLICT (code) DO NOTHING;

-- Grant all procurement permissions to the System Admin role
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'System Admin'
  AND p.module = 'procurement'
ON CONFLICT DO NOTHING;
