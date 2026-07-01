-- ── Feedback module ─────────────────────────────────────────────────────────
-- Global anonymous feedback board where any signed-in user can report bugs,
-- suggest features, or flag things that should be removed. Submitter_id is
-- stored for audit / spam control only — never exposed in the UI.

CREATE TABLE IF NOT EXISTS feedback_submissions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id        UUID REFERENCES sites(id) ON DELETE SET NULL,
  module         TEXT,     -- optional: which module the feedback relates to
  kind           TEXT NOT NULL CHECK (kind IN ('bug', 'suggestion', 'removal', 'other')),
  title          TEXT NOT NULL,
  body           TEXT,
  status         TEXT NOT NULL DEFAULT 'new'
                   CHECK (status IN ('new', 'triaged', 'in_progress', 'done', 'wont_do', 'duplicate')),
  submitter_id   UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS feedback_submissions_kind_status_idx
  ON feedback_submissions(kind, status, created_at DESC);
CREATE INDEX IF NOT EXISTS feedback_submissions_created_idx
  ON feedback_submissions(created_at DESC);

ALTER TABLE feedback_submissions ENABLE ROW LEVEL SECURITY;

-- Everyone signed in can read every submission — it's a public board.
DROP POLICY IF EXISTS feedback_read_all ON feedback_submissions;
CREATE POLICY feedback_read_all ON feedback_submissions
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Everyone signed in can create feedback, but the submitter_id must be
-- their own id (prevents impersonation).
DROP POLICY IF EXISTS feedback_insert_own ON feedback_submissions;
CREATE POLICY feedback_insert_own ON feedback_submissions
  FOR INSERT WITH CHECK (submitter_id = auth.uid());

-- Only super_admin can update status / triage decisions. We check the
-- profile role rather than a permission code because the feedback module
-- deliberately has no dedicated permission surface.
DROP POLICY IF EXISTS feedback_update_admin ON feedback_submissions;
CREATE POLICY feedback_update_admin ON feedback_submissions
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

COMMENT ON TABLE  feedback_submissions IS 'Anonymous-in-UI feedback board. submitter_id is stored for audit only and must not be displayed.';
COMMENT ON COLUMN feedback_submissions.submitter_id IS 'For audit/anti-spam only. NEVER surface this in the UI.';
