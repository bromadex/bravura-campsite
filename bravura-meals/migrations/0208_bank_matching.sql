-- 0208 bank_matching — Finance rewrite Phase 5 (issue #49): bank statements & reconciliation.
--   • Statement lines are imported in bulk (bank_import_lines) with duplicate protection.
--   • bank_auto_match suggests, for each unreconciled line, either an existing posted journal that
--     moved the bank's ledger account by the same amount within ±5 days, or a matching rule
--     ("description contains ZESA → 6710 Electricity, cost centre Camp").
--   • bank_confirm_line reconciles a line: to the suggested/chosen journal, or by posting a new
--     journal from a rule / chosen account (Dr expense Cr bank for money out; reverse for money in).
--   • Rules learn: bank_save_rule creates one from a line and immediately re-runs matching.
--   • bank_rec_summary: balance per bank vs per books, matched / waiting counts.
-- Everything is server-side; lines are never deleted (unmatching reopens a line; a journal that
-- was created from a line is voided with balances reversed).

-- ── Lines: matching state ───────────────────────────────────────────────────
ALTER TABLE bank_statement_lines
  ADD COLUMN IF NOT EXISTS match_status text NOT NULL DEFAULT 'unmatched'
    CHECK (match_status IN ('unmatched','suggested','matched')),
  ADD COLUMN IF NOT EXISTS match_kind text CHECK (match_kind IN ('journal','rule','manual')),
  ADD COLUMN IF NOT EXISTS suggested_journal_id uuid REFERENCES journal_entries(id),
  ADD COLUMN IF NOT EXISTS suggested_rule_id uuid,
  ADD COLUMN IF NOT EXISTS suggest_reason text,
  ADD COLUMN IF NOT EXISTS created_journal_id uuid REFERENCES journal_entries(id),
  ADD COLUMN IF NOT EXISTS dedupe_key text;
CREATE UNIQUE INDEX IF NOT EXISTS bank_statement_lines_dedupe ON bank_statement_lines (bank_account_id, dedupe_key) WHERE dedupe_key IS NOT NULL AND NOT is_archived;
CREATE INDEX IF NOT EXISTS bank_statement_lines_open ON bank_statement_lines (bank_account_id, is_reconciled, transaction_date);

-- Row security through the bank account's site.
ALTER TABLE bank_statement_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bsl_select ON bank_statement_lines;
DROP POLICY IF EXISTS bsl_insert ON bank_statement_lines;
DROP POLICY IF EXISTS bsl_update ON bank_statement_lines;
DROP POLICY IF EXISTS bsl_delete ON bank_statement_lines;
CREATE POLICY bsl_select ON bank_statement_lines FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM bank_accounts b WHERE b.id = bank_statement_lines.bank_account_id AND _has_permission('finance.view', b.site_id)));
-- writes go through the RPCs below

-- ── Rules ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bank_match_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id         uuid NOT NULL REFERENCES sites(id),
  name            text NOT NULL,
  match_text      text NOT NULL CHECK (length(btrim(match_text)) >= 2),
  direction       text NOT NULL DEFAULT 'out' CHECK (direction IN ('out','in','any')),
  account_id      uuid NOT NULL REFERENCES accounts(id),
  cost_centre_id  uuid REFERENCES cost_centres(id),
  project_id      uuid REFERENCES projects(id),
  priority        int  NOT NULL DEFAULT 100,
  times_used      int  NOT NULL DEFAULT 0,
  is_active       boolean NOT NULL DEFAULT true,
  is_archived     boolean NOT NULL DEFAULT false,
  created_by      uuid REFERENCES profiles(id) DEFAULT auth.uid(),
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE bank_statement_lines DROP CONSTRAINT IF EXISTS bank_statement_lines_rule_fkey;
ALTER TABLE bank_statement_lines ADD CONSTRAINT bank_statement_lines_rule_fkey FOREIGN KEY (suggested_rule_id) REFERENCES bank_match_rules(id);
ALTER TABLE bank_match_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bmr_select ON bank_match_rules;
CREATE POLICY bmr_select ON bank_match_rules FOR SELECT TO authenticated USING (_has_permission('finance.view', site_id));
DROP POLICY IF EXISTS bmr_update ON bank_match_rules;
CREATE POLICY bmr_update ON bank_match_rules FOR UPDATE TO authenticated
  USING (_has_permission('finance.edit', site_id)) WITH CHECK (_has_permission('finance.edit', site_id));

