-- 0261 (#76, user 28 Sep): task numbers use the AREA CODE, not project letters — "A100-43"; no area → "#43".
CREATE OR REPLACE FUNCTION _pj_ref(p_task uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN t.project_id IS NULL THEN 'To-do'
              ELSE COALESCE(ac.code || '-', '#') || t.task_no END
  FROM project_tasks t
  LEFT JOIN project_areas pa ON pa.id = t.area_id
  LEFT JOIN area_codes ac ON ac.id = pa.area_code_id
  WHERE t.id = p_task
$$;

-- swap "<project>.key || '-' || <task>.task_no" for _pj_ref(<task>.id) in every projects function
DO $$ DECLARE f record; _d text; _n text; BEGIN
  FOR f IN SELECT p.oid, p.proname FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
           AND p.proname IN ('_ai_alerts_projects','_pj_task_folder','ai_projects','pj_my_workspace','pj_task_comment','pj_task_detail','pj_time_list','trg_pj_task_after') LOOP
    _d := pg_get_functiondef(f.oid);
    _n := regexp_replace(_d, 'COALESCE\(\s*(\w+)\.key\s*,\s*''PRJ''\s*\)\s*\|\|\s*''-''\s*\|\|\s*(\w+)\.task_no', '_pj_ref(\2.id)', 'g');
    _n := regexp_replace(_n, 'COALESCE\(\s*(\w+)\.key\s*\|\|\s*''-''\s*\|\|\s*(\w+)\.task_no\s*,\s*''To-do''\s*\)', '_pj_ref(\2.id)', 'g');
    _n := regexp_replace(_n, 'COALESCE\(\s*(\w+)\.key\s*\|\|\s*''-''\s*\|\|\s*(\w+)\.task_no\s*,\s*''to-do''\s*\)', '_pj_ref(\2.id)', 'g');
    _n := regexp_replace(_n, '(\w+)\.key\s*\|\|\s*''-''\s*\|\|\s*(\w+)\.task_no', '_pj_ref(\2.id)', 'g');
    IF _n = _d THEN RAISE EXCEPTION 'ref patch did not apply to %', f.proname; END IF;
    EXECUTE _n;
  END LOOP;
END $$;

-- the two that build it differently
DO $$ DECLARE _d text; _n text; BEGIN
  _d := pg_get_functiondef('pj_task_save(jsonb)'::regprocedure);
  _n := replace(_d, '''ref'', (SELECT key FROM projects WHERE id = _t.project_id) || ''-'' || _t.task_no', '''ref'', _pj_ref(_t.id)');
  IF _n = _d THEN RAISE EXCEPTION 'pj_task_save ref patch'; END IF; EXECUTE _n;
  _d := pg_get_functiondef('pj_tasks_for_record(text,text)'::regprocedure);
  _n := replace(_d, 'COALESCE(p.key, ''TODO'') || COALESCE(''-'' || t.task_no, '''')', '_pj_ref(t.id)');
  IF _n = _d THEN RAISE EXCEPTION 'pj_tasks_for_record ref patch'; END IF; EXECUTE _n;
END $$;

-- task folders already created get renamed to the new number
UPDATE ds_folders f SET name = _pj_ref(t.id) || ' ' || left(t.title, 80)
  FROM project_tasks t WHERE t.ds_folder_id = f.id;

INSERT INTO schema_migrations (filename) VALUES ('0261_task_ref_area_code.sql') ON CONFLICT DO NOTHING;
