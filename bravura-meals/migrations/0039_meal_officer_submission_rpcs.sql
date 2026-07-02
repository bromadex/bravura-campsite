-- ── Meal officer submission RPCs ────────────────────────────────────────────
-- The Daily Meal Entry page writes to daily_submissions from the client:
--   1. INSERT a draft row when saving entries for the first time
--   2. UPSERT meal_logs against that draft
--   3. UPDATE status to 'submitted' when the officer submits for approval
--
-- All three were being blocked by RLS on daily_submissions / meal_logs,
-- surfacing as "new row violates row-level security policy" toasts.
-- These SECURITY DEFINER RPCs perform the writes on behalf of the caller
-- after verifying they hold meals.create on the target site — the same
-- pattern already used for return_submission_for_corrections and
-- mark_password_reset_done.

BEGIN;

-- Helper: does the calling user have a given permission on this site?
CREATE OR REPLACE FUNCTION public._has_meal_permission(p_code text, p_site_id uuid)
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
       AND p.code = p_code
       AND (ur.site_id IS NULL OR ur.site_id = p_site_id)
  );
$$;

REVOKE ALL ON FUNCTION public._has_meal_permission(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._has_meal_permission(text, uuid) TO authenticated;

-- ── 1. Ensure a draft submission for (date, site) exists ────────────────────
CREATE OR REPLACE FUNCTION public.ensure_meal_submission_draft(
  p_date    date,
  p_site_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public._has_meal_permission('meals.create', p_site_id) THEN
    RAISE EXCEPTION 'You do not have permission to record meals on this site';
  END IF;

  SELECT id INTO v_id
    FROM public.daily_submissions
   WHERE date = p_date AND site_id = p_site_id
   LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO public.daily_submissions (date, site_id, status, submitted_by)
    VALUES (p_date, p_site_id, 'draft', auth.uid())
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_meal_submission_draft(date, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_meal_submission_draft(date, uuid) TO authenticated;

-- ── 2. Upsert a batch of meal_logs against a submission ────────────────────
-- Payload shape: jsonb array of objects, each:
--   { "employee_id": <uuid>, "employee_name": <text>,
--     "had_breakfast": <bool>, "had_lunch": <bool>, "had_supper": <bool> }
CREATE OR REPLACE FUNCTION public.save_meal_logs(
  p_submission_id uuid,
  p_date          date,
  p_logs          jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_site_id uuid;
  v_status  text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT site_id, status INTO v_site_id, v_status
    FROM public.daily_submissions
   WHERE id = p_submission_id;
  IF v_site_id IS NULL THEN
    RAISE EXCEPTION 'Submission not found';
  END IF;
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'This day is locked (status: %). Return it to draft first.', v_status;
  END IF;

  IF NOT public._has_meal_permission('meals.create', v_site_id) THEN
    RAISE EXCEPTION 'You do not have permission to record meals on this site';
  END IF;

  INSERT INTO public.meal_logs (
    submission_id, date, employee_id, employee_name,
    had_breakfast, had_lunch, had_supper,
    recorded_by, recorded_at
  )
  SELECT
    p_submission_id,
    p_date,
    (row->>'employee_id')::uuid,
    row->>'employee_name',
    COALESCE((row->>'had_breakfast')::boolean, false),
    COALESCE((row->>'had_lunch')::boolean, false),
    COALESCE((row->>'had_supper')::boolean, false),
    auth.uid(),
    NOW()
  FROM jsonb_array_elements(p_logs) AS row
  ON CONFLICT (date, employee_id) DO UPDATE
    SET had_breakfast = EXCLUDED.had_breakfast,
        had_lunch     = EXCLUDED.had_lunch,
        had_supper    = EXCLUDED.had_supper,
        recorded_by   = EXCLUDED.recorded_by,
        recorded_at   = EXCLUDED.recorded_at,
        submission_id = EXCLUDED.submission_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_meal_logs(uuid, date, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_meal_logs(uuid, date, jsonb) TO authenticated;

-- ── 3. Submit the draft submission for approval ────────────────────────────
CREATE OR REPLACE FUNCTION public.submit_meal_submission(p_submission_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_site_id uuid;
  v_status  text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT site_id, status INTO v_site_id, v_status
    FROM public.daily_submissions
   WHERE id = p_submission_id;
  IF v_site_id IS NULL THEN
    RAISE EXCEPTION 'Submission not found';
  END IF;
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'This submission has already been % — nothing to submit.', v_status;
  END IF;

  IF NOT public._has_meal_permission('meals.create', v_site_id) THEN
    RAISE EXCEPTION 'You do not have permission to submit meals on this site';
  END IF;

  UPDATE public.daily_submissions
     SET status       = 'submitted',
         submitted_by = auth.uid(),
         submitted_at = NOW()
   WHERE id = p_submission_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_meal_submission(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_meal_submission(uuid) TO authenticated;

COMMIT;
