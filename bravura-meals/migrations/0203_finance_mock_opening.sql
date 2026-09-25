-- 0203 finance_mock_opening — lets a site run on MOCK opening balances while testing, then
-- clear them before the real figures go in. Nothing is deleted: the mock journal is voided
-- (account balances reversed) and the setup's opening step is reopened.

ALTER TABLE finance_setup ADD COLUMN IF NOT EXISTS opening_is_mock boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION finance_setup_clear_mock_opening(p_site uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _fs finance_setup%ROWTYPE; _l record;
BEGIN
  IF NOT _has_permission('FI02', p_site) THEN RAISE EXCEPTION 'Clearing opening balances needs finance approval permission'; END IF;
  SELECT * INTO _fs FROM finance_setup WHERE site_id = p_site;
  IF _fs.opening_journal_id IS NULL THEN RAISE EXCEPTION 'No opening balances to clear'; END IF;
  IF NOT _fs.opening_is_mock THEN RAISE EXCEPTION 'These opening balances are real, not mock — correct them with a journal entry'; END IF;
  FOR _l IN SELECT jl.*, a.account_type FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id WHERE jl.journal_id = _fs.opening_journal_id LOOP
    UPDATE accounts SET balance = CASE WHEN _l.account_type IN ('Asset','Expense') THEN balance - _l.debit + _l.credit
                                       ELSE balance + _l.debit - _l.credit END, updated_at = now()
     WHERE id = _l.account_id;
  END LOOP;
  UPDATE journal_entries SET status = 'void', voided_at = now(), voided_by = auth.uid(),
         void_reason = 'Mock opening balances cleared', updated_at = now()
   WHERE id = _fs.opening_journal_id;
  UPDATE finance_setup SET opening_journal_id = NULL, opening_date = NULL, opening_is_mock = false, updated_at = now()
   WHERE site_id = p_site;
END $$;
REVOKE ALL ON FUNCTION finance_setup_clear_mock_opening(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION finance_setup_clear_mock_opening(uuid) TO authenticated;

-- finance_setup_status also reports whether the opening balances are mock.
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
    'opening_is_mock', COALESCE(_fs.opening_is_mock, false),
    'bank_accounts', (SELECT count(*) FROM bank_accounts WHERE site_id = p_site AND NOT is_archived AND gl_account_id IS NOT NULL),
    'go_live_date', _fs.go_live_date, 'went_live_at', _fs.went_live_at,
    'skipped_postings', (SELECT count(*) FROM gl_posting_log WHERE site_id = p_site AND status = 'skipped'));
END $$;

-- Opening balances can be flagged as MOCK (test figures), labelled on the journal before it locks.
DROP FUNCTION IF EXISTS finance_setup_opening_balances(uuid, date, jsonb);
CREATE OR REPLACE FUNCTION finance_setup_opening_balances(p_site uuid, p_date date, p_lines jsonb, p_mock boolean DEFAULT false)
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
  VALUES (p_site, finance_next_entry_number(p_site), p_date, CASE WHEN p_mock THEN 'MOCK opening balances — test figures only, clear before the real figures go in' ELSE 'Opening balances' END, 'draft', 'opening_balances', auth.uid())
  RETURNING id INTO _je;

  FOR _l IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    CONTINUE WHEN COALESCE((_l->>'debit')::numeric, 0) = 0 AND COALESCE((_l->>'credit')::numeric, 0) = 0;
    IF NOT EXISTS (SELECT 1 FROM accounts WHERE id = (_l->>'account_id')::uuid AND site_id = p_site) THEN
      RAISE EXCEPTION 'An account does not belong to this site';
    END IF;
    _i := _i + 1;
    INSERT INTO journal_lines (journal_id, account_id, description, debit, credit, line_order)
    VALUES (_je, (_l->>'account_id')::uuid, CASE WHEN p_mock THEN 'MOCK opening balance' ELSE 'Opening balance' END, round(COALESCE((_l->>'debit')::numeric, 0), 2),
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
  UPDATE finance_setup SET opening_date = p_date, opening_journal_id = _je, opening_is_mock = p_mock, updated_at = now(), updated_by = auth.uid()
   WHERE site_id = p_site;
  RETURN _je;
END $$;
REVOKE ALL ON FUNCTION finance_setup_opening_balances(uuid, date, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION finance_setup_opening_balances(uuid, date, jsonb, boolean) TO authenticated;

INSERT INTO schema_migrations (filename) VALUES ('0203_finance_mock_opening.sql') ON CONFLICT DO NOTHING;
