-- 0168c_connect_foundation.sql
-- Bravura Connect (Phase 3) — chat_conversations, chat_participants,
-- chat_messages, message_reactions + RLS + storage bucket.

-- ============================================================
-- Tables
-- ============================================================

CREATE TABLE IF NOT EXISTS chat_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES sites(id),
  type text NOT NULL CHECK (type IN ('dm','group','department','record_linked')),
  name text,
  description text,
  record_type text,
  record_id uuid,
  department_id uuid REFERENCES departments(id),
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  is_archived boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS chat_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id),
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_read_at timestamptz,
  UNIQUE (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES profiles(id),
  content text NOT NULL,
  reply_to_id uuid REFERENCES chat_messages(id),
  is_edited boolean NOT NULL DEFAULT false,
  is_deleted boolean NOT NULL DEFAULT false,
  is_pinned boolean NOT NULL DEFAULT false,
  file_url text,
  file_name text,
  file_type text,
  mentions jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS message_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id),
  emoji text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id, emoji)
);

-- ============================================================
-- Indexes
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_chat_messages_conv_created
  ON chat_messages (conversation_id, created_at);

CREATE INDEX IF NOT EXISTS idx_chat_participants_user
  ON chat_participants (user_id);

CREATE INDEX IF NOT EXISTS idx_message_reactions_message
  ON message_reactions (message_id);

CREATE INDEX IF NOT EXISTS idx_chat_conversations_site
  ON chat_conversations (site_id);

-- ============================================================
-- RLS
-- ============================================================

ALTER TABLE chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_reactions ENABLE ROW LEVEL SECURITY;

-- ---------- chat_conversations ----------

DROP POLICY IF EXISTS chat_conversations_select ON chat_conversations;
CREATE POLICY chat_conversations_select ON chat_conversations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM chat_participants cp
      WHERE cp.conversation_id = chat_conversations.id
        AND cp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS chat_conversations_insert ON chat_conversations;
CREATE POLICY chat_conversations_insert ON chat_conversations
  FOR INSERT
  WITH CHECK (_has_permission('connect.create', site_id));

DROP POLICY IF EXISTS chat_conversations_update ON chat_conversations;
CREATE POLICY chat_conversations_update ON chat_conversations
  FOR UPDATE
  USING (
    _has_permission('connect.edit', site_id)
    AND EXISTS (
      SELECT 1 FROM chat_participants cp
      WHERE cp.conversation_id = chat_conversations.id
        AND cp.user_id = auth.uid()
        AND cp.role = 'admin'
    )
  )
  WITH CHECK (
    _has_permission('connect.edit', site_id)
    AND EXISTS (
      SELECT 1 FROM chat_participants cp
      WHERE cp.conversation_id = chat_conversations.id
        AND cp.user_id = auth.uid()
        AND cp.role = 'admin'
    )
  );

-- ---------- chat_participants ----------

DROP POLICY IF EXISTS chat_participants_select ON chat_participants;
CREATE POLICY chat_participants_select ON chat_participants
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM chat_participants cp2
      WHERE cp2.conversation_id = chat_participants.conversation_id
        AND cp2.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS chat_participants_insert ON chat_participants;
CREATE POLICY chat_participants_insert ON chat_participants
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM chat_participants cp2
      WHERE cp2.conversation_id = chat_participants.conversation_id
        AND cp2.user_id = auth.uid()
        AND cp2.role = 'admin'
    )
  );

DROP POLICY IF EXISTS chat_participants_update ON chat_participants;
CREATE POLICY chat_participants_update ON chat_participants
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS chat_participants_delete ON chat_participants;
CREATE POLICY chat_participants_delete ON chat_participants
  FOR DELETE
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM chat_participants cp2
      WHERE cp2.conversation_id = chat_participants.conversation_id
        AND cp2.user_id = auth.uid()
        AND cp2.role = 'admin'
    )
  );

-- ---------- chat_messages ----------

DROP POLICY IF EXISTS chat_messages_select ON chat_messages;
CREATE POLICY chat_messages_select ON chat_messages
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM chat_participants cp
      WHERE cp.conversation_id = chat_messages.conversation_id
        AND cp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS chat_messages_insert ON chat_messages;
CREATE POLICY chat_messages_insert ON chat_messages
  FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM chat_participants cp
      JOIN chat_conversations cc ON cc.id = cp.conversation_id
      WHERE cp.conversation_id = chat_messages.conversation_id
        AND cp.user_id = auth.uid()
        AND _has_permission('connect.create', cc.site_id)
    )
  );

DROP POLICY IF EXISTS chat_messages_update ON chat_messages;
CREATE POLICY chat_messages_update ON chat_messages
  FOR UPDATE
  USING (sender_id = auth.uid())
  WITH CHECK (sender_id = auth.uid());

-- ---------- message_reactions ----------

DROP POLICY IF EXISTS message_reactions_select ON message_reactions;
CREATE POLICY message_reactions_select ON message_reactions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM chat_messages cm
      JOIN chat_participants cp ON cp.conversation_id = cm.conversation_id
      WHERE cm.id = message_reactions.message_id
        AND cp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS message_reactions_insert ON message_reactions;
CREATE POLICY message_reactions_insert ON message_reactions
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM chat_messages cm
      JOIN chat_participants cp ON cp.conversation_id = cm.conversation_id
      WHERE cm.id = message_reactions.message_id
        AND cp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS message_reactions_delete ON message_reactions;
CREATE POLICY message_reactions_delete ON message_reactions
  FOR DELETE
  USING (user_id = auth.uid());

-- ============================================================
-- Permissions (connect module — should already exist from 0168)
-- ============================================================

INSERT INTO permissions (code, module, action, description) VALUES
  ('connect.view',    'connect', 'View',    'View Connect conversations and messages'),
  ('connect.create',  'connect', 'Create',  'Create conversations and send messages'),
  ('connect.edit',    'connect', 'Edit',    'Edit conversations and own messages'),
  ('connect.delete',  'connect', 'Delete',  'Delete conversations and own messages'),
  ('connect.approve', 'connect', 'Approve', 'Approve Connect actions')
ON CONFLICT (code) DO NOTHING;

-- Grant all connect permissions to system admin role
INSERT INTO role_permissions (role_id, permission_id)
SELECT '85928d6a-e1f8-45e4-95c0-b467b6baeef8', p.id
FROM permissions p
WHERE p.code IN ('connect.view','connect.create','connect.edit','connect.delete','connect.approve')
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = '85928d6a-e1f8-45e4-95c0-b467b6baeef8'
      AND rp.permission_id = p.id
  );

-- ============================================================
-- Storage bucket for Connect attachments
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('connect-files', 'connect-files', false)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- Storage RLS policies for connect-files
-- ============================================================

DROP POLICY IF EXISTS connect_files_select ON storage.objects;
CREATE POLICY connect_files_select ON storage.objects
  FOR SELECT USING (bucket_id = 'connect-files' AND auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS connect_files_insert ON storage.objects;
CREATE POLICY connect_files_insert ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'connect-files' AND auth.uid() IS NOT NULL);

-- ============================================================
-- Self-record migration
-- ============================================================

INSERT INTO schema_migrations (filename) VALUES ('0168c_connect_foundation.sql')
ON CONFLICT DO NOTHING;
