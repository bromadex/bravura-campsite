-- 0224 — Ask Bravura B4 (issue #58): actions with confirmation.
-- The assistant never changes anything itself. It prepares a proposal (ai_prepare_* → ai_action_propose),
-- the person sees a card and presses Confirm, and ai_action_confirm runs the SAME functions / inserts the
-- screens use — as the person (SECURITY INVOKER), so every permission, lock and trigger still applies.

CREATE TABLE IF NOT EXISTS public.ai_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  site_id uuid REFERENCES sites(id),
  kind text NOT NULL CHECK (kind IN ('receive_delivery','draft_bill','petty_cash_spend','purchase_request')),
  summary text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','done','failed','cancelled')),
  result jsonb, error text,
  created_at timestamptz NOT NULL DEFAULT now(), done_at timestamptz
);
CREATE INDEX IF NOT EXISTS ai_actions_user_idx ON ai_actions (user_id, created_at DESC);
ALTER TABLE ai_actions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aia_own ON ai_actions;
CREATE POLICY aia_own ON ai_actions FOR SELECT TO authenticated USING (user_id = auth.uid() OR _has_permission('finance.approve', site_id));
DROP POLICY IF EXISTS aia_insert ON ai_actions;
CREATE POLICY aia_insert ON ai_actions FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() AND status = 'proposed');
-- status changes only through ai_action_confirm / ai_action_cancel (SECURITY DEFINER bookkeeping)

-- ── Prepare: resolve names to records and check what is possible; never writes ──────────────
CREATE OR REPLACE FUNCTION public.ai_prepare_receive(p_site_ids uuid[], p_po text, p_lines jsonb DEFAULT NULL, p_delivery_ref text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _s uuid[] := _ai_sites(p_site_ids); _po purchase_orders%ROWTYPE; _out jsonb := '[]'; _l record; _want numeric; _m jsonb;
BEGIN
  IF _s IS NULL THEN RETURN jsonb_build_object('error', 'You have no procurement access to those sites'); END IF;
  SELECT * INTO _po FROM purchase_orders WHERE site_id = ANY(_s) AND po_number ILIKE '%' || trim(p_po) || '%' ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'No purchase order matching "' || p_po || '"'); END IF;
  IF _po.status NOT IN ('sent','partially_received') THEN
    RETURN jsonb_build_object('error', _po.po_number || ' is ' || _po.status || ' — only sent or part-received orders can be received'); END IF;
  FOR _l IN SELECT pl.id, COALESCE(i.description, pl.description) what, pl.quantity, pl.received_qty, pl.unit
              FROM po_lines pl LEFT JOIN items i ON i.id = pl.item_id WHERE pl.po_id = _po.id AND NOT pl.is_archived AND pl.received_qty < pl.quantity LOOP
    _want := _l.quantity - _l.received_qty;
    IF p_lines IS NOT NULL AND jsonb_typeof(p_lines) = 'array' AND jsonb_array_length(p_lines) > 0 THEN
      SELECT x INTO _m FROM jsonb_array_elements(p_lines) x
       WHERE lower(_l.what) LIKE '%' || lower(trim(x->>'what')) || '%' OR lower(trim(x->>'what')) LIKE '%' || lower(_l.what) || '%' LIMIT 1;
      _want := CASE WHEN _m IS NULL THEN 0 ELSE LEAST(COALESCE((_m->>'qty')::numeric, _want), _l.quantity - _l.received_qty) END;
    END IF;
    _out := _out || jsonb_build_object('po_line_id', _l.id, 'what', _l.what, 'unit', _l.unit, 'ordered', _l.quantity, 'already_received', _l.received_qty,
                                       'still_to_come', _l.quantity - _l.received_qty, 'qty', _want);
  END LOOP;
  IF jsonb_array_length(_out) = 0 THEN RETURN jsonb_build_object('error', 'Everything on ' || _po.po_number || ' has already been received'); END IF;
  RETURN jsonb_build_object('po_id', _po.id, 'po', _po.po_number, 'site_id', _po.site_id,
    'supplier', (SELECT supplier_name FROM procurement_suppliers WHERE id = _po.supplier_id), 'delivery_ref', p_delivery_ref, 'lines', _out);
