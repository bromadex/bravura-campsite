-- 0230 — DocShare file privacy. The docshare-files bucket let any logged-in user read (and upload) any file.
-- Files live under <site_id>/..., so reading now needs ds.view and uploading ds.create at that site.
CREATE OR REPLACE FUNCTION public._ds_storage_site(p_name text) RETURNS uuid
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN split_part(p_name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              THEN split_part(p_name, '/', 1)::uuid END;
$$;

DROP POLICY IF EXISTS ds_read ON storage.objects;
CREATE POLICY ds_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'docshare-files' AND public._has_permission('ds.view', public._ds_storage_site(name)));

DROP POLICY IF EXISTS ds_upload ON storage.objects;
CREATE POLICY ds_upload ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'docshare-files' AND public._has_permission('ds.create', public._ds_storage_site(name)));

INSERT INTO schema_migrations (filename) VALUES ('0230_docshare_storage_privacy.sql') ON CONFLICT DO NOTHING;