-- ── Helpers ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION _bank_ctx(p_bank uuid, p_perm text, OUT site_id uuid, OUT gl_account_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  SELECT b.site_id, b.gl_account_id INTO site_id, gl_account_id FROM bank_accounts b WHERE b.id = p_bank;
  IF site_id IS NULL THEN RAISE EXCEPTION 'Bank account not found'; END IF;
  IF NOT _has_permission(p_perm, site_id) THEN RAISE EXCEPTION 'You need % permission for this', p_perm; END IF;
END $$;

-- Posts a two-line journal and returns it (raises on failure).
CREATE OR REPLACE FUNCTION _bank_post(p_site uuid, p_date date, p_desc text, p_dr uuid, p_cr uuid, p_amount numeric, p_cc uuid, p_project uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _je uuid; _res jsonb;
BEGIN
  INSERT INTO journal_entries (site_id, entry_number, entry_date, description, status, source_module, created_by)
  VALUES (p_site, finance_next_entry_number(p_site), p_date, p_desc, 'draft', 'bank_statement', auth.uid()) RETURNING id INTO _je;
  INSERT INTO journal_lines (journal_id, account_id, description, debit, credit, line_order, cost_centre_id, project_id)
  VALUES (_je, p_dr, p_desc, p_amount, 0, 1, p_cc, p_project), (_je, p_cr, p_desc, 0, p_amount, 2, p_cc, p_project);
  _res := finance_post_journal(_je);
  IF NOT COALESCE((_res->>'ok')::boolean, false) THEN RAISE EXCEPTION '%', _res->>'error'; END IF;
  RETURN _je;
END $$;

-- ── Matching ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION bank_auto_match(p_bank uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _c record; _l record; _j record; _n int; _r record; _jr int := 0; _rr int := 0;
BEGIN
  SELECT * INTO _c FROM _bank_ctx(p_bank, 'finance.view');
  FOR _l IN SELECT * FROM bank_statement_lines WHERE bank_account_id = p_bank AND NOT is_reconciled AND NOT is_archived LOOP
    -- 1. an existing posted journal on this bank's ledger account, same amount, ±5 days, not used yet
    _n := 0;
    IF _c.gl_account_id IS NOT NULL THEN
      SELECT count(*) INTO _n FROM journal_entries je JOIN journal_lines jl ON jl.journal_id = je.id
       WHERE je.site_id = _c.site_id AND je.status = 'posted' AND jl.account_id = _c.gl_account_id
         AND ((_l.debit > 0 AND jl.credit = _l.debit) OR (_l.credit > 0 AND jl.debit = _l.credit))
         AND abs(je.entry_date - _l.transaction_date) <= 5
         AND NOT EXISTS (SELECT 1 FROM bank_statement_lines x WHERE x.matched_journal_id = je.id AND x.is_reconciled AND NOT x.is_archived);
    END IF;
    IF _n >= 1 THEN
      SELECT je.id, je.entry_number, je.entry_date, je.description INTO _j FROM journal_entries je JOIN journal_lines jl ON jl.journal_id = je.id
       WHERE je.site_id = _c.site_id AND je.status = 'posted' AND jl.account_id = _c.gl_account_id
         AND ((_l.debit > 0 AND jl.credit = _l.debit) OR (_l.credit > 0 AND jl.debit = _l.credit))
         AND abs(je.entry_date - _l.transaction_date) <= 5
         AND NOT EXISTS (SELECT 1 FROM bank_statement_lines x WHERE x.matched_journal_id = je.id AND x.is_reconciled AND NOT x.is_archived)
       ORDER BY abs(je.entry_date - _l.transaction_date), je.entry_date LIMIT 1;
      UPDATE bank_statement_lines SET match_status = 'suggested', suggested_journal_id = _j.id, suggested_rule_id = NULL,
             suggest_reason = format('Same amount as %s (%s)%s', _j.entry_number, COALESCE(_j.description, ''),
                                     CASE WHEN _j.entry_date = _l.transaction_date THEN ', same day' ELSE format(', %s day(s) apart', abs(_j.entry_date - _l.transaction_date)) END)
       WHERE id = _l.id;
      _jr := _jr + 1;
      CONTINUE;
    END IF;
    -- 2. a rule whose text appears in the description (first by priority)
    SELECT * INTO _r FROM bank_match_rules r
     WHERE r.site_id = _c.site_id AND r.is_active AND NOT r.is_archived
       AND (r.direction = 'any' OR (r.direction = 'out' AND _l.debit > 0) OR (r.direction = 'in' AND _l.credit > 0))
       AND (COALESCE(_l.description, '') || ' ' || COALESCE(_l.reference, '')) ILIKE '%' || r.match_text || '%'
     ORDER BY r.priority, length(r.match_text) DESC LIMIT 1;
    IF FOUND THEN
      UPDATE bank_statement_lines SET match_status = 'suggested', suggested_rule_id = _r.id, suggested_journal_id = NULL,
             suggest_reason = format('Rule "%s": description contains "%s"', _r.name, _r.match_text)
       WHERE id = _l.id;
      _rr := _rr + 1;
    ELSE
      UPDATE bank_statement_lines SET match_status = 'unmatched', suggested_rule_id = NULL, suggested_journal_id = NULL, suggest_reason = NULL
       WHERE id = _l.id AND match_status <> 'unmatched';
    END IF;
  END LOOP;
  RETURN jsonb_build_object('journal_suggestions', _jr, 'rule_suggestions', _rr);
END $$;

-- p_lines: [{date:'YYYY-MM-DD', description, reference, amount (money in +, out −) | debit/credit, balance}]
CREATE OR REPLACE FUNCTION bank_import_lines(p_bank uuid, p_lines jsonb, p_batch text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _c record; _l jsonb; _out numeric; _in numeric; _key text; _new int := 0; _dup int := 0; _bad int := 0; _batch text; _m jsonb; _d date;
BEGIN
  SELECT * INTO _c FROM _bank_ctx(p_bank, 'finance.create');
  _batch := COALESCE(NULLIF(p_batch, ''), 'Import ' || to_char(now(), 'YYYY-MM-DD HH24:MI'));
  FOR _l IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    BEGIN _d := (_l->>'date')::date; EXCEPTION WHEN others THEN _d := NULL; END;
    IF _d IS NULL THEN _bad := _bad + 1; CONTINUE; END IF;
    IF _l ? 'amount' AND NULLIF(_l->>'amount', '') IS NOT NULL THEN
      _out := GREATEST(-(_l->>'amount')::numeric, 0); _in := GREATEST((_l->>'amount')::numeric, 0);
    ELSE
      _out := abs(COALESCE(NULLIF(_l->>'debit', '')::numeric, 0)); _in := abs(COALESCE(NULLIF(_l->>'credit', '')::numeric, 0));
    END IF;
    IF _out = 0 AND _in = 0 THEN _bad := _bad + 1; CONTINUE; END IF;
    _key := md5(concat_ws('|', _d, round(_out, 2), round(_in, 2), lower(btrim(COALESCE(_l->>'description', ''))), lower(btrim(COALESCE(_l->>'reference', ''))), COALESCE(_l->>'balance', '')));
    INSERT INTO bank_statement_lines (bank_account_id, transaction_date, description, reference, debit, credit, balance, is_reconciled, import_batch, is_archived, created_by, dedupe_key)
    VALUES (p_bank, _d, NULLIF(btrim(_l->>'description'), ''), NULLIF(btrim(_l->>'reference'), ''), round(_out, 2), round(_in, 2),
            NULLIF(_l->>'balance', '')::numeric, false, _batch, false, auth.uid(), _key)
    ON CONFLICT DO NOTHING;
    IF FOUND THEN _new := _new + 1; ELSE _dup := _dup + 1; END IF;
  END LOOP;
  _m := bank_auto_match(p_bank);
  RETURN jsonb_build_object('imported', _new, 'duplicates', _dup, 'skipped', _bad) || _m;
END $$;

-- Reconcile a line. p_mode: 'journal' (p_journal or the suggestion), 'rule' (the suggested rule),
-- 'account' (post to p_account with optional cost centre / project).
CREATE OR REPLACE FUNCTION bank_confirm_line(p_line uuid, p_mode text, p_journal uuid DEFAULT NULL, p_account uuid DEFAULT NULL,
                                             p_cost_centre uuid DEFAULT NULL, p_project uuid DEFAULT NULL, p_memo text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _l bank_statement_lines%ROWTYPE; _c record; _r bank_match_rules%ROWTYPE; _acct uuid; _je uuid; _amt numeric; _desc text; _cc uuid; _pj uuid;
BEGIN
  SELECT * INTO _l FROM bank_statement_lines WHERE id = p_line FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Statement line not found'; END IF;
  SELECT * INTO _c FROM _bank_ctx(_l.bank_account_id, 'finance.edit');
  IF _l.is_reconciled THEN RAISE EXCEPTION 'This line is already reconciled'; END IF;
  _amt := GREATEST(_l.debit, _l.credit);

  IF p_mode = 'journal' THEN
    _je := COALESCE(p_journal, _l.suggested_journal_id);
    IF _je IS NULL OR NOT EXISTS (SELECT 1 FROM journal_entries WHERE id = _je AND site_id = _c.site_id AND status = 'posted') THEN
      RAISE EXCEPTION 'Choose a posted journal from this site';
    END IF;
    IF EXISTS (SELECT 1 FROM bank_statement_lines WHERE matched_journal_id = _je AND is_reconciled AND NOT is_archived) THEN
      RAISE EXCEPTION 'That journal is already matched to another statement line';
    END IF;
    UPDATE bank_statement_lines SET is_reconciled = true, reconciled_at = now(), reconciled_by = auth.uid(),
           matched_journal_id = _je, match_status = 'matched', match_kind = 'journal' WHERE id = p_line;
    RETURN;
  END IF;

  IF _c.gl_account_id IS NULL THEN RAISE EXCEPTION 'Link this bank account to its ledger account first (Set Up the Books → Bank accounts)'; END IF;
  IF p_mode = 'rule' THEN
    SELECT * INTO _r FROM bank_match_rules WHERE id = _l.suggested_rule_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'No rule suggested for this line'; END IF;
    _acct := _r.account_id; _cc := _r.cost_centre_id; _pj := _r.project_id;
    UPDATE bank_match_rules SET times_used = times_used + 1 WHERE id = _r.id;
  ELSIF p_mode = 'account' THEN
    _acct := p_account; _cc := p_cost_centre; _pj := p_project;
    IF _acct IS NULL OR NOT EXISTS (SELECT 1 FROM accounts WHERE id = _acct AND site_id = _c.site_id AND NOT is_archived) THEN
      RAISE EXCEPTION 'Choose an account from this site';
    END IF;
  ELSE
    RAISE EXCEPTION 'Unknown match mode %', p_mode;
  END IF;

  _desc := left(COALESCE(NULLIF(p_memo, ''), 'Bank: ' || COALESCE(_l.description, _l.reference, 'statement line')), 200);
  IF _l.debit > 0 THEN   -- money out: Dr cost/other, Cr bank
    _je := _bank_post(_c.site_id, _l.transaction_date, _desc, _acct, _c.gl_account_id, _amt, _cc, _pj);
  ELSE                   -- money in: Dr bank, Cr other
    _je := _bank_post(_c.site_id, _l.transaction_date, _desc, _c.gl_account_id, _acct, _amt, _cc, _pj);
  END IF;
  UPDATE bank_statement_lines SET is_reconciled = true, reconciled_at = now(), reconciled_by = auth.uid(),
         matched_journal_id = _je, created_journal_id = _je, match_status = 'matched',
         match_kind = CASE WHEN p_mode = 'rule' THEN 'rule' ELSE 'manual' END WHERE id = p_line;
END $$;

-- Reopen a reconciled line. A journal the line created is voided (balances reversed).
CREATE OR REPLACE FUNCTION bank_unmatch_line(p_line uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _l bank_statement_lines%ROWTYPE; _c record; _x record;
BEGIN
  SELECT * INTO _l FROM bank_statement_lines WHERE id = p_line FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Statement line not found'; END IF;
  SELECT * INTO _c FROM _bank_ctx(_l.bank_account_id, 'finance.edit');
  IF NOT _l.is_reconciled THEN RETURN; END IF;
  IF _l.created_journal_id IS NOT NULL THEN
    FOR _x IN SELECT jl.*, a.account_type FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id WHERE jl.journal_id = _l.created_journal_id LOOP
      UPDATE accounts SET balance = CASE WHEN _x.account_type IN ('Asset','Expense') THEN balance - _x.debit + _x.credit
                                         ELSE balance + _x.debit - _x.credit END, updated_at = now() WHERE id = _x.account_id;
    END LOOP;
    UPDATE journal_entries SET status = 'void', voided_at = now(), voided_by = auth.uid(), void_reason = 'Bank line unmatched', updated_at = now()
     WHERE id = _l.created_journal_id AND status = 'posted';
  END IF;
  UPDATE bank_statement_lines SET is_reconciled = false, reconciled_at = NULL, reconciled_by = NULL, matched_journal_id = NULL,
         created_journal_id = NULL, match_status = 'unmatched', match_kind = NULL WHERE id = p_line;
  PERFORM bank_auto_match(_l.bank_account_id);
END $$;

-- Create (or update) a rule and re-run matching for the bank account.
CREATE OR REPLACE FUNCTION bank_save_rule(p_bank uuid, p_rule uuid, p_name text, p_text text, p_direction text, p_account uuid,
                                          p_cost_centre uuid DEFAULT NULL, p_project uuid DEFAULT NULL, p_active boolean DEFAULT true)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _c record; _id uuid := p_rule;
BEGIN
  SELECT * INTO _c FROM _bank_ctx(p_bank, 'finance.edit');
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE id = p_account AND site_id = _c.site_id) THEN RAISE EXCEPTION 'Choose an account from this site'; END IF;
  IF _id IS NULL THEN
    INSERT INTO bank_match_rules (site_id, name, match_text, direction, account_id, cost_centre_id, project_id, is_active)
    VALUES (_c.site_id, COALESCE(NULLIF(btrim(p_name), ''), p_text), btrim(p_text), COALESCE(p_direction, 'out'), p_account, p_cost_centre, p_project, COALESCE(p_active, true))
    RETURNING id INTO _id;
  ELSE
    UPDATE bank_match_rules SET name = COALESCE(NULLIF(btrim(p_name), ''), p_text), match_text = btrim(p_text), direction = COALESCE(p_direction, 'out'),
           account_id = p_account, cost_centre_id = p_cost_centre, project_id = p_project, is_active = COALESCE(p_active, true)
     WHERE id = _id AND site_id = _c.site_id;
  END IF;
  PERFORM bank_auto_match(p_bank);
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION bank_rec_summary(p_bank uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _c record; _last bank_statement_lines%ROWTYPE; _books numeric; _stmt numeric;
BEGIN
  SELECT * INTO _c FROM _bank_ctx(p_bank, 'finance.view');
  SELECT * INTO _last FROM bank_statement_lines WHERE bank_account_id = p_bank AND NOT is_archived
   ORDER BY transaction_date DESC, created_at DESC LIMIT 1;
  SELECT balance INTO _books FROM accounts WHERE id = _c.gl_account_id;
  _stmt := COALESCE(_last.balance,
    (SELECT COALESCE(opening_balance, 0) FROM bank_accounts WHERE id = p_bank)
      + (SELECT COALESCE(sum(credit - debit), 0) FROM bank_statement_lines WHERE bank_account_id = p_bank AND NOT is_archived));
  RETURN jsonb_build_object(
    'statement_balance', _stmt, 'statement_to', _last.transaction_date, 'balance_from_statement', _last.balance IS NOT NULL,
    'books_balance', _books, 'ledger_linked', _c.gl_account_id IS NOT NULL,
    'difference', CASE WHEN _books IS NULL THEN NULL ELSE round(_stmt - _books, 2) END,
    'total', (SELECT count(*) FROM bank_statement_lines WHERE bank_account_id = p_bank AND NOT is_archived),
    'matched', (SELECT count(*) FROM bank_statement_lines WHERE bank_account_id = p_bank AND NOT is_archived AND is_reconciled),
    'suggested', (SELECT count(*) FROM bank_statement_lines WHERE bank_account_id = p_bank AND NOT is_archived AND NOT is_reconciled AND match_status = 'suggested'),
    'unmatched', (SELECT count(*) FROM bank_statement_lines WHERE bank_account_id = p_bank AND NOT is_archived AND NOT is_reconciled AND match_status = 'unmatched'),
    'rules', (SELECT count(*) FROM bank_match_rules WHERE site_id = _c.site_id AND NOT is_archived AND is_active));
END $$;

-- Candidate journals for manually matching one line (same site, bank ledger account, ±30 days).
CREATE OR REPLACE FUNCTION bank_line_candidates(p_line uuid) RETURNS TABLE (journal_id uuid, entry_number text, entry_date date, description text, amount numeric, exact boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _l bank_statement_lines%ROWTYPE; _c record;
BEGIN
  SELECT * INTO _l FROM bank_statement_lines WHERE id = p_line;
  SELECT * INTO _c FROM _bank_ctx(_l.bank_account_id, 'finance.view');
  RETURN QUERY
  SELECT DISTINCT ON (je.id) je.id, je.entry_number, je.entry_date, je.description,
         CASE WHEN _l.debit > 0 THEN jl.credit ELSE jl.debit END,
         (CASE WHEN _l.debit > 0 THEN jl.credit ELSE jl.debit END) = GREATEST(_l.debit, _l.credit)
    FROM journal_entries je JOIN journal_lines jl ON jl.journal_id = je.id
   WHERE je.site_id = _c.site_id AND je.status = 'posted' AND jl.account_id = _c.gl_account_id
     AND ((_l.debit > 0 AND jl.credit > 0) OR (_l.credit > 0 AND jl.debit > 0))
     AND abs(je.entry_date - _l.transaction_date) <= 30
     AND NOT EXISTS (SELECT 1 FROM bank_statement_lines x WHERE x.matched_journal_id = je.id AND x.is_reconciled AND NOT x.is_archived)
   ORDER BY je.id;
END $$;

REVOKE ALL ON FUNCTION _bank_ctx(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION _bank_post(uuid, date, text, uuid, uuid, numeric, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION bank_auto_match(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION bank_import_lines(uuid, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION bank_confirm_line(uuid, text, uuid, uuid, uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION bank_unmatch_line(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION bank_save_rule(uuid, uuid, text, text, text, uuid, uuid, uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION bank_rec_summary(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION bank_line_candidates(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION bank_auto_match(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION bank_import_lines(uuid, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION bank_confirm_line(uuid, text, uuid, uuid, uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION bank_unmatch_line(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION bank_save_rule(uuid, uuid, text, text, text, uuid, uuid, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION bank_rec_summary(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION bank_line_candidates(uuid) TO authenticated;

INSERT INTO schema_migrations (filename) VALUES ('0208_bank_matching.sql') ON CONFLICT DO NOTHING;
