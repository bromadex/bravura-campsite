-- ── Super admin account: Clement Mpala (Supabase invite flow) ──────────────
-- No default password. We prep the DB so that Supabase's own "Invite user"
-- flow (Dashboard → Authentication → Add User → Send invitation link, or
-- auth.admin.inviteUserByEmail) does the work:
--
--   1. Ensure "System Administrator" role exists with the full permission
--      catalogue granted (business modules + users.*).
--   2. Register a pending role assignment for clement@bravura.com.
--   3. Install a trigger on auth.users that, whenever a new user is
--      inserted, checks pending_role_assignments by email — if there's a
--      row, it creates the matching profiles row and user_roles row and
--      then removes the pending entry. Safe for every future signup: no
--      match, no effect.
--
-- After running this migration, invite Clement via Supabase Dashboard
-- (Authentication → Add User → email = clement@bravura.com → Send
-- invitation link). He picks his own password on first click and lands
-- on the app already holding System Administrator across every site.
--
-- Fully idempotent — safe to re-run.

BEGIN;

-- ── 1. Ensure the System Administrator role exists ─────────────────────────
INSERT INTO roles (name, description)
SELECT 'System Administrator',
       'Full system access across every module, every site. Includes user & role administration and audit visibility.'
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'System Administrator');

-- ── 2. Ensure the full permission catalogue + grants ───────────────────────
DO $$
DECLARE
  role_sysadmin uuid;
  all_perms text[] := ARRAY[
    'meals.view','meals.create','meals.edit','meals.approve','meals.delete',
    'fuel.view','fuel.create','fuel.edit','fuel.approve','fuel.delete',
    'employees.view','employees.create','employees.edit','employees.delete',
    'contractors.view','contractors.create','contractors.edit','contractors.delete',
    'accommodation.view','accommodation.create','accommodation.edit','accommodation.approve','accommodation.delete',
    'supplies.view','supplies.create','supplies.edit','supplies.approve','supplies.delete',
    'users.view','users.create','users.edit','users.delete'
  ];
  perm text;
BEGIN
  SELECT id INTO role_sysadmin FROM roles WHERE name = 'System Administrator';

  FOREACH perm IN ARRAY all_perms LOOP
    INSERT INTO permissions (code)
    SELECT perm
    WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = perm);

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

-- ── 3. Pending role assignments table ──────────────────────────────────────
-- Queues "when a user with this email signs up, give them this role".
-- Cleared by the trigger once applied. Kept in the public schema so the
-- Users & Roles UI can inspect / manage it later without needing schema
-- ownership.
CREATE TABLE IF NOT EXISTS pending_role_assignments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email      text NOT NULL UNIQUE,
  role_id    uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  full_name  text,
  username   text,
  created_at timestamptz DEFAULT NOW()
);

COMMENT ON TABLE pending_role_assignments IS
  'Pre-authorised role assignments. When a matching auth.users row is inserted, apply_pending_role_assignment() creates the profile + user_roles rows and removes the pending entry.';

-- ── 4. Trigger: apply pending assignment on signup ─────────────────────────
CREATE OR REPLACE FUNCTION public.apply_pending_role_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  pending RECORD;
BEGIN
  SELECT * INTO pending
    FROM public.pending_role_assignments
   WHERE email = NEW.email
   LIMIT 1;

  IF pending IS NULL THEN
    RETURN NEW;  -- no pending row for this email → do nothing
  END IF;

  -- Ensure a profile row exists (a handle_new_user trigger may already
  -- have created one; if so, just fill in the name)
  INSERT INTO public.profiles (id, username, full_name, force_password_reset)
  SELECT NEW.id, COALESCE(pending.username, split_part(NEW.email, '@', 1)),
         pending.full_name, false
  WHERE NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = NEW.id);

  UPDATE public.profiles
     SET full_name = COALESCE(pending.full_name, full_name),
         username  = COALESCE(username, pending.username, split_part(NEW.email, '@', 1))
   WHERE id = NEW.id;

  -- Grant the role globally
  INSERT INTO public.user_roles (user_id, role_id, site_id)
  SELECT NEW.id, pending.role_id, NULL
  WHERE NOT EXISTS (
    SELECT 1 FROM public.user_roles
     WHERE user_id = NEW.id AND role_id = pending.role_id AND site_id IS NULL
  );

  -- Consume the pending row
  DELETE FROM public.pending_role_assignments WHERE id = pending.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_pending_role_assignment ON auth.users;
CREATE TRIGGER trg_apply_pending_role_assignment
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.apply_pending_role_assignment();

-- Helper: apply a queued assignment to a user who already exists.
-- Defined before the DO block below that calls it, so it can be
-- resolved at runtime.
CREATE OR REPLACE FUNCTION public.apply_pending_role_assignment_for_existing(target_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  u_id uuid;
  pending RECORD;
BEGIN
  SELECT id INTO u_id FROM auth.users WHERE email = target_email;
  IF u_id IS NULL THEN RETURN; END IF;

  SELECT * INTO pending
    FROM public.pending_role_assignments
   WHERE email = target_email
   LIMIT 1;
  IF pending IS NULL THEN RETURN; END IF;

  INSERT INTO public.profiles (id, username, full_name, force_password_reset)
  SELECT u_id, COALESCE(pending.username, split_part(target_email, '@', 1)),
         pending.full_name, false
  WHERE NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = u_id);

  UPDATE public.profiles
     SET full_name = COALESCE(pending.full_name, full_name)
   WHERE id = u_id;

  INSERT INTO public.user_roles (user_id, role_id, site_id)
  SELECT u_id, pending.role_id, NULL
  WHERE NOT EXISTS (
    SELECT 1 FROM public.user_roles
     WHERE user_id = u_id AND role_id = pending.role_id AND site_id IS NULL
  );

  DELETE FROM public.pending_role_assignments WHERE id = pending.id;
END;
$$;

-- ── 5. Queue Clement's assignment ──────────────────────────────────────────
DO $$
DECLARE
  r_id uuid;
BEGIN
  SELECT id INTO r_id FROM roles WHERE name = 'System Administrator';

  INSERT INTO pending_role_assignments (email, role_id, full_name, username)
  VALUES ('clement@bravura.com', r_id, 'Clement Mpala', 'clement')
  ON CONFLICT (email) DO UPDATE
    SET role_id   = EXCLUDED.role_id,
        full_name = EXCLUDED.full_name,
        username  = EXCLUDED.username;

  -- If Clement already exists in auth.users (e.g. earlier attempt or
  -- created via Dashboard before this migration ran), apply the
  -- assignment immediately rather than waiting for a signup event.
  PERFORM public.apply_pending_role_assignment_for_existing('clement@bravura.com');
END $$;

COMMIT;
