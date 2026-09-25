-- 0213 bill_accrual_matching — match an 'accrued' supplier bill to the exact timesheets, hired-plant
-- usage logs and incidents it covers.
--   • bill_accrual_links: which accrued items a bill covers (one live bill per item).
--   • ap_unbilled_accruals(site): accrued items posted to 2200 that no live bill covers yet.
--   • ap_set_bill_accruals(invoice, items[]): replace a draft/pending bill's matched items.
--   • On approval an accrued bill still posts invoice_accrual (Dr 2200 / Cr 2100) for the bill total,
--     then evens out 2200 so exactly the matched amount leaves it:
--       bill < matched → accrual_release  Dr 2200 / Cr 6510 (cost over-accrued)
--       bill > matched → accrual_topup    Dr 6510 / Cr 2200 (cost under-accrued)
--     Bills with no matched items behave as in 0212.

CREATE TABLE IF NOT EXISTS bill_accrual_links (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id      uuid NOT NULL REFERENCES sites(id),
  invoice_id   uuid NOT NULL REFERENCES purchase_invoices(id),
  source_table text NOT NULL CHECK (source_table IN ('casual_timesheets','equipment_usage_log','sheq_incidents')),
  source_id    uuid NOT NULL,
  amount       numeric(14,2) NOT NULL,
  created_by   uuid DEFAULT auth.uid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  is_archived  boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS bill_accrual_links_inv ON bill_accrual_links (invoice_id) WHERE NOT is_archived;
CREATE INDEX IF NOT EXISTS bill_accrual_links_src ON bill_accrual_links (source_table, source_id) WHERE NOT is_archived;
ALTER TABLE bill_accrual_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bal_select ON bill_accrual_links;
CREATE POLICY bal_select ON bill_accrual_links FOR SELECT TO authenticated USING (_ap_can('view', site_id));
-- writes only through ap_set_bill_accruals

ALTER TABLE gl_posting_rules DROP CONSTRAINT IF EXISTS gl_posting_rules_event_code_check;
ALTER TABLE gl_posting_rules ADD CONSTRAINT gl_posting_rules_event_code_check CHECK (event_code = ANY (ARRAY[
  'fuel_issue','fuel_delivery','grn_accepted','invoice_approved','invoice_paid','payroll_net','payroll_deductions',
  'payroll_paye','payroll_nssa','payroll_nssa_employer','payroll_paid','payroll_loan_recovery','meals_approved','imtt',
  'expense_approved','advance_settled','expense_paid','expense_paid_cash','advance_paid','advance_paid_cash',
  'petty_cash_topup','petty_cash_expense','petty_cash_short','petty_cash_over','staff_loan_paid','asset_capitalised',
  'asset_depreciation','asset_disposal_accum','asset_disposal_loss','asset_disposal_proceeds','landed_cost',
  'stock_issue','stock_issue_camp','stock_return','stock_loss','stock_gain',
  'contractor_labour','hired_plant_usage','sheq_incident_cost','invoice_accrual','accrual_release','accrual_topup']));

CREATE OR REPLACE FUNCTION public.finance_rule_template()
 RETURNS TABLE(event_code text, debit_code text, credit_code text) LANGUAGE sql IMMUTABLE AS $$
  SELECT * FROM (VALUES
  ('fuel_delivery','1310','2100'), ('fuel_issue','6110','1310'),
  ('grn_accepted','1320','2150'), ('landed_cost','1320','2160'),
  ('invoice_approved','2150','2100'), ('invoice_accrual','2200','2100'), ('invoice_paid','2100','1110'),
  ('accrual_release','2200','6510'), ('accrual_topup','6510','2200'),
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

-- Accrued items not yet covered by a live bill (i.e. one that isn't cancelled / archived link).
CREATE OR REPLACE FUNCTION public.ap_unbilled_accruals(p_site uuid, p_invoice uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT _ap_can('view', p_site) THEN RAISE EXCEPTION 'No access'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(x ORDER BY x->>'date', x->>'description') FROM (
    SELECT jsonb_build_object(
      'source_table', l.source_table, 'source_id', l.source_id, 'date', l.entry_date, 'amount', l.amount,
      'description', l.description,
      'kind', CASE l.event_code WHEN 'contractor_labour' THEN 'Timesheet' WHEN 'hired_plant_usage' THEN 'Hired plant' ELSE 'Incident' END,
      'party', COALESCE(ct.name, ce.name),
      'worker', cw.name,
      'selected', EXISTS (SELECT 1 FROM bill_accrual_links b WHERE b.invoice_id = p_invoice AND b.source_id = l.source_id AND NOT b.is_archived)) AS x
      FROM gl_posting_log l
      LEFT JOIN casual_timesheets t ON l.source_table = 'casual_timesheets' AND t.id = l.source_id
      LEFT JOIN contractors ct ON ct.id = t.contractor_id
      LEFT JOIN casual_workers cw ON cw.id = t.casual_worker_id
      LEFT JOIN equipment_usage_log u ON l.source_table = 'equipment_usage_log' AND u.id = l.source_id
      LEFT JOIN hired_equipment he ON he.id = u.equipment_id
      LEFT JOIN contractors ce ON ce.id = he.contractor_id
     WHERE l.site_id = p_site AND l.status = 'posted'
       AND l.event_code IN ('contractor_labour','hired_plant_usage','sheq_incident_cost')
       AND EXISTS (SELECT 1 FROM journal_entries j WHERE j.id = l.journal_id AND j.status = 'posted')
       AND NOT EXISTS (SELECT 1 FROM bill_accrual_links b JOIN purchase_invoices i ON i.id = b.invoice_id
                        WHERE b.source_id = l.source_id AND NOT b.is_archived AND i.status NOT IN ('cancelled','rejected')
                          AND b.invoice_id IS DISTINCT FROM p_invoice)
  ) s), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.ap_set_bill_accruals(p_invoice uuid, p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _inv purchase_invoices%ROWTYPE; _it jsonb; _amt numeric; _n int := 0; _total numeric := 0;
BEGIN
  SELECT * INTO _inv FROM purchase_invoices WHERE id = p_invoice FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bill not found'; END IF;
  IF NOT _ap_can('edit', _inv.site_id) AND NOT _ap_can('create', _inv.site_id) THEN RAISE EXCEPTION 'No access'; END IF;
  IF _inv.status NOT IN ('draft','pending_approval') THEN RAISE EXCEPTION 'Only a draft or pending bill can change what it covers'; END IF;
  UPDATE bill_accrual_links SET is_archived = true WHERE invoice_id = p_invoice AND NOT is_archived;
  FOR _it IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) LOOP
    _amt := NULL;
    SELECT l.amount INTO _amt FROM gl_posting_log l
     WHERE l.site_id = _inv.site_id AND l.status = 'posted' AND l.source_table = _it->>'source_table'
       AND l.source_id = (_it->>'source_id')::uuid
       AND l.event_code IN ('contractor_labour','hired_plant_usage','sheq_incident_cost');
    IF _amt IS NULL THEN RAISE EXCEPTION 'An item has not been accrued in the ledger yet'; END IF;
    IF EXISTS (SELECT 1 FROM bill_accrual_links b JOIN purchase_invoices i ON i.id = b.invoice_id
                WHERE b.source_id = (_it->>'source_id')::uuid AND NOT b.is_archived AND i.status NOT IN ('cancelled','rejected') AND b.invoice_id <> p_invoice) THEN
      RAISE EXCEPTION 'An item is already on another bill';
    END IF;
    INSERT INTO bill_accrual_links (site_id, invoice_id, source_table, source_id, amount)
    VALUES (_inv.site_id, p_invoice, _it->>'source_table', (_it->>'source_id')::uuid, _amt);
    _n := _n + 1; _total := _total + _amt;
  END LOOP;
  IF _n > 0 AND _inv.bill_type <> 'accrued' THEN UPDATE purchase_invoices SET bill_type = 'accrued' WHERE id = p_invoice; END IF;
  RETURN jsonb_build_object('items', _n, 'matched', _total, 'bill', _inv.total_amount, 'difference', _inv.total_amount - _total);
END $$;
REVOKE ALL ON FUNCTION ap_unbilled_accruals(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION ap_set_bill_accruals(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION ap_unbilled_accruals(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION ap_set_bill_accruals(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.trg_gl_purchase_invoices()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _old TEXT := CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END;
  _ref TEXT := 'Supplier invoice ' || COALESCE(NEW.invoice_number, '');
  _paid_on DATE := COALESCE(NEW.paid_at::date, CURRENT_DATE);
  _matched NUMERIC; _n INT;
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
 WHERE m.event_code IN ('accrual_release','accrual_topup')
   AND NOT EXISTS (SELECT 1 FROM gl_posting_rules g WHERE g.site_id = s.site_id AND g.event_code = m.event_code AND NOT g.is_archived);

INSERT INTO schema_migrations (filename) VALUES ('0213_bill_accrual_matching.sql') ON CONFLICT DO NOTHING;
