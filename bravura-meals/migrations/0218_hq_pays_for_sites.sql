-- 0218 hq_pays_for_sites — Procurement rewrite P6 (#56).
-- Harare HQ pays suppliers and funds petty cash for the sites. Each site keeps its own books:
--   bill paid from an HQ bank account → site: Dr 2100 payables / Cr 2500 owed to head office
--                                        HQ:   Dr 2500 owed by sites / Cr 1110 bank  (+ IMTT at HQ)
--   petty cash top-up funded by HQ     → site: Dr 1150 petty cash / Cr 2500
--                                        HQ:   Dr 2500 / Cr 1110 bank
-- Who pays for a site: finance_setup.funded_by_site_id (set per site); a payment run's bank account, if
-- it belongs to another site, also counts. Balances between HQ and sites: fin_intersite_balances().

ALTER TABLE finance_setup ADD COLUMN IF NOT EXISTS funded_by_site_id uuid REFERENCES sites(id);

ALTER TABLE gl_posting_rules DROP CONSTRAINT IF EXISTS gl_posting_rules_event_code_check;
ALTER TABLE gl_posting_rules ADD CONSTRAINT gl_posting_rules_event_code_check CHECK (event_code = ANY (ARRAY[
  'fuel_issue','fuel_delivery','grn_accepted','invoice_approved','invoice_paid','payroll_net','payroll_deductions',
  'payroll_paye','payroll_nssa','payroll_nssa_employer','payroll_paid','payroll_loan_recovery','meals_approved','imtt',
  'expense_approved','advance_settled','expense_paid','expense_paid_cash','advance_paid','advance_paid_cash',
  'petty_cash_topup','petty_cash_expense','petty_cash_short','petty_cash_over','staff_loan_paid','asset_capitalised',
  'asset_depreciation','asset_disposal_accum','asset_disposal_loss','asset_disposal_proceeds','landed_cost',
  'stock_issue','stock_issue_camp','stock_return','stock_loss','stock_gain',
  'contractor_labour','hired_plant_usage','sheq_incident_cost','invoice_accrual','accrual_release','accrual_topup',
  'invoice_paid_by_hq','hq_paid_for_site','petty_cash_topup_hq','hq_funded_site_cash']));

CREATE OR REPLACE FUNCTION public.finance_rule_template()
 RETURNS TABLE(event_code text, debit_code text, credit_code text) LANGUAGE sql IMMUTABLE AS $$
  SELECT * FROM (VALUES
  ('fuel_delivery','1310','2100'), ('fuel_issue','6110','1310'),
  ('grn_accepted','1320','2150'), ('landed_cost','1320','2160'),
  ('invoice_approved','2150','2100'), ('invoice_accrual','2200','2100'), ('invoice_paid','2100','1110'),
  ('invoice_paid_by_hq','2100','2500'), ('hq_paid_for_site','2500','1110'),
  ('accrual_release','2200','6510'), ('accrual_topup','6510','2200'),
  ('payroll_net','6210','2310'), ('payroll_paye','6210','2320'), ('payroll_nssa','6210','2330'),
  ('payroll_nssa_employer','6220','2330'), ('payroll_deductions','6210','2340'),
  ('payroll_loan_recovery','6210','1210'), ('staff_loan_paid','1210','1110'), ('payroll_paid','2310','1110'),
  ('meals_approved','6410','2410'),
  ('expense_approved','6240','2400'), ('advance_settled','2400','1210'), ('expense_paid','2400','1110'),
  ('expense_paid_cash','2400','1150'), ('advance_paid','1210','1110'), ('advance_paid_cash','1210','1150'),
  ('petty_cash_topup','1150','1110'), ('petty_cash_topup_hq','1150','2500'), ('hq_funded_site_cash','2500','1110'),
  ('petty_cash_expense','6860','1150'),
  ('petty_cash_short','6870','1150'), ('petty_cash_over','1150','6870'),
  ('asset_capitalised','1610','1650'), ('asset_depreciation','6910','1690'),
  ('asset_disposal_accum','1690','1610'), ('asset_disposal_loss','6920','1610'),
  ('asset_disposal_proceeds','1110','6920'), ('imtt','6810','1110'),
  ('stock_issue','6310','1320'), ('stock_issue_camp','6420','1320'), ('stock_return','1320','6310'),
  ('stock_loss','6870','1320'), ('stock_gain','1320','6870'),
  ('contractor_labour','6510','2200'), ('hired_plant_usage','6520','2200'),
  ('sheq_incident_cost','6951','2200')
  ) AS t(event_code, debit_code, credit_code);
$$;

-- Which site's bank pays for a bill: the payment run's bank account if it belongs to another site,
-- else the site's funder, else the site itself.
CREATE OR REPLACE FUNCTION public._paying_site(p_invoice purchase_invoices) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT b.site_id FROM ap_payment_runs r JOIN bank_accounts b ON b.id = r.bank_account_id WHERE r.id = p_invoice.payment_run_id),
    (SELECT funded_by_site_id FROM finance_setup WHERE site_id = p_invoice.site_id),
    p_invoice.site_id);
