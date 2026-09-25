-- 0225 — Procurement Home insights (PR01 touch-up): headline figures, 6-month trend, top suppliers,
-- delivery performance and the request → paid pipeline for the sites the person can see.
CREATE OR REPLACE FUNCTION public.proc_home_insights(p_site_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _s uuid[]; _m0 date := date_trunc('month', CURRENT_DATE)::date;
BEGIN
  SELECT array_agg(x) INTO _s FROM unnest(p_site_ids) x WHERE _proc_can('view', x);
  IF _s IS NULL THEN RAISE EXCEPTION 'No access'; END IF;
  RETURN (WITH po AS (
      SELECT p.*, COALESCE(p.order_date, p.created_at::date) d FROM purchase_orders p
       WHERE p.site_id = ANY(_s) AND p.status IN ('pending_approval','sent','partially_received','received')),
    grn AS (SELECT g.received_date, p.expected_date, p.d FROM goods_received_notes g JOIN po p ON p.id = g.po_id
             WHERE g.received_date >= CURRENT_DATE - 90)
    SELECT jsonb_build_object(
      'ordered_this_month', COALESCE((SELECT round(sum(total_amount), 2) FROM po WHERE d >= _m0), 0),
      'ordered_last_month_to_date', COALESCE((SELECT round(sum(total_amount), 2) FROM po
          WHERE d >= (_m0 - interval '1 month')::date AND d <= (CURRENT_DATE - interval '1 month')::date), 0),
      'open_commitment', COALESCE((SELECT round(sum((pl.quantity - pl.received_qty) * pl.unit_cost), 2) FROM po JOIN po_lines pl ON pl.po_id = po.id
          WHERE po.status IN ('sent','partially_received') AND NOT pl.is_archived AND pl.received_qty < pl.quantity), 0),
      'open_orders', (SELECT count(*) FROM po WHERE status IN ('sent','partially_received')),
      'on_time_pct', (SELECT round(100.0 * count(*) FILTER (WHERE received_date <= expected_date) / NULLIF(count(*) FILTER (WHERE expected_date IS NOT NULL), 0)) FROM grn),
      'deliveries_90d', (SELECT count(*) FROM grn),
      'avg_lead_days', (SELECT round(avg(received_date - d), 1) FROM grn WHERE received_date >= d),
      'active_suppliers_90d', (SELECT count(DISTINCT supplier_id) FROM po WHERE d >= CURRENT_DATE - 90),
      'trend', (SELECT jsonb_agg(jsonb_build_object('month', to_char(m, 'YYYY-MM'), 'label', to_char(m, 'Mon'),
                  'ordered', COALESCE((SELECT round(sum(total_amount), 2) FROM po WHERE date_trunc('month', d) = m), 0)) ORDER BY m)
                FROM generate_series(_m0 - interval '5 months', _m0, interval '1 month') m),
      'top_suppliers', COALESCE((SELECT jsonb_agg(x ORDER BY (x->>'ordered')::numeric DESC) FROM (
          SELECT jsonb_build_object('supplier', COALESCE(ps.supplier_name, '(unknown)'), 'ordered', round(sum(po.total_amount), 2), 'orders', count(*)) x
            FROM po LEFT JOIN procurement_suppliers ps ON ps.id = po.supplier_id WHERE po.d >= CURRENT_DATE - 90
           GROUP BY ps.supplier_name ORDER BY sum(po.total_amount) DESC LIMIT 5) q), '[]'),
      'total_90d', COALESCE((SELECT round(sum(total_amount), 2) FROM po WHERE d >= CURRENT_DATE - 90), 0),
      'pipeline_30d', jsonb_build_object(
        'requested', (SELECT count(*) FROM purchase_requisitions WHERE site_id = ANY(_s) AND NOT COALESCE(is_archived, false) AND created_at >= CURRENT_DATE - 30 AND status <> 'draft'),
        'approved',  (SELECT count(*) FROM purchase_requisitions WHERE site_id = ANY(_s) AND NOT COALESCE(is_archived, false) AND approved_at >= CURRENT_DATE - 30),
        'ordered',   (SELECT count(*) FROM po WHERE d >= CURRENT_DATE - 30 AND status <> 'pending_approval'),
        'received',  (SELECT count(*) FROM goods_received_notes WHERE site_id = ANY(_s) AND received_date >= CURRENT_DATE - 30),
        'billed',    (SELECT count(*) FROM purchase_invoices WHERE site_id = ANY(_s) AND invoice_date >= CURRENT_DATE - 30 AND status IN ('approved','paid')),
        'paid',      (SELECT count(*) FROM purchase_invoices WHERE site_id = ANY(_s) AND paid_at >= CURRENT_DATE - 30 AND status = 'paid'))));
END $$;
REVOKE ALL ON FUNCTION proc_home_insights(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION proc_home_insights(uuid[]) TO authenticated;
INSERT INTO schema_migrations (filename) VALUES ('0225_proc_home_insights.sql') ON CONFLICT DO NOTHING;
