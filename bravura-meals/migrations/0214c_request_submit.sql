-- 0214c — send a draft (or rejected) request for approval; the requester may do this even without edit rights.
CREATE OR REPLACE FUNCTION public.proc_request_submit(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r purchase_requisitions%ROWTYPE;
BEGIN
  SELECT * INTO _r FROM purchase_requisitions WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF NOT (_proc_can('edit', _r.site_id) OR _r.requested_by = auth.uid()) THEN RAISE EXCEPTION 'No access'; END IF;
  IF _r.status NOT IN ('draft','rejected') THEN RAISE EXCEPTION 'Only a draft request can be sent for approval'; END IF;
  IF NOT EXISTS (SELECT 1 FROM requisition_lines WHERE requisition_id = p_id AND NOT is_archived) THEN RAISE EXCEPTION 'Add at least one line first'; END IF;
  UPDATE purchase_requisitions SET status = 'submitted', updated_at = now() WHERE id = p_id;
END $$;
REVOKE ALL ON FUNCTION proc_request_submit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION proc_request_submit(uuid) TO authenticated;
INSERT INTO schema_migrations (filename) VALUES ('0214c_request_submit.sql') ON CONFLICT DO NOTHING;
