-- 0231 — Ask Bravura leftovers (issue #58): approve / reject from the chat, turn a quote into a draft PO,
-- and chat history kept on the server for 30 days (ai_questions.hidden = "New conversation" clears the view).
ALTER TABLE ai_actions DROP CONSTRAINT IF EXISTS ai_actions_kind_check;
ALTER TABLE ai_actions ADD CONSTRAINT ai_actions_kind_check
  CHECK (kind IN ('receive_delivery','draft_bill','petty_cash_spend','purchase_request','approval_decision','po_from_quote'));
ALTER TABLE ai_questions ADD COLUMN IF NOT EXISTS hidden boolean NOT NULL DEFAULT false;

-- Find an item in MY approvals inbox (approval_inbox checks who may act) by title / number / requester.
CREATE OR REPLACE FUNCTION public.ai_prepare_approval(p_search text, p_approve boolean, p_comment text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
DECLARE _q text := '%' || trim(COALESCE(p_search, '')) || '%'; _n int; _r record;
BEGIN
  SELECT count(*) INTO _n FROM approval_inbox() a WHERE a.title ILIKE _q OR a.requester_name ILIKE _q OR a.entity_type ILIKE _q;
  IF _n = 0 THEN RETURN jsonb_build_object('error', 'Nothing matching "' || COALESCE(p_search, '') || '" is waiting for your approval',
      'waiting', (SELECT jsonb_agg(a.title) FROM (SELECT * FROM approval_inbox() LIMIT 10) a)); END IF;
  IF _n > 1 THEN RETURN jsonb_build_object('error', 'More than one item matches — say which one',
      'matches', (SELECT jsonb_agg(jsonb_build_object('title', a.title, 'from', a.requester_name, 'amount', a.amount)) FROM approval_inbox() a
                   WHERE a.title ILIKE _q OR a.requester_name ILIKE _q OR a.entity_type ILIKE _q)); END IF;
  IF NOT p_approve AND COALESCE(trim(p_comment), '') = '' THEN RETURN jsonb_build_object('error', 'Say why you are rejecting it'); END IF;
  SELECT * INTO _r FROM approval_inbox() a WHERE a.title ILIKE _q OR a.requester_name ILIKE _q OR a.entity_type ILIKE _q;
  RETURN jsonb_build_object('request_id', _r.id, 'site_id', _r.site_id, 'site', _r.site_name, 'title', _r.title, 'what', replace(_r.entity_type, '_', ' '),
    'amount', _r.amount, 'from', _r.requester_name, 'step', _r.step_label, 'link', _r.link, 'approve', p_approve, 'comment', NULLIF(trim(p_comment), ''));
END $$;
GRANT EXECUTE ON FUNCTION ai_prepare_approval(text, boolean, text) TO authenticated;

-- A supplier's quote (usually read from an attached file) → a draft PO with the supplier and priced lines.
CREATE OR REPLACE FUNCTION public.ai_prepare_po(p_site_ids uuid[], p_supplier text, p_lines jsonb, p_quote_ref text DEFAULT NULL, p_expected date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _site uuid := p_site_ids[1]; _sup procurement_suppliers%ROWTYPE; _tot numeric;
BEGIN
  IF _site IS NULL THEN RETURN jsonb_build_object('error', 'Say which site the order is for'); END IF;
  IF NOT _proc_can('create', _site) THEN RETURN jsonb_build_object('error', 'You cannot raise purchase orders for this site'); END IF;
  SELECT * INTO _sup FROM procurement_suppliers WHERE site_id = _site AND supplier_name ILIKE '%' || trim(COALESCE(p_supplier, '')) || '%' ORDER BY length(supplier_name) LIMIT 1;
  IF _sup.id IS NULL THEN SELECT * INTO _sup FROM procurement_suppliers WHERE supplier_name ILIKE '%' || trim(COALESCE(p_supplier, '')) || '%' ORDER BY length(supplier_name) LIMIT 1; END IF;
  IF _sup.id IS NULL THEN RETURN jsonb_build_object('error', 'No supplier matching "' || COALESCE(p_supplier, '') || '" — add them in Suppliers first'); END IF;
  IF _sup.hold_type = 'all' THEN RETURN jsonb_build_object('error', _sup.supplier_name || ' is on hold for new orders'); END IF;
  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN RETURN jsonb_build_object('error', 'The order needs at least one line'); END IF;
  SELECT round(sum(COALESCE((x->>'qty')::numeric, 1) * COALESCE((x->>'unit_price')::numeric, 0)), 2) INTO _tot FROM jsonb_array_elements(p_lines) x;
  RETURN jsonb_build_object('site_id', _site, 'supplier_id', _sup.id, 'supplier', _sup.supplier_name, 'quote_ref', NULLIF(trim(p_quote_ref), ''), 'expected_date', p_expected,
    'lines', (SELECT jsonb_agg(jsonb_build_object('item_id', it.id, 'what', COALESCE(it.item_code || ' — ' || it.description, x->>'what'),
        'description', CASE WHEN it.id IS NULL THEN x->>'what' END, 'unit', x->>'unit', 'qty', COALESCE((x->>'qty')::numeric, 1), 'unit_price', COALESCE((x->>'unit_price')::numeric, 0)))
      FROM jsonb_array_elements(p_lines) x
      LEFT JOIN LATERAL (SELECT i.* FROM items i WHERE NOT COALESCE(i.is_archived, false) AND (i.item_code ILIKE trim(x->>'what') OR i.description ILIKE trim(x->>'what'))
                          ORDER BY length(i.description) LIMIT 1) it ON true),
    'total', _tot);
END $$;
GRANT EXECUTE ON FUNCTION ai_prepare_po(uuid[], text, jsonb, text, date) TO authenticated;

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
  ELSIF _a.kind = 'approval_decision' THEN
    PERFORM approval_decide((_p->>'request_id')::uuid, (_p->>'approve')::boolean, NULLIF(_p->>'comment', ''));
    _res := jsonb_build_object('message', CASE WHEN (_p->>'approve')::boolean THEN 'Approved: ' ELSE 'Rejected: ' END || (_p->>'title'), 'path', COALESCE(NULLIF(_p->>'link', ''), '/'));
  ELSIF _a.kind = 'po_from_quote' THEN
    _id := proc_po_save(jsonb_build_object('site_id', _p->>'site_id', 'supplier_id', _p->>'supplier_id', 'supplier_ref', _p->>'quote_ref', 'expected_date', _p->>'expected_date',
      'notes', 'Drafted via Ask Bravura from a quote',
      'lines', (SELECT jsonb_agg(jsonb_build_object('item_id', l->>'item_id', 'description', COALESCE(l->>'description', l->>'what'), 'unit', l->>'unit',
                 'quantity', l->>'qty', 'unit_cost', l->>'unit_price')) FROM jsonb_array_elements(_p->'lines') l)));
    _res := jsonb_build_object('message', 'Draft PO saved for ' || (_p->>'supplier') || ' — check it and send it for approval', 'path', '/procurement/proc_orders:' || _id,
      'record_table', 'purchase_orders', 'record_id', _id);
  END IF;
  _res := _res || jsonb_build_object('site_id', _a.site_id);
  PERFORM _ai_action_mark(p_id, 'done', _res, NULL);
  RETURN _res;
END $$;

INSERT INTO schema_migrations (filename) VALUES ('0231_ask_bravura_approvals_quote_po_history.sql') ON CONFLICT DO NOTHING;