END $$;

CREATE OR REPLACE FUNCTION public.ai_prepare_bill(p_site_ids uuid[], p_supplier text, p_invoice_number text, p_invoice_date date,
  p_lines jsonb, p_po text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _s uuid[] := _ai_sites(p_site_ids); _sup procurement_suppliers%ROWTYPE; _po purchase_orders%ROWTYPE; _grn uuid; _tot numeric;
BEGIN
  IF _s IS NULL THEN RETURN jsonb_build_object('error', 'You have no finance or procurement access to those sites'); END IF;
  IF COALESCE(trim(p_invoice_number), '') = '' THEN RETURN jsonb_build_object('error', 'The bill needs the supplier''s invoice number'); END IF;
  IF p_po IS NOT NULL AND trim(p_po) <> '' THEN
    SELECT * INTO _po FROM purchase_orders WHERE site_id = ANY(_s) AND po_number ILIKE '%' || trim(p_po) || '%' ORDER BY created_at DESC LIMIT 1;
  END IF;
  IF _po.id IS NOT NULL THEN SELECT * INTO _sup FROM procurement_suppliers WHERE id = _po.supplier_id;
  ELSE SELECT * INTO _sup FROM procurement_suppliers WHERE site_id = ANY(_s) AND supplier_name ILIKE '%' || trim(p_supplier) || '%' ORDER BY length(supplier_name) LIMIT 1;
  END IF;
  IF _sup.id IS NULL THEN RETURN jsonb_build_object('error', 'No supplier matching "' || COALESCE(p_supplier, '') || '" — add them in Suppliers first'); END IF;
  IF EXISTS (SELECT 1 FROM purchase_invoices WHERE supplier_id = _sup.id AND invoice_number ILIKE trim(p_invoice_number)) THEN
    RETURN jsonb_build_object('error', 'A bill ' || p_invoice_number || ' from ' || _sup.supplier_name || ' is already recorded'); END IF;
  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN RETURN jsonb_build_object('error', 'The bill needs at least one line'); END IF;
  IF _po.id IS NOT NULL THEN SELECT id INTO _grn FROM goods_received_notes WHERE po_id = _po.id ORDER BY created_at DESC LIMIT 1; END IF;
  SELECT round(sum(COALESCE((x->>'qty')::numeric, 1) * COALESCE((x->>'unit_price')::numeric, 0)), 2) INTO _tot FROM jsonb_array_elements(p_lines) x;
  RETURN jsonb_build_object('site_id', COALESCE(_po.site_id, _sup.site_id), 'supplier_id', _sup.id, 'supplier', _sup.supplier_name, 'supplier_hold', _sup.hold_type,
    'po_id', _po.id, 'po', _po.po_number, 'grn_id', _grn, 'invoice_number', trim(p_invoice_number), 'invoice_date', COALESCE(p_invoice_date, CURRENT_DATE),
    'bill_type', CASE WHEN _grn IS NOT NULL THEN 'goods' ELSE 'accrued' END,
    'lines', (SELECT jsonb_agg(jsonb_build_object('what', x->>'what', 'qty', COALESCE((x->>'qty')::numeric, 1), 'unit', x->>'unit', 'unit_price', COALESCE((x->>'unit_price')::numeric, 0))) FROM jsonb_array_elements(p_lines) x),
    'total', _tot);
END $$;

CREATE OR REPLACE FUNCTION public.ai_prepare_petty_cash(p_site_ids uuid[], p_amount numeric, p_what text, p_category text DEFAULT NULL, p_date date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _f petty_cash_funds%ROWTYPE;
BEGIN
  IF NOT (p_amount > 0) THEN RETURN jsonb_build_object('error', 'Say how much was spent'); END IF;
  IF COALESCE(trim(p_what), '') = '' THEN RETURN jsonb_build_object('error', 'Say what it was for'); END IF;
  SELECT f.* INTO _f FROM petty_cash_funds f
   WHERE f.is_active AND NOT COALESCE(f.is_archived, false)
     AND (p_site_ids IS NULL OR cardinality(p_site_ids) = 0 OR f.site_id = ANY(p_site_ids))
     AND (f.custodian_id = auth.uid() OR _has_permission('pettycash.create', f.site_id) OR _has_permission('pettycash.edit', f.site_id))
   ORDER BY (f.custodian_id = auth.uid()) DESC, f.balance DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'You don''t look after a petty cash box at this site'); END IF;
  IF p_amount > _f.balance THEN RETURN jsonb_build_object('error', 'Only $' || to_char(_f.balance, 'FM999,999,990.00') || ' left in ' || _f.name); END IF;
  RETURN jsonb_build_object('fund_id', _f.id, 'fund', _f.name, 'site_id', _f.site_id, 'balance_before', _f.balance, 'balance_after', _f.balance - p_amount,
    'amount', p_amount, 'what', trim(p_what), 'category', p_category, 'date', COALESCE(p_date, CURRENT_DATE));
END $$;

CREATE OR REPLACE FUNCTION public.ai_prepare_request(p_site_ids uuid[], p_title text, p_lines jsonb, p_needed_by date DEFAULT NULL, p_priority text DEFAULT 'normal')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _site uuid := COALESCE(p_site_ids[1], NULL);
BEGIN
  IF _site IS NULL THEN RETURN jsonb_build_object('error', 'Say which site the request is for'); END IF;
  IF NOT _proc_can('create', _site) THEN RETURN jsonb_build_object('error', 'You cannot raise requests for this site'); END IF;
  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN RETURN jsonb_build_object('error', 'Say what is needed'); END IF;
  RETURN jsonb_build_object('site_id', _site, 'title', COALESCE(NULLIF(trim(p_title), ''), 'Request'), 'needed_by', p_needed_by,
    'priority', CASE WHEN p_priority IN ('low','normal','high','urgent') THEN p_priority ELSE 'normal' END,
    'lines', (SELECT jsonb_agg(jsonb_build_object('item_id', it.id, 'what', COALESCE(it.item_code || ' — ' || it.description, x->>'what'),
        'description', CASE WHEN it.id IS NULL THEN x->>'what' END, 'unit', x->>'unit', 'quantity', COALESCE((x->>'qty')::numeric, 1),
        'estimated_cost', COALESCE((x->>'estimated_cost')::numeric, it.average_cost)))
      FROM jsonb_array_elements(p_lines) x
      LEFT JOIN LATERAL (SELECT i.* FROM items i WHERE NOT COALESCE(i.is_archived, false) AND (i.item_code ILIKE trim(x->>'what') OR i.description ILIKE trim(x->>'what'))
                          ORDER BY length(i.description) LIMIT 1) it ON true));
END $$;

-- Save a proposal (the card the person sees). Only the edge function's prepare output goes in.
CREATE OR REPLACE FUNCTION public.ai_action_propose(p_kind text, p_site uuid, p_summary text, p_payload jsonb)
RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$
  INSERT INTO ai_actions (kind, site_id, summary, payload) VALUES (p_kind, p_site, p_summary, p_payload) RETURNING id;
$$;

-- Run a confirmed proposal as the person. Uses the same RPCs / inserts as the screens.
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
    PERFORM proc_receive_po((_p->>'po_id')::uuid,
      (SELECT jsonb_agg(jsonb_build_object('po_line_id', l->>'po_line_id', 'qty', (l->>'qty')::numeric, 'rejected', 0)) FROM jsonb_array_elements(_p->'lines') l WHERE (l->>'qty')::numeric > 0),
      NULLIF(_p->>'delivery_ref', ''), 'Recorded via Ask Bravura');
    _res := jsonb_build_object('message', 'Delivery received on ' || (_p->>'po'), 'path', '/procurement/proc_grn');
  ELSIF _a.kind = 'draft_bill' THEN
    INSERT INTO purchase_invoices (invoice_number, site_id, po_id, grn_id, supplier_id, invoice_date, subtotal, tax_amount, total_amount, status, notes, created_by, bill_type)
    VALUES (_p->>'invoice_number', (_p->>'site_id')::uuid, NULLIF(_p->>'po_id','')::uuid, NULLIF(_p->>'grn_id','')::uuid, (_p->>'supplier_id')::uuid,
            (_p->>'invoice_date')::date, (_p->>'total')::numeric, 0, (_p->>'total')::numeric, 'draft', 'Drafted via Ask Bravura', auth.uid(), _p->>'bill_type')
    RETURNING id INTO _id;
    FOR _l IN SELECT * FROM jsonb_array_elements(_p->'lines') LOOP
      INSERT INTO invoice_lines (invoice_id, item_description, quantity, unit, unit_price)
      VALUES (_id, COALESCE(_l->>'what', 'Item'), (_l->>'qty')::numeric, NULLIF(_l->>'unit',''), (_l->>'unit_price')::numeric);
    END LOOP;
    _res := jsonb_build_object('message', 'Draft bill ' || (_p->>'invoice_number') || ' saved — approve it in Pay Suppliers', 'path', '/finance/fi_pay_suppliers', 'id', _id);
  ELSIF _a.kind = 'petty_cash_spend' THEN
    PERFORM petty_cash_record((_p->>'fund_id')::uuid, 'expense', (_p->>'amount')::numeric, _p->>'what', NULLIF(_p->>'category',''), (_p->>'date')::date, NULL, 'Ask Bravura');
    _res := jsonb_build_object('message', '$' || to_char((_p->>'amount')::numeric, 'FM999,999,990.00') || ' recorded in ' || (_p->>'fund'), 'path', '/finance/fi_spending');
  ELSIF _a.kind = 'purchase_request' THEN
    PERFORM proc_request_save(jsonb_build_object('site_id', _p->>'site_id', 'title', _p->>'title', 'needed_by', _p->>'needed_by', 'priority', _p->>'priority',
      'request_type', 'buy', 'submit', false, 'notes', 'Drafted via Ask Bravura',
      'lines', (SELECT jsonb_agg(jsonb_build_object('item_id', l->>'item_id', 'description', l->>'description', 'unit', l->>'unit',
                 'quantity', l->>'quantity', 'estimated_cost', l->>'estimated_cost')) FROM jsonb_array_elements(_p->'lines') l)));
    _res := jsonb_build_object('message', 'Draft request saved — check it and send it for approval', 'path', '/procurement/proc_requisitions');
  END IF;
  PERFORM _ai_action_mark(p_id, 'done', _res, NULL);
  RETURN _res;
END $$;

CREATE OR REPLACE FUNCTION public._ai_action_mark(p_id uuid, p_status text, p_result jsonb, p_error text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE ai_actions SET status = p_status, result = p_result, error = p_error, done_at = now() WHERE id = p_id AND user_id = auth.uid();
$$;
CREATE OR REPLACE FUNCTION public.ai_action_cancel(p_id uuid, p_error text DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE ai_actions SET status = CASE WHEN p_error IS NULL THEN 'cancelled' ELSE 'failed' END, error = p_error, done_at = now()
   WHERE id = p_id AND user_id = auth.uid() AND status = 'proposed';
$$;

REVOKE ALL ON FUNCTION ai_prepare_receive(uuid[], text, jsonb, text), ai_prepare_bill(uuid[], text, text, date, jsonb, text),
  ai_prepare_petty_cash(uuid[], numeric, text, text, date), ai_prepare_request(uuid[], text, jsonb, date, text),
  ai_action_propose(text, uuid, text, jsonb), ai_action_confirm(uuid), _ai_action_mark(uuid, text, jsonb, text), ai_action_cancel(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION ai_prepare_receive(uuid[], text, jsonb, text), ai_prepare_bill(uuid[], text, text, date, jsonb, text),
  ai_prepare_petty_cash(uuid[], numeric, text, text, date), ai_prepare_request(uuid[], text, jsonb, date, text),
  ai_action_propose(text, uuid, text, jsonb), ai_action_confirm(uuid), _ai_action_mark(uuid, text, jsonb, text), ai_action_cancel(uuid, text) TO authenticated;

GRANT SELECT, INSERT ON ai_actions TO authenticated;

INSERT INTO schema_migrations (filename) VALUES ('0224_ask_bravura_b4_actions.sql') ON CONFLICT DO NOTHING;
