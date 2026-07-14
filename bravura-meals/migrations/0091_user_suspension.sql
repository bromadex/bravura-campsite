-- 0091: User suspension/deactivation from Users & Roles.
-- "Deleting" a user = suspend + revoke roles. The profiles row is never
-- removed, so created_by/approved_by/audit references keep resolving and
-- no historical data is touched.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.rpc_set_user_suspended(p_user_id UUID, p_suspend BOOLEAN)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  -- Requires users.edit (site-agnostic admin permission)
  IF NOT EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = auth.uid() AND p.code = 'users.edit'
  ) THEN
    RAISE EXCEPTION 'Missing users.edit permission';
  END IF;
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot suspend your own account';
  END IF;

  UPDATE profiles
     SET is_suspended = p_suspend,
         suspended_at = CASE WHEN p_suspend THEN NOW() ELSE NULL END
   WHERE id = p_user_id;
END;
$$;

INSERT INTO schema_migrations (filename)
VALUES ('0091_user_suspension.sql')
ON CONFLICT DO NOTHING;
