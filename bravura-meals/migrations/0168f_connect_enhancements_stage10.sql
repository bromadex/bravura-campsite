-- 0168f_connect_enhancements_stage10.sql
-- Stage 10: Connect enhancements, notification preferences, enhanced soft delete
BEGIN;

-- 1. Add preferences JSONB column to profiles for notification preferences
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS preferences jsonb DEFAULT '{}'::jsonb;

-- 2. Enhanced soft delete on chat_messages (deleted_at, deleted_by)
ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES auth.users(id);

-- Self-record migration
INSERT INTO schema_migrations (filename)
VALUES ('0168f_connect_enhancements_stage10.sql')
ON CONFLICT DO NOTHING;

COMMIT;
