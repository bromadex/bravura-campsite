-- 0227 — See whether invited people have accepted (Admin → Invitations).
-- pending_role_assignments rows are removed by apply_pending_role_assignment the moment the invite creates
-- the login, so the invite list could never show "accepted". This reads the login records instead.
CREATE OR REPLACE FUNCTION public.admin_invite_status()
RETURNS TABLE (user_id uuid, email text, full_name text, invited_at timestamptz, accepted_at timestamptz,
               last_sign_in_at timestamptz, status text, roles text[], role_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM sites s WHERE _has_permission('users.view', s.id)) THEN RAISE EXCEPTION 'No access'; END IF;
  RETURN QUERY
  SELECT u.id, u.email::text, p.full_name, u.invited_at,
         CASE WHEN u.last_sign_in_at IS NOT NULL THEN COALESCE(u.email_confirmed_at, u.last_sign_in_at) END,
         u.last_sign_in_at,
         CASE WHEN u.banned_until > now() THEN 'blocked' WHEN u.last_sign_in_at IS NULL THEN 'waiting' ELSE 'accepted' END,
         ARRAY(SELECT DISTINCT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id AND ur.is_active),
         (SELECT ur.role_id FROM user_roles ur WHERE ur.user_id = u.id AND ur.is_active LIMIT 1)
    FROM auth.users u LEFT JOIN profiles p ON p.id = u.id
   WHERE u.invited_at IS NOT NULL
   ORDER BY (u.last_sign_in_at IS NULL) DESC, u.invited_at DESC;
END $$;
REVOKE ALL ON FUNCTION admin_invite_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_invite_status() TO authenticated;
INSERT INTO schema_migrations (filename) VALUES ('0227_invite_status.sql') ON CONFLICT DO NOTHING;
