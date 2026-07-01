-- ── Super admin account: Clement Mpala ──────────────────────────────────────
-- Adds clement@bravura.com as a global System Administrator with the
-- temporary password Bravura@2026! and force_password_reset = true.
--
-- Reuses the existing "System Administrator" role — the same role referenced
-- by the UserManagement page's "last super admin" safety check — so no new
-- role is introduced. We also ensure that role has the full permission
-- catalogue granted (users.* included) so the Admin module is reachable.
-- Idempotent: safe to re-run.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── 1. Ensure the System Administrator role exists ─────────────────────────
INSERT INTO roles (name, description)
SELECT 'System Administrator',
       'Full system access across every module, every site. Includes user & role administration and audit visibility.'
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'System Administrator');

-- ── 2. Ensure the full permission catalogue is available + granted ─────────
DO $$
DECLARE
  role_sysadmin uuid;
  all_perms text[] := ARRAY[
    -- Business modules
    'meals.view','meals.create','meals.edit','meals.approve','meals.delete',
    'fuel.view','fuel.create','fuel.edit','fuel.approve','fuel.delete',
    'employees.view','employees.create','employees.edit','employees.delete',
    'contractors.view','contractors.create','contractors.edit','contractors.delete',
    'accommodation.view','accommodation.create','accommodation.edit','accommodation.approve','accommodation.delete',
    'supplies.view','supplies.create','supplies.edit','supplies.approve','supplies.delete',
    -- Admin module
    'users.view','users.create','users.edit','users.delete'
  ];
  perm text;
BEGIN
  SELECT id INTO role_sysadmin FROM roles WHERE name = 'System Administrator';

  FOREACH perm IN ARRAY all_perms LOOP
    -- Ensure the permission row exists
    INSERT INTO permissions (code)
    SELECT perm
    WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = perm);

    -- Grant to System Administrator
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT role_sysadmin, p.id
      FROM permissions p
     WHERE p.code = perm
       AND NOT EXISTS (
         SELECT 1 FROM role_permissions rp
          WHERE rp.role_id = role_sysadmin AND rp.permission_id = p.id
       );
  END LOOP;
END $$;

-- ── 3. Create the auth user + profile + role assignment ────────────────────
DO $$
DECLARE
  u_id uuid;
  r_id uuid;
  target_email text := 'clement@bravura.com';
  temp_password text := 'Bravura@2026!';
BEGIN
  SELECT id INTO u_id FROM auth.users WHERE email = target_email;

  IF u_id IS NULL THEN
    u_id := gen_random_uuid();

    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, is_super_admin,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      u_id,
      'authenticated', 'authenticated',
      target_email,
      crypt(temp_password, gen_salt('bf')),
      NOW(), NOW(), NOW(),
      jsonb_build_object('provider','email','providers', jsonb_build_array('email')),
      jsonb_build_object('full_name', 'Clement Mpala'),
      false,
      '', '', '', ''
    );

    INSERT INTO auth.identities (
      id, user_id, identity_data, provider, provider_id,
      created_at, updated_at, last_sign_in_at
    ) VALUES (
      gen_random_uuid(),
      u_id,
      jsonb_build_object('sub', u_id::text, 'email', target_email, 'email_verified', true),
      'email',
      u_id::text,
      NOW(), NOW(), NOW()
    );
  END IF;

  INSERT INTO profiles (id, username, full_name, force_password_reset)
  SELECT u_id, 'clement', 'Clement Mpala', true
  WHERE NOT EXISTS (SELECT 1 FROM profiles WHERE id = u_id);

  UPDATE profiles
    SET full_name = 'Clement Mpala',
        username  = COALESCE(username, 'clement'),
        force_password_reset = true
    WHERE id = u_id;

  SELECT id INTO r_id FROM roles WHERE name = 'System Administrator';
  IF r_id IS NOT NULL THEN
    INSERT INTO user_roles (user_id, role_id, site_id)
    SELECT u_id, r_id, NULL
    WHERE NOT EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = u_id AND role_id = r_id AND site_id IS NULL
    );
  END IF;
END $$;

COMMIT;