$$;

CREATE OR REPLACE FUNCTION public.trg_gl_purchase_invoices()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _old TEXT := CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END;
  _ref TEXT := 'Supplier invoice ' || COALESCE(NEW.invoice_number, '');
  _paid_on DATE := COALESCE(NEW.paid_at::date, CURRENT_DATE);
  _matched NUMERIC; _n INT; _payer uuid; _site_name text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM _old THEN RETURN NEW; END IF;
  IF NEW.status IN ('approved','paid') THEN
    IF NEW.bill_type = 'accrued' THEN
      PERFORM gl_auto_post(NEW.site_id, 'invoice_accrual', 'purchase_invoices', NEW.id,
                           COALESCE(NEW.invoice_date, CURRENT_DATE), NEW.total_amount, _ref || ' (clears accrual)');
      SELECT count(*), COALESCE(sum(amount), 0) INTO _n, _matched FROM bill_accrual_links WHERE invoice_id = NEW.id AND NOT is_archived;
      IF _n > 0 AND _matched > NEW.total_amount THEN
        PERFORM gl_auto_post(NEW.site_id, 'accrual_release', 'purchase_invoices', NEW.id, COALESCE(NEW.invoice_date, CURRENT_DATE),
                             _matched - NEW.total_amount, _ref || ' — billed less than accrued');
      ELSIF _n > 0 AND _matched < NEW.total_amount THEN
        PERFORM gl_auto_post(NEW.site_id, 'accrual_topup', 'purchase_invoices', NEW.id, COALESCE(NEW.invoice_date, CURRENT_DATE),
                             NEW.total_amount - _matched, _ref || ' — billed more than accrued');
      END IF;
    ELSE
      PERFORM gl_auto_post(NEW.site_id, 'invoice_approved', 'purchase_invoices', NEW.id,
                           COALESCE(NEW.invoice_date, CURRENT_DATE), NEW.total_amount, _ref);
    END IF;
  END IF;
  IF NEW.status = 'paid' THEN
    _payer := _paying_site(NEW);
    IF _payer = NEW.site_id THEN
      PERFORM gl_auto_post(NEW.site_id, 'invoice_paid', 'purchase_invoices', NEW.id, _paid_on, NEW.total_amount, _ref || ' paid');
      IF gl_imtt_on(NEW.site_id, NEW.total_amount) > 0 THEN
        PERFORM gl_auto_post(NEW.site_id, 'imtt', 'purchase_invoices', NEW.id, _paid_on, gl_imtt_on(NEW.site_id, NEW.total_amount), 'IMTT on ' || _ref);
      END IF;
    ELSE
      SELECT name INTO _site_name FROM sites WHERE id = NEW.site_id;
      PERFORM gl_auto_post(NEW.site_id, 'invoice_paid_by_hq', 'purchase_invoices', NEW.id, _paid_on, NEW.total_amount, _ref || ' paid by head office');
      PERFORM gl_auto_post(_payer, 'hq_paid_for_site', 'purchase_invoices', NEW.id, _paid_on, NEW.total_amount, _ref || ' paid for ' || COALESCE(_site_name, 'site'));
      IF gl_imtt_on(_payer, NEW.total_amount) > 0 THEN
        PERFORM gl_auto_post(_payer, 'imtt', 'purchase_invoices', NEW.id, _paid_on, gl_imtt_on(_payer, NEW.total_amount), 'IMTT on ' || _ref);
      END IF;
    END IF;
  END IF;
  IF NEW.status IN ('cancelled','draft','pending_approval') AND _old IN ('approved','paid') THEN
    PERFORM gl_auto_reverse('purchase_invoices', NEW.id, 'Invoice status changed to ' || NEW.status);
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_petty_cash_after() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _delta NUMERIC; _event TEXT; _hq uuid; _site_name text;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'posted' THEN
    _delta := CASE WHEN NEW.direction = 'in' THEN NEW.amount ELSE -NEW.amount END;
  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'posted' AND NEW.status = 'void' THEN
    _delta := CASE WHEN NEW.direction = 'in' THEN -NEW.amount ELSE NEW.amount END;
  ELSE
    RETURN NEW;
  END IF;
  UPDATE petty_cash_funds SET balance = balance + _delta, updated_at = now() WHERE id = NEW.fund_id;
  IF NEW.status = 'void' THEN
    PERFORM gl_auto_reverse('petty_cash_transactions', NEW.id, 'Petty cash entry voided: ' || COALESCE(NEW.void_reason, ''));
    RETURN NEW;
  END IF;
  SELECT funded_by_site_id INTO _hq FROM finance_setup WHERE site_id = NEW.site_id;
  IF NEW.txn_type = 'top_up' AND _hq IS NOT NULL AND _hq <> NEW.site_id THEN
    SELECT name INTO _site_name FROM sites WHERE id = NEW.site_id;
    PERFORM gl_auto_post(NEW.site_id, 'petty_cash_topup_hq', 'petty_cash_transactions', NEW.id, NEW.txn_date, NEW.amount, 'Petty cash from head office: ' || NEW.description);
    PERFORM gl_auto_post(_hq, 'hq_funded_site_cash', 'petty_cash_transactions', NEW.id, NEW.txn_date, NEW.amount, 'Petty cash sent to ' || COALESCE(_site_name, 'site') || ': ' || NEW.description);
    RETURN NEW;
  END IF;
  _event := CASE
    WHEN NEW.txn_type = 'top_up' THEN 'petty_cash_topup'
    WHEN NEW.txn_type = 'expense' THEN 'petty_cash_expense'
    WHEN NEW.txn_type = 'adjustment' AND NEW.direction = 'out' THEN 'petty_cash_short'
    WHEN NEW.txn_type = 'adjustment' AND NEW.direction = 'in' THEN 'petty_cash_over' END;
  IF _event IS NOT NULL THEN
    PERFORM gl_auto_post(NEW.site_id, _event, 'petty_cash_transactions', NEW.id, NEW.txn_date, NEW.amount, 'Petty cash: ' || NEW.description);
  END IF;
  RETURN NEW;
