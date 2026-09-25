-- 0209 reports_month_end — Finance rewrite Phase 6 (issue #49): statements, explorer, month-end close.
--   fin_statements(site, from, to)   trial balance, operating-costs statement (cost-only P&L),
--                                     balance sheet and cash flow — all from posted journal lines
--   fin_explore(site, from, to, by)  spend grouped by heading / account / cost centre / project / month
--   finance_periods + fin_close_checklist / fin_close_period / fin_reopen_period
--   A closed month is locked: no journal can be posted, changed or voided with a date inside it
--   (automatic postings into a closed month land in the "waiting" log instead).

-- Reporting heading: the account's parent group, or itself when it sits at the top.
CREATE OR REPLACE FUNCTION _fin_heading(p_account uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN pa.id IS NULL OR pa.parent_id IS NULL THEN a.name ELSE pa.name END
    FROM accounts a LEFT JOIN accounts pa ON pa.id = a.parent_id WHERE a.id = p_account;
$$;

-- Posted journal lines of a site up to a date (is_opening: the opening-balances journal, which
-- counts as opening cash rather than a movement in the cash flow).
DROP FUNCTION IF EXISTS _fin_lines(uuid, date);
CREATE FUNCTION _fin_lines(p_site uuid, p_to date)
RETURNS TABLE (account_id uuid, entry_date date, journal_id uuid, debit numeric, credit numeric, is_opening boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jl.account_id, je.entry_date, je.id, jl.debit, jl.credit, COALESCE(je.source_module = 'opening_balances', false)
    FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_id
   WHERE je.site_id = p_site AND je.status = 'posted' AND je.entry_date <= p_to;
$$;
REVOKE ALL ON FUNCTION _fin_lines(uuid, date) FROM PUBLIC, anon, authenticated;

-- ── Statements ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fin_statements(p_site uuid, p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _len int := p_to - p_from; _pfrom date; _pto date; _yfrom date; _fy int; _out jsonb;
BEGIN
  IF NOT _has_permission('finance.view', p_site) THEN RAISE EXCEPTION 'No access'; END IF;
  _pto := p_from - 1; _pfrom := _pto - _len;
  SELECT COALESCE(financial_year_start, 1) INTO _fy FROM finance_setup WHERE site_id = p_site;
  _fy := COALESCE(_fy, 1);
  _yfrom := make_date(EXTRACT(YEAR FROM p_to)::int - CASE WHEN EXTRACT(MONTH FROM p_to) < _fy THEN 1 ELSE 0 END, _fy, 1);

  _out := jsonb_build_object(
    'from', p_from, 'to', p_to, 'prior_from', _pfrom, 'prior_to', _pto, 'year_from', _yfrom,
    -- Trial balance: every account with activity; natural sign (debit for assets/costs, credit otherwise)
    'trial_balance', (SELECT COALESCE(jsonb_agg(x ORDER BY x->>'code'), '[]'::jsonb) FROM (
        SELECT jsonb_build_object('id', a.id, 'code', a.code, 'name', a.name, 'type', a.account_type, 'heading', _fin_heading(a.id),
          'opening', COALESCE(sum(f.debit - f.credit) FILTER (WHERE f.entry_date < p_from), 0) * CASE WHEN a.account_type IN ('Asset','Expense') THEN 1 ELSE -1 END,
          'debit', COALESCE(sum(f.debit) FILTER (WHERE f.entry_date >= p_from), 0),
          'credit', COALESCE(sum(f.credit) FILTER (WHERE f.entry_date >= p_from), 0),
          'closing', COALESCE(sum(f.debit - f.credit), 0) * CASE WHEN a.account_type IN ('Asset','Expense') THEN 1 ELSE -1 END) x
          FROM accounts a JOIN _fin_lines(p_site, p_to) f ON f.account_id = a.id
         WHERE a.site_id = p_site GROUP BY a.id HAVING sum(f.debit) <> 0 OR sum(f.credit) <> 0) q),
    -- Operating costs (cost-only P&L): this period, the period before, year to date
    'costs', (SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'period')::numeric DESC), '[]'::jsonb) FROM (
        SELECT jsonb_build_object('heading', _fin_heading(a.id),
          'period', COALESCE(sum(f.debit - f.credit) FILTER (WHERE f.entry_date BETWEEN p_from AND p_to), 0),
          'prior', COALESCE(sum(f.debit - f.credit) FILTER (WHERE f.entry_date BETWEEN _pfrom AND _pto), 0),
          'ytd', COALESCE(sum(f.debit - f.credit) FILTER (WHERE f.entry_date BETWEEN _yfrom AND p_to), 0),
          'accounts', jsonb_agg(DISTINCT jsonb_build_object('code', a.code, 'name', a.name))) x
          FROM accounts a JOIN _fin_lines(p_site, p_to) f ON f.account_id = a.id
         WHERE a.site_id = p_site AND a.account_type = 'Expense' GROUP BY _fin_heading(a.id)) q),
    -- Balance sheet as at p_to (costs to date shown as a reduction of funding)
    'balance_sheet', (SELECT COALESCE(jsonb_agg(x ORDER BY x->>'type', x->>'heading'), '[]'::jsonb) FROM (
        SELECT jsonb_build_object('type', a.account_type, 'heading', _fin_heading(a.id),
          'amount', sum(f.debit - f.credit) * CASE WHEN a.account_type = 'Asset' THEN 1 ELSE -1 END) x
          FROM accounts a JOIN _fin_lines(p_site, p_to) f ON f.account_id = a.id
         WHERE a.site_id = p_site AND a.account_type IN ('Asset','Liability','Equity')
         GROUP BY a.account_type, _fin_heading(a.id) HAVING sum(f.debit - f.credit) <> 0) q),
    'costs_to_date', (SELECT COALESCE(sum(f.debit - f.credit), 0) FROM _fin_lines(p_site, p_to) f JOIN accounts a ON a.id = f.account_id WHERE a.account_type = 'Expense'),
    -- Cash flow: movement on bank & cash accounts, attributed to the other side of each journal
    'cash_opening', (SELECT COALESCE(sum(f.debit - f.credit), 0) FROM _fin_lines(p_site, p_to) f JOIN accounts a ON a.id = f.account_id WHERE a.sub_type IN ('Bank','Cash') AND (f.entry_date < p_from OR f.is_opening)),
    'cash_closing', (SELECT COALESCE(sum(f.debit - f.credit), 0) FROM _fin_lines(p_site, p_to) f JOIN accounts a ON a.id = f.account_id WHERE a.sub_type IN ('Bank','Cash')),
    'cash_flow', (SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'amount')::numeric), '[]'::jsonb) FROM (
        SELECT jsonb_build_object('heading', _fin_heading(a.id), 'type', a.account_type, 'amount', sum(f.credit - f.debit)) x
          FROM _fin_lines(p_site, p_to) f JOIN accounts a ON a.id = f.account_id
         WHERE f.entry_date BETWEEN p_from AND p_to AND NOT f.is_opening AND COALESCE(a.sub_type, '') NOT IN ('Bank','Cash')
           AND EXISTS (SELECT 1 FROM _fin_lines(p_site, p_to) c JOIN accounts ca ON ca.id = c.account_id WHERE c.journal_id = f.journal_id AND ca.sub_type IN ('Bank','Cash'))
         GROUP BY _fin_heading(a.id), a.account_type HAVING sum(f.credit - f.debit) <> 0) q)
  );
  RETURN _out;
