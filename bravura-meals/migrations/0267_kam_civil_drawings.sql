-- 0267 (user, 8 Oct 2026): Kamativi civil drawings — latest revision of every set from Confidence's Drive folder
-- "Kamativi Civil Designs" (TSF batches, Drawings Book and campsite renders left out). 558 files were extracted from the zips
-- and uploaded to docshare-files/<KAM site>/drawings/ by a one-off locked edge function (drawings-import, now retired).
-- Each file → ds_documents (category Drawings, filed in its task's DocShare folder, else the project folder), linked to every
-- task of its area code (ds_document_links), and a row in the project drawing register (project_documents, file_url = storage path,
-- status 'approved': status is varchar(20) so the allowed 'issued_for_construction' (23 chars) can never be saved).
CREATE OR REPLACE FUNCTION _pj_import_drawings(p_rows jsonb) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _p uuid := 'a0000001-0000-0000-0000-000000000001'; _site uuid := 'fe3f29ed-e1d4-44a2-b409-9a15a98eba97';
  r jsonb; _doc uuid; _tasks uuid[]; _folder uuid; _n int := 0;
BEGIN
  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    IF EXISTS (SELECT 1 FROM ds_documents WHERE file_path = r->>'path') THEN CONTINUE; END IF;
    SELECT array_agg(id ORDER BY task_no) INTO _tasks FROM project_tasks t
     WHERE t.project_id = _p AND NOT COALESCE(t.is_archived, false)
       AND (t.area_code = ANY (ARRAY(SELECT jsonb_array_elements_text(r->'ac')))
            OR t.title ILIKE ANY (ARRAY(SELECT jsonb_array_elements_text(r->'pat')))
            OR (r->>'set' ILIKE 'AC 40 MCC%' AND t.area_code = '40' AND t.title ILIKE ANY (ARRAY(SELECT jsonb_array_elements_text(r->'pat')))));
    _folder := CASE WHEN _tasks IS NOT NULL THEN _pj_task_folder(_tasks[1]) ELSE _pj_project_folder(_p) END;
    INSERT INTO ds_documents (site_id, title, description, category, doc_mode, folder_id, file_path, file_name, file_size, file_type,
      project_id, document_number, document_type, tags)
    VALUES (_site, r->>'title', 'From drawing set "' || (r->>'set') || '" (Drive: Kamativi Civil Designs)', 'Drawings', 'general', _folder,
      r->>'path', r->>'file', (r->>'size')::bigint, r->>'ext', _p, r->>'num', r->>'type',
      array_remove(ARRAY[r->>'area', r->>'set'], NULL))
    RETURNING id INTO _doc;
    IF _tasks IS NOT NULL THEN
      INSERT INTO ds_document_links (document_id, linked_table, linked_id) SELECT _doc, 'project_tasks', unnest(_tasks);
    END IF;
    INSERT INTO project_documents (project_id, doc_number, title, doc_type, discipline, revision, status, file_url, file_size, file_format, notes)
    VALUES (_p, r->>'num', left(r->>'title', 255), r->>'type', 'civil', r->>'rev', 'approved', r->>'path',
      (r->>'size')::bigint, r->>'ext', 'Set: ' || (r->>'set') || COALESCE(' · ' || (r->>'area'), '') || ' · https://drive.google.com/file/d/' || (r->>'drive') || '/view');
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END $$;
REVOKE ALL ON FUNCTION _pj_import_drawings(jsonb) FROM PUBLIC, anon, authenticated;
-- The file list (558 rows) was passed to _pj_import_drawings by the one-off edge function; kept in the session scratchpad, not in git.

INSERT INTO schema_migrations (filename) VALUES ('0267_kam_civil_drawings.sql') ON CONFLICT DO NOTHING;
