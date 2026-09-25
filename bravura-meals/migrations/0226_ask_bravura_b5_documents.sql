-- 0226 — Ask Bravura B5 (issue #58): documents on any record.
-- ds_document_links was referenced by LinkedDocuments but never created in the live DB. It links a
-- DocShare document to any record (linked_table + linked_id). Links are archived, never deleted.
CREATE TABLE IF NOT EXISTS public.ds_document_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES ds_documents(id),
  linked_table text NOT NULL,
  linked_id uuid NOT NULL,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  is_archived boolean NOT NULL DEFAULT false,
  archived_at timestamptz, archived_by uuid
);
CREATE INDEX IF NOT EXISTS ds_links_record_idx ON ds_document_links (linked_table, linked_id) WHERE NOT is_archived;
CREATE UNIQUE INDEX IF NOT EXISTS ds_links_unique ON ds_document_links (document_id, linked_table, linked_id) WHERE NOT is_archived;
ALTER TABLE ds_document_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dsl_select ON ds_document_links;
CREATE POLICY dsl_select ON ds_document_links FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM ds_documents d WHERE d.id = document_id AND _has_permission('ds.view', d.site_id)));
DROP POLICY IF EXISTS dsl_insert ON ds_document_links;
CREATE POLICY dsl_insert ON ds_document_links FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM ds_documents d WHERE d.id = document_id AND _has_permission('ds.create', d.site_id)));
DROP POLICY IF EXISTS dsl_update ON ds_document_links;
CREATE POLICY dsl_update ON ds_document_links FOR UPDATE TO authenticated
  USING (created_by = auth.uid() OR EXISTS (SELECT 1 FROM ds_documents d WHERE d.id = document_id AND _has_permission('ds.edit', d.site_id)));
GRANT SELECT, INSERT, UPDATE ON ds_document_links TO authenticated;

-- Upload-and-link in one step (the file is already in the docshare-files bucket at p_path).
CREATE OR REPLACE FUNCTION public.ds_attach_file(p_site uuid, p_table text, p_record uuid, p_title text, p_path text,
  p_file_name text, p_file_size bigint, p_file_type text, p_category text DEFAULT 'General')
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE _doc uuid;
BEGIN
  IF p_path IS NULL OR p_path NOT LIKE p_site::text || '/%' THEN RAISE EXCEPTION 'File must be stored under the site folder'; END IF;
  INSERT INTO ds_documents (site_id, title, category, doc_mode, file_path, file_name, file_size, file_type, created_by, tags)
  VALUES (p_site, COALESCE(NULLIF(trim(p_title), ''), p_file_name), COALESCE(p_category, 'General'), 'general', p_path, p_file_name, p_file_size, p_file_type,
          auth.uid(), ARRAY[p_table])
  RETURNING id INTO _doc;
  INSERT INTO ds_document_links (document_id, linked_table, linked_id) VALUES (_doc, p_table, p_record);
  RETURN _doc;
END $$;

CREATE OR REPLACE FUNCTION public.ds_unlink(p_link uuid)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$
  UPDATE ds_document_links SET is_archived = true, archived_at = now(), archived_by = auth.uid() WHERE id = p_link AND NOT is_archived;
