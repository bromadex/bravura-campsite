-- 0262 (#76, user 28 Sep): tasks carry the plant AREA CODE — shown as "AC-49 Plant workshop".
-- Titles like "Area Code 49 Plant workshop" are split into area_code '49' + title 'Plant workshop' (also on save).
ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS area_code text;

CREATE OR REPLACE FUNCTION trg_pj_area_code() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE m text[];
BEGIN
  m := regexp_match(NEW.title, '^\s*area\s*code\s*([0-9A-Za-z/]+)\s*[-:–]?\s*(.*)$', 'i');
  IF m IS NOT NULL AND COALESCE(m[2], '') <> '' THEN
    NEW.area_code := COALESCE(NULLIF(trim(NEW.area_code), ''), m[1]);
    NEW.title := m[2];
  END IF;
  NEW.area_code := NULLIF(upper(trim(regexp_replace(COALESCE(NEW.area_code, ''), '^\s*AC\s*-?\s*', '', 'i'))), '');
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_pj_0_area_code ON project_tasks;
CREATE TRIGGER trg_pj_0_area_code BEFORE INSERT OR UPDATE OF title, area_code ON project_tasks FOR EACH ROW EXECUTE FUNCTION trg_pj_area_code();

UPDATE project_tasks SET title = title WHERE title ~* '^\s*area\s*code';   -- runs the split on existing tasks

CREATE OR REPLACE FUNCTION _pj_ref(p_task uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN t.project_id IS NULL THEN 'To-do'
              WHEN t.area_code IS NOT NULL THEN 'AC-' || t.area_code
              WHEN ac.code IS NOT NULL THEN ac.code || '-' || t.task_no
              ELSE '#' || t.task_no END
  FROM project_tasks t
  LEFT JOIN project_areas pa ON pa.id = t.area_id
  LEFT JOIN area_codes ac ON ac.id = pa.area_code_id
  WHERE t.id = p_task
$$;

-- pj_task_save accepts area_code
DO $$ DECLARE _d text; _n text; BEGIN
  _d := pg_get_functiondef('pj_task_save(jsonb)'::regprocedure);
  IF position('area_code' in _d) > 0 THEN RETURN; END IF;
  _n := replace(_d, '      created_by, position)
    VALUES (_proj,', '      created_by, position, area_code)
    VALUES (_proj,');
  _n := replace(_n, '      COALESCE((SELECT max(position) + 1 FROM project_tasks WHERE project_id = _proj), 0))
    RETURNING * INTO _t;', '      COALESCE((SELECT max(position) + 1 FROM project_tasks WHERE project_id = _proj), 0), NULLIF(p->>''area_code'', ''''))
    RETURNING * INTO _t;');
  _n := replace(_n, '      percent_complete = COALESCE(NULLIF(p->>''percent_complete'','''')::numeric, percent_complete)',
    '      percent_complete = COALESCE(NULLIF(p->>''percent_complete'','''')::numeric, percent_complete),
      area_code = CASE WHEN p ? ''area_code'' THEN NULLIF(p->>''area_code'', '''') ELSE area_code END');
  IF length(_n) - length(_d) < 100 THEN RAISE EXCEPTION 'pj_task_save area_code patch'; END IF;
  EXECUTE _n;
END $$;

UPDATE ds_folders f SET name = _pj_ref(t.id) || ' ' || left(t.title, 80) FROM project_tasks t WHERE t.ds_folder_id = f.id;

INSERT INTO schema_migrations (filename) VALUES ('0262_task_area_code.sql') ON CONFLICT DO NOTHING;
