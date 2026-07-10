-- ── 0072: auto-create profiles row + set force_password_reset for new users
-- When a user is invited via Supabase Auth (Dashboard → Send invite) or signs
-- up any other way, they get a row in auth.users. This trigger makes sure
-- there's a matching public.profiles row so they aren't a ghost user, and
-- flags force_password_reset=true so the app's blocking modal makes them
-- create a real password on first login instead of leaving them on the
-- magic-link session forever.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_username TEXT;
  v_full_name TEXT;
BEGIN
  -- Prefer whatever the invite/signup metadata gave us, fall back to email.
  v_full_name := COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name',
    split_part(NEW.email, '@', 1)
  );
  v_username := COALESCE(
    NEW.raw_user_meta_data->>'username',
    split_part(NEW.email, '@', 1)
  );

  -- profiles.role is a legacy NOT NULL text column; real access is granted
  -- via the roles/user_roles tables, so we default this to 'viewer' —
  -- the user will get real permissions once an admin assigns roles to them.
  INSERT INTO public.profiles (id, username, full_name, role, force_password_reset)
  VALUES (NEW.id, v_username, v_full_name, 'meal_officer', true)
  ON CONFLICT (id) DO UPDATE
    SET force_password_reset = true
    WHERE profiles.force_password_reset IS DISTINCT FROM true
      AND profiles.username IS NULL;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
