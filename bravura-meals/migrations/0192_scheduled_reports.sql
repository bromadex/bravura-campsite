-- 0192: Scheduled report emails
--   * users subscribe to reports (daily / weekly / monthly, at a local hour) for a site they have access to
--   * report_build() assembles each report server-side from live data (also used for in-app preview)
--   * pg_cron calls the scheduled-reports edge function hourly (via pg_net) with a private token;
--     the function emails due reports through Resend and leaves an in-app notification copy

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION _user_has_permission(p_user UUID, p_code TEXT, p_site_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id
                  WHERE ur.user_id = p_user AND p.code = p_code AND (ur.site_id IS NULL OR ur.site_id = p_site_id))
$$;
CREATE OR REPLACE FUNCTION _user_on_site(p_user UUID, p_site_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = p_user AND (ur.site_id IS NULL OR ur.site_id = p_site_id))
$$;

-- Report catalogue: code, title, what it covers, permission needed (NULL = anyone with a role at the site), default frequency.
CREATE OR REPLACE FUNCTION report_catalog()
RETURNS TABLE (code TEXT, title TEXT, description TEXT, permission TEXT, default_frequency TEXT)
LANGUAGE sql IMMUTABLE AS $$
  VALUES
    ('ops_daily',          'Site daily summary',      'Yesterday''s fuel and meals, who''s on site and on leave, open work orders, overdue services, incidents, pending approvals, low and expiring stock.', NULL, 'daily'),
    ('fleet_weekly',       'Fleet weekly',            'Availability and downtime for the last 7 days, worst assets, services overdue or due soon.', 'fleet.view', 'weekly'),
    ('procurement_weekly', 'Procurement weekly',      'Orders sent this week, what we owe suppliers by age, budgets nearly or already used up.', 'procurement.view', 'weekly'),
    ('hr_weekly',          'People weekly',           'Headcount, leave in the coming week, timesheets and requests waiting for a decision.', 'hr.view', 'weekly'),
    ('finance_monthly',    'Finance monthly',         'Last month''s costs by cost centre, depreciation posted, and any postings that were skipped.', 'FI01', 'monthly')
$$;

CREATE TABLE IF NOT EXISTS report_subscriptions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES profiles(id),
  site_id      UUID NOT NULL REFERENCES sites(id),
  report_code  TEXT NOT NULL,
  frequency    TEXT NOT NULL CHECK (frequency IN ('daily','weekly','monthly')),
  weekday      INT  NOT NULL DEFAULT 1 CHECK (weekday BETWEEN 1 AND 7),     -- ISO: 1 = Monday
  hour_local   INT  NOT NULL DEFAULT 6 CHECK (hour_local BETWEEN 0 AND 23),  -- Africa/Harare
  is_active    BOOLEAN NOT NULL DEFAULT true,
  last_sent_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, site_id, report_code)
);
ALTER TABLE report_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rs_own ON report_subscriptions;
CREATE POLICY rs_own ON report_subscriptions FOR ALL USING (user_id = auth.uid()) WITH CHECK (
  user_id = auth.uid() AND _user_on_site(auth.uid(), site_id)
  AND COALESCE((SELECT permission FROM report_catalog() c WHERE c.code = report_code) IS NULL
               OR _has_permission((SELECT permission FROM report_catalog() c WHERE c.code = report_code), site_id), false)
  AND report_code IN (SELECT code FROM report_catalog()));

