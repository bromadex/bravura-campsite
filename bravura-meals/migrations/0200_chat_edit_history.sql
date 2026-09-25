-- 0200 chat_edit_history — every edit to a Connect message keeps the previous text.
-- Written by trigger (clients cannot forge or remove history); readable by the
-- conversation's participants, like the message itself.

CREATE TABLE IF NOT EXISTS chat_message_edits (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id       uuid NOT NULL REFERENCES chat_messages(id),
  conversation_id  uuid NOT NULL REFERENCES chat_conversations(id),
  previous_content text,
  edited_by        uuid REFERENCES profiles(id),
  edited_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_message_edits_msg_idx ON chat_message_edits (message_id, edited_at);

ALTER TABLE chat_message_edits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chat_message_edits_select ON chat_message_edits;
CREATE POLICY chat_message_edits_select ON chat_message_edits FOR SELECT TO authenticated
  USING (_is_chat_participant(conversation_id));
-- No insert/update/delete policies: only the trigger writes here.

CREATE OR REPLACE FUNCTION trg_chat_message_edit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.content IS DISTINCT FROM OLD.content AND NOT COALESCE(NEW.is_deleted, false) THEN
    INSERT INTO chat_message_edits (message_id, conversation_id, previous_content, edited_by)
    VALUES (OLD.id, OLD.conversation_id, OLD.content, auth.uid());
    NEW.is_edited := true;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_chat_message_edit ON chat_messages;
CREATE TRIGGER trg_chat_message_edit BEFORE UPDATE OF content ON chat_messages
  FOR EACH ROW EXECUTE FUNCTION trg_chat_message_edit();

INSERT INTO schema_migrations (filename) VALUES ('0200_chat_edit_history.sql') ON CONFLICT DO NOTHING;