$$;
REVOKE ALL ON FUNCTION ds_attach_file(uuid, text, uuid, text, text, text, bigint, text, text), ds_unlink(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION ds_attach_file(uuid, text, uuid, text, text, text, bigint, text, text), ds_unlink(uuid) TO authenticated;

-- Ask Bravura: documents linked to a record (read-only tool).
CREATE OR REPLACE FUNCTION public.ai_record_documents(p_table text, p_record uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT jsonb_build_object('documents', COALESCE(jsonb_agg(jsonb_build_object('title', d.title, 'file', d.file_name, 'type', d.file_type, 'added', l.created_at::date)), '[]'))
    FROM ds_document_links l JOIN ds_documents d ON d.id = l.document_id
   WHERE l.linked_table = p_table AND l.linked_id = p_record AND NOT l.is_archived AND NOT d.is_archived;
$$;
GRANT EXECUTE ON FUNCTION ai_record_documents(text, uuid) TO authenticated;

-- ai_action_confirm now reports the record it created, so the chat can file the attached document on it.
CREATE OR REPLACE FUNCTION public.ai_action_confirm(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE _a ai_actions%ROWTYPE; _p jsonb; _res jsonb; _id uuid; _l jsonb;
BEGIN
  SELECT * INTO _a FROM ai_actions WHERE id = p_id AND user_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Proposal not found'; END IF;
  IF _a.status <> 'proposed' THEN RAISE EXCEPTION 'This proposal was already %', _a.status; END IF;
  IF _a.created_at < now() - interval '2 hours' THEN RAISE EXCEPTION 'This proposal is older than 2 hours — ask again so the figures are fresh'; END IF;
  _p := _a.payload;
  IF _a.kind = 'receive_delivery' THEN
    _id := proc_receive_po((_p->>'po_id')::uuid,
      (SELECT jsonb_agg(jsonb_build_object('po_line_id', l->>'po_line_id', 'qty', (l->>'qty')::numeric, 'rejected', 0)) FROM jsonb_array_elements(_p->'lines') l WHERE (l->>'qty')::numeric > 0),
      NULLIF(_p->>'delivery_ref', ''), 'Recorded via Ask Bravura');
    _res := jsonb_build_object('message', 'Delivery received on ' || (_p->>'po'), 'path', '/procurement/proc_grn', 'record_table', 'goods_received_notes', 'record_id', _id);
  ELSIF _a.kind = 'draft_bill' THEN
    INSERT INTO purchase_invoices (invoice_number, site_id, po_id, grn_id, supplier_id, invoice_date, subtotal, tax_amount, total_amount, status, notes, created_by, bill_type)
    VALUES (_p->>'invoice_number', (_p->>'site_id')::uuid, NULLIF(_p->>'po_id','')::uuid, NULLIF(_p->>'grn_id','')::uuid, (_p->>'supplier_id')::uuid,
            (_p->>'invoice_date')::date, (_p->>'total')::numeric, 0, (_p->>'total')::numeric, 'draft', 'Drafted via Ask Bravura', auth.uid(), _p->>'bill_type')
    RETURNING id INTO _id;
    FOR _l IN SELECT * FROM jsonb_array_elements(_p->'lines') LOOP
      INSERT INTO invoice_lines (invoice_id, item_description, quantity, unit, unit_price)
      VALUES (_id, COALESCE(_l->>'what', 'Item'), (_l->>'qty')::numeric, NULLIF(_l->>'unit',''), (_l->>'unit_price')::numeric);
    END LOOP;
    _res := jsonb_build_object('message', 'Draft bill ' || (_p->>'invoice_number') || ' saved — approve it in Pay Suppliers', 'path', '/finance/fi_pay_suppliers', 'record_table', 'purchase_invoices', 'record_id', _id);
  ELSIF _a.kind = 'petty_cash_spend' THEN
    _id := petty_cash_record((_p->>'fund_id')::uuid, 'expense', (_p->>'amount')::numeric, _p->>'what', NULLIF(_p->>'category',''), (_p->>'date')::date, NULL, 'Ask Bravura');
    _res := jsonb_build_object('message', '$' || to_char((_p->>'amount')::numeric, 'FM999,999,990.00') || ' recorded in ' || (_p->>'fund'), 'path', '/finance/fi_spending', 'record_table', 'petty_cash_transactions', 'record_id', _id);
  ELSIF _a.kind = 'purchase_request' THEN
    _id := proc_request_save(jsonb_build_object('site_id', _p->>'site_id', 'title', _p->>'title', 'needed_by', _p->>'needed_by', 'priority', _p->>'priority',
      'request_type', 'buy', 'submit', false, 'notes', 'Drafted via Ask Bravura',
      'lines', (SELECT jsonb_agg(jsonb_build_object('item_id', l->>'item_id', 'description', l->>'description', 'unit', l->>'unit',
                 'quantity', l->>'quantity', 'estimated_cost', l->>'estimated_cost')) FROM jsonb_array_elements(_p->'lines') l)));
    _res := jsonb_build_object('message', 'Draft request saved — check it and send it for approval', 'path', '/procurement/proc_requisitions:' || _id, 'record_table', 'purchase_requisitions', 'record_id', _id);
  END IF;
  _res := _res || jsonb_build_object('site_id', _a.site_id);
  PERFORM _ai_action_mark(p_id, 'done', _res, NULL);
  RETURN _res;
END $$;

INSERT INTO schema_migrations (filename) VALUES ('0226_ask_bravura_b5_documents.sql') ON CONFLICT DO NOTHING;
