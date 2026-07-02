-- ── Meals RLS policies for daily_submissions + meal_logs ────────────────────
-- The SECURITY DEFINER RPCs added in 0039 were still failing with
-- "new row violates row-level security policy" because Supabase enforces
-- FORCE ROW LEVEL SECURITY, which applies even to definer functions
-- unless the owning role has BYPASSRLS. Rather than depend on function
-- ownership, we add explicit permissive policies that match what the
-- RPCs check internally: any authenticated user holding meals.create /
-- meals.edit / meals.approve for the row's site may INSERT and UPDATE.
--
-- Both the RPCs (0039) and any future direct client writes now succeed
-- through the same policy.

BEGIN;

-- Helper: does the current user hold one of these permission codes for
-- the given site? (Same semantics as the RPCs' internal check.)
CREATE OR REPLACE FUNCTION public._user_has_meals_perm(p_site_id uuid, p_codes text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.user_roles ur
      JOIN public.role_permissions rp ON rp.role_id = ur.role_id
      JOIN public.permissions       p ON p.id = rp.permission_id
     WHERE ur.user_id = auth.uid()
       AND p.code = ANY(p_codes)
       AND (ur.site_id IS NULL OR ur.site_id = p_site_id)
  );
$$;

REVOKE ALL ON FUNCTION public._user_has_meals_perm(uuid, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._user_has_meals_perm(uuid, text[]) TO authenticated;

-- ── daily_submissions policies ──────────────────────────────────────────────
ALTER TABLE public.daily_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "meals: view submissions on your sites"       ON public.daily_submissions;
DROP POLICY IF EXISTS "meals: officers create submissions"          ON public.daily_submissions;
DROP POLICY IF EXISTS "meals: officers and approvers update"        ON public.daily_submissions;

-- SELECT — anyone with any meals permission on the site can read.
CREATE POLICY "meals: view submissions on your sites"
  ON public.daily_submissions FOR SELECT
  TO authenticated
  USING (public._user_has_meals_perm(
    site_id,
    ARRAY['meals.view','meals.create','meals.edit','meals.approve','meals.delete']
  ));

-- INSERT — meal officers (meals.create) create drafts.
CREATE POLICY "meals: officers create submissions"
  ON public.daily_submissions FOR INSERT
  TO authenticated
  WITH CHECK (public._user_has_meals_perm(
    site_id, ARRAY['meals.create','meals.edit','meals.approve','meals.delete']
  ));

-- UPDATE — meal officers move drafts through the workflow; approvers
-- flip status; delete-privileged users can unlock anything.
CREATE POLICY "meals: officers and approvers update"
  ON public.daily_submissions FOR UPDATE
  TO authenticated
  USING (public._user_has_meals_perm(
    site_id, ARRAY['meals.create','meals.edit','meals.approve','meals.delete']
  ))
  WITH CHECK (public._user_has_meals_perm(
    site_id, ARRAY['meals.create','meals.edit','meals.approve','meals.delete']
  ));

-- ── meal_logs policies ──────────────────────────────────────────────────────
-- meal_logs has no site_id column; scope through submission_id → daily_submissions.site_id.
ALTER TABLE public.meal_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "meals: view logs on your sites"     ON public.meal_logs;
DROP POLICY IF EXISTS "meals: officers write logs"         ON public.meal_logs;
DROP POLICY IF EXISTS "meals: officers update logs"        ON public.meal_logs;

CREATE POLICY "meals: view logs on your sites"
  ON public.meal_logs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.daily_submissions s
       WHERE s.id = meal_logs.submission_id
         AND public._user_has_meals_perm(s.site_id,
              ARRAY['meals.view','meals.create','meals.edit','meals.approve','meals.delete'])
    )
    OR meal_logs.submission_id IS NULL
  );

CREATE POLICY "meals: officers write logs"
  ON public.meal_logs FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.daily_submissions s
       WHERE s.id = meal_logs.submission_id
         AND public._user_has_meals_perm(s.site_id,
              ARRAY['meals.create','meals.edit','meals.approve','meals.delete'])
    )
  );

CREATE POLICY "meals: officers update logs"
  ON public.meal_logs FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.daily_submissions s
       WHERE s.id = meal_logs.submission_id
         AND public._user_has_meals_perm(s.site_id,
              ARRAY['meals.create','meals.edit','meals.approve','meals.delete'])
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.daily_submissions s
       WHERE s.id = meal_logs.submission_id
         AND public._user_has_meals_perm(s.site_id,
              ARRAY['meals.create','meals.edit','meals.approve','meals.delete'])
    )
  );

COMMIT;