END;
$function$;

-- Set who pays for a site (finance approvers of that site).
CREATE OR REPLACE FUNCTION public.finance_set_funded_by(p_site uuid, p_funder uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT _has_permission('finance.approve', p_site) THEN RAISE EXCEPTION 'Only a finance approver can change who pays for this site'; END IF;
  IF p_funder = p_site THEN p_funder := NULL; END IF;
  INSERT INTO finance_setup (site_id, funded_by_site_id) VALUES (p_site, p_funder)
  ON CONFLICT (site_id) DO UPDATE SET funded_by_site_id = EXCLUDED.funded_by_site_id;
END $$;

-- What each site owes head office (2500) and what HQ is owed, from posted journals.
CREATE OR REPLACE FUNCTION public.fin_intersite_balances() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('site_id', s.id, 'site', s.name, 'site_type', s.site_type,
      'funded_by_site_id', fs.funded_by_site_id, 'funded_by', f.name, 'has_books', fs.site_id IS NOT NULL AND EXISTS (SELECT 1 FROM accounts WHERE site_id = s.id),
      'balance', COALESCE((SELECT round(sum(jl.credit - jl.debit), 2) FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_id
                            JOIN accounts a ON a.id = jl.account_id WHERE je.site_id = s.id AND je.status = 'posted' AND a.code = '2500'), 0))
      ORDER BY s.site_type DESC, s.name)
    FROM sites s LEFT JOIN finance_setup fs ON fs.site_id = s.id LEFT JOIN sites f ON f.id = fs.funded_by_site_id
   WHERE s.is_active AND _has_permission('finance.view', s.id)), '[]'::jsonb);
END $$;

REVOKE ALL ON FUNCTION _paying_site(purchase_invoices), finance_set_funded_by(uuid, uuid), fin_intersite_balances() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION finance_set_funded_by(uuid, uuid), fin_intersite_balances() TO authenticated;

-- New rules for sites that already have books.
INSERT INTO gl_posting_rules (site_id, event_code, debit_account_id, credit_account_id, is_active, is_archived)
SELECT s.site_id, m.event_code, d.id, c.id, true, false
  FROM finance_setup s CROSS JOIN finance_rule_template() m
  JOIN accounts d ON d.site_id = s.site_id AND d.code = m.debit_code AND NOT d.is_archived
  JOIN accounts c ON c.site_id = s.site_id AND c.code = m.credit_code AND NOT c.is_archived
 WHERE m.event_code IN ('invoice_paid_by_hq','hq_paid_for_site','petty_cash_topup_hq','hq_funded_site_cash')
   AND NOT EXISTS (SELECT 1 FROM gl_posting_rules g WHERE g.site_id = s.site_id AND g.event_code = m.event_code AND NOT g.is_archived);

-- Operating model: Harare (head office) pays for the operational sites that already keep books.
UPDATE finance_setup fs SET funded_by_site_id = (SELECT id FROM sites WHERE site_type = 'head_office' ORDER BY name LIMIT 1)
 WHERE fs.funded_by_site_id IS NULL AND fs.site_id IN (SELECT id FROM sites WHERE site_type = 'operational_site');

INSERT INTO schema_migrations (filename) VALUES ('0218_hq_pays_for_sites.sql') ON CONFLICT DO NOTHING;
