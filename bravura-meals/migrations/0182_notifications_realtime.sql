-- 0182: stream notifications over realtime (bell + My Workspace badges update live). RLS still applies.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='notifications') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
  END IF;
END $$;
INSERT INTO schema_migrations (filename) VALUES ('0182_notifications_realtime.sql') ON CONFLICT DO NOTHING;
