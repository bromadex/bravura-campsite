-- 0202 finance_setup_wizard — "Set up the books" (Finance module rewrite, Phase 2, issue #49).
-- One setup record per site plus server-side steps:
--   finance_coa_template()                 the mining chart of accounts (costs only — no sales / VAT)
--   finance_setup_apply_template(site, codes[])   creates the ticked accounts (idempotent)
--   finance_setup_suggest_rules(site)      fills every missing posting rule from the template mapping
--   finance_setup_opening_balances(site, date, lines)  one balanced opening journal (difference → 3900)
--   finance_setup_go_live(site, date)      marks the books live; nothing dated before it auto-posts
--   finance_setup_status(site)             progress of each step, for the wizard and Finance Home

CREATE TABLE IF NOT EXISTS finance_setup (
  site_id               uuid PRIMARY KEY REFERENCES sites(id),
  financial_year_start  int  NOT NULL DEFAULT 1 CHECK (financial_year_start BETWEEN 1 AND 12),
  template              text,
  opening_date          date,
  opening_journal_id    uuid REFERENCES journal_entries(id),
  go_live_date          date,
  went_live_at          timestamptz,
  went_live_by          uuid REFERENCES profiles(id),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid REFERENCES profiles(id) DEFAULT auth.uid()
);
ALTER TABLE finance_setup ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS finance_setup_select ON finance_setup;
CREATE POLICY finance_setup_select ON finance_setup FOR SELECT TO authenticated
  USING (_has_permission('FI01', site_id) OR _has_permission('FI04', site_id));
DROP POLICY IF EXISTS finance_setup_insert ON finance_setup;
CREATE POLICY finance_setup_insert ON finance_setup FOR INSERT TO authenticated
  WITH CHECK (_has_permission('FI04', site_id) AND go_live_date IS NULL);
DROP POLICY IF EXISTS finance_setup_update ON finance_setup;
CREATE POLICY finance_setup_update ON finance_setup FOR UPDATE TO authenticated
  USING (_has_permission('FI04', site_id) AND go_live_date IS NULL)
  WITH CHECK (_has_permission('FI04', site_id) AND go_live_date IS NULL);   -- go-live only via RPC

-- ── Mining chart of accounts ─────────────────────────────────────────────────
-- is_group rows are headings (they hold no postings). contra = balance normally opposite its type.
CREATE OR REPLACE FUNCTION finance_coa_template()
RETURNS TABLE (code text, name text, account_type text, sub_type text, parent_code text, is_group boolean, note text)
LANGUAGE sql IMMUTABLE AS $$
  SELECT * FROM (VALUES
  ('1000','Assets','Asset','Group',NULL,true,NULL),
  ('1100','Bank & cash','Asset','Group','1000',true,NULL),
  ('1110','Bank — main current account','Asset','Bank','1100',false,'Rename to your bank, e.g. CBZ current account'),
  ('1120','Bank — second account','Asset','Bank','1100',false,NULL),
  ('1150','Petty cash','Asset','Cash','1100',false,'All site petty cash funds'),
  ('1200','Advances & prepayments','Asset','Group','1000',true,NULL),
  ('1210','Staff loans & advances','Asset','Receivable','1200',false,NULL),
  ('1220','Prepayments & deposits','Asset','Prepayment','1200',false,NULL),
  ('1300','Stores & inventory','Asset','Group','1000',true,NULL),
  ('1310','Fuel stock','Asset','Stock','1300',false,NULL),
  ('1320','Spares & consumables stock','Asset','Stock','1300',false,NULL),
  ('1330','Explosives & reagents stock','Asset','Stock','1300',false,NULL),
  ('1600','Fixed assets','Asset','Group','1000',true,NULL),
  ('1610','Plant & heavy equipment','Asset','Fixed asset','1600',false,NULL),
  ('1620','Motor vehicles','Asset','Fixed asset','1600',false,NULL),
  ('1630','Buildings & camp infrastructure','Asset','Fixed asset','1600',false,NULL),
  ('1640','Furniture, IT & office equipment','Asset','Fixed asset','1600',false,NULL),
  ('1650','Asset clearing','Asset','Clearing','1600',false,'Temporary account while an asset is being capitalised'),
  ('1690','Accumulated depreciation','Asset','Contra asset','1600',false,'Normally a credit balance'),
  ('2000','Liabilities','Liability','Group',NULL,true,NULL),
  ('2100','Trade payables (suppliers)','Liability','Payables','2000',false,NULL),
  ('2150','Goods received not invoiced','Liability','Accrual','2000',false,NULL),
  ('2160','Freight & clearing accrued','Liability','Accrual','2000',false,NULL),
  ('2200','Other accruals','Liability','Accrual','2000',false,NULL),
  ('2300','Payroll liabilities','Liability','Group','2000',true,NULL),
  ('2310','Net pay payable','Liability','Payroll','2300',false,NULL),
  ('2320','PAYE & AIDS levy payable (ZIMRA)','Liability','Tax','2300',false,NULL),
  ('2330','NSSA payable','Liability','Tax','2300',false,NULL),
  ('2340','Other payroll deductions payable','Liability','Payroll','2300',false,'Medical aid, funeral cover, union'),
  ('2400','Employee claims payable','Liability','Payables','2000',false,NULL),
  ('2410','Catering provider payable','Liability','Payables','2000',false,NULL),
  ('2500','Head office & inter-site funding','Liability','Funding','2000',false,'Money received from Harare head office'),
  ('3000','Equity','Equity','Group',NULL,true,NULL),
  ('3100','Capital contributed','Equity','Capital','3000',false,NULL),
  ('3900','Opening balance equity','Equity','Opening','3000',false,'Balancing figure for opening balances'),
  ('3950','Accumulated costs','Equity','Retained','3000',false,'Costs of prior years (a cost-only operation has no profit)'),
  ('6000','Operating costs','Expense','Group',NULL,true,NULL),
  ('6100','Fuel & lubricants','Expense','Group','6000',true,NULL),
  ('6110','Diesel & petrol','Expense','Fuel','6100',false,NULL),
  ('6120','Oils & lubricants','Expense','Fuel','6100',false,NULL),
  ('6200','Staff costs','Expense','Group','6000',true,NULL),
  ('6210','Salaries & wages','Expense','Staff','6200',false,NULL),
  ('6220','Employer NSSA','Expense','Staff','6200',false,NULL),
  ('6230','Staff welfare & PPE','Expense','Staff','6200',false,NULL),
  ('6240','Staff travel & expense claims','Expense','Staff','6200',false,NULL),
  ('6300','Repairs & maintenance','Expense','Group','6000',true,NULL),
  ('6310','Plant & vehicle parts','Expense','Maintenance','6300',false,NULL),
  ('6320','Tyres','Expense','Maintenance','6300',false,NULL),
  ('6330','Building & camp maintenance','Expense','Maintenance','6300',false,NULL),
  ('6400','Camp & catering','Expense','Group','6000',true,NULL),
  ('6410','Catering','Expense','Camp','6400',false,NULL),
  ('6420','Camp utilities & supplies','Expense','Camp','6400',false,NULL),
  ('6500','Contractors & hired plant','Expense','Group','6000',true,NULL),
  ('6510','Contractor services','Expense','Contractors','6500',false,NULL),
  ('6520','Hired plant & vehicles','Expense','Contractors','6500',false,NULL),
  ('6530','Haulage & transport','Expense','Contractors','6500',false,NULL),
  ('6600','Mining consumables','Expense','Group','6000',true,NULL),
  ('6610','Explosives & blasting','Expense','Mining','6600',false,NULL),
  ('6620','Drilling consumables','Expense','Mining','6600',false,NULL),
  ('6630','Reagents & process consumables','Expense','Mining','6600',false,NULL),
  ('6700','Utilities','Expense','Group','6000',true,NULL),
  ('6710','Electricity','Expense','Utilities','6700',false,NULL),
  ('6720','Water','Expense','Utilities','6700',false,NULL),
  ('6730','Communications & internet','Expense','Utilities','6700',false,NULL),
  ('6800','Admin & finance costs','Expense','Group','6000',true,NULL),
  ('6810','Bank charges & IMTT','Expense','Finance','6800',false,NULL),
  ('6820','Insurance','Expense','Admin','6800',false,NULL),
  ('6830','Licences, permits & royalties','Expense','Admin','6800',false,NULL),
  ('6840','Professional fees','Expense','Admin','6800',false,NULL),
  ('6850','Office & IT','Expense','Admin','6800',false,NULL),
  ('6860','Sundry site expenses (petty cash)','Expense','Admin','6800',false,NULL),
  ('6870','Cash shortages','Expense','Admin','6800',false,NULL),
  ('6900','Depreciation & disposals','Expense','Group','6000',true,NULL),
  ('6910','Depreciation','Expense','Depreciation','6900',false,NULL),
  ('6920','Loss on disposal of assets','Expense','Depreciation','6900',false,NULL),
  ('6950','SHEQ & environment','Expense','Group','6000',true,NULL),
  ('6951','Safety & medical','Expense','SHEQ','6950',false,NULL),
  ('6952','Environmental & rehabilitation','Expense','SHEQ','6950',false,NULL)
  ) AS t(code, name, account_type, sub_type, parent_code, is_group, note);
$$;

-- Default posting rule for each ERP event (debit code, credit code) in the template.
CREATE OR REPLACE FUNCTION finance_rule_template()
RETURNS TABLE (event_code text, debit_code text, credit_code text)
LANGUAGE sql IMMUTABLE AS $$
  SELECT * FROM (VALUES
  ('fuel_delivery','1310','2100'), ('fuel_issue','6110','1310'),
  ('grn_accepted','1320','2150'), ('landed_cost','1320','2160'),
  ('invoice_approved','2150','2100'), ('invoice_paid','2100','1110'),
  ('payroll_net','6210','2310'), ('payroll_paye','6210','2320'), ('payroll_nssa','6210','2330'),
  ('payroll_nssa_employer','6220','2330'), ('payroll_deductions','6210','2340'),
  ('payroll_loan_recovery','6210','1210'), ('staff_loan_paid','1210','1110'), ('payroll_paid','2310','1110'),
  ('meals_approved','6410','2410'),
  ('expense_approved','6240','2400'), ('advance_settled','2400','1210'), ('expense_paid','2400','1110'),
  ('expense_paid_cash','2400','1150'), ('advance_paid','1210','1110'), ('advance_paid_cash','1210','1150'),
  ('petty_cash_topup','1150','1110'), ('petty_cash_expense','6860','1150'),
  ('petty_cash_short','6870','1150'), ('petty_cash_over','1150','6870'),
  ('asset_capitalised','1610','1650'), ('asset_depreciation','6910','1690'),
  ('asset_disposal_accum','1690','1610'), ('asset_disposal_loss','6920','1610'),
  ('asset_disposal_proceeds','1110','6920'), ('imtt','6810','1110')
  ) AS t(event_code, debit_code, credit_code);
$$;

CREATE OR REPLACE FUNCTION _finance_setup_guard(p_site uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT _has_permission('FI04', p_site) THEN
    RAISE EXCEPTION 'You need finance edit permission at this site to set up the books';
  END IF;
  INSERT INTO finance_setup (site_id) VALUES (p_site) ON CONFLICT DO NOTHING;
END $$;

-- Creates the ticked template accounts (headings of ticked accounts are always included).
CREATE OR REPLACE FUNCTION finance_setup_apply_template(p_site uuid, p_codes text[])
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n int := 0; _r record; _want text[];
BEGIN
  PERFORM _finance_setup_guard(p_site);
  -- the ticked codes plus every heading above them
  WITH RECURSIVE up AS (
    SELECT t.code, t.parent_code FROM finance_coa_template() t WHERE t.code = ANY(p_codes)
    UNION SELECT t.code, t.parent_code FROM finance_coa_template() t JOIN up ON t.code = up.parent_code)
  SELECT array_agg(DISTINCT code) INTO _want FROM up;
  IF _want IS NULL THEN RAISE EXCEPTION 'Tick at least one account'; END IF;

  FOR _r IN SELECT * FROM finance_coa_template() t WHERE t.code = ANY(_want) ORDER BY t.code LOOP
    INSERT INTO accounts (site_id, code, name, account_type, sub_type, description, balance, is_archived, created_by)
    VALUES (p_site, _r.code, _r.name, _r.account_type, _r.sub_type, _r.note, 0, false, auth.uid())
    ON CONFLICT (site_id, code) DO NOTHING;
    IF FOUND THEN _n := _n + 1; END IF;
  END LOOP;
  UPDATE accounts a SET parent_id = p.id
    FROM finance_coa_template() t JOIN accounts p ON p.site_id = p_site AND p.code = t.parent_code
   WHERE a.site_id = p_site AND a.code = t.code AND a.parent_id IS NULL;
  UPDATE finance_setup SET template = 'mining', updated_at = now(), updated_by = auth.uid() WHERE site_id = p_site;
  RETURN _n;
END $$;

-- Fills every event that has no rule yet, using the template mapping (only when both accounts exist).
CREATE OR REPLACE FUNCTION finance_setup_suggest_rules(p_site uuid)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n int := 0; _r record;
BEGIN
  PERFORM _finance_setup_guard(p_site);
  FOR _r IN
    SELECT m.event_code, d.id AS dr, c.id AS cr
      FROM finance_rule_template() m
      JOIN accounts d ON d.site_id = p_site AND d.code = m.debit_code AND NOT d.is_archived
      JOIN accounts c ON c.site_id = p_site AND c.code = m.credit_code AND NOT c.is_archived
     WHERE NOT EXISTS (SELECT 1 FROM gl_posting_rules g WHERE g.site_id = p_site AND g.event_code = m.event_code AND NOT g.is_archived)
  LOOP
    INSERT INTO gl_posting_rules (site_id, event_code, debit_account_id, credit_account_id, is_active, is_archived, updated_by)
    VALUES (p_site, _r.event_code, _r.dr, _r.cr, true, false, auth.uid());
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END $$;

-- One balanced opening journal. p_lines: [{account_id, debit, credit}] — any difference goes to 3900.
CREATE OR REPLACE FUNCTION finance_setup_opening_balances(p_site uuid, p_date date, p_lines jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _fs finance_setup%ROWTYPE; _je uuid; _l jsonb; _dr numeric := 0; _cr numeric := 0; _obe uuid; _i int := 0; _res jsonb;
BEGIN
  PERFORM _finance_setup_guard(p_site);
  SELECT * INTO _fs FROM finance_setup WHERE site_id = p_site;
  IF _fs.opening_journal_id IS NOT NULL THEN
    RAISE EXCEPTION 'Opening balances are already entered. Correct them with a journal entry.';
  END IF;
  IF p_date IS NULL THEN RAISE EXCEPTION 'Choose the date of the opening balances'; END IF;
  SELECT id INTO _obe FROM accounts WHERE site_id = p_site AND code = '3900';
  IF _obe IS NULL THEN RAISE EXCEPTION 'Account 3900 Opening balance equity is missing — add it in the chart of accounts step'; END IF;

  INSERT INTO journal_entries (site_id, entry_number, entry_date, description, status, source_module, created_by)
  VALUES (p_site, finance_next_entry_number(p_site), p_date, 'Opening balances', 'draft', 'opening_balances', auth.uid())
  RETURNING id INTO _je;

  FOR _l IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    CONTINUE WHEN COALESCE((_l->>'debit')::numeric, 0) = 0 AND COALESCE((_l->>'credit')::numeric, 0) = 0;
    IF NOT EXISTS (SELECT 1 FROM accounts WHERE id = (_l->>'account_id')::uuid AND site_id = p_site) THEN
      RAISE EXCEPTION 'An account does not belong to this site';
    END IF;
    _i := _i + 1;
    INSERT INTO journal_lines (journal_id, account_id, description, debit, credit, line_order)
    VALUES (_je, (_l->>'account_id')::uuid, 'Opening balance', round(COALESCE((_l->>'debit')::numeric, 0), 2),
            round(COALESCE((_l->>'credit')::numeric, 0), 2), _i);
    _dr := _dr + round(COALESCE((_l->>'debit')::numeric, 0), 2);
    _cr := _cr + round(COALESCE((_l->>'credit')::numeric, 0), 2);
  END LOOP;
  IF _i = 0 THEN RAISE EXCEPTION 'Enter at least one opening balance'; END IF;
  IF _dr <> _cr THEN
    INSERT INTO journal_lines (journal_id, account_id, description, debit, credit, line_order)
    VALUES (_je, _obe, 'Balancing figure', GREATEST(_cr - _dr, 0), GREATEST(_dr - _cr, 0), _i + 1);
  END IF;
  _res := finance_post_journal(_je);
  IF NOT COALESCE((_res->>'ok')::boolean, false) THEN RAISE EXCEPTION '%', _res->>'error'; END IF;
  UPDATE finance_setup SET opening_date = p_date, opening_journal_id = _je, updated_at = now(), updated_by = auth.uid()
   WHERE site_id = p_site;
  RETURN _je;
END $$;

-- Going live needs finance approve. Automatic postings dated before this are skipped.
CREATE OR REPLACE FUNCTION finance_setup_go_live(p_site uuid, p_date date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT _has_permission('FI02', p_site) THEN
    RAISE EXCEPTION 'Going live needs finance approval permission';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE site_id = p_site AND NOT is_archived) THEN
    RAISE EXCEPTION 'Set up the chart of accounts first';
  END IF;
  INSERT INTO finance_setup (site_id) VALUES (p_site) ON CONFLICT DO NOTHING;
  UPDATE finance_setup SET go_live_date = p_date, went_live_at = now(), went_live_by = auth.uid(), updated_at = now()
   WHERE site_id = p_site;
END $$;

CREATE OR REPLACE FUNCTION finance_setup_status(p_site uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _fs finance_setup%ROWTYPE; _events int; _rules int;
BEGIN
  IF NOT (_has_permission('FI01', p_site) OR _has_permission('FI04', p_site)) THEN RETURN NULL; END IF;
  SELECT * INTO _fs FROM finance_setup WHERE site_id = p_site;
  SELECT count(*) INTO _events FROM finance_rule_template();
  SELECT count(DISTINCT event_code) INTO _rules FROM gl_posting_rules
   WHERE site_id = p_site AND is_active AND NOT is_archived AND debit_account_id IS NOT NULL AND credit_account_id IS NOT NULL;
  RETURN jsonb_build_object(
    'financial_year_start', COALESCE(_fs.financial_year_start, 1),
    'company_done', _fs.site_id IS NOT NULL,
    'accounts', (SELECT count(*) FROM accounts WHERE site_id = p_site AND NOT is_archived),
    'rules', _rules, 'events', _events,
    'opening_date', _fs.opening_date, 'opening_journal_id', _fs.opening_journal_id,
    'bank_accounts', (SELECT count(*) FROM bank_accounts WHERE site_id = p_site AND NOT is_archived AND gl_account_id IS NOT NULL),
    'go_live_date', _fs.go_live_date, 'went_live_at', _fs.went_live_at,
    'skipped_postings', (SELECT count(*) FROM gl_posting_log WHERE site_id = p_site AND status = 'skipped'));
END $$;

REVOKE ALL ON FUNCTION finance_setup_apply_template(uuid, text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION finance_setup_suggest_rules(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION finance_setup_opening_balances(uuid, date, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION finance_setup_go_live(uuid, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION finance_setup_status(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION _finance_setup_guard(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION finance_setup_apply_template(uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION finance_setup_suggest_rules(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION finance_setup_opening_balances(uuid, date, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION finance_setup_go_live(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION finance_setup_status(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION finance_coa_template() TO authenticated;
GRANT EXECUTE ON FUNCTION finance_rule_template() TO authenticated;

-- ── Automatic postings respect the go-live date ─────────────────────────────
CREATE OR REPLACE FUNCTION gl_auto_post(p_site_id uuid, p_event_code text, p_source_table text, p_source_id uuid,
                                        p_entry_date date, p_amount numeric, p_description text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _rule gl_posting_rules%ROWTYPE; _je_id UUID; _amount NUMERIC(15,2) := ROUND(COALESCE(p_amount, 0), 2);
  _msg TEXT; _res JSONB; _dims RECORD; _cc UUID; _live date;
BEGIN
  IF EXISTS (SELECT 1 FROM gl_posting_log WHERE source_table = p_source_table AND source_id = p_source_id
                AND event_code = p_event_code AND status IN ('posted','skipped')) THEN
    RETURN NULL;
  END IF;
  SELECT go_live_date INTO _live FROM finance_setup WHERE site_id = p_site_id;
  IF _amount <= 0 THEN
    _msg := 'No value to post (amount is zero or unknown)';
  ELSIF _live IS NOT NULL AND p_entry_date < _live THEN
    _msg := 'Dated before the books went live (' || to_char(_live, 'DD Mon YYYY') || ') — covered by opening balances';
  ELSE
    SELECT * INTO _rule FROM gl_posting_rules WHERE site_id = p_site_id AND event_code = p_event_code AND is_active AND NOT is_archived;
    IF NOT FOUND OR _rule.debit_account_id IS NULL OR _rule.credit_account_id IS NULL THEN
      _msg := 'No posting rule set up for this event';
    END IF;
  END IF;
  IF _msg IS NOT NULL THEN
    INSERT INTO gl_posting_log (site_id, event_code, source_table, source_id, entry_date, amount, description, status, message, created_by)
    VALUES (p_site_id, p_event_code, p_source_table, p_source_id, p_entry_date, _amount, p_description, 'skipped', _msg, auth.uid());
    RETURN NULL;
  END IF;
  SELECT * INTO _dims FROM _gl_source_dims(p_source_table, p_source_id);
  _cc := COALESCE(_dims.cost_centre_id, _rule.cost_centre_id);
  BEGIN
    INSERT INTO journal_entries (site_id, entry_number, entry_date, description, status, source_module, source_record_id, created_by)
    VALUES (p_site_id, finance_next_entry_number(p_site_id), p_entry_date, p_description, 'draft', p_event_code, p_source_id, auth.uid())
    RETURNING id INTO _je_id;
    INSERT INTO journal_lines (journal_id, account_id, description, debit, credit, line_order, cost_centre_id, project_id)
    VALUES (_je_id, _rule.debit_account_id,  p_description, _amount, 0, 1, _cc, _dims.project_id),
           (_je_id, _rule.credit_account_id, p_description, 0, _amount, 2, _cc, _dims.project_id);
    _res := finance_post_journal(_je_id);
    IF NOT COALESCE((_res->>'ok')::boolean, false) THEN RAISE EXCEPTION '%', _res->>'error'; END IF;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO gl_posting_log (site_id, event_code, source_table, source_id, entry_date, amount, description, status, message, created_by)
    VALUES (p_site_id, p_event_code, p_source_table, p_source_id, p_entry_date, _amount, p_description, 'skipped', 'Posting failed: ' || SQLERRM, auth.uid());
    RETURN NULL;
  END;
  INSERT INTO gl_posting_log (site_id, event_code, source_table, source_id, entry_date, amount, description, journal_id, status, created_by)
  VALUES (p_site_id, p_event_code, p_source_table, p_source_id, p_entry_date, _amount, p_description, _je_id, 'posted', auth.uid());
  RETURN _je_id;
END $$;

INSERT INTO schema_migrations (filename) VALUES ('0202_finance_setup_wizard.sql') ON CONFLICT DO NOTHING;
