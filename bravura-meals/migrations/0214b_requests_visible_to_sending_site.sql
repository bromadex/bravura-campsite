-- 0214b — the sending site's stores can see transfer requests aimed at it (to send the stock).
DROP POLICY IF EXISTS pr_select ON purchase_requisitions;
CREATE POLICY pr_select ON purchase_requisitions FOR SELECT TO authenticated
  USING (_proc_can('view', site_id) OR requested_by = auth.uid() OR (source_site_id IS NOT NULL AND _proc_can('view', source_site_id)));
DROP POLICY IF EXISTS prl_select ON requisition_lines;
CREATE POLICY prl_select ON requisition_lines FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM purchase_requisitions r WHERE r.id = requisition_id
    AND (_proc_can('view', r.site_id) OR r.requested_by = auth.uid() OR (r.source_site_id IS NOT NULL AND _proc_can('view', r.source_site_id)))));
INSERT INTO schema_migrations (filename) VALUES ('0214b_requests_visible_to_sending_site.sql') ON CONFLICT DO NOTHING;