END $$;

-- Spend explorer (expense accounts), grouped as asked.
CREATE OR REPLACE FUNCTION fin_explore(p_site uuid, p_from date, p_to date, p_group text, p_heading text DEFAULT NULL)
RETURNS TABLE (label text, amount numeric, lines bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT _has_permission('finance.view', p_site) THEN RAISE EXCEPTION 'No access'; END IF;
  RETURN QUERY
  SELECT CASE p_group
           WHEN 'account' THEN a.code || ' ' || a.name
           WHEN 'cost_centre' THEN COALESCE(cc.code || ' ' || cc.name, 'No cost centre')
           WHEN 'project' THEN COALESCE(pj.name, 'No project')
           WHEN 'month' THEN to_char(je.entry_date, 'YYYY-MM')
           WHEN 'source' THEN COALESCE(je.source_module, 'manual')
           ELSE _fin_heading(a.id) END AS label,
         sum(jl.debit - jl.credit), count(*)
    FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_id JOIN accounts a ON a.id = jl.account_id
    LEFT JOIN cost_centres cc ON cc.id = jl.cost_centre_id LEFT JOIN projects pj ON pj.id = jl.project_id
   WHERE je.site_id = p_site AND je.status = 'posted' AND a.account_type = 'Expense'
     AND je.entry_date BETWEEN p_from AND p_to
     AND (p_heading IS NULL OR _fin_heading(a.id) = p_heading)
   GROUP BY 1 HAVING sum(jl.debit - jl.credit) <> 0
   ORDER BY (CASE WHEN p_group = 'month' THEN min(to_char(je.entry_date, 'YYYY-MM')) END), 2 DESC;
END $$;

-- ── Month-end ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS finance_periods (
  site_id      uuid NOT NULL REFERENCES sites(id),
  year         int  NOT NULL,
  month        int  NOT NULL CHECK (month BETWEEN 1 AND 12),
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  closed_by    uuid REFERENCES profiles(id),
  closed_at    timestamptz,
  close_note   text,
  checklist    jsonb,
  reopened_by  uuid REFERENCES profiles(id),
  reopened_at  timestamptz,
  reopen_reason text,
  PRIMARY KEY (site_id, year, month)
);
ALTER TABLE finance_periods ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fp_select ON finance_periods;
CREATE POLICY fp_select ON finance_periods FOR SELECT TO authenticated USING (_has_permission('finance.view', site_id));

CREATE OR REPLACE FUNCTION _period_closed(p_site uuid, p_date date) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM finance_periods WHERE site_id = p_site AND status = 'closed'
                 AND year = EXTRACT(YEAR FROM p_date) AND month = EXTRACT(MONTH FROM p_date));
