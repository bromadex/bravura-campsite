-- ── 0071: reopen a submitted/approved meal submission when an open flag exists
-- Meal officer raises → reviewer flags → officer edits.  save_meal_logs only
-- accepts writes on 'draft' submissions, so this RPC returns the row to draft
-- (preserving prior counts as a snapshot) but only when at least one open
-- flag exists — outside that window the pipeline still locks.

CREATE OR REPLACE FUNCTION public.reopen_meal_submission_for_flag(
  p_submission_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_site_id uuid;
  v_status  text;
  v_open_flags int;
  v_prev_counts jsonb;
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

  IF NOT public._has_meal_permission('meals.create', v_site_id) THEN
    RAISE EXCEPTION 'You do not have permission to edit meals on this site';
  END IF;

  IF v_status = 'draft' THEN
    RETURN;  -- already editable, no-op
  END IF;

  SELECT COUNT(*) INTO v_open_flags
    FROM public.flags
   WHERE submission_id = p_submission_id AND status = 'open';
  IF v_open_flags = 0 THEN
    RAISE EXCEPTION 'This submission has no open flags; it cannot be reopened.';
  END IF;

  -- Snapshot the counts we're about to overwrite so the audit trail can show
  -- what changed after the flag was actioned.
  SELECT jsonb_build_object(
    'b', COALESCE(SUM(CASE WHEN had_breakfast THEN 1 ELSE 0 END), 0),
    'l', COALESCE(SUM(CASE WHEN had_lunch     THEN 1 ELSE 0 END), 0),
    's', COALESCE(SUM(CASE WHEN had_supper    THEN 1 ELSE 0 END), 0),
    'actor', auth.uid(),
    'reason', 'reopened_via_flag',
    'at', NOW()
  ) INTO v_prev_counts
    FROM public.meal_logs
   WHERE submission_id = p_submission_id;

  UPDATE public.daily_submissions
     SET status = 'draft',
         approved_at = NULL,
         approved_by = NULL,
         previous_counts = v_prev_counts
   WHERE id = p_submission_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reopen_meal_submission_for_flag(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reopen_meal_submission_for_flag(uuid) TO authenticated;
