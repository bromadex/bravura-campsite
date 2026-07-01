-- ── Meals Approval — snapshot for diff view ─────────────────────────────────
-- When an approver "returns for corrections", we snapshot the current
-- kitchen-count totals into previous_counts so the diff view on the next
-- approval attempt can show what actually changed.

ALTER TABLE daily_submissions
  ADD COLUMN IF NOT EXISTS previous_counts JSONB;

COMMENT ON COLUMN daily_submissions.previous_counts IS
  'Snapshot taken when this submission was returned for corrections. Keys: b, l, s, at (ISO ts), actor (uuid).';
