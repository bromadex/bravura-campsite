-- 0153: Normalize permissions.module column to lowercase
-- Fixes inconsistent casing (e.g. 'Fleet' vs 'fuel', 'HR' vs 'hr', 'Procurement' vs 'procurement')
-- Also removes duplicate hr.delete permission (replaced by hr.terminate)

-- Migrate role_permissions from hr.delete to hr.terminate (the canonical permission)
UPDATE role_permissions
SET permission_id = (SELECT id FROM permissions WHERE code = 'hr.terminate')
WHERE permission_id = (SELECT id FROM permissions WHERE code = 'hr.delete')
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp2
    WHERE rp2.role_id = role_permissions.role_id
      AND rp2.permission_id = (SELECT id FROM permissions WHERE code = 'hr.terminate')
  );
DELETE FROM role_permissions WHERE permission_id = (SELECT id FROM permissions WHERE code = 'hr.delete');
DELETE FROM permissions WHERE code = 'hr.delete';

-- Lowercase all module values
UPDATE permissions SET module = LOWER(module) WHERE module <> LOWER(module);

INSERT INTO schema_migrations (filename) VALUES ('0153_normalize_permission_module_casing.sql') ON CONFLICT DO NOTHING;
