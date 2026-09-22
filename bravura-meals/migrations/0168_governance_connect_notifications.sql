-- 0168_governance_connect_notifications.sql
-- Governance, Bravura Connect, and Notification Center tables
-- Phase 1 of the Governance/Connect/Notifications roadmap

BEGIN;

-- ══════════════════════════════════════════════════════════════════════════════
-- NOTIFICATIONS
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id    uuid REFERENCES sites(id),
  user_id    uuid NOT NULL REFERENCES profiles(id),
  type       text NOT NULL,
  title      text NOT NULL,
  message    text,
  link       text,
  metadata   jsonb DEFAULT '{}',
  category   text NOT NULL DEFAULT 'general'
    CHECK (category IN ('general','approval','reminder','announcement','escalation','chat')),
  is_read    boolean NOT NULL DEFAULT false,
  is_archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_read
  ON notifications (user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_site_user
  ON notifications (site_id, user_id);

CREATE TABLE IF NOT EXISTS notification_templates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text UNIQUE NOT NULL,
  type       text NOT NULL,
  title      text NOT NULL,
  message    text NOT NULL,
  link       text,
  category   text NOT NULL DEFAULT 'general',
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notification_templates_event
  ON notification_templates (event_type);

-- ══════════════════════════════════════════════════════════════════════════════
-- GOVERNANCE
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS governance_documents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id           uuid NOT NULL REFERENCES sites(id),
  doc_type          text NOT NULL CHECK (doc_type IN ('announcement','policy')),
  title             text NOT NULL,
  body              text,
  body_html         text,
  version           text DEFAULT '1.0',
  category          text DEFAULT 'General',
  priority          text DEFAULT 'normal' CHECK (priority IN ('normal','important','urgent')),
  expiry_date       date,
  is_pinned         boolean NOT NULL DEFAULT false,
  target_recipients jsonb DEFAULT '[]',
  is_mandatory      boolean NOT NULL DEFAULT false,
  acknowledge_by    date,
  status            text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','published','archived')),
  published_by      uuid REFERENCES profiles(id),
  published_by_name text,
  is_archived       boolean NOT NULL DEFAULT false,
  created_by        uuid NOT NULL REFERENCES profiles(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_governance_docs_site_type
  ON governance_documents (site_id, doc_type, is_archived);

CREATE TABLE IF NOT EXISTS governance_versions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES governance_documents(id) ON DELETE CASCADE,
  version     text NOT NULL,
  body        text,
  body_html   text,
  change_notes text,
  created_by  uuid REFERENCES profiles(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS governance_responses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES governance_documents(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES profiles(id),
  response    text NOT NULL CHECK (response IN ('accepted','rejected')),
  comment     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_governance_responses_doc
  ON governance_responses (document_id, user_id);

CREATE TABLE IF NOT EXISTS announcement_reads (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES governance_documents(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES profiles(id),
  read_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_announcement_reads_doc
  ON announcement_reads (document_id, user_id);

-- ══════════════════════════════════════════════════════════════════════════════
-- BRAVURA CONNECT
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS chat_conversations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id       uuid NOT NULL REFERENCES sites(id),
  type          text NOT NULL CHECK (type IN ('dm','group','department','record')),
  name          text,
  description   text,
  record_module text,
  record_id     uuid,
  record_label  text,
  department_id uuid REFERENCES departments(id),
  created_by    uuid NOT NULL REFERENCES profiles(id),
  is_archived   boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_conversations_site
  ON chat_conversations (site_id, type);

CREATE TABLE IF NOT EXISTS chat_participants (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES profiles(id),
  role            text NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  last_read_at    timestamptz DEFAULT now(),
  is_muted        boolean NOT NULL DEFAULT false,
  joined_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_participants_user
  ON chat_participants (user_id, conversation_id);

CREATE TABLE IF NOT EXISTS chat_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  sender_id       uuid NOT NULL REFERENCES profiles(id),
  content         text NOT NULL,
  message_type    text NOT NULL DEFAULT 'text'
    CHECK (message_type IN ('text','file','system')),
  file_url        text,
  file_name       text,
  file_type       text,
  reply_to        uuid REFERENCES chat_messages(id),
  mentions        jsonb DEFAULT '[]',
  txn_refs        jsonb DEFAULT '[]',
  is_edited       boolean NOT NULL DEFAULT false,
  is_deleted      boolean NOT NULL DEFAULT false,
  is_pinned       boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_conv
  ON chat_messages (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_sender
  ON chat_messages (sender_id);

CREATE TABLE IF NOT EXISTS message_reactions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES profiles(id),
  emoji      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_message_reactions_msg
  ON message_reactions (message_id);

CREATE TABLE IF NOT EXISTS message_reads (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES profiles(id),
  read_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id)
);

-- ══════════════════════════════════════════════════════════════════════════════
-- RLS
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcement_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_reads ENABLE ROW LEVEL SECURITY;

-- Notifications: users see only their own
DROP POLICY IF EXISTS notifications_select ON notifications;
CREATE POLICY notifications_select ON notifications FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS notifications_update ON notifications;
CREATE POLICY notifications_update ON notifications FOR UPDATE
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS notifications_insert ON notifications;
CREATE POLICY notifications_insert ON notifications FOR INSERT
  WITH CHECK (true);

-- Notification templates: readable by anyone authenticated
DROP POLICY IF EXISTS notif_templates_select ON notification_templates;
CREATE POLICY notif_templates_select ON notification_templates FOR SELECT
  USING (auth.role() = 'authenticated');

-- Governance documents: permission-gated
DROP POLICY IF EXISTS governance_docs_select ON governance_documents;
CREATE POLICY governance_docs_select ON governance_documents FOR SELECT
  USING (_has_permission('governance.view', site_id));

DROP POLICY IF EXISTS governance_docs_insert ON governance_documents;
CREATE POLICY governance_docs_insert ON governance_documents FOR INSERT
  WITH CHECK (_has_permission('governance.create', site_id));

DROP POLICY IF EXISTS governance_docs_update ON governance_documents;
CREATE POLICY governance_docs_update ON governance_documents FOR UPDATE
  USING (_has_permission('governance.edit', site_id));

-- Governance versions: same as docs
DROP POLICY IF EXISTS governance_versions_select ON governance_versions;
CREATE POLICY governance_versions_select ON governance_versions FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM governance_documents d
    WHERE d.id = document_id AND _has_permission('governance.view', d.site_id)
  ));

DROP POLICY IF EXISTS governance_versions_insert ON governance_versions;
CREATE POLICY governance_versions_insert ON governance_versions FOR INSERT
  WITH CHECK (true);

-- Governance responses: users can insert their own, admins can view all
DROP POLICY IF EXISTS governance_responses_select ON governance_responses;
CREATE POLICY governance_responses_select ON governance_responses FOR SELECT
  USING (user_id = auth.uid() OR EXISTS (
    SELECT 1 FROM governance_documents d
    WHERE d.id = document_id AND _has_permission('governance.approve', d.site_id)
  ));

DROP POLICY IF EXISTS governance_responses_insert ON governance_responses;
CREATE POLICY governance_responses_insert ON governance_responses FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Announcement reads: same pattern
DROP POLICY IF EXISTS announcement_reads_select ON announcement_reads;
CREATE POLICY announcement_reads_select ON announcement_reads FOR SELECT
  USING (user_id = auth.uid() OR EXISTS (
    SELECT 1 FROM governance_documents d
    WHERE d.id = document_id AND _has_permission('governance.approve', d.site_id)
  ));

DROP POLICY IF EXISTS announcement_reads_insert ON announcement_reads;
CREATE POLICY announcement_reads_insert ON announcement_reads FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Chat conversations: participants can see their conversations
DROP POLICY IF EXISTS chat_conversations_select ON chat_conversations;
CREATE POLICY chat_conversations_select ON chat_conversations FOR SELECT
  USING (
    _has_permission('connect.view', site_id)
    AND EXISTS (
      SELECT 1 FROM chat_participants cp
      WHERE cp.conversation_id = id AND cp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS chat_conversations_insert ON chat_conversations;
CREATE POLICY chat_conversations_insert ON chat_conversations FOR INSERT
  WITH CHECK (_has_permission('connect.create', site_id));

DROP POLICY IF EXISTS chat_conversations_update ON chat_conversations;
CREATE POLICY chat_conversations_update ON chat_conversations FOR UPDATE
  USING (_has_permission('connect.edit', site_id));

-- Chat participants: see own memberships
DROP POLICY IF EXISTS chat_participants_select ON chat_participants;
CREATE POLICY chat_participants_select ON chat_participants FOR SELECT
  USING (user_id = auth.uid() OR EXISTS (
    SELECT 1 FROM chat_participants cp2
    WHERE cp2.conversation_id = conversation_id AND cp2.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS chat_participants_insert ON chat_participants;
CREATE POLICY chat_participants_insert ON chat_participants FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS chat_participants_update ON chat_participants;
CREATE POLICY chat_participants_update ON chat_participants FOR UPDATE
  USING (user_id = auth.uid());

-- Chat messages: participants can see messages in their conversations
DROP POLICY IF EXISTS chat_messages_select ON chat_messages;
CREATE POLICY chat_messages_select ON chat_messages FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM chat_participants cp
    WHERE cp.conversation_id = conversation_id AND cp.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS chat_messages_insert ON chat_messages;
CREATE POLICY chat_messages_insert ON chat_messages FOR INSERT
  WITH CHECK (sender_id = auth.uid() AND EXISTS (
    SELECT 1 FROM chat_participants cp
    WHERE cp.conversation_id = conversation_id AND cp.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS chat_messages_update ON chat_messages;
CREATE POLICY chat_messages_update ON chat_messages FOR UPDATE
  USING (sender_id = auth.uid());

-- Message reactions: participants
DROP POLICY IF EXISTS message_reactions_select ON message_reactions;
CREATE POLICY message_reactions_select ON message_reactions FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM chat_messages m
    JOIN chat_participants cp ON cp.conversation_id = m.conversation_id
    WHERE m.id = message_id AND cp.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS message_reactions_insert ON message_reactions;
CREATE POLICY message_reactions_insert ON message_reactions FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS message_reactions_delete ON message_reactions;
CREATE POLICY message_reactions_delete ON message_reactions FOR DELETE
  USING (user_id = auth.uid());

-- Message reads: participants
DROP POLICY IF EXISTS message_reads_select ON message_reads;
CREATE POLICY message_reads_select ON message_reads FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS message_reads_insert ON message_reads;
CREATE POLICY message_reads_insert ON message_reads FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- ══════════════════════════════════════════════════════════════════════════════
-- PERMISSIONS
-- ══════════════════════════════════════════════════════════════════════════════

INSERT INTO permissions (id, code, module, action, description) VALUES
  (gen_random_uuid(), 'governance.view',    'Governance', 'View',    'View governance documents'),
  (gen_random_uuid(), 'governance.create',  'Governance', 'Create',  'Create governance documents'),
  (gen_random_uuid(), 'governance.edit',    'Governance', 'Edit',    'Edit governance documents'),
  (gen_random_uuid(), 'governance.delete',  'Governance', 'Delete',  'Archive governance documents'),
  (gen_random_uuid(), 'governance.approve', 'Governance', 'Approve', 'Publish and manage governance'),
  (gen_random_uuid(), 'connect.view',       'Connect',    'View',    'View Bravura Connect'),
  (gen_random_uuid(), 'connect.create',     'Connect',    'Create',  'Create conversations and messages'),
  (gen_random_uuid(), 'connect.edit',       'Connect',    'Edit',    'Edit messages and conversations'),
  (gen_random_uuid(), 'connect.delete',     'Connect',    'Delete',  'Delete messages'),
  (gen_random_uuid(), 'connect.approve',    'Connect',    'Approve', 'Manage Connect settings'),
  (gen_random_uuid(), 'notifications.view',   'Notifications', 'View',    'View notification center'),
  (gen_random_uuid(), 'notifications.create', 'Notifications', 'Create',  'Create notifications'),
  (gen_random_uuid(), 'notifications.edit',   'Notifications', 'Edit',    'Edit notifications'),
  (gen_random_uuid(), 'notifications.delete', 'Notifications', 'Delete',  'Archive notifications'),
  (gen_random_uuid(), 'notifications.approve','Notifications', 'Approve', 'Manage notification settings')
ON CONFLICT (code) DO NOTHING;

-- Grant all new permissions to System Administrator
INSERT INTO role_permissions (role_id, permission_id)
SELECT '85928d6a-e1f8-45e4-95c0-b467b6baeef8', p.id
FROM permissions p
WHERE p.code IN (
  'governance.view','governance.create','governance.edit','governance.delete','governance.approve',
  'connect.view','connect.create','connect.edit','connect.delete','connect.approve',
  'notifications.view','notifications.create','notifications.edit','notifications.delete','notifications.approve'
)
AND NOT EXISTS (
  SELECT 1 FROM role_permissions rp
  WHERE rp.role_id = '85928d6a-e1f8-45e4-95c0-b467b6baeef8' AND rp.permission_id = p.id
);

-- ══════════════════════════════════════════════════════════════════════════════
-- AUTO-DEPARTMENT CHAT GROUPS (function + trigger)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION auto_join_department_chat()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_conv_id    uuid;
  v_app_user   uuid;
  v_site_id    uuid;
BEGIN
  IF NEW.department_id IS NULL THEN RETURN NEW; END IF;

  SELECT au.id, COALESCE(ur.site_id, NEW.site_id)
    INTO v_app_user, v_site_id
    FROM profiles au
    LEFT JOIN user_roles ur ON ur.user_id = au.id
    WHERE au.employee_id = NEW.id
    LIMIT 1;

  IF v_app_user IS NULL OR v_site_id IS NULL THEN RETURN NEW; END IF;

  SELECT id INTO v_conv_id
    FROM chat_conversations
    WHERE type = 'department'
      AND department_id = NEW.department_id
      AND site_id = v_site_id
    LIMIT 1;

  IF v_conv_id IS NULL THEN
    INSERT INTO chat_conversations (site_id, type, name, department_id, created_by)
    SELECT v_site_id, 'department',
           COALESCE(d.name, 'Department Chat'),
           NEW.department_id, v_app_user
    FROM departments d WHERE d.id = NEW.department_id
    RETURNING id INTO v_conv_id;
  END IF;

  INSERT INTO chat_participants (conversation_id, user_id, role)
  VALUES (v_conv_id, v_app_user, 'member')
  ON CONFLICT (conversation_id, user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_dept_chat ON employees;
CREATE TRIGGER trg_auto_dept_chat
  AFTER INSERT OR UPDATE OF department_id ON employees
  FOR EACH ROW EXECUTE FUNCTION auto_join_department_chat();

-- ══════════════════════════════════════════════════════════════════════════════
-- SEED NOTIFICATION TEMPLATES
-- ══════════════════════════════════════════════════════════════════════════════

INSERT INTO notification_templates (event_type, type, title, message, link, category) VALUES
  ('leave_submitted',     'leave_request',    '{{employee_name}} submitted a leave request',     '{{leave_type}} from {{start_date}} to {{end_date}}',         '/workforce/wf_leave_requests', 'approval'),
  ('leave_approved',      'leave_approved',   'Your leave request was approved',                  '{{leave_type}} from {{start_date}} to {{end_date}} approved by {{approver_name}}', '/workforce/wf_leave_requests', 'general'),
  ('leave_rejected',      'leave_rejected',   'Your leave request was rejected',                  '{{leave_type}} from {{start_date}} to {{end_date}} rejected by {{approver_name}}', '/workforce/wf_leave_requests', 'general'),
  ('fuel_approved',       'success',          'Fuel request approved',                            '{{litres}}L of {{fuel_type}} approved for {{vehicle}}',      '/fuel/fuel_requests_list',     'approval'),
  ('incident_reported',   'warning',          'New SHEQ incident reported',                       '{{incident_type}} at {{location}}: {{description}}',         '/sheq/sq_incidents',           'escalation'),
  ('policy_published',    'policy_pending',   'New policy requires your acknowledgement',         '{{policy_title}} — please review and acknowledge by {{deadline}}', '/governance/gov_policies', 'announcement'),
  ('announcement_posted', 'info',             '{{title}}',                                        '{{body_preview}}',                                           '/governance/gov_announcements','announcement'),
  ('chat_mention',        'chat_message',     '{{sender_name}} mentioned you',                    '{{message_preview}}',                                        '/connect/connect_chat',        'chat'),
  ('maintenance_due',     'warning',          'Maintenance due: {{asset_name}}',                  '{{service_type}} is due on {{due_date}}',                    '/fleet/fleet_maintenance',     'reminder'),
  ('po_approval_needed',  'po_approval_required', 'Purchase order requires approval',             'PO {{po_number}} from {{supplier}} — {{total_amount}}',      '/procurement/proc_orders',     'approval')
ON CONFLICT (event_type) DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════════
-- SELF-RECORD
-- ══════════════════════════════════════════════════════════════════════════════

INSERT INTO schema_migrations (filename)
VALUES ('0168_governance_connect_notifications.sql')
ON CONFLICT DO NOTHING;

COMMIT;