$$;

CREATE OR REPLACE FUNCTION trg_period_lock() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _period_closed(NEW.site_id, NEW.entry_date)
     OR (TG_OP = 'UPDATE' AND _period_closed(OLD.site_id, OLD.entry_date)) THEN
    RAISE EXCEPTION 'The books for % are closed. Reopen the month in Month-end, or date this in an open month.',
      to_char(CASE WHEN TG_OP = 'UPDATE' AND _period_closed(OLD.site_id, OLD.entry_date) THEN OLD.entry_date ELSE NEW.entry_date END, 'FMMonth YYYY');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_period_lock ON journal_entries;
CREATE TRIGGER trg_period_lock BEFORE INSERT OR UPDATE ON journal_entries FOR EACH ROW EXECUTE FUNCTION trg_period_lock();

CREATE OR REPLACE FUNCTION fin_close_checklist(p_site uuid, p_year int, p_month int)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _m1 date := make_date(p_year, p_month, 1); _m2 date := (make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date;
        _n int; _items jsonb := '[]'::jsonb; _has_assets boolean; _has_bank boolean;
BEGIN
  IF NOT _has_permission('finance.view', p_site) THEN RAISE EXCEPTION 'No access'; END IF;

  SELECT count(*) INTO _n FROM journal_entries WHERE site_id = p_site AND status = 'draft' AND entry_date BETWEEN _m1 AND _m2;
  _items := _items || jsonb_build_object('key', 'drafts', 'required', true, 'ok', _n = 0, 'label', 'No draft journals left',
             'detail', CASE WHEN _n = 0 THEN 'All journals for the month are posted' ELSE _n || ' draft journal(s) dated in the month' END, 'link', 'fi_journal_entries');

  SELECT count(*) INTO _n FROM gl_posting_log WHERE site_id = p_site AND status = 'skipped' AND entry_date BETWEEN _m1 AND _m2
     AND message NOT LIKE 'Dated before%' AND message NOT LIKE 'No value%';
  _items := _items || jsonb_build_object('key', 'waiting', 'required', true, 'ok', _n = 0, 'label', 'No postings waiting',
             'detail', CASE WHEN _n = 0 THEN 'Every approved fuel issue, GRN, bill and payroll posted' ELSE _n || ' item(s) waiting — usually a missing posting rule' END, 'link', 'fi_posting_rules');

  SELECT EXISTS (SELECT 1 FROM bank_accounts WHERE site_id = p_site AND NOT is_archived) INTO _has_bank;
  SELECT count(*) INTO _n FROM bank_statement_lines l JOIN bank_accounts b ON b.id = l.bank_account_id
   WHERE b.site_id = p_site AND NOT l.is_archived AND NOT l.is_reconciled AND l.transaction_date BETWEEN _m1 AND _m2;
  _items := _items || jsonb_build_object('key', 'bank', 'required', false, 'ok', _has_bank AND _n = 0
             AND EXISTS (SELECT 1 FROM bank_statement_lines l JOIN bank_accounts b ON b.id = l.bank_account_id WHERE b.site_id = p_site AND l.transaction_date >= _m2 - 3),
             'label', 'Bank reconciled',
             'detail', CASE WHEN NOT _has_bank THEN 'No bank accounts set up'
                            WHEN _n > 0 THEN _n || ' statement line(s) in the month not reconciled'
                            WHEN NOT EXISTS (SELECT 1 FROM bank_statement_lines l JOIN bank_accounts b ON b.id = l.bank_account_id WHERE b.site_id = p_site AND l.transaction_date >= _m2 - 3)
                              THEN 'Statement not imported up to month end'
                            ELSE 'All statement lines reconciled' END, 'link', 'fi_bank');

  _items := _items || jsonb_build_object('key', 'payroll', 'required', false,
             'ok', EXISTS (SELECT 1 FROM payroll_runs WHERE site_id = p_site AND period_year = p_year AND period_month = p_month AND status IN ('approved','paid')),
             'label', 'Payroll approved',
             'detail', COALESCE((SELECT 'Payroll run is ' || status FROM payroll_runs WHERE site_id = p_site AND period_year = p_year AND period_month = p_month ORDER BY created_at DESC LIMIT 1), 'No payroll run for the month'),
             'link', 'wf_payroll');

  SELECT EXISTS (SELECT 1 FROM fixed_assets WHERE site_id = p_site AND NOT COALESCE(is_archived, false)) INTO _has_assets;
  _items := _items || jsonb_build_object('key', 'depreciation', 'required', false,
             'ok', NOT _has_assets OR EXISTS (SELECT 1 FROM asset_depreciation WHERE site_id = p_site AND date_trunc('month', period) = _m1),
             'label', 'Depreciation run',
             'detail', CASE WHEN NOT _has_assets THEN 'No fixed assets registered' WHEN EXISTS (SELECT 1 FROM asset_depreciation WHERE site_id = p_site AND date_trunc('month', period) = _m1) THEN 'Run for the month' ELSE 'Not run for the month' END,
             'link', 'fi_asset_depreciation');

  SELECT count(*) INTO _n FROM purchase_invoices WHERE site_id = p_site AND invoice_date BETWEEN _m1 AND _m2 AND status IN ('draft','pending_approval');
  _items := _items || jsonb_build_object('key', 'bills', 'required', false, 'ok', _n = 0, 'label', 'Bills for the month approved',
             'detail', CASE WHEN _n = 0 THEN 'No bills waiting' ELSE _n || ' bill(s) dated in the month still draft or awaiting approval' END, 'link', 'fi_pay_suppliers');

  _items := _items || jsonb_build_object('key', 'mock', 'required', false,
             'ok', NOT COALESCE((SELECT opening_is_mock FROM finance_setup WHERE site_id = p_site), false), 'label', 'Real opening balances',
             'detail', CASE WHEN COALESCE((SELECT opening_is_mock FROM finance_setup WHERE site_id = p_site), false) THEN 'The books still run on MOCK opening balances' ELSE 'Opening balances are real' END,
             'link', 'fi_setup');
  RETURN _items;
END $$;

CREATE OR REPLACE FUNCTION fin_close_period(p_site uuid, p_year int, p_month int, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _chk jsonb; _req int; _adv int;
BEGIN
  IF NOT _has_permission('finance.approve', p_site) THEN RAISE EXCEPTION 'Closing a month needs finance approval permission'; END IF;
  IF make_date(p_year, p_month, 1) > date_trunc('month', CURRENT_DATE)::date THEN RAISE EXCEPTION 'You cannot close a month that has not started'; END IF;
  IF EXISTS (SELECT 1 FROM finance_periods WHERE site_id = p_site AND ((year = p_year AND month < p_month) OR year < p_year) AND status = 'open'
             AND make_date(year, month, 1) >= COALESCE((SELECT date_trunc('month', go_live_date)::date FROM finance_setup WHERE site_id = p_site), '1900-01-01')) THEN
    RAISE EXCEPTION 'Close the earlier open months first';
  END IF;
  _chk := fin_close_checklist(p_site, p_year, p_month);
  SELECT count(*) FILTER (WHERE (i->>'required')::boolean AND NOT (i->>'ok')::boolean),
         count(*) FILTER (WHERE NOT (i->>'required')::boolean AND NOT (i->>'ok')::boolean)
    INTO _req, _adv FROM jsonb_array_elements(_chk) i;
  IF _req > 0 THEN RAISE EXCEPTION 'Finish the required checks first (draft journals and waiting postings)'; END IF;
  IF _adv > 0 AND COALESCE(btrim(p_note), '') = '' THEN RAISE EXCEPTION 'Some checks are not done — add a note explaining why the month is being closed anyway'; END IF;
  INSERT INTO finance_periods (site_id, year, month, status, closed_by, closed_at, close_note, checklist)
  VALUES (p_site, p_year, p_month, 'closed', auth.uid(), now(), NULLIF(btrim(p_note), ''), _chk)
  ON CONFLICT (site_id, year, month) DO UPDATE SET status = 'closed', closed_by = auth.uid(), closed_at = now(),
     close_note = NULLIF(btrim(p_note), ''), checklist = _chk;
END $$;

CREATE OR REPLACE FUNCTION fin_reopen_period(p_site uuid, p_year int, p_month int, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT _has_permission('finance.approve', p_site) THEN RAISE EXCEPTION 'Reopening a month needs finance approval permission'; END IF;
  IF COALESCE(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'Give a reason for reopening the month'; END IF;
  IF EXISTS (SELECT 1 FROM finance_periods WHERE site_id = p_site AND status = 'closed' AND ((year = p_year AND month > p_month) OR year > p_year)) THEN
    RAISE EXCEPTION 'Reopen the later closed months first';
  END IF;
  UPDATE finance_periods SET status = 'open', reopened_by = auth.uid(), reopened_at = now(), reopen_reason = p_reason
   WHERE site_id = p_site AND year = p_year AND month = p_month AND status = 'closed';
  IF NOT FOUND THEN RAISE EXCEPTION 'That month is not closed'; END IF;
END $$;

REVOKE ALL ON FUNCTION _fin_heading(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION fin_statements(uuid, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION fin_explore(uuid, date, date, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION fin_close_checklist(uuid, int, int) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION fin_close_period(uuid, int, int, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION fin_reopen_period(uuid, int, int, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION fin_statements(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION fin_explore(uuid, date, date, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION fin_close_checklist(uuid, int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION fin_close_period(uuid, int, int, text) TO authenticated;
GRANT EXECUTE ON FUNCTION fin_reopen_period(uuid, int, int, text) TO authenticated;

INSERT INTO schema_migrations (filename) VALUES ('0209_reports_month_end.sql') ON CONFLICT DO NOTHING;
