-- 0168e_connect_hardening_t2_t3.sql
-- Connect Hardening: Tier 2 (Security) & Tier 3 (Architecture)
BEGIN;

-- ============================================================
-- TIER 2 — SECURITY
-- ============================================================

-- 1. Switch connect-files bucket to private
UPDATE storage.buckets
   SET public = false
 WHERE id = 'connect-files';

-- RPC: verify caller is a participant in the conversation that owns the file
-- Path format: {site_id}/{conversation_id}/{filename}
CREATE OR REPLACE FUNCTION public.verify_connect_file_access(p_path text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_conversation_id uuid;
BEGIN
  -- Extract conversation_id (second segment of the path)
  v_conversation_id := (string_to_array(p_path, '/'))[2]::uuid;

  RETURN EXISTS (
    SELECT 1
      FROM chat_participants
     WHERE conversation_id = v_conversation_id
       AND user_id = auth.uid()
  );
END;
$$;

-- 2. Pin policy: allow sender OR connect.edit holder to update messages
DROP POLICY IF EXISTS chat_messages_update ON chat_messages;
DROP POLICY IF EXISTS "Users can update own messages" ON chat_messages;

CREATE POLICY "Users can update own messages or pin with permission"
  ON chat_messages FOR UPDATE
  USING (
    sender_id = auth.uid()
    OR _has_permission('connect.edit',
         (SELECT site_id FROM chat_conversations WHERE id = conversation_id))
  )
  WITH CHECK (
    sender_id = auth.uid()
    OR _has_permission('connect.edit',
         (SELECT site_id FROM chat_conversations WHERE id = conversation_id))
  );

-- ============================================================
-- TIER 3 — ARCHITECTURE
-- ============================================================

-- 3. Denormalize conversation list
ALTER TABLE chat_conversations
  ADD COLUMN IF NOT EXISTS last_message_at    timestamptz,
  ADD COLUMN IF NOT EXISTS last_message_preview text,
  ADD COLUMN IF NOT EXISTS message_count      integer NOT NULL DEFAULT 0;

-- Trigger: keep denormalized fields in sync
CREATE OR REPLACE FUNCTION fn_chat_message_denorm()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NOT NEW.is_deleted THEN
    UPDATE chat_conversations
       SET last_message_at    = NEW.created_at,
           last_message_preview = LEFT(NEW.content, 100),
           message_count      = message_count + 1
     WHERE id = NEW.conversation_id;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.is_deleted = false
     AND NEW.is_deleted = true THEN
    UPDATE chat_conversations
       SET message_count = GREATEST(message_count - 1, 0)
     WHERE id = NEW.conversation_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chat_message_denorm ON chat_messages;
CREATE TRIGGER trg_chat_message_denorm
  AFTER INSERT OR UPDATE ON chat_messages
  FOR EACH ROW EXECUTE FUNCTION fn_chat_message_denorm();

-- Backfill existing data
UPDATE chat_conversations c
   SET message_count      = sub.cnt,
       last_message_at    = sub.last_at,
       last_message_preview = LEFT(sub.last_content, 100)
  FROM (
    SELECT m.conversation_id,
           COUNT(*)                                          AS cnt,
           MAX(m.created_at)                                 AS last_at,
           (ARRAY_AGG(m.content ORDER BY m.created_at DESC))[1] AS last_content
      FROM chat_messages m
     WHERE m.is_deleted = false
     GROUP BY m.conversation_id
  ) sub
 WHERE c.id = sub.conversation_id;

-- 4. Server-side unread counts
ALTER TABLE chat_participants
  ADD COLUMN IF NOT EXISTS unread_count integer NOT NULL DEFAULT 0;

-- On new message: bump unread for other participants
CREATE OR REPLACE FUNCTION fn_chat_unread_count()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  IF NOT NEW.is_deleted THEN
    UPDATE chat_participants
       SET unread_count = unread_count + 1
     WHERE conversation_id = NEW.conversation_id
       AND user_id != NEW.sender_id
       AND (last_read_at IS NULL OR last_read_at < NEW.created_at);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chat_unread_count ON chat_messages;
CREATE TRIGGER trg_chat_unread_count
  AFTER INSERT ON chat_messages
  FOR EACH ROW EXECUTE FUNCTION fn_chat_unread_count();

-- On marking read: zero the count
CREATE OR REPLACE FUNCTION fn_chat_mark_read()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  IF NEW.last_read_at IS DISTINCT FROM OLD.last_read_at THEN
    NEW.unread_count := 0;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chat_mark_read ON chat_participants;
CREATE TRIGGER trg_chat_mark_read
  BEFORE UPDATE ON chat_participants
  FOR EACH ROW EXECUTE FUNCTION fn_chat_mark_read();

-- 5. Atomic DM creation RPC
CREATE OR REPLACE FUNCTION public.create_or_get_dm(
  p_other_user_id uuid,
  p_site_id       uuid
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_caller   uuid := auth.uid();
  v_conv_id  uuid;
  v_lock_key bigint;
BEGIN
  -- Deterministic advisory lock from the two user ids + site
  v_lock_key := abs(hashtext(
    LEAST(v_caller::text, p_other_user_id::text)
    || '|' ||
    GREATEST(v_caller::text, p_other_user_id::text)
    || '|' || p_site_id::text
  ));
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- Look for existing DM between the two users on this site
  SELECT cp1.conversation_id INTO v_conv_id
    FROM chat_participants cp1
    JOIN chat_participants cp2
      ON cp1.conversation_id = cp2.conversation_id
    JOIN chat_conversations cc
      ON cc.id = cp1.conversation_id
   WHERE cc.type    = 'dm'
     AND cc.site_id = p_site_id
     AND cp1.user_id = v_caller
     AND cp2.user_id = p_other_user_id
   LIMIT 1;

  IF v_conv_id IS NOT NULL THEN
    RETURN v_conv_id;
  END IF;

  -- Create conversation
  v_conv_id := gen_random_uuid();

  INSERT INTO chat_conversations (id, site_id, type, created_by, created_at)
  VALUES (v_conv_id, p_site_id, 'dm', v_caller, now());

  INSERT INTO chat_participants (id, conversation_id, user_id, role, joined_at)
  VALUES
    (gen_random_uuid(), v_conv_id, v_caller,          'member', now()),
    (gen_random_uuid(), v_conv_id, p_other_user_id,   'member', now());

  RETURN v_conv_id;
END;
$$;

-- Self-record migration
INSERT INTO schema_migrations (filename)
VALUES ('0168e_connect_hardening_t2_t3.sql')
ON CONFLICT DO NOTHING;

COMMIT;
