-- ── Notifications ──────────────────────────────────────────────────────────────
-- Global notification table for all modules.
-- Edge Functions INSERT rows; the UI reads and marks them read.

CREATE TABLE IF NOT EXISTS notifications (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id       UUID          NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  recipient_id  UUID          NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type          TEXT          NOT NULL,
    -- 'fuel_alert' | 'fuel_warning' | 'fuel_info' | 'system'
  title         TEXT          NOT NULL,
  body          TEXT,
  action_url    TEXT,         -- e.g. '/fuel/fuel_report_variance'
  is_read       BOOLEAN       NOT NULL DEFAULT false,
  read_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_recipient_unread
  ON notifications(recipient_id, is_read, created_at DESC)
  WHERE is_read = false;

CREATE INDEX IF NOT EXISTS notifications_site_created
  ON notifications(site_id, created_at DESC);

-- ── RLS ────────────────────────────────────────────────────────────────────────
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own notifications" ON notifications;
CREATE POLICY "Users see own notifications"
  ON notifications FOR SELECT
  USING (auth.uid() = recipient_id);

DROP POLICY IF EXISTS "Service role inserts notifications" ON notifications;
CREATE POLICY "Service role inserts notifications"
  ON notifications FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "Users update own notifications" ON notifications;
CREATE POLICY "Users update own notifications"
  ON notifications FOR UPDATE
  USING (auth.uid() = recipient_id);
