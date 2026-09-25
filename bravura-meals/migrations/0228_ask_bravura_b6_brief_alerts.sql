-- 0228 — Ask Bravura B6 (issue #58): daily brief + alerts.
-- _ai_alerts_core(sites) finds things worth a look; ai_alerts() shows them to a person for the sites and modules
-- they can see; ai_daily_brief() is the "your day" summary; ai_alerts_notify() (pg_cron, daily) notifies the
-- people responsible, once per alert (ai_alert_log).

CREATE TABLE IF NOT EXISTS public.ai_alert_log (
  key text PRIMARY KEY,
  site_id uuid, kind text, title text,
  notified_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE ai_alert_log ENABLE ROW LEVEL SECURITY;   -- written only by the cron function; no client policies

CREATE OR REPLACE FUNCTION public._ai_alerts_core(p_sites uuid[])
RETURNS TABLE (key text, site_id uuid, kind text, perm text, severity text, title text, detail text, link text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  -- Unusual fuel draw: an issue in the last 7 days over twice that machine's usual issue (60 days before), at least 50 L.
  SELECT 'fuel:' || ft.id, ft.site_id, 'fuel_draw', 'fuel.view', 'warning',
         'Unusual fuel draw: ' || COALESCE(fa.fleet_number, fa.registration, ft.asset_description, 'unknown'),
         round(ft.litres) || ' L on ' || to_char(ft.transaction_date, 'DD Mon') || ' — usually about ' || round(h.avg_l) || ' L (' || COALESCE(ft.transaction_number, '') || ')',
         '/fuel/fuel_transactions'
    FROM fuel_transactions ft
    JOIN fleet_assets fa ON fa.id = ft.fleet_asset_id
    JOIN LATERAL (SELECT avg(x.litres) avg_l, count(*) n FROM fuel_transactions x
                   WHERE x.fleet_asset_id = ft.fleet_asset_id AND x.transaction_type = 'issuance' AND NOT COALESCE(x.is_deleted, false)
                     AND x.transaction_date BETWEEN ft.transaction_date - 60 AND ft.transaction_date - 1) h ON h.n >= 3
   WHERE ft.site_id = ANY(p_sites) AND ft.transaction_type = 'issuance' AND NOT COALESCE(ft.is_deleted, false)
     AND ft.transaction_date >= CURRENT_DATE - 7 AND ft.litres >= 50 AND ft.litres > 2 * h.avg_l
  UNION ALL
  -- Supplier price jump: an item ordered in the last 30 days at more than 20% above its previous order price.
  SELECT 'price:' || pl.id, po.site_id, 'price_jump', 'procurement.view', 'warning',
         'Price up ' || round((pl.unit_cost / prev.unit_cost - 1) * 100) || '%: ' || i.description,
         ps.supplier_name || ' on ' || po.po_number || ' at $' || to_char(pl.unit_cost, 'FM999,999,990.00') || ' — last paid $' || to_char(prev.unit_cost, 'FM999,999,990.00'),
         '/procurement/proc_orders:' || po.id
    FROM po_lines pl JOIN purchase_orders po ON po.id = pl.po_id JOIN items i ON i.id = pl.item_id
    LEFT JOIN procurement_suppliers ps ON ps.id = po.supplier_id
    JOIN LATERAL (SELECT pl2.unit_cost FROM po_lines pl2 JOIN purchase_orders po2 ON po2.id = pl2.po_id
                   WHERE pl2.item_id = pl.item_id AND pl2.id <> pl.id AND NOT pl2.is_archived AND pl2.unit_cost > 0
                     AND po2.status IN ('sent','partially_received','received') AND po2.created_at < po.created_at
                   ORDER BY po2.created_at DESC LIMIT 1) prev ON true
   WHERE po.site_id = ANY(p_sites) AND NOT pl.is_archived AND po.status NOT IN ('cancelled','rfq','rfq_sent')
     AND po.created_at >= CURRENT_DATE - 30 AND pl.unit_cost > 1.2 * prev.unit_cost
  UNION ALL
  -- Possible duplicate bill: same supplier and same amount within 10 days, or the same invoice number twice.
  SELECT 'dup:' || least(a.id::text, b.id::text) || greatest(a.id::text, b.id::text), a.site_id, 'duplicate_bill', 'finance.view', 'critical',
         'Possible duplicate bill from ' || COALESCE(ps.supplier_name, 'a supplier'),
         a.invoice_number || ' and ' || b.invoice_number || ' — both $' || to_char(a.total_amount, 'FM999,999,990.00'),
         '/finance/fi_pay_suppliers'
    FROM purchase_invoices a JOIN purchase_invoices b ON b.supplier_id = a.supplier_id AND b.id > a.id
     AND (lower(trim(b.invoice_number)) = lower(trim(a.invoice_number))
          OR (b.total_amount = a.total_amount AND abs(b.invoice_date - a.invoice_date) <= 10))
    LEFT JOIN procurement_suppliers ps ON ps.id = a.supplier_id
   WHERE a.site_id = ANY(p_sites) AND a.status <> 'cancelled' AND b.status <> 'cancelled' AND a.created_at >= CURRENT_DATE - 30
  UNION ALL
  -- Bill that doesn't match its order / receipt (three-way match).
  SELECT 'match:' || pi.id, pi.site_id, 'bill_mismatch', 'finance.view', 'warning',
         'Bill doesn''t match its order: ' || pi.invoice_number,
         COALESCE(ps.supplier_name, '') || ' · ' || replace(pi.match_status, '_', ' ') || COALESCE(' · difference $' || to_char(pi.match_diff, 'FM999,999,990.00'), ''),
         '/finance/fi_pay_suppliers'
    FROM purchase_invoices pi LEFT JOIN procurement_suppliers ps ON ps.id = pi.supplier_id
   WHERE pi.site_id = ANY(p_sites) AND pi.status IN ('draft','pending','approved') AND pi.match_status IS NOT NULL
     AND pi.match_status NOT IN ('matched','not_applicable','no_po') AND pi.created_at >= CURRENT_DATE - 30;
$$;
REVOKE ALL ON FUNCTION _ai_alerts_core(uuid[]) FROM PUBLIC, anon, authenticated;

-- Alerts for the person asking: only sites + modules they can see.
CREATE OR REPLACE FUNCTION public.ai_alerts(p_site_ids uuid[] DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('alerts', COALESCE(jsonb_agg(jsonb_build_object('kind', a.kind, 'severity', a.severity, 'title', a.title, 'detail', a.detail,
           'link', a.link, 'site', s.name) ORDER BY (a.severity = 'critical') DESC, a.title), '[]'))
    FROM _ai_alerts_core(ARRAY(SELECT id FROM sites WHERE p_site_ids IS NULL OR cardinality(p_site_ids) = 0 OR id = ANY(p_site_ids))) a
    JOIN sites s ON s.id = a.site_id
   WHERE _has_permission(a.perm, a.site_id);
$$;
GRANT EXECUTE ON FUNCTION ai_alerts(uuid[]) TO authenticated;

-- "Your day": approvals waiting for me, late deliveries, low stock, papers/documents expiring, budgets at risk, alerts.
CREATE OR REPLACE FUNCTION public.ai_daily_brief(p_site_ids uuid[] DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _all uuid[] := ARRAY(SELECT id FROM sites WHERE p_site_ids IS NULL OR cardinality(p_site_ids) = 0 OR id = ANY(p_site_ids));
  _pr uuid[] := _ai_sites_for('procurement.view', _all); _iv uuid[] := _ai_sites_for('inventory.view', _all);
  _fl uuid[] := _ai_sites_for('fleet.view', _all); _ds uuid[] := _ai_sites_for('ds.view', _all); _fi uuid[] := _ai_sites_for('finance.view', _all);
  _budget jsonb := '[]'; _s uuid; _r record;
BEGIN
  FOREACH _s IN ARRAY COALESCE(_fi, '{}') LOOP
    FOR _r IN SELECT b.dim_name, b.month_budget, b.month_actual, b.committed FROM fin_budget_vs_actual(_s, extract(year FROM CURRENT_DATE)::int, extract(month FROM CURRENT_DATE)::int) b
               WHERE b.month_budget > 0 AND (b.month_actual + COALESCE(b.committed, 0)) >= 0.9 * b.month_budget LOOP
      _budget := _budget || jsonb_build_object('site', (SELECT name FROM sites WHERE id = _s), 'budget', _r.dim_name, 'month_budget', _r.month_budget,
                   'used', _r.month_actual + COALESCE(_r.committed, 0), 'pct', round(100 * (_r.month_actual + COALESCE(_r.committed, 0)) / _r.month_budget));
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('date', CURRENT_DATE,
    'approvals', COALESCE((SELECT jsonb_agg(jsonb_build_object('title', a.title, 'site', a.site_name, 'amount', a.amount, 'from', a.requester_name, 'link', a.link,
                    'step', a.step_label, 'since', a.created_at::date) ORDER BY a.created_at) FROM (SELECT * FROM approval_inbox() LIMIT 10) a), '[]'),
    'approvals_total', (SELECT count(*) FROM approval_inbox()),
    'late_deliveries', COALESCE((SELECT jsonb_agg(x) FROM (SELECT jsonb_build_object('po', po.po_number, 'supplier', ps.supplier_name, 'due', po.expected_date, 'id', po.id) x
        FROM purchase_orders po LEFT JOIN procurement_suppliers ps ON ps.id = po.supplier_id
       WHERE po.site_id = ANY(COALESCE(_pr, '{}')) AND po.status IN ('sent','partially_received') AND po.expected_date < CURRENT_DATE ORDER BY po.expected_date LIMIT 8) q), '[]'),
    'low_stock', (SELECT count(*) FROM (SELECT i.id FROM items i JOIN stock_balances b ON b.item_id = i.id JOIN warehouses w ON w.id = b.warehouse_id
        WHERE w.site_id = ANY(COALESCE(_iv, '{}')) AND NOT COALESCE(i.is_archived, false) AND COALESCE(i.reorder_level, 0) > 0
        GROUP BY i.id, i.reorder_level HAVING sum(b.on_hand_qty) <= i.reorder_level) q),
    'expiring', COALESCE((SELECT jsonb_agg(x) FROM (
        SELECT jsonb_build_object('what', COALESCE(fleet_number, registration) || ' ' || k, 'date', d) x FROM fleet_assets,
          LATERAL (VALUES ('licence', licence_expiry), ('insurance', insurance_expiry), ('roadworthy', roadworthy_expiry)) v(k, d)
         WHERE site_id = ANY(COALESCE(_fl, '{}')) AND NOT COALESCE(is_archived, false) AND d BETWEEN CURRENT_DATE - 7 AND CURRENT_DATE + 30
        UNION ALL
        SELECT jsonb_build_object('what', title, 'date', expiry_date) FROM ds_documents
         WHERE site_id = ANY(COALESCE(_ds, '{}')) AND NOT is_archived AND expiry_date BETWEEN CURRENT_DATE - 7 AND CURRENT_DATE + 30
        ORDER BY 1 LIMIT 10) q), '[]'),
    'budgets_at_risk', _budget,
    'alerts', (ai_alerts(p_site_ids))->'alerts',
    'unread_notifications', (SELECT count(*) FROM notifications WHERE user_id = auth.uid() AND NOT is_read AND NOT COALESCE(is_archived, false)));
END $$;
REVOKE ALL ON FUNCTION ai_daily_brief(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION ai_daily_brief(uuid[]) TO authenticated;

-- Daily: notify the people responsible about each new alert once.
CREATE OR REPLACE FUNCTION public.ai_alerts_notify()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _a record; _n int := 0;
BEGIN
  FOR _a IN SELECT * FROM _ai_alerts_core(ARRAY(SELECT id FROM sites)) c WHERE NOT EXISTS (SELECT 1 FROM ai_alert_log l WHERE l.key = c.key) LOOP
    INSERT INTO notifications (site_id, user_id, type, title, message, link, category)
    SELECT _a.site_id, u, 'ai_alert', _a.title, _a.detail, _a.link, 'escalation'
      FROM (SELECT _users_with_permission(replace(_a.perm, '.view', '.edit'), _a.site_id) u) x;
    INSERT INTO ai_alert_log (key, site_id, kind, title) VALUES (_a.key, _a.site_id, _a.kind, _a.title);
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END $$;
REVOKE ALL ON FUNCTION ai_alerts_notify() FROM PUBLIC, anon, authenticated;

SELECT cron.unschedule('ask-bravura-alerts') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ask-bravura-alerts');
SELECT cron.schedule('ask-bravura-alerts', '30 4 * * *', 'SELECT public.ai_alerts_notify()');

INSERT INTO schema_migrations (filename) VALUES ('0228_ask_bravura_b6_brief_alerts.sql') ON CONFLICT DO NOTHING;
