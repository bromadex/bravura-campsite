-- 0206 fix_legacy_notification_triggers — two old triggers still wrote notifications with the
-- pre-0168 column names (recipient_id, body, action_url). The table now has user_id, message, link
-- (category defaults to 'general'), so these inserts failed and took the whole save down with them:
--   notify_fuel_issuance_pending  → "column recipient_id does not exist" when issuing fuel
--   notify_meals_submission_change → same error on meal submit / approve / return / confirm
-- Rewrite the column list in both functions; nothing else about them changes.

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname IN ('notify_fuel_issuance_pending', 'notify_meals_submission_change') LOOP
    EXECUTE replace(pg_get_functiondef(r.oid),
      'notifications (site_id, recipient_id, type, title, body, action_url)',
      'notifications (site_id, user_id, type, title, message, link)');
  END LOOP;
END $$;

INSERT INTO schema_migrations (filename) VALUES ('0206_fix_legacy_notification_triggers.sql') ON CONFLICT DO NOTHING;
