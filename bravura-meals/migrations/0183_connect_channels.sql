-- 0183: Connect channels — site-wide broadcast feeds. Anyone with connect.view at the site can browse and join;
-- only channel admins post. Creating a channel needs connect.approve.
ALTER TABLE chat_conversations DROP CONSTRAINT IF EXISTS chat_conversations_type_check;
ALTER TABLE chat_conversations ADD CONSTRAINT chat_conversations_type_check CHECK (type IN ('dm','group','department','record','channel'));

DROP POLICY IF EXISTS chat_messages_insert ON chat_messages;
CREATE POLICY chat_messages_insert ON chat_messages FOR INSERT WITH CHECK (
  sender_id = auth.uid() AND _is_chat_participant(conversation_id)
  AND (NOT EXISTS (SELECT 1 FROM chat_conversations c WHERE c.id = conversation_id AND c.type = 'channel')
       OR EXISTS (SELECT 1 FROM chat_participants p WHERE p.conversation_id = chat_messages.conversation_id
                   AND p.user_id = auth.uid() AND p.role = 'admin')));

CREATE OR REPLACE FUNCTION connect_list_channels(p_site_id UUID)
RETURNS TABLE (id UUID, name TEXT, description TEXT, members BIGINT, joined BOOLEAN, is_admin BOOLEAN, last_message_at TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT _has_permission('connect.view', p_site_id) THEN RETURN; END IF;
  RETURN QUERY
  SELECT c.id, c.name, c.description,
         (SELECT COUNT(*) FROM chat_participants p WHERE p.conversation_id = c.id),
         EXISTS (SELECT 1 FROM chat_participants p WHERE p.conversation_id = c.id AND p.user_id = auth.uid()),
         EXISTS (SELECT 1 FROM chat_participants p WHERE p.conversation_id = c.id AND p.user_id = auth.uid() AND p.role = 'admin'),
         c.last_message_at
    FROM chat_conversations c
   WHERE c.site_id = p_site_id AND c.type = 'channel' AND NOT COALESCE(c.is_archived, false)
   ORDER BY c.name;
END;
$$;

CREATE OR REPLACE FUNCTION connect_create_channel(p_site_id UUID, p_name TEXT, p_description TEXT DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id UUID;
BEGIN
  IF NOT _has_permission('connect.approve', p_site_id) THEN RAISE EXCEPTION 'You do not have permission to create channels'; END IF;
  IF COALESCE(TRIM(p_name), '') = '' THEN RAISE EXCEPTION 'Give the channel a name'; END IF;
  INSERT INTO chat_conversations (site_id, type, name, description, created_by)
  VALUES (p_site_id, 'channel', TRIM(p_name), NULLIF(TRIM(p_description), ''), auth.uid()) RETURNING id INTO _id;
  INSERT INTO chat_participants (conversation_id, user_id, role) VALUES (_id, auth.uid(), 'admin');
  RETURN _id;
END;
$$;

CREATE OR REPLACE FUNCTION connect_join_channel(p_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _site UUID;
BEGIN
  SELECT site_id INTO _site FROM chat_conversations WHERE id = p_id AND type = 'channel' AND NOT COALESCE(is_archived, false);
  IF _site IS NULL THEN RAISE EXCEPTION 'Channel not found'; END IF;
  IF NOT _has_permission('connect.view', _site) THEN RAISE EXCEPTION 'You do not have access to Connect at this site'; END IF;
  INSERT INTO chat_participants (conversation_id, user_id, role, last_read_at)
  SELECT p_id, auth.uid(), 'member', now()
   WHERE NOT EXISTS (SELECT 1 FROM chat_participants WHERE conversation_id = p_id AND user_id = auth.uid());
END;
$$;

REVOKE ALL ON FUNCTION connect_list_channels(UUID), connect_create_channel(UUID, TEXT, TEXT), connect_join_channel(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION connect_list_channels(UUID), connect_create_channel(UUID, TEXT, TEXT), connect_join_channel(UUID) TO authenticated;

-- 0183b: chat tables currently have RLS disabled, so the policy above is not enforced yet —
-- a trigger enforces admin-only posting regardless.
CREATE OR REPLACE FUNCTION trg_chat_channel_post_guard() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM chat_conversations c WHERE c.id = NEW.conversation_id AND c.type = 'channel')
     AND NOT EXISTS (SELECT 1 FROM chat_participants p WHERE p.conversation_id = NEW.conversation_id
                      AND p.user_id = NEW.sender_id AND p.role = 'admin') THEN
    RAISE EXCEPTION 'Only channel admins can post in this channel';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS chat_channel_post_guard ON chat_messages;
CREATE TRIGGER chat_channel_post_guard BEFORE INSERT ON chat_messages FOR EACH ROW EXECUTE FUNCTION trg_chat_channel_post_guard();

INSERT INTO schema_migrations (filename) VALUES ('0183_connect_channels.sql') ON CONFLICT DO NOTHING;
