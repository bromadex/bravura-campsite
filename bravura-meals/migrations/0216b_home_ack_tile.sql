-- 0216b — Procurement Home "Not confirmed by supplier" tile; PO list carries the supplier's confirmation.
CREATE OR REPLACE FUNCTION public.proc_po_list(p_site_ids uuid[]) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _sites uuid[];
BEGIN
  SELECT array_agg(s) INTO _sites FROM unnest(p_site_ids) s WHERE _proc_can('view', s);
  IF _sites IS NULL THEN RAISE EXCEPTION 'No access'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(x ORDER BY x->>'created_at' DESC) FROM (
    SELECT jsonb_build_object(
      'id', po.id, 'po_number', po.po_number, 'status', po.status, 'site_id', po.site_id, 'site', s.name,
      'supplier_id', po.supplier_id, 'supplier', ps.supplier_name, 'total', po.total_amount, 'priority', po.priority,
      'order_date', po.order_date, 'expected_date', po.expected_date, 'created_at', po.created_at, 'rfq_group_id', po.rfq_group_id,
      'revision', po.revision, 'amended_from', po.amended_from, 'cancel_reason', po.cancel_reason,
      'delivery_status', po.delivery_status, 'acknowledged_at', po.acknowledged_at, 'ack_by_name', po.ack_by_name,
      'lines', (SELECT count(*) FROM po_lines l WHERE l.po_id = po.id AND NOT l.is_archived),
      'receipt', CASE
          WHEN po.status NOT IN ('sent','partially_received','received') THEN NULL
          WHEN NOT EXISTS (SELECT 1 FROM po_lines l WHERE l.po_id = po.id AND NOT l.is_archived AND l.received_qty > 0) THEN 'none'
          WHEN EXISTS (SELECT 1 FROM po_lines l WHERE l.po_id = po.id AND NOT l.is_archived AND l.received_qty < l.quantity) THEN 'partial'
          ELSE 'full' END,
      'billed', COALESCE((SELECT sum(i.total_amount) FROM purchase_invoices i WHERE i.po_id = po.id AND i.status NOT IN ('cancelled','rejected')), 0),
      'late', po.status IN ('sent','partially_received') AND po.expected_date < CURRENT_DATE,
      'alternatives', CASE WHEN po.rfq_group_id IS NULL THEN 0 ELSE
          (SELECT count(*) FROM purchase_orders a WHERE a.rfq_group_id = po.rfq_group_id AND a.id <> po.id AND a.status <> 'cancelled') END,
      'requests', (SELECT string_agg(DISTINCT r.requisition_no, ', ') FROM po_lines l JOIN requisition_lines rl ON rl.id = l.requisition_line_id
                     JOIN purchase_requisitions r ON r.id = rl.requisition_id WHERE l.po_id = po.id)) AS x
      FROM purchase_orders po JOIN sites s ON s.id = po.site_id LEFT JOIN procurement_suppliers ps ON ps.id = po.supplier_id
     WHERE po.site_id = ANY(_sites)
     ORDER BY po.created_at DESC LIMIT 800) q), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.proc_home(p_site_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _sites uuid[]; _m0 date := date_trunc('month', current_date)::date; _me uuid := auth.uid();
BEGIN
  SELECT array_agg(s) INTO _sites FROM unnest(p_site_ids) s WHERE _proc_can('view', s);
  IF _sites IS NULL THEN RAISE EXCEPTION 'No access'; END IF;
  RETURN jsonb_build_object(
    'tiles', jsonb_build_object(
      'requests_to_approve', (SELECT count(*) FROM purchase_requisitions WHERE site_id = ANY(_sites) AND status = 'submitted' AND NOT is_archived),
      'requests_to_order',   (SELECT count(*) FROM purchase_requisitions WHERE site_id = ANY(_sites) AND status = 'approved' AND request_type = 'buy' AND NOT is_archived),
      'transfers_to_send',   (SELECT count(*) FROM purchase_requisitions WHERE source_site_id = ANY(_sites) AND status = 'approved' AND request_type = 'transfer' AND NOT is_archived),
      'pos_to_approve',      (SELECT count(*) FROM purchase_orders WHERE site_id = ANY(_sites) AND status = 'pending_approval'),
      'pos_draft',           (SELECT count(*) FROM purchase_orders WHERE site_id = ANY(_sites) AND status = 'draft'),
      'pos_waiting',         (SELECT count(*) FROM purchase_orders WHERE site_id = ANY(_sites) AND status IN ('sent','partially_received')),
      'not_acknowledged',    (SELECT count(*) FROM purchase_orders WHERE site_id = ANY(_sites) AND status IN ('sent','partially_received') AND acknowledged_at IS NULL),
      'late_deliveries',     (SELECT count(*) FROM purchase_orders WHERE site_id = ANY(_sites) AND status IN ('sent','partially_received') AND expected_date < current_date),
      'received_not_billed', (SELECT count(*) FROM goods_received_notes g WHERE g.site_id = ANY(_sites) AND g.status IN ('accepted','accepted_partial')
                                AND NOT EXISTS (SELECT 1 FROM purchase_invoices i WHERE i.grn_id = g.id AND i.status <> 'cancelled')),
      'mine_open',           (SELECT count(*) FROM purchase_requisitions WHERE requested_by = _me AND status IN ('draft','submitted','approved') AND NOT is_archived)),
    'spend_by_site', COALESCE((SELECT jsonb_agg(x ORDER BY x->>'site') FROM (
        SELECT jsonb_build_object('site_id', s.id, 'site', s.name,
          'ordered', COALESCE((SELECT sum(total_amount) FROM purchase_orders o WHERE o.site_id = s.id AND o.status IN ('sent','partially_received','received') AND COALESCE(o.order_date, o.created_at::date) >= _m0), 0),
          'budget',  COALESCE((SELECT sum(CASE WHEN b.monthly_split THEN COALESCE(bm.amount, 0) ELSE b.amount / 12.0 END)
                                 FROM procurement_budgets b
                                 LEFT JOIN budget_months bm ON bm.budget_id = b.id AND bm.month = extract(month FROM _m0)::int
                                WHERE b.site_id = s.id AND NOT COALESCE(b.is_archived, false)
                                  AND b.fiscal_year = extract(year FROM _m0)::int), 0)) AS x
          FROM sites s WHERE s.id = ANY(_sites)) q), '[]'::jsonb),
    'attention', COALESCE((SELECT jsonb_agg(a ORDER BY a->>'sort') FROM (
        SELECT jsonb_build_object('kind','late','sort','1'||COALESCE(o.expected_date::text,''), 'label', 'PO ' || o.po_number || ' is late', 'detail',
               COALESCE(ps.supplier_name,'') || ' · due ' || to_char(o.expected_date,'DD Mon'), 'page','proc_orders', 'site', s.name) AS a
          FROM purchase_orders o JOIN sites s ON s.id = o.site_id LEFT JOIN procurement_suppliers ps ON ps.id = o.supplier_id
         WHERE o.site_id = ANY(_sites) AND o.status IN ('sent','partially_received') AND o.expected_date < current_date
        UNION ALL
        SELECT jsonb_build_object('kind','urgent','sort','0'||r.created_at::text, 'label', 'Urgent request ' || r.requisition_no || ' waiting', 'detail',
               COALESCE(r.title,'') || ' · ' || r.status, 'page','proc_requisitions', 'site', s.name)
          FROM purchase_requisitions r JOIN sites s ON s.id = r.site_id
         WHERE r.site_id = ANY(_sites) AND r.priority = 'urgent' AND r.status IN ('submitted','approved') AND NOT r.is_archived
        UNION ALL
        SELECT jsonb_build_object('kind','needed','sort','2'||r.needed_by::text, 'label', 'Request ' || r.requisition_no || ' needed by ' || to_char(r.needed_by,'DD Mon'),
               'detail', COALESCE(r.title,'') || ' · not ordered yet', 'page','proc_requisitions', 'site', s.name)
          FROM purchase_requisitions r JOIN sites s ON s.id = r.site_id
         WHERE r.site_id = ANY(_sites) AND r.status IN ('submitted','approved') AND r.needed_by <= current_date + 7 AND NOT r.is_archived
        LIMIT 30) q), '[]'::jsonb));
END $$;

INSERT INTO schema_migrations (filename) VALUES ('0216b_home_ack_tile.sql') ON CONFLICT DO NOTHING;
