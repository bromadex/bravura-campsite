-- ── Initial user accounts + RBAC configuration ──────────────────────────────
-- Creates the 4 launch accounts, builds tailored composite roles for each,
-- grants only the permissions each user actually needs, and forces a
-- password change on first login.
--
-- Fully idempotent: safe to re-run. Skips accounts that already exist,
-- skips role rows that already exist, skips permission grants that are
-- already in place, and skips user_roles rows that are already assigned.
--
-- Accounts created (temporary password: Bravura@2026!):
--   takunda@bravura.com  → "Meals Officer (Composite)"
--   abbey@bravura.com    → "Approver — Fuel & Meals"
--   osaramen@bravura.com → "Operations Administrator"
--   tafadzwa@bravura.com → "Executive Administrator"
--
-- All 4 get user_roles.site_id = NULL so their permissions apply across
-- every site (including sites created in the future), matching how
-- PermissionsContext already resolves global grants.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── 1. Schema: force_password_reset ─────────────────────────────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS force_password_reset BOOLEAN DEFAULT false;
COMMENT ON COLUMN profiles.force_password_reset IS
  'When true, the app shows a blocking modal on next login forcing the user to change their password before they can navigate anywhere else. Cleared automatically once they set a new one.';

-- ── 2. Roles ────────────────────────────────────────────────────────────────
-- One tailored role per launch user. Cleaner in the UI than composite
-- multi-role assignments, and each role's exact permission set is visible
-- in a single grant list rather than scattered across several rows.
INSERT INTO roles (name, description)
SELECT * FROM (VALUES
  ('Meals Officer (Composite)',
    'Full Meals module access, read-only across other business modules, plus HR employee activation/termination.'),
  ('Approver — Fuel & Meals',
    'Approves fuel workflows and meal submissions across all sites; read-only elsewhere. No configuration or admin access.'),
  ('Operations Administrator',
    'Full CRUD, approvals, reports, imports and exports across every business module. No Admin module access.'),
  ('Executive Administrator',
    'Full CRUD, approvals, reports, imports and exports across every business module. No Admin module access.')
) AS r(name, description)
WHERE NOT EXISTS (SELECT 1 FROM roles r2 WHERE r2.name = r.name);

-- ── 3. Ensure permission catalogue exists ───────────────────────────────────
-- The permissions table is code-keyed (permissions.code). Insert any
-- missing codes we need — safe no-op if they already exist. Uses WHERE
-- NOT EXISTS rather than ON CONFLICT so it works whether or not a unique
-- constraint has been declared on permissions.code.
DO $$
DECLARE
  all_perms text[] := ARRAY[
    -- Meals
    'meals.view','meals.create','meals.edit','meals.approve','meals.delete',
    -- Fuel
    'fuel.view','fuel.create','fuel.edit','fuel.approve','fuel.delete',
    -- HR / Workforce
    'employees.view','employees.create','employees.edit','employees.delete',
    'contractors.view','contractors.create','contractors.edit','contractors.delete',
    -- Campsite / Accommodation
    'accommodation.view','accommodation.create','accommodation.edit','accommodation.approve','accommodation.delete',
    'supplies.view','supplies.create','supplies.edit','supplies.approve','supplies.delete'
  ];
  p text;
BEGIN
  FOREACH p IN ARRAY all_perms LOOP
    INSERT INTO permissions (code)
    SELECT p
    WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = p);
  END LOOP;
END $$;

-- ── 4. Grant permissions to each role ───────────────────────────────────────
DO $$
DECLARE
  role_meals_officer uuid;
  role_approver      uuid;
  role_ops_admin     uuid;
  role_exec_admin    uuid;

  -- View-only reads across every other module — used by both the Meals
  -- Officer (Composite) and the Approver.
  cross_module_view text[] := ARRAY[
    'employees.view','contractors.view',
    'accommodation.view','supplies.view'
  ];

  meals_officer_perms text[] := ARRAY[
    'meals.view','meals.create','meals.edit',
    -- Cross-module view + HR employee activation/termination
    'employees.view','employees.edit',
    'contractors.view','accommodation.view','supplies.view',
    'fuel.view'
  ];

  approver_perms text[] := ARRAY[
    'meals.view','meals.approve',
    'fuel.view','fuel.approve',
    'employees.view','contractors.view',
    'accommodation.view','supplies.view'
  ];

  -- Full CRUD + approvals across every business module. Deliberately
  -- excludes users.* / audit permissions so the Admin module stays gated.
  business_full_perms text[] := ARRAY[
    'meals.view','meals.create','meals.edit','meals.approve','meals.delete',
    'fuel.view','fuel.create','fuel.edit','fuel.approve','fuel.delete',
    'employees.view','employees.create','employees.edit','employees.delete',
    'contractors.view','contractors.create','contractors.edit','contractors.delete',
    'accommodation.view','accommodation.create','accommodation.edit','accommodation.approve','accommodation.delete',
    'supplies.view','supplies.create','supplies.edit','supplies.approve','supplies.delete'
  ];

  perm text;
