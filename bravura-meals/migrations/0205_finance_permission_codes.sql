-- 0205 finance_permission_codes — finance permissions were stored as FI01–FI05 (transaction-code
-- style) while every other module uses module.action. Rename them to finance.view / .approve /
-- .create / .edit / .delete and rewrite every access rule and function that referred to the old
-- codes. Role grants are untouched (role_permissions points at the permission id).

UPDATE permissions SET code = CASE code
    WHEN 'FI01' THEN 'finance.view'   WHEN 'FI02' THEN 'finance.approve'
    WHEN 'FI03' THEN 'finance.create' WHEN 'FI04' THEN 'finance.edit'
    WHEN 'FI05' THEN 'finance.delete' END
 WHERE code IN ('FI01','FI02','FI03','FI04','FI05');

CREATE OR REPLACE FUNCTION _fi_code_rename(t text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT replace(replace(replace(replace(replace(t,
    '''FI01''', '''finance.view'''), '''FI02''', '''finance.approve'''), '''FI03''', '''finance.create'''),
    '''FI04''', '''finance.edit'''), '''FI05''', '''finance.delete''');
$$;

DO $$
DECLARE r record; _sql text;
BEGIN
  -- Row-level security policies
  FOR r IN SELECT schemaname, tablename, policyname, qual, with_check FROM pg_policies
            WHERE coalesce(qual, '') || coalesce(with_check, '') ~ '''FI0[1-5]''' LOOP
    _sql := format('ALTER POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
    IF r.qual IS NOT NULL THEN _sql := _sql || ' USING (' || _fi_code_rename(r.qual) || ')'; END IF;
    IF r.with_check IS NOT NULL THEN _sql := _sql || ' WITH CHECK (' || _fi_code_rename(r.with_check) || ')'; END IF;
    EXECUTE _sql;
  END LOOP;
  -- Functions
  FOR r IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.prosrc ~ '''FI0[1-5]''' AND p.proname <> '_fi_code_rename' LOOP
    EXECUTE _fi_code_rename(pg_get_functiondef(r.oid));
  END LOOP;
END $$;

DROP FUNCTION _fi_code_rename(text);

INSERT INTO schema_migrations (filename) VALUES ('0205_finance_permission_codes.sql') ON CONFLICT DO NOTHING;
