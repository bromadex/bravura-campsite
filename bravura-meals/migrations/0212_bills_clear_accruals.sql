-- 0212 bills_clear_accruals — a contractor / hired-plant / incident bill clears what 0211 accrued.
-- purchase_invoices.bill_type: 'goods' (default — clears Goods received not invoiced 2150, as before) or
-- 'accrued' (clears Other accruals 2200 for work already accrued from approved timesheets, hired-plant
-- usage logs or closed incidents). Event invoice_accrual: Dr 2200 / Cr 2100 payables.
ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS bill_type text NOT NULL DEFAULT 'goods';
ALTER TABLE purchase_invoices DROP CONSTRAINT IF EXISTS purchase_invoices_bill_type_check;
ALTER TABLE purchase_invoices ADD CONSTRAINT purchase_invoices_bill_type_check CHECK (bill_type IN ('goods','accrued'));

ALTER TABLE gl_posting_rules DROP CONSTRAINT IF EXISTS gl_posting_rules_event_code_check;
ALTER TABLE gl_posting_rules ADD CONSTRAINT gl_posting_rules_event_code_check CHECK (event_code = ANY (ARRAY[
  'fuel_issue','fuel_delivery','grn_accepted','invoice_approved','invoice_paid','payroll_net','payroll_deductions',
  'payroll_paye','payroll_nssa','payroll_nssa_employer','payroll_paid','payroll_loan_recovery','meals_approved','imtt',
  'expense_approved','advance_settled','expense_paid','expense_paid_cash','advance_paid','advance_paid_cash',
  'petty_cash_topup','petty_cash_expense','petty_cash_short','petty_cash_over','staff_loan_paid','asset_capitalised',
  'asset_depreciation','asset_disposal_accum','asset_disposal_loss','asset_disposal_proceeds','landed_cost',
  'stock_issue','stock_issue_camp','stock_return','stock_loss','stock_gain',
  'contractor_labour','hired_plant_usage','sheq_incident_cost','invoice_accrual']));

CREATE OR REPLACE FUNCTION public.finance_rule_template()
 RETURNS TABLE(event_code text, debit_code text, credit_code text) LANGUAGE sql IMMUTABLE AS $$
  SELECT * FROM (VALUES
  ('fuel_delivery','1310','2100'), ('fuel_issue','6110','1310'),
  ('grn_accepted','1320','2150'), ('landed_cost','1320','2160'),
  ('invoice_approved','2150','2100'), ('invoice_accrual','2200','2100'), ('invoice_paid','2100','1110'),
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
  ('asset_disposal_proceeds','1110','6920'), ('imtt','6810','1110'),
  ('stock_issue','6310','1320'), ('stock_issue_camp','6420','1320'), ('stock_return','1320','6310'),
  ('stock_loss','6870','1320'), ('stock_gain','1320','6870'),
  ('contractor_labour','6510','2200'), ('hired_plant_usage','6520','2200'),
  ('sheq_incident_cost','6951','2200')
  ) AS t(event_code, debit_code, credit_code);
$$;

CREATE OR REPLACE FUNCTION public.trg_gl_purchase_invoices()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _old TEXT := CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END;
  _ref TEXT := 'Supplier invoice ' || COALESCE(NEW.invoice_number, '');
  _paid_on DATE := COALESCE(NEW.paid_at::date, CURRENT_DATE);
BEGIN
  IF NEW.status IS NOT DISTINCT FROM _old THEN RETURN NEW; END IF;
  IF NEW.status IN ('approved','paid') THEN
    IF NEW.bill_type = 'accrued' THEN
      PERFORM gl_auto_post(NEW.site_id, 'invoice_accrual', 'purchase_invoices', NEW.id,
                           COALESCE(NEW.invoice_date, CURRENT_DATE), NEW.total_amount, _ref || ' (clears accrual)');
    ELSE
      PERFORM gl_auto_post(NEW.site_id, 'invoice_approved', 'purchase_invoices', NEW.id,
                           COALESCE(NEW.invoice_date, CURRENT_DATE), NEW.total_amount, _ref);
    END IF;
  END IF;
  IF NEW.status = 'paid' THEN
    PERFORM gl_auto_post(NEW.site_id, 'invoice_paid', 'purchase_invoices', NEW.id, _paid_on, NEW.total_amount, _ref || ' paid');
    IF gl_imtt_on(NEW.site_id, NEW.total_amount) > 0 THEN
      PERFORM gl_auto_post(NEW.site_id, 'imtt', 'purchase_invoices', NEW.id, _paid_on, gl_imtt_on(NEW.site_id, NEW.total_amount), 'IMTT on ' || _ref);
    END IF;
  END IF;
  IF NEW.status IN ('cancelled','draft','pending_approval') AND _old IN ('approved','paid') THEN
    PERFORM gl_auto_reverse('purchase_invoices', NEW.id, 'Invoice status changed to ' || NEW.status);
  END IF;
  RETURN NEW;
END;
$function$;

INSERT INTO gl_posting_rules (site_id, event_code, debit_account_id, credit_account_id, is_active, is_archived)
SELECT s.site_id, m.event_code, d.id, c.id, true, false
  FROM finance_setup s CROSS JOIN finance_rule_template() m
  JOIN accounts d ON d.site_id = s.site_id AND d.code = m.debit_code AND NOT d.is_archived
  JOIN accounts c ON c.site_id = s.site_id AND c.code = m.credit_code AND NOT c.is_archived
 WHERE m.event_code = 'invoice_accrual'
   AND NOT EXISTS (SELECT 1 FROM gl_posting_rules g WHERE g.site_id = s.site_id AND g.event_code = m.event_code AND NOT g.is_archived);

INSERT INTO schema_migrations (filename) VALUES ('0212_bills_clear_accruals.sql') ON CONFLICT DO NOTHING;
