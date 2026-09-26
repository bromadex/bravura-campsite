-- 0245 — Fuel (#68/#69): restore the April–June 2026 fuel issues (434 rows, 47,832 L, Kamativi Main Tank).
-- They were recovered from the old system after the Supabase project was lost, imported on 2 Sep, then soft-deleted
-- on 7 Sep ("start from September"). User, 26 Sep: recover them as history.
-- Main Tank is dip-tracked, so tank levels don't move. Dated before the books went live, so nothing posts to the ledger.
-- Unit prices stay empty until the April–May delivery prices are entered (then issues are repriced).
ALTER TABLE fuel_transactions DISABLE TRIGGER trg_notify_fuel_issuance_pending;
UPDATE fuel_transactions
   SET is_deleted = false, deleted_at = NULL, deleted_by = NULL,
       edit_reason = 'Restored as history (Apr–Jun 2026, recovered data) — user request 26 Sep 2026',
       acknowledgement_status = 'not_required'
 WHERE is_deleted AND transaction_type = 'issuance' AND transaction_date < DATE '2026-07-01'
   AND deleted_at::date = DATE '2026-09-07';
ALTER TABLE fuel_transactions ENABLE TRIGGER trg_notify_fuel_issuance_pending;
INSERT INTO schema_migrations (filename) VALUES ('0245_fuel_restore_history.sql') ON CONFLICT DO NOTHING;
