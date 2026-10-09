-- 0268 (user, 9 Oct 2026): project_documents.status was varchar(20) but its CHECK allows 'issued_for_construction' (23 chars),
-- so that status could never be saved. Widen it and mark the imported Kamativi civil drawings (0267) issued for construction.
ALTER TABLE project_documents ALTER COLUMN status TYPE varchar(40);

UPDATE project_documents SET status = 'issued_for_construction', updated_at = now()
 WHERE project_id = 'a0000001-0000-0000-0000-000000000001' AND status = 'approved' AND doc_type = 'drawing'
   AND notes LIKE 'Set: %' AND NOT COALESCE(is_archived, false);

INSERT INTO schema_migrations (filename) VALUES ('0268_pj_docs_status_ifc.sql') ON CONFLICT DO NOTHING;