-- ── Report builder ───────────────────────────────────────────────────
-- Returns {title, site, period, sections: [{heading, items: [{label, value, tone}], rows?: [[...]], columns?: [...]}]}
CREATE OR REPLACE FUNCTION _report_item(p_label TEXT, p_value TEXT, p_tone TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$ SELECT jsonb_build_object('label', p_label, 'value', p_value, 'tone', p_tone) $$;

CREATE OR REPLACE FUNCTION _report_money(n NUMERIC) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT '$' || to_char(COALESCE(n, 0), 'FM999,999,999,990.00') $$;

CREATE OR REPLACE FUNCTION report_build(p_code TEXT, p_site_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _site TEXT; _today DATE := (now() AT TIME ZONE 'Africa/Harare')::date; _y DATE := _today - 1;
  _s JSONB := '[]'; _items JSONB; _rows JSONB; _n NUMERIC; _m NUMERIC; _t TEXT; _title TEXT; _period TEXT;
  _mfrom DATE := date_trunc('month', _today - INTERVAL '1 month')::date; _mto DATE := (date_trunc('month', _today) - INTERVAL '1 day')::date;
BEGIN
  SELECT name INTO _site FROM sites WHERE id = p_site_id;
  SELECT title INTO _title FROM report_catalog() WHERE code = p_code;
  IF _title IS NULL THEN RAISE EXCEPTION 'Unknown report'; END IF;

  IF p_code = 'ops_daily' THEN
    _period := to_char(_y, 'Dy DD Mon YYYY');
    _items := '[]';
    SELECT COALESCE(SUM(litres), 0), COALESCE(SUM(total_cost), 0) INTO _n, _m FROM fuel_transactions
     WHERE site_id = p_site_id AND transaction_date::date = _y AND transaction_type ILIKE '%issue%' AND NOT COALESCE(is_deleted, false);
    _items := _items || _report_item('Fuel issued', to_char(_n, 'FM999,999,990') || ' L' || CASE WHEN _m > 0 THEN ' · ' || _report_money(_m) ELSE '' END);
    SELECT COUNT(*) FILTER (WHERE had_breakfast) + COUNT(*) FILTER (WHERE had_lunch) + COUNT(*) FILTER (WHERE had_supper) INTO _n
      FROM meal_logs m JOIN employees e ON e.id = m.employee_id WHERE e.site_id = p_site_id AND m.date = _y;
    _items := _items || _report_item('Meals served', _n::text);
    _s := _s || jsonb_build_object('heading', 'Yesterday', 'items', _items);

    _items := '[]';
    SELECT COUNT(*) INTO _n FROM attendance_logs WHERE site_id = p_site_id AND date = _today AND clock_in IS NOT NULL;
    _items := _items || _report_item('Clocked in so far today', _n::text);
    SELECT COUNT(*) INTO _n FROM leave_requests WHERE site_id = p_site_id AND status = 'approved' AND _today BETWEEN start_date AND end_date;
    _items := _items || _report_item('On leave today', _n::text);
    SELECT COUNT(*) INTO _n FROM approval_requests WHERE site_id = p_site_id AND status = 'pending';
    _items := _items || _report_item('Approvals waiting', _n::text, CASE WHEN _n > 0 THEN 'warn' END);
    _s := _s || jsonb_build_object('heading', 'People & approvals', 'items', _items);

    _items := '[]';
    SELECT COUNT(*) INTO _n FROM fleet_work_orders WHERE site_id = p_site_id AND COALESCE(status, '') NOT IN ('completed','cancelled','closed');
    _items := _items || _report_item('Open work orders', _n::text);
    SELECT COUNT(*) INTO _n FROM _fleet_pm_due_core(p_site_id) WHERE state = 'overdue';
    _items := _items || _report_item('Services overdue', _n::text, CASE WHEN _n > 0 THEN 'bad' END);
    SELECT COUNT(*) INTO _n FROM fleet_assets WHERE site_id = p_site_id AND status IN ('grounded','awaiting_parts') AND NOT COALESCE(is_archived, false);
    _items := _items || _report_item('Assets grounded / awaiting parts', _n::text, CASE WHEN _n > 0 THEN 'warn' END);
    SELECT COUNT(*) INTO _n FROM sheq_incidents WHERE site_id = p_site_id AND created_at >= now() - INTERVAL '24 hours' AND NOT COALESCE(is_archived, false);
    _items := _items || _report_item('Incidents reported (24 h)', _n::text, CASE WHEN _n > 0 THEN 'bad' END);
    _s := _s || jsonb_build_object('heading', 'Operations & safety', 'items', _items);

    _items := '[]';
    SELECT COUNT(*) INTO _n FROM _inv_reorder_core(p_site_id);
    _items := _items || _report_item('Items at reorder level', _n::text, CASE WHEN _n > 0 THEN 'warn' END);
    SELECT COUNT(*) INTO _n FROM inventory_batches b JOIN warehouses w ON w.id = b.warehouse_id
     WHERE w.site_id = p_site_id AND b.qty_remaining > 0 AND b.expiry_date IS NOT NULL AND b.expiry_date <= _today + 30;
    _items := _items || _report_item('Batches expired or expiring in 30 days', _n::text, CASE WHEN _n > 0 THEN 'warn' END);
    _s := _s || jsonb_build_object('heading', 'Stores', 'items', _items);

  ELSIF p_code = 'fleet_weekly' THEN
    _period := to_char(_today - 7, 'DD Mon') || ' – ' || to_char(_y, 'DD Mon YYYY');
    SELECT ROUND(AVG(COALESCE(availability_pct, 100)), 1), SUM(hours_down) INTO _n, _m FROM fleet_downtime_core(p_site_id, _today - 7, _y);
    _s := _s || jsonb_build_object('heading', 'Last 7 days', 'items', jsonb_build_array(
      _report_item('Fleet availability', COALESCE(_n, 100) || '%', CASE WHEN _n < 85 THEN 'bad' WHEN _n < 95 THEN 'warn' END),
      _report_item('Hours down', to_char(COALESCE(_m, 0), 'FM999,990'))));
    SELECT COALESCE(jsonb_agg(jsonb_build_array(asset_label, hours_down || ' h', COALESCE(availability_pct, 100) || '%', failures)), '[]') INTO _rows
      FROM (SELECT * FROM fleet_downtime_core(p_site_id, _today - 7, _y) WHERE hours_down > 0 ORDER BY hours_down DESC LIMIT 5) x;
    _s := _s || jsonb_build_object('heading', 'Most downtime', 'columns', jsonb_build_array('Asset', 'Down', 'Availability', 'Breakdowns'), 'rows', _rows);
    SELECT COALESCE(jsonb_agg(jsonb_build_array(asset_label, plan_name, CASE state WHEN 'overdue' THEN 'Overdue' ELSE 'Due soon' END, COALESCE(open_wo_number, '—'))), '[]') INTO _rows
      FROM (SELECT * FROM _fleet_pm_due_core(p_site_id) WHERE state <> 'ok' LIMIT 20) x;
    _s := _s || jsonb_build_object('heading', 'Services due', 'columns', jsonb_build_array('Asset', 'Service', 'Status', 'Work order'), 'rows', _rows);

  ELSIF p_code = 'procurement_weekly' THEN
    _period := to_char(_today - 7, 'DD Mon') || ' – ' || to_char(_y, 'DD Mon YYYY');
    SELECT COUNT(*), COALESCE(SUM(total_amount), 0) INTO _n, _m FROM purchase_orders
     WHERE site_id = p_site_id AND status NOT IN ('draft','cancelled') AND COALESCE(order_date, created_at::date) BETWEEN _today - 7 AND _y;
    _items := jsonb_build_array(_report_item('Orders sent this week', _n || ' · ' || _report_money(_m)));
    SELECT SUM(COALESCE(d1_30,0)+COALESCE(d31_60,0)+COALESCE(d61_90,0)+COALESCE(d90_plus,0)), SUM(COALESCE(d90_plus,0)) INTO _n, _m FROM proc_supplier_aging_core(p_site_id);
    _items := _items || _report_item('Owed to suppliers, overdue', _report_money(_n), CASE WHEN _n > 0 THEN 'warn' END)
                     || _report_item('Overdue more than 90 days', _report_money(_m), CASE WHEN _m > 0 THEN 'bad' END);
    _s := _s || jsonb_build_object('heading', 'This week', 'items', _items);
    SELECT COALESCE(jsonb_agg(jsonb_build_array(COALESCE(cc.name, pj.name), _report_money(b.amount), _report_money(s.used),
             ROUND(100 * s.used / NULLIF(b.amount, 0)) || '%')), '[]') INTO _rows
      FROM procurement_budgets b LEFT JOIN cost_centres cc ON cc.id = b.cost_centre_id LEFT JOIN projects pj ON pj.id = b.project_id
      CROSS JOIN LATERAL (SELECT COALESCE(SUM(po.total_amount), 0) used FROM purchase_orders po WHERE po.site_id = b.site_id
          AND po.status NOT IN ('draft','cancelled') AND EXTRACT(YEAR FROM COALESCE(po.order_date, po.created_at::date)) = b.fiscal_year
          AND ((b.cost_centre_id IS NOT NULL AND po.cost_centre_id = b.cost_centre_id) OR (b.project_id IS NOT NULL AND po.project_id = b.project_id))) s
     WHERE b.site_id = p_site_id AND b.fiscal_year = EXTRACT(YEAR FROM _today) AND NOT b.is_archived AND s.used >= b.amount * 0.85;
    _s := _s || jsonb_build_object('heading', 'Budgets 85% or more used', 'columns', jsonb_build_array('Budget', 'Amount', 'Committed', 'Used'), 'rows', _rows);

  ELSIF p_code = 'hr_weekly' THEN
    _period := 'Week of ' || to_char(_today, 'DD Mon YYYY');
    SELECT COUNT(*) INTO _n FROM employees WHERE site_id = p_site_id AND status = 'active';
    _items := jsonb_build_array(_report_item('Active employees', _n::text));
    SELECT COUNT(*) INTO _n FROM attendance_logs a JOIN employees e ON e.id = a.employee_id
     WHERE e.site_id = p_site_id AND a.approval_status = 'pending' AND a.clock_out IS NOT NULL;
    _items := _items || _report_item('Timesheets waiting for supervisors', _n::text, CASE WHEN _n > 0 THEN 'warn' END);
    SELECT COUNT(*) INTO _n FROM leave_requests WHERE site_id = p_site_id AND status = 'pending';
    _items := _items || _report_item('Leave requests waiting', _n::text, CASE WHEN _n > 0 THEN 'warn' END);
    SELECT COUNT(*) INTO _n FROM employee_change_requests WHERE site_id = p_site_id AND status = 'pending';
    _items := _items || _report_item('Detail changes to verify', _n::text, CASE WHEN _n > 0 THEN 'warn' END);
    SELECT COUNT(*) INTO _n FROM salary_advances WHERE site_id = p_site_id AND status IN ('submitted','approved');
    _items := _items || _report_item('Advances to approve or pay', _n::text);
    _s := _s || jsonb_build_object('heading', 'Now', 'items', _items);
    SELECT COALESCE(jsonb_agg(jsonb_build_array(e.name, lt.name, to_char(r.start_date, 'DD Mon') || ' – ' || to_char(r.end_date, 'DD Mon'))), '[]') INTO _rows
      FROM leave_requests r JOIN employees e ON e.id = r.employee_id LEFT JOIN leave_types lt ON lt.id = r.leave_type_id
     WHERE r.site_id = p_site_id AND r.status = 'approved' AND r.start_date <= _today + 7 AND r.end_date >= _today;
    _s := _s || jsonb_build_object('heading', 'On leave in the next 7 days', 'columns', jsonb_build_array('Employee', 'Type', 'Dates'), 'rows', _rows);

  ELSIF p_code = 'finance_monthly' THEN
    _period := to_char(_mfrom, 'FMMonth YYYY');
    SELECT COALESCE(jsonb_agg(jsonb_build_array(COALESCE(nm, 'Not tagged'), _report_money(amt)) ORDER BY amt DESC), '[]') INTO _rows FROM (
      SELECT cc.name nm, SUM(l.debit - l.credit) amt FROM journal_lines l JOIN journal_entries je ON je.id = l.journal_id JOIN accounts a ON a.id = l.account_id
        LEFT JOIN cost_centres cc ON cc.id = l.cost_centre_id
       WHERE je.site_id = p_site_id AND je.status = 'posted' AND a.account_type = 'Expense' AND je.entry_date BETWEEN _mfrom AND _mto
       GROUP BY cc.name ORDER BY 2 DESC LIMIT 12) x;
    _s := _s || jsonb_build_object('heading', 'Costs by cost centre', 'columns', jsonb_build_array('Cost centre', 'Cost'), 'rows', _rows);
    SELECT COALESCE(SUM(amount), 0) INTO _n FROM asset_depreciation WHERE site_id = p_site_id AND period = _mfrom;
    SELECT COUNT(*) INTO _m FROM gl_posting_log WHERE site_id = p_site_id AND status = 'skipped' AND entry_date BETWEEN _mfrom AND _mto AND amount > 0;
    _s := _s || jsonb_build_object('heading', 'Ledger', 'items', jsonb_build_array(
      _report_item('Depreciation posted', _report_money(_n)),
      _report_item('Postings skipped (no rule set up)', _m::text, CASE WHEN _m > 0 THEN 'warn' END)));
  END IF;

  RETURN jsonb_build_object('title', _title, 'site', _site, 'period', _period, 'sections', _s);
END;
$$;

-- In-app preview for someone allowed to receive it.
CREATE OR REPLACE FUNCTION report_preview(p_code TEXT, p_site_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _perm TEXT;
BEGIN
  SELECT permission INTO _perm FROM report_catalog() WHERE code = p_code;
  IF NOT _user_on_site(auth.uid(), p_site_id) OR (_perm IS NOT NULL AND NOT _has_permission(_perm, p_site_id)) THEN
    RAISE EXCEPTION 'You do not have access to this report';
  END IF;
  RETURN report_build(p_code, p_site_id);
END;
$$;

-- Subscriptions due now (Africa/Harare), still permitted, with the recipient's email.
CREATE OR REPLACE FUNCTION report_due_subscriptions()
RETURNS TABLE (id UUID, user_id UUID, email TEXT, full_name TEXT, site_id UUID, report_code TEXT, frequency TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH nowl AS (SELECT (now() AT TIME ZONE 'Africa/Harare') t)
  SELECT s.id, s.user_id, u.email::text, p.full_name, s.site_id, s.report_code, s.frequency
    FROM report_subscriptions s JOIN profiles p ON p.id = s.user_id JOIN auth.users u ON u.id = s.user_id, nowl
   WHERE s.is_active AND u.email IS NOT NULL
     AND EXTRACT(HOUR FROM nowl.t) >= s.hour_local
     AND (s.last_sent_at IS NULL OR (s.last_sent_at AT TIME ZONE 'Africa/Harare')::date < nowl.t::date)
     AND CASE s.frequency
           WHEN 'daily'   THEN true
           WHEN 'weekly'  THEN EXTRACT(ISODOW FROM nowl.t) = s.weekday
           WHEN 'monthly' THEN EXTRACT(DAY FROM nowl.t) = 1
         END
     AND _user_on_site(s.user_id, s.site_id)
     AND COALESCE((SELECT c.permission FROM report_catalog() c WHERE c.code = s.report_code) IS NULL
                  OR _user_has_permission(s.user_id, (SELECT c.permission FROM report_catalog() c WHERE c.code = s.report_code), s.site_id), false)
$$;

CREATE OR REPLACE FUNCTION report_mark_sent(p_id UUID, p_title TEXT, p_link TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _s report_subscriptions%ROWTYPE;
BEGIN
  UPDATE report_subscriptions SET last_sent_at = now() WHERE id = p_id RETURNING * INTO _s;
  INSERT INTO notifications (site_id, user_id, type, title, message, link, category)
  VALUES (_s.site_id, _s.user_id, 'scheduled_report', p_title, 'Your scheduled report was emailed to you.', p_link, 'general');
END;
$$;

-- Split the RPCs used by reports into permission-free cores (the public versions keep their checks).
CREATE OR REPLACE FUNCTION fleet_downtime_core(p_site_id UUID, p_from DATE, p_to DATE)
RETURNS TABLE (asset_id UUID, asset_label TEXT, status_now TEXT, hours_down NUMERIC, hours_maintenance NUMERIC, hours_grounded NUMERIC,
               hours_awaiting_parts NUMERIC, failures BIGINT, mttr_hours NUMERIC, mtbf_hours NUMERIC, availability_pct NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _t0 TIMESTAMPTZ := p_from::timestamptz; _t1 TIMESTAMPTZ := LEAST((p_to + 1)::timestamptz, now());
BEGIN
  RETURN QUERY
  WITH a AS (
    SELECT fa.id, TRIM(CONCAT_WS(' ', COALESCE(fa.fleet_number, fa.asset_number), fa.make, fa.model)) lbl, fa.status
      FROM fleet_assets fa WHERE fa.site_id = p_site_id AND NOT COALESCE(fa.is_archived, false) AND COALESCE(fa.status, '') <> 'decommissioned'
  ), ev AS (
    SELECT a.id aid, _t0 t,
           COALESCE((SELECT h.new_status FROM fleet_status_history h WHERE h.asset_id = a.id AND h.created_at <= _t0 ORDER BY h.created_at DESC LIMIT 1),
                    (SELECT h.old_status FROM fleet_status_history h WHERE h.asset_id = a.id AND h.created_at > _t0 ORDER BY h.created_at LIMIT 1),
                    a.status) st
      FROM a
    UNION ALL
    SELECT h.asset_id, h.created_at, h.new_status FROM fleet_status_history h JOIN a ON a.id = h.asset_id
     WHERE h.created_at > _t0 AND h.created_at < _t1
  ), seg AS (
    SELECT aid, st, t, LEAD(t, 1, _t1) OVER (PARTITION BY aid ORDER BY t) t_end, LAG(st) OVER (PARTITION BY aid ORDER BY t) prev_st FROM ev
  ), agg AS (
    SELECT aid,
           SUM(EXTRACT(EPOCH FROM (t_end - t)) / 3600) FILTER (WHERE st IN ('maintenance','grounded','awaiting_parts')) down_h,
           SUM(EXTRACT(EPOCH FROM (t_end - t)) / 3600) FILTER (WHERE st = 'maintenance') m_h,
           SUM(EXTRACT(EPOCH FROM (t_end - t)) / 3600) FILTER (WHERE st = 'grounded') g_h,
           SUM(EXTRACT(EPOCH FROM (t_end - t)) / 3600) FILTER (WHERE st = 'awaiting_parts') p_h,
           SUM(EXTRACT(EPOCH FROM (t_end - t)) / 3600) total_h,
           COUNT(*) FILTER (WHERE st IN ('grounded','maintenance','awaiting_parts') AND COALESCE(prev_st, 'x') NOT IN ('grounded','maintenance','awaiting_parts') AND t > _t0) fails
      FROM seg GROUP BY aid
  )
  SELECT a.id, a.lbl, a.status,
         ROUND(COALESCE(g.down_h, 0)::numeric, 1), ROUND(COALESCE(g.m_h, 0)::numeric, 1), ROUND(COALESCE(g.g_h, 0)::numeric, 1), ROUND(COALESCE(g.p_h, 0)::numeric, 1),
         COALESCE(g.fails, 0),
         CASE WHEN g.fails > 0 THEN ROUND((g.down_h / g.fails)::numeric, 1) END,
         CASE WHEN g.fails > 0 THEN ROUND(((g.total_h - COALESCE(g.down_h, 0)) / g.fails)::numeric, 1) END,
         CASE WHEN g.total_h > 0 THEN ROUND((100 * (g.total_h - COALESCE(g.down_h, 0)) / g.total_h)::numeric, 1) END
    FROM a LEFT JOIN agg g ON g.aid = a.id
   ORDER BY COALESCE(g.down_h, 0) DESC, a.lbl;
END;
$$;
CREATE OR REPLACE FUNCTION fleet_downtime(p_site_id UUID, p_from DATE, p_to DATE)
RETURNS TABLE (asset_id UUID, asset_label TEXT, status_now TEXT, hours_down NUMERIC, hours_maintenance NUMERIC, hours_grounded NUMERIC,
               hours_awaiting_parts NUMERIC, failures BIGINT, mttr_hours NUMERIC, mtbf_hours NUMERIC, availability_pct NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT _has_permission('fleet.view', p_site_id) THEN RAISE EXCEPTION 'No access'; END IF;
  RETURN QUERY SELECT * FROM fleet_downtime_core(p_site_id, p_from, p_to);
END;
$$;

CREATE OR REPLACE FUNCTION proc_supplier_aging_core(p_site_id UUID)
RETURNS TABLE (supplier_id UUID, supplier_name TEXT, invoices BIGINT, not_due NUMERIC, d1_30 NUMERIC, d31_60 NUMERIC,
               d61_90 NUMERIC, d90_plus NUMERIC, total NUMERIC, oldest_due DATE)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, s.supplier_name, COUNT(*),
         SUM(i.total_amount) FILTER (WHERE COALESCE(i.due_date, i.invoice_date) >= CURRENT_DATE),
         SUM(i.total_amount) FILTER (WHERE CURRENT_DATE - COALESCE(i.due_date, i.invoice_date) BETWEEN 1 AND 30),
         SUM(i.total_amount) FILTER (WHERE CURRENT_DATE - COALESCE(i.due_date, i.invoice_date) BETWEEN 31 AND 60),
         SUM(i.total_amount) FILTER (WHERE CURRENT_DATE - COALESCE(i.due_date, i.invoice_date) BETWEEN 61 AND 90),
         SUM(i.total_amount) FILTER (WHERE CURRENT_DATE - COALESCE(i.due_date, i.invoice_date) > 90),
         SUM(i.total_amount), MIN(COALESCE(i.due_date, i.invoice_date))
    FROM purchase_invoices i JOIN procurement_suppliers s ON s.id = i.supplier_id
   WHERE i.site_id = p_site_id AND i.status IN ('pending_approval','approved')
   GROUP BY s.id, s.supplier_name ORDER BY SUM(i.total_amount) DESC
$$;
CREATE OR REPLACE FUNCTION proc_supplier_aging(p_site_id UUID)
RETURNS TABLE (supplier_id UUID, supplier_name TEXT, invoices BIGINT, not_due NUMERIC, d1_30 NUMERIC, d31_60 NUMERIC,
               d61_90 NUMERIC, d90_plus NUMERIC, total NUMERIC, oldest_due DATE)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT _has_permission('procurement.view', p_site_id) THEN RAISE EXCEPTION 'No access'; END IF;
  RETURN QUERY SELECT * FROM proc_supplier_aging_core(p_site_id);
END;
$$;

-- ── Cron: call the edge function hourly with a private token ─────────
CREATE TABLE IF NOT EXISTS report_cron_token (id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1), token TEXT NOT NULL);
ALTER TABLE report_cron_token ENABLE ROW LEVEL SECURITY;   -- no policies: only the service role / definer functions read it
INSERT INTO report_cron_token (id, token) VALUES (1, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')) ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION report_cron_tick() RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _tok TEXT;
BEGIN
  SELECT token INTO _tok FROM report_cron_token WHERE id = 1;
  PERFORM net.http_post(
    url := 'https://ybhvbvrxuzrwmozmsfic.supabase.co/functions/v1/scheduled-reports',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-token', _tok),
    body := '{}'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION report_cron_tick() FROM PUBLIC, anon, authenticated;

DO $$ BEGIN
  PERFORM cron.unschedule('scheduled-reports') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'scheduled-reports');
  PERFORM cron.schedule('scheduled-reports', '5 * * * *', 'SELECT public.report_cron_tick()');
END $$;

REVOKE ALL ON FUNCTION report_build(TEXT, UUID), report_due_subscriptions(), report_mark_sent(UUID, TEXT, TEXT),
  _user_has_permission(UUID, TEXT, UUID), fleet_downtime_core(UUID, DATE, DATE), proc_supplier_aging_core(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION report_build(TEXT, UUID), report_due_subscriptions(), report_mark_sent(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION report_preview(TEXT, UUID), report_catalog() TO authenticated;

INSERT INTO schema_migrations (filename) VALUES ('0192_scheduled_reports.sql') ON CONFLICT DO NOTHING;
