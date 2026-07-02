-- ── mark_password_reset_done ────────────────────────────────────────────────
-- After the ForcePasswordResetModal successfully changes the user's
-- password via supabase.auth.updateUser, the frontend needs to clear
-- profiles.force_password_reset for that user. Direct UPDATEs from the
-- client are typically blocked by RLS on the profiles table, so we
-- expose a SECURITY DEFINER RPC that flips only that column, only for
-- the caller's own row.

CREATE OR REPLACE FUNCTION public.mark_password_reset_done()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE public.profiles
     SET force_password_reset = false
   WHERE id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.mark_password_reset_done() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_password_reset_done() TO authenticated;

COMMENT ON FUNCTION public.mark_password_reset_done() IS
  'Clears profiles.force_password_reset for the calling user. Called by the ForcePasswordResetModal after supabase.auth.updateUser succeeds. Uses SECURITY DEFINER so it bypasses RLS restrictions that would otherwise block a client-side UPDATE.';
