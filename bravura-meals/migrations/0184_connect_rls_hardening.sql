-- 0184: Connect hardening (Tier 2). Turn RLS ON for chat tables and tighten policies:
--  * you only see conversations/messages/reactions you take part in
--  * you can't add yourself to someone else's conversation (channels: join via RPC)
--  * only the creator/admins can rename or remove other members
--  * chat files readable/uploadable only by participants of that conversation (path: site/conversation/uuid.ext)
--  * record "Discuss" threads via RPC (find-or-create + join)

CREATE OR REPLACE FUNCTION _chat_can_manage(p_conversation_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM chat_conversations c WHERE c.id = p_conversation_id AND c.created_by = auth.uid())
      OR EXISTS (SELECT 1 FROM chat_participants p WHERE p.conversation_id = p_conversation_id AND p.user_id = auth.uid() AND p.role = 'admin')
$$;

-- conversations
DROP POLICY IF EXISTS chat_conversations_insert ON chat_conversations;
CREATE POLICY chat_conversations_insert ON chat_conversations FOR INSERT WITH CHECK (
  created_by = auth.uid() AND type IN ('dm','group') AND _has_permission('connect.create', site_id));
DROP POLICY IF EXISTS chat_conversations_update ON chat_conversations;
CREATE POLICY chat_conversations_update ON chat_conversations FOR UPDATE
  USING (_is_chat_participant(id) AND (_chat_can_manage(id) OR _has_permission('connect.edit', site_id)))
  WITH CHECK (_is_chat_participant(id) AND (_chat_can_manage(id) OR _has_permission('connect.edit', site_id)));

-- participants
DROP POLICY IF EXISTS chat_participants_insert ON chat_participants;
CREATE POLICY chat_participants_insert ON chat_participants FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM chat_conversations c WHERE c.id = conversation_id AND c.type IN ('dm','group','record'))
  AND (_is_chat_participant(conversation_id) OR _chat_can_manage(conversation_id)));
DROP POLICY IF EXISTS chat_participants_delete ON chat_participants;
CREATE POLICY chat_participants_delete ON chat_participants FOR DELETE USING (
  user_id = auth.uid() OR _chat_can_manage(conversation_id));

-- messages: edit own; pin needs connect.edit AND membership
DROP POLICY IF EXISTS "Users can update own messages or pin with permission" ON chat_messages;
DROP POLICY IF EXISTS chat_messages_update ON chat_messages;
CREATE POLICY chat_messages_update ON chat_messages FOR UPDATE
  USING (sender_id = auth.uid() OR (_is_chat_participant(conversation_id)
         AND _has_permission('connect.edit', (SELECT c.site_id FROM chat_conversations c WHERE c.id = conversation_id))))
  WITH CHECK (sender_id = auth.uid() OR (_is_chat_participant(conversation_id)
         AND _has_permission('connect.edit', (SELECT c.site_id FROM chat_conversations c WHERE c.id = conversation_id))));

ALTER TABLE chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_participants  ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_reactions  ENABLE ROW LEVEL SECURITY;

-- storage: participants only
DROP POLICY IF EXISTS connect_files_select ON storage.objects;
DROP POLICY IF EXISTS connect_files_insert ON storage.objects;
CREATE POLICY connect_files_select ON storage.objects FOR SELECT USING (
  bucket_id = 'connect-files' AND (storage.foldername(name))[2] ~ '^[0-9a-f-]{36}$'
  AND public._is_chat_participant(((storage.foldername(name))[2])::uuid));
CREATE POLICY connect_files_insert ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'connect-files' AND (storage.foldername(name))[2] ~ '^[0-9a-f-]{36}$'
  AND public._is_chat_participant(((storage.foldername(name))[2])::uuid));

-- record threads ("Discuss" button)
CREATE OR REPLACE FUNCTION connect_open_record_thread(p_site_id UUID, p_module TEXT, p_record_id UUID, p_label TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id UUID;
BEGIN
  IF NOT _has_permission('connect.view', p_site_id) THEN RAISE EXCEPTION 'You do not have access to Connect at this site'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('record_thread:' || p_module || ':' || p_record_id::text));
  SELECT id INTO _id FROM chat_conversations
   WHERE site_id = p_site_id AND type = 'record' AND record_module = p_module AND record_id = p_record_id AND NOT COALESCE(is_archived, false) LIMIT 1;
  IF _id IS NULL THEN
    INSERT INTO chat_conversations (site_id, type, name, record_module, record_id, record_label, created_by)
    VALUES (p_site_id, 'record', COALESCE(NULLIF(TRIM(p_label), ''), replace(p_module, '_', ' ') || ' discussion'), p_module, p_record_id, p_label, auth.uid())
    RETURNING id INTO _id;
  END IF;
  INSERT INTO chat_participants (conversation_id, user_id, last_read_at)
  SELECT _id, auth.uid(), now() WHERE NOT EXISTS (SELECT 1 FROM chat_participants WHERE conversation_id = _id AND user_id = auth.uid());
  RETURN _id;
END;
$$;
REVOKE ALL ON FUNCTION connect_open_record_thread(UUID, TEXT, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION connect_open_record_thread(UUID, TEXT, UUID, TEXT) TO authenticated;

-- DM creation: pin search_path and require connect.create (was missing).
CREATE OR REPLACE FUNCTION public.create_or_get_dm(p_other_user_id uuid, p_site_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE v_caller uuid := auth.uid(); v_conv_id uuid;
BEGIN
  IF v_caller IS NULL OR NOT _has_permission('connect.create', p_site_id) THEN RAISE EXCEPTION 'You do not have permission to start chats'; END IF;
  IF p_other_user_id IS NULL OR p_other_user_id = v_caller THEN RAISE EXCEPTION 'Pick someone to chat with'; END IF;
  PERFORM pg_advisory_xact_lock(abs(hashtext(LEAST(v_caller::text, p_other_user_id::text) || '|' || GREATEST(v_caller::text, p_other_user_id::text) || '|' || p_site_id::text)));
  SELECT cp1.conversation_id INTO v_conv_id
    FROM chat_participants cp1 JOIN chat_participants cp2 ON cp1.conversation_id = cp2.conversation_id
    JOIN chat_conversations cc ON cc.id = cp1.conversation_id
   WHERE cc.type = 'dm' AND cc.site_id = p_site_id AND cp1.user_id = v_caller AND cp2.user_id = p_other_user_id LIMIT 1;
  IF v_conv_id IS NOT NULL THEN RETURN v_conv_id; END IF;
  INSERT INTO chat_conversations (site_id, type, created_by) VALUES (p_site_id, 'dm', v_caller) RETURNING id INTO v_conv_id;
  INSERT INTO chat_participants (conversation_id, user_id, role) VALUES (v_conv_id, v_caller, 'member'), (v_conv_id, p_other_user_id, 'member');
  RETURN v_conv_id;
END;
$function$;
REVOKE ALL ON FUNCTION create_or_get_dm(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION create_or_get_dm(uuid, uuid) TO authenticated;

INSERT INTO schema_migrations (filename) VALUES ('0184_connect_rls_hardening.sql') ON CONFLICT DO NOTHING;
