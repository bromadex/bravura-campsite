-- 0222 — Ask Bravura B3 (issue #58): match an attached document (invoice, delivery note, quote, receipt) to
-- suppliers / POs / existing bills. Nothing is saved — the file is read in the chat and only compared.
-- Also ai_leave: leave requests in a period by status (B2 gap: "whose leave was rejected?").

CREATE OR REPLACE FUNCTION public.ai_leave(p_site_ids uuid[], p_from date, p_to date, p_status text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _s uuid[] := _ai_sites_for('hr.view', p_site_ids);
BEGIN
  IF _s IS NULL THEN RETURN jsonb_build_object('error', 'You have no HR access to those sites'); END IF;
  RETURN (WITH r AS (
      SELECT lr.status, e.name, lt.name typ, lr.start_date, lr.end_date, lr.days_requested, lr.reason, lr.rejected_reason, lr.created_at::date applied, s.name site
        FROM leave_requests lr JOIN employees e ON e.id = lr.employee_id LEFT JOIN leave_types lt ON lt.id = lr.leave_type_id JOIN sites s ON s.id = lr.site_id
       WHERE lr.site_id = ANY(_s) AND (lr.created_at::date BETWEEN p_from AND p_to OR lr.start_date BETWEEN p_from AND p_to)
         AND (p_status IS NULL OR p_status = '' OR lr.status = p_status))
    SELECT jsonb_build_object('from', p_from, 'to', p_to, 'status_filter', p_status,
      'by_status', COALESCE((SELECT jsonb_object_agg(status, n) FROM (SELECT status, count(*) n FROM r GROUP BY status) q), '{}'),
      'requests', COALESCE((SELECT jsonb_agg(x) FROM (SELECT jsonb_build_object('employee', name, 'type', typ, 'from', start_date, 'to', end_date, 'days', days_requested,
          'status', status, 'applied', applied, 'reason', left(reason, 80), 'rejected_because', left(rejected_reason, 80), 'site', site) x FROM r ORDER BY applied DESC LIMIT 30) q), '[]')));
END $$;

CREATE OR REPLACE FUNCTION public.ai_match_document(p_site_ids uuid[], p_supplier text, p_doc_number text DEFAULT NULL,
  p_po_ref text DEFAULT NULL, p_total numeric DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _s uuid[] := _ai_sites(p_site_ids); _sup uuid[]; _w text; _pos uuid[];
BEGIN
  IF _s IS NULL THEN RETURN jsonb_build_object('error', 'You have no finance or procurement access to those sites'); END IF;
  -- Supplier: full name match first, then the first meaningful word of the name.
  SELECT array_agg(id) INTO _sup FROM procurement_suppliers WHERE site_id = ANY(_s) AND length(trim(COALESCE(p_supplier, ''))) > 1
     AND (supplier_name ILIKE '%' || trim(p_supplier) || '%' OR trim(p_supplier) ILIKE '%' || supplier_name || '%');
  IF _sup IS NULL AND p_supplier IS NOT NULL THEN
    SELECT w INTO _w FROM regexp_split_to_table(lower(p_supplier), '[^a-z0-9]+') w
     WHERE length(w) > 3 AND w NOT IN ('private','limited','company','trading','zimbabwe','enterprises','investments','holdings','services','pvt') LIMIT 1;
    IF _w IS NOT NULL THEN SELECT array_agg(id) INTO _sup FROM procurement_suppliers WHERE site_id = ANY(_s) AND supplier_name ILIKE '%' || _w || '%'; END IF;
  END IF;
  -- POs: the reference printed on the document, else open/recent POs of the supplier closest to the total.
  IF COALESCE(trim(p_po_ref), '') <> '' THEN
    SELECT array_agg(id) INTO _pos FROM purchase_orders WHERE site_id = ANY(_s) AND po_number ILIKE '%' || trim(p_po_ref) || '%';
  END IF;
  IF _pos IS NULL AND _sup IS NOT NULL THEN
    SELECT array_agg(id) INTO _pos FROM (SELECT id FROM purchase_orders WHERE supplier_id = ANY(_sup) AND status NOT IN ('cancelled','rfq','rfq_sent')
       AND COALESCE(order_date, created_at::date) >= CURRENT_DATE - 180
     ORDER BY CASE WHEN p_total IS NULL THEN 0 ELSE abs(COALESCE(total_amount, 0) - p_total) END, created_at DESC LIMIT 3) q;
  END IF;
  RETURN jsonb_build_object(
    'suppliers', COALESCE((SELECT jsonb_agg(jsonb_build_object('supplier', supplier_name, 'hold', hold_type, 'terms_days', payment_terms_days)) FROM procurement_suppliers WHERE id = ANY(_sup)), '[]'),
    'supplier_found', _sup IS NOT NULL,
    'purchase_orders', COALESCE((SELECT jsonb_agg(jsonb_build_object('po', po.po_number, 'status', po.status, 'date', COALESCE(po.order_date, po.created_at::date),
        'total', po.total_amount, 'supplier', ps.supplier_name,
        'difference_to_document', CASE WHEN p_total IS NULL THEN NULL ELSE round(p_total - COALESCE(po.total_amount, 0), 2) END,
        'lines', (SELECT jsonb_agg(jsonb_build_object('what', COALESCE(i.description, pl.description), 'ordered', pl.quantity, 'received', pl.received_qty, 'unit_cost', pl.unit_cost))
                    FROM po_lines pl LEFT JOIN items i ON i.id = pl.item_id WHERE pl.po_id = po.id AND NOT pl.is_archived),
        'receipts', (SELECT jsonb_agg(jsonb_build_object('grn', grn_number, 'date', received_date, 'delivery_note', delivery_note_ref)) FROM goods_received_notes WHERE po_id = po.id),
        'bills', (SELECT jsonb_agg(jsonb_build_object('bill', invoice_number, 'total', total_amount, 'status', status)) FROM purchase_invoices WHERE po_id = po.id)))
        FROM purchase_orders po LEFT JOIN procurement_suppliers ps ON ps.id = po.supplier_id WHERE po.id = ANY(_pos)), '[]'),
    'already_billed_with_this_number', COALESCE((SELECT jsonb_agg(jsonb_build_object('bill', invoice_number, 'date', invoice_date, 'total', total_amount, 'status', status))
        FROM purchase_invoices WHERE site_id = ANY(_s) AND COALESCE(trim(p_doc_number), '') <> '' AND invoice_number ILIKE trim(p_doc_number)
         AND (_sup IS NULL OR supplier_id = ANY(_sup))), '[]'));
END $$;

REVOKE ALL ON FUNCTION ai_leave(uuid[], date, date, text), ai_match_document(uuid[], text, text, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION ai_leave(uuid[], date, date, text), ai_match_document(uuid[], text, text, text, numeric) TO authenticated;

INSERT INTO schema_migrations (filename) VALUES ('0222_ask_bravura_b3.sql') ON CONFLICT DO NOTHING;
