-- Migration 0166: RPC for admin employee linking
-- Bypasses profiles RLS so admins can link employees to user accounts

BEGIN;

CREATE OR REPLACE FUNCTION admin_link_employee(p_profile_id uuid, p_employee_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_has_access boolean;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM user_roles WHERE user_id = v_user_id
  ) INTO v_has_access;

  IF NOT v_has_access THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;

  UPDATE profiles SET employee_id = p_employee_id, updated_at = now() WHERE id = p_profile_id;
END;
$$;

INSERT INTO schema_migrations (filename) VALUES ('0166_admin_link_employee_rpc.sql') ON CONFLICT DO NOTHING;

COMMIT;