BEGIN
  SELECT id INTO role_meals_officer FROM roles WHERE name = 'Meals Officer (Composite)';
  SELECT id INTO role_approver      FROM roles WHERE name = 'Approver — Fuel & Meals';
  SELECT id INTO role_ops_admin     FROM roles WHERE name = 'Operations Administrator';
  SELECT id INTO role_exec_admin    FROM roles WHERE name = 'Executive Administrator';

  -- Meals Officer (Composite)
  FOREACH perm IN ARRAY meals_officer_perms LOOP
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT role_meals_officer, p.id
      FROM permissions p
     WHERE p.code = perm
       AND NOT EXISTS (
         SELECT 1 FROM role_permissions rp
          WHERE rp.role_id = role_meals_officer AND rp.permission_id = p.id
       );
  END LOOP;

  -- Approver
  FOREACH perm IN ARRAY approver_perms LOOP
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT role_approver, p.id
      FROM permissions p
     WHERE p.code = perm
       AND NOT EXISTS (
         SELECT 1 FROM role_permissions rp
          WHERE rp.role_id = role_approver AND rp.permission_id = p.id
       );
  END LOOP;

  -- Operations Administrator
  FOREACH perm IN ARRAY business_full_perms LOOP
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT role_ops_admin, p.id
      FROM permissions p
     WHERE p.code = perm
       AND NOT EXISTS (
         SELECT 1 FROM role_permissions rp
          WHERE rp.role_id = role_ops_admin AND rp.permission_id = p.id
       );
  END LOOP;

  -- Executive Administrator (spec is identical to Ops Admin — kept as a
  -- separate role so job titles stay distinguishable in the UI)
  FOREACH perm IN ARRAY business_full_perms LOOP
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT role_exec_admin, p.id
      FROM permissions p
     WHERE p.code = perm
       AND NOT EXISTS (
         SELECT 1 FROM role_permissions rp
          WHERE rp.role_id = role_exec_admin AND rp.permission_id = p.id
       );
  END LOOP;
END $$;

-- ── 5. Create auth users + profiles + role assignments ─────────────────────
-- Direct auth.users insert works because migrations run as postgres
-- superuser. Idempotent: existing accounts are left alone (only their
-- role assignment and force_password_reset flag are re-asserted).
DO $$
DECLARE
  targets JSONB := '[
    {"email":"takunda@bravura.com", "full_name":"Takunda Tewe",         "username":"takunda",  "role":"Meals Officer (Composite)"},
    {"email":"abbey@bravura.com",   "full_name":"Joshua Abbey",         "username":"abbey",    "role":"Approver — Fuel & Meals"},
    {"email":"osaramen@bravura.com","full_name":"Eng. Osasaremene",     "username":"osaramen", "role":"Operations Administrator"},
    {"email":"tafadzwa@bravura.com","full_name":"Dr Tafadzwa Murinzi",  "username":"tafadzwa", "role":"Executive Administrator"}
  ]'::jsonb;
  rec  JSONB;
  u_id uuid;
  r_id uuid;
  temp_password text := 'Bravura@2026!';
BEGIN
  FOR rec IN SELECT * FROM jsonb_array_elements(targets)
  LOOP
    SELECT id INTO u_id FROM auth.users WHERE email = rec->>'email';

    -- Create auth.users + auth.identities if this email is new.
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
        rec->>'email',
        crypt(temp_password, gen_salt('bf')),
        NOW(), NOW(), NOW(),
        jsonb_build_object('provider','email','providers', jsonb_build_array('email')),
        jsonb_build_object('full_name', rec->>'full_name'),
        false,
        '', '', '', ''
      );

      INSERT INTO auth.identities (
        id, user_id, identity_data, provider, provider_id,
        created_at, updated_at, last_sign_in_at
      ) VALUES (
        gen_random_uuid(),
        u_id,
        jsonb_build_object('sub', u_id::text, 'email', rec->>'email', 'email_verified', true),
        'email',
        u_id::text,
        NOW(), NOW(), NOW()
      );
    END IF;

    -- Ensure the profile row exists + flag force_password_reset.
    -- Uses upsert-by-id semantics; if a handle_new_user trigger already
    -- created it, we just update.
    INSERT INTO profiles (id, username, full_name, force_password_reset)
    SELECT u_id, rec->>'username', rec->>'full_name', true
    WHERE NOT EXISTS (SELECT 1 FROM profiles WHERE id = u_id);

    UPDATE profiles
      SET full_name = rec->>'full_name',
          username  = COALESCE(username, rec->>'username'),
          force_password_reset = true
      WHERE id = u_id;

    -- Assign the role globally (site_id NULL).
    SELECT id INTO r_id FROM roles WHERE name = rec->>'role';
    IF r_id IS NOT NULL THEN
      INSERT INTO user_roles (user_id, role_id, site_id)
      SELECT u_id, r_id, NULL
      WHERE NOT EXISTS (
        SELECT 1 FROM user_roles
        WHERE user_id = u_id AND role_id = r_id AND site_id IS NULL
      );
    END IF;
  END LOOP;
END $$;

COMMIT;
