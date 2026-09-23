-- 0168d_connect_files_public_bucket.sql
-- Fix: connect-files bucket was created as private but code uses getPublicUrl().
-- Switch to public so existing attachment URLs work. Tier 2 hardening will
-- later switch to private + signed URLs with a proper migration.

BEGIN;

UPDATE storage.buckets SET public = true WHERE id = 'connect-files';

INSERT INTO schema_migrations (filename)
VALUES ('0168d_connect_files_public_bucket.sql')
ON CONFLICT DO NOTHING;

COMMIT;
