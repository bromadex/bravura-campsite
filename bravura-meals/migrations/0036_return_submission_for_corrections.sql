-- ── return_submission_for_corrections ──────────────────────────────────────
-- Approvers reject a daily meal submission with a note, which flips it
-- back to draft so the meal officer can edit it again. Doing that from
-- the client side was silently blocked by RLS: the update returned no
-- error but affected 0 rows, leaving the row stuck at status='submitted'
-- and the meal officer unable to edit it.
--
-- This SECURITY DEFINER RPC bypasses RLS to perform the flip, but only
-- after verifying the caller actually holds meals.approve (globally or
-- for the row's site). Snapshots the current kitchen counts into
-- previous_counts so the diff view on the meal officer's next attempt
-- can highlight what changed.

CREATE OR REPLACE FUNCTION public.return_submission_for_corrections(
  p_submission_id uuid,
  p_note          text,
  p_counts        jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_site_id uuid;
  v_allowed boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT site_id INTO v_site_id
    FROM public.daily_submissions
   WHERE id = p_submission_id;

  IF v_site_id IS NULL THEN
    RAISE EXCEPTION 'Submission not found';
  END IF;

  -- Caller must hold meals.approve either globally (user_roles.site_id
  -- NULL) or specifically for the submission's site.
  SELECT EXISTS (
    SELECT 1
      FROM public.user_roles ur
      JOIN public.role_permissions rp ON rp.role_id = ur.role_id
      JOIN public.permissions       p ON p.id = rp.permission_id
     WHERE ur.user_id = auth.uid()
       AND p.code = 'meals.approve'
       AND (ur.site_id IS NULL OR ur.site_id = v_site_id)
  ) INTO v_allowed;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'You do not have permission to return submissions on this site';
  END IF;

  UPDATE public.daily_submissions
     SET status          = 'draft',
         notes           = p_note,
         approved_by     = NULL,
         approved_at     = NULL,
         previous_counts = jsonb_build_object(
           'b',     COALESCE(p_counts->'b', to_jsonb(0)),
           'l',     COALESCE(p_counts->'l', to_jsonb(0)),
           's',     COALESCE(p_counts->'s', to_jsonb(0)),
           'at',    to_jsonb(NOW()),
           'actor', to_jsonb(auth.uid()),
           'note',  to_jsonb(p_note)
         )
   WHERE id = p_submission_id;
END;
$$;

REVOKE ALL ON FUNCTION public.return_submission_for_corrections(uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.return_submission_for_corrections(uuid, text, jsonb) TO authenticated;

COMMENT ON FUNCTION public.return_submission_for_corrections(uuid, text, jsonb) IS
  'Approvers use this RPC (via Approvals.jsx reject()) to send a submitted daily_submissions row back to draft with a note and a snapshot of the current counts. Verifies the caller holds meals.approve for the row site before touching the row, then updates with SECURITY DEFINER so RLS cannot silently drop the change.';
