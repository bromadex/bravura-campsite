-- 0207 budgets_and_finance_home — Finance rewrite Phase 4 (issue #49).
-- One budget store: procurement_budgets (yearly per cost centre OR project) gains an optional
-- monthly split (budget_months). Finance can now edit budgets too. Two read-only RPCs feed the
-- new screens, all figures computed server-side:
--   fin_budget_vs_actual(site, year, month)  plan vs actual (ledger) vs committed (POs not yet billed)
--   fin_home(site, month_start)               everything Finance Home shows

-- ── Budgets ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS budget_months (
  budget_id  uuid NOT NULL REFERENCES procurement_budgets(id),
  month      int  NOT NULL CHECK (month BETWEEN 1 AND 12),
  amount     numeric(15,2) NOT NULL CHECK (amount >= 0),
  PRIMARY KEY (budget_id, month)
);
ALTER TABLE budget_months ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bm_select ON budget_months;
CREATE POLICY bm_select ON budget_months FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM procurement_budgets b WHERE b.id = budget_months.budget_id
                 AND (_has_permission('procurement.view', b.site_id) OR _has_permission('finance.view', b.site_id))));
DROP POLICY IF EXISTS bm_write ON budget_months;
CREATE POLICY bm_write ON budget_months FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM procurement_budgets b WHERE b.id = budget_months.budget_id
                 AND (_has_permission('procurement.approve', b.site_id) OR _has_permission('finance.edit', b.site_id))))
  WITH CHECK (EXISTS (SELECT 1 FROM procurement_budgets b WHERE b.id = budget_months.budget_id
                 AND (_has_permission('procurement.approve', b.site_id) OR _has_permission('finance.edit', b.site_id))));

DROP POLICY IF EXISTS pb_select ON procurement_budgets;
CREATE POLICY pb_select ON procurement_budgets FOR SELECT TO authenticated
  USING (_has_permission('procurement.view', site_id) OR _has_permission('finance.view', site_id));
DROP POLICY IF EXISTS pb_write ON procurement_budgets;
CREATE POLICY pb_write ON procurement_budgets FOR ALL TO authenticated
  USING (_has_permission('procurement.approve', site_id) OR _has_permission('finance.edit', site_id))
  WITH CHECK (_has_permission('procurement.approve', site_id) OR _has_permission('finance.edit', site_id));

-- A budget's months follow its explicit split when monthly_split is on, else an even twelfth.
ALTER TABLE procurement_budgets ADD COLUMN IF NOT EXISTS monthly_split boolean NOT NULL DEFAULT false;
CREATE OR REPLACE FUNCTION _budget_month_amount(p_budget uuid, p_month int) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN b.monthly_split
              THEN COALESCE((SELECT amount FROM budget_months WHERE budget_id = b.id AND month = p_month), 0)
              ELSE round(b.amount / 12, 2) END
    FROM procurement_budgets b WHERE b.id = p_budget;
$$;

-- Actual cost on posted journals (expense accounts) for a cost centre or project in a date range.
CREATE OR REPLACE FUNCTION _ledger_cost(p_site uuid, p_cc uuid, p_project uuid, p_from date, p_to date) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(sum(jl.debit - jl.credit), 0)
    FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_id JOIN accounts a ON a.id = jl.account_id
   WHERE je.site_id = p_site AND je.status = 'posted' AND a.account_type = 'Expense'
     AND je.entry_date BETWEEN p_from AND p_to
     AND ((p_cc IS NOT NULL AND jl.cost_centre_id = p_cc) OR (p_project IS NOT NULL AND jl.project_id = p_project));
$$;

