-- 0175_invite_user_enhancements.sql
-- Add site_id, status, invited_at, is_archived to pending_role_assignments
BEGIN;

ALTER TABLE pending_role_assignments
  ADD COLUMN IF NOT EXISTS site_id uuid REFERENCES sites(id),
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','invited','accepted','revoked')),
  ADD COLUMN IF NOT EXISTS invited_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false;

INSERT INTO schema_migrations (filename)
VALUES ('0175_invite_user_enhancements.sql')
ON CONFLICT DO NOTHING;

COMMIT;