-- Committed = approved/sent POs (in the year) not yet covered by an approved or paid bill.
CREATE OR REPLACE FUNCTION _po_committed(p_site uuid, p_cc uuid, p_project uuid, p_year int) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(sum(GREATEST(po.total_amount - COALESCE(billed.amt, 0), 0)), 0)
    FROM purchase_orders po
    LEFT JOIN LATERAL (SELECT sum(i.total_amount) amt FROM purchase_invoices i
                        WHERE i.po_id = po.id AND i.status IN ('approved','paid')) billed ON true
   WHERE po.site_id = p_site AND po.status IN ('sent','partially_received','received')
     AND EXTRACT(YEAR FROM COALESCE(po.order_date, po.created_at::date)) = p_year
     AND ((p_cc IS NOT NULL AND po.cost_centre_id = p_cc) OR (p_project IS NOT NULL AND po.project_id = p_project));
$$;

CREATE OR REPLACE FUNCTION fin_budget_vs_actual(p_site uuid, p_year int, p_month int)
RETURNS TABLE (budget_id uuid, kind text, dim_id uuid, dim_code text, dim_name text,
               year_budget numeric, month_budget numeric, ytd_budget numeric,
               month_actual numeric, ytd_actual numeric, committed numeric, remaining_year numeric, has_split boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _m1 date := make_date(p_year, p_month, 1); _m2 date := (make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date;
        _y1 date := make_date(p_year, 1, 1);
BEGIN
  IF NOT (_has_permission('finance.view', p_site) OR _has_permission('procurement.view', p_site)) THEN RAISE EXCEPTION 'No access'; END IF;
  RETURN QUERY
  SELECT b.id,
         CASE WHEN b.cost_centre_id IS NOT NULL THEN 'cost_centre' ELSE 'project' END,
         COALESCE(b.cost_centre_id, b.project_id),
         COALESCE(cc.code, pj.project_code), COALESCE(cc.name, pj.name),
         b.amount,
         _budget_month_amount(b.id, p_month),
         (SELECT sum(_budget_month_amount(b.id, m)) FROM generate_series(1, p_month) m),
         _ledger_cost(p_site, b.cost_centre_id, b.project_id, _m1, _m2),
         _ledger_cost(p_site, b.cost_centre_id, b.project_id, _y1, _m2),
         _po_committed(p_site, b.cost_centre_id, b.project_id, p_year),
         b.amount - _ledger_cost(p_site, b.cost_centre_id, b.project_id, _y1, make_date(p_year, 12, 31))
                  - _po_committed(p_site, b.cost_centre_id, b.project_id, p_year),
         b.monthly_split
    FROM procurement_budgets b
    LEFT JOIN cost_centres cc ON cc.id = b.cost_centre_id
    LEFT JOIN projects pj ON pj.id = b.project_id
   WHERE b.site_id = p_site AND b.fiscal_year = p_year AND NOT b.is_archived
   ORDER BY 2, 4, 5;
END $$;

-- ── Finance Home ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fin_home(p_site uuid, p_month date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _m1 date := date_trunc('month', COALESCE(p_month, CURRENT_DATE))::date;
  _m2 date := (date_trunc('month', COALESCE(p_month, CURRENT_DATE)) + interval '1 month - 1 day')::date;
  _yr int := EXTRACT(YEAR FROM COALESCE(p_month, CURRENT_DATE))::int;
  _mo int := EXTRACT(MONTH FROM COALESCE(p_month, CURRENT_DATE))::int;
  _today date := CURRENT_DATE;
  _spent numeric; _budget numeric; _out jsonb;
BEGIN
  IF NOT _has_permission('finance.view', p_site) THEN RAISE EXCEPTION 'No access'; END IF;

  SELECT COALESCE(sum(jl.debit - jl.credit), 0) INTO _spent
    FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_id JOIN accounts a ON a.id = jl.account_id
   WHERE je.site_id = p_site AND je.status = 'posted' AND a.account_type = 'Expense' AND je.entry_date BETWEEN _m1 AND _m2;
  SELECT COALESCE(sum(_budget_month_amount(b.id, _mo)), 0) INTO _budget
    FROM procurement_budgets b WHERE b.site_id = p_site AND b.fiscal_year = _yr AND NOT b.is_archived;

  _out := jsonb_build_object(
    'month', _m1, 'days_left', GREATEST(_m2 - _today, 0),
    'spent', _spent, 'budget', _budget,
    'cash_bank', (SELECT COALESCE(sum(balance), 0) FROM accounts WHERE site_id = p_site AND sub_type = 'Bank' AND NOT is_archived),
    'bank_count', (SELECT count(*) FROM accounts WHERE site_id = p_site AND sub_type = 'Bank' AND NOT is_archived),
    'petty_cash', (SELECT COALESCE(sum(balance), 0) FROM petty_cash_funds WHERE site_id = p_site AND NOT is_archived AND is_active),
    'petty_funds', (SELECT count(*) FROM petty_cash_funds WHERE site_id = p_site AND NOT is_archived AND is_active),
    'petty_low', (SELECT count(*) FROM petty_cash_funds WHERE site_id = p_site AND NOT is_archived AND is_active AND balance < float_amount * 0.25),
    'owed', (SELECT COALESCE(sum(total_amount), 0) FROM purchase_invoices WHERE site_id = p_site AND status IN ('draft','pending_approval','approved')),
    'overdue', (SELECT COALESCE(sum(total_amount), 0) FROM purchase_invoices WHERE site_id = p_site AND status IN ('pending_approval','approved') AND due_date < _today),
    'overdue_count', (SELECT count(*) FROM purchase_invoices WHERE site_id = p_site AND status IN ('pending_approval','approved') AND due_date < _today),
    'due_7', (SELECT COALESCE(sum(total_amount), 0) FROM purchase_invoices WHERE site_id = p_site AND status IN ('pending_approval','approved') AND due_date BETWEEN _today AND _today + 7),
    -- 12 months of spend (ledger) and budget, oldest first
    'trend', (SELECT jsonb_agg(jsonb_build_object('month', to_char(m, 'Mon'), 'start', m::date,
                 'spent', (SELECT COALESCE(sum(jl.debit - jl.credit), 0) FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_id
                            JOIN accounts a ON a.id = jl.account_id
                           WHERE je.site_id = p_site AND je.status = 'posted' AND a.account_type = 'Expense'
                             AND je.entry_date >= m AND je.entry_date < m + interval '1 month'),
                 'budget', (SELECT COALESCE(sum(_budget_month_amount(b.id, EXTRACT(MONTH FROM m)::int)), 0) FROM procurement_budgets b
                             WHERE b.site_id = p_site AND b.fiscal_year = EXTRACT(YEAR FROM m) AND NOT b.is_archived)) ORDER BY m)
                FROM generate_series(_m1 - interval '11 months', _m1, interval '1 month') m),
    -- spend this month by expense heading (the account's parent group)
    'categories', (SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'amount')::numeric DESC), '[]'::jsonb) FROM (
                     SELECT jsonb_build_object('name', COALESCE(pa.name, a.name), 'amount', sum(jl.debit - jl.credit)) x
                       FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_id
                       JOIN accounts a ON a.id = jl.account_id LEFT JOIN accounts pa ON pa.id = a.parent_id
                      WHERE je.site_id = p_site AND je.status = 'posted' AND a.account_type = 'Expense' AND je.entry_date BETWEEN _m1 AND _m2
                      GROUP BY COALESCE(pa.name, a.name) HAVING sum(jl.debit - jl.credit) <> 0) q),
    -- cost by site for every site the viewer can see
    'sites', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'current', s.id = p_site,
                 'spent', (SELECT COALESCE(sum(jl.debit - jl.credit), 0) FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_id
                            JOIN accounts a ON a.id = jl.account_id
                           WHERE je.site_id = s.id AND je.status = 'posted' AND a.account_type = 'Expense' AND je.entry_date BETWEEN _m1 AND _m2),
                 'budget', (SELECT COALESCE(sum(_budget_month_amount(b.id, _mo)), 0) FROM procurement_budgets b
                             WHERE b.site_id = s.id AND b.fiscal_year = _yr AND NOT b.is_archived)) ORDER BY s.name), '[]'::jsonb)
                FROM sites s WHERE _has_permission('finance.view', s.id)),
    -- projects with budgets or spend this year
    'projects', (SELECT COALESCE(jsonb_agg(p ORDER BY (p->>'spent')::numeric DESC), '[]'::jsonb) FROM (
                   SELECT jsonb_build_object('id', pj.id, 'name', pj.name,
                     'spent', _ledger_cost(p_site, NULL, pj.id, make_date(_yr, 1, 1), _m2),
                     'budget', (SELECT COALESCE(sum(amount), 0) FROM procurement_budgets b WHERE b.project_id = pj.id AND b.fiscal_year = _yr AND NOT b.is_archived),
                     'weeks', (SELECT jsonb_agg(_ledger_cost(p_site, NULL, pj.id, w::date, (w + interval '6 days')::date) ORDER BY w)
                                 FROM generate_series(date_trunc('week', _today) - interval '6 weeks', date_trunc('week', _today), interval '1 week') w)) p
                     FROM projects pj WHERE pj.site_id = p_site AND NOT COALESCE(pj.is_archived, false) AND pj.status IN ('planning','active','on_hold')
                     LIMIT 8) q),
    'upcoming', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', i.id, 'due_date', i.due_date, 'supplier', sp.supplier_name,
                     'reference', COALESCE(po.po_number, i.invoice_number), 'amount', i.total_amount, 'match', i.match_status, 'status', i.status) ORDER BY i.due_date), '[]'::jsonb)
                   FROM purchase_invoices i LEFT JOIN procurement_suppliers sp ON sp.id = i.supplier_id LEFT JOIN purchase_orders po ON po.id = i.po_id
                  WHERE i.site_id = p_site AND i.status IN ('pending_approval','approved') AND i.due_date <= _today + 14),
    'attention', jsonb_build_object(
       'overdue_bills', (SELECT count(*) FROM purchase_invoices WHERE site_id = p_site AND status IN ('pending_approval','approved') AND due_date < _today),
       'mismatched_bills', (SELECT count(*) FROM purchase_invoices WHERE site_id = p_site AND status NOT IN ('paid','cancelled') AND match_status IN ('price_diff','qty_diff','no_grn')),
       'budgets_over_90', (SELECT count(*) FROM fin_budget_vs_actual(p_site, _yr, _mo) v WHERE v.year_budget > 0 AND (v.year_budget - v.remaining_year) >= 0.9 * v.year_budget),
       'claims_waiting', (SELECT count(*) FROM expense_claims WHERE site_id = p_site AND NOT is_archived AND status = 'submitted'),
       'runs_to_approve', (SELECT count(*) FROM ap_payment_runs WHERE site_id = p_site AND status = 'draft' AND NOT is_archived),
       'waiting_postings', (SELECT count(*) FROM gl_posting_log WHERE site_id = p_site AND status = 'skipped' AND message NOT LIKE 'Dated before%' AND message NOT LIKE 'No value%'),
       'depreciation_due', EXISTS (SELECT 1 FROM fixed_assets fa WHERE fa.site_id = p_site AND NOT COALESCE(fa.is_archived, false))
                           AND NOT EXISTS (SELECT 1 FROM asset_depreciation d WHERE d.site_id = p_site AND date_trunc('month', d.period) = _m1)),
    'setup', finance_setup_status(p_site)
  );
  RETURN _out;
END $$;

REVOKE ALL ON FUNCTION fin_budget_vs_actual(uuid, int, int) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION fin_home(uuid, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION _ledger_cost(uuid, uuid, uuid, date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION _po_committed(uuid, uuid, uuid, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fin_budget_vs_actual(uuid, int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION fin_home(uuid, date) TO authenticated;

INSERT INTO schema_migrations (filename) VALUES ('0207_budgets_and_finance_home.sql') ON CONFLICT DO NOTHING;
