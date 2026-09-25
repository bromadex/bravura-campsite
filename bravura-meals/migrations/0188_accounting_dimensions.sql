-- 0188: Accounting dimensions — tag every ledger line with a cost centre and project.
-- Documents carry cost_centre_id / project_id; gl_auto_post inherits them from the source document
-- (directly, or via its purchase order, fleet asset or fixed asset), falling back to the posting rule's
-- cost centre. fi_dimension_report() summarises the ledger by cost centre or project.

ALTER TABLE journal_lines ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_cc ON journal_lines (cost_centre_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_pj ON journal_lines (project_id);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['purchase_orders','purchase_requisitions','procurement_requisitions','expense_claims',
                           'petty_cash_transactions','fleet_work_orders','fleet_assets','fuel_transactions'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS cost_centre_id UUID REFERENCES cost_centres(id)', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id)', t);
  END LOOP;
END $$;

-- Dimensions of the document being posted.
CREATE OR REPLACE FUNCTION _gl_source_dims(p_table TEXT, p_id UUID, OUT cost_centre_id UUID, OUT project_id UUID)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _r JSONB; _x JSONB;
BEGIN
  IF p_table IS NULL OR p_id IS NULL OR to_regclass('public.' || p_table) IS NULL THEN RETURN; END IF;
  BEGIN
    EXECUTE format('SELECT to_jsonb(t) FROM %I t WHERE t.id = $1', p_table) INTO _r USING p_id;
  EXCEPTION WHEN OTHERS THEN RETURN;
  END;
  IF _r IS NULL THEN RETURN; END IF;
  cost_centre_id := NULLIF(_r->>'cost_centre_id', '')::uuid;
  project_id     := NULLIF(_r->>'project_id', '')::uuid;

  -- Inherit what's missing from the related record.
  IF p_table = 'asset_depreciation' THEN
    SELECT to_jsonb(a) INTO _x FROM fixed_assets a WHERE a.id = (_r->>'asset_id')::uuid;
  ELSIF _r ? 'po_id' AND _r->>'po_id' IS NOT NULL THEN
    SELECT to_jsonb(p) INTO _x FROM purchase_orders p WHERE p.id = (_r->>'po_id')::uuid;
  ELSIF p_table = 'fleet_work_orders' AND _r->>'asset_id' IS NOT NULL THEN
    SELECT to_jsonb(f) INTO _x FROM fleet_assets f WHERE f.id = (_r->>'asset_id')::uuid;
  ELSIF _r ? 'fleet_asset_id' AND _r->>'fleet_asset_id' IS NOT NULL THEN
    SELECT to_jsonb(f) INTO _x FROM fleet_assets f WHERE f.id = (_r->>'fleet_asset_id')::uuid;
  END IF;
  IF _x IS NOT NULL THEN
    cost_centre_id := COALESCE(cost_centre_id, NULLIF(_x->>'cost_centre_id', '')::uuid);
    project_id     := COALESCE(project_id, NULLIF(_x->>'project_id', '')::uuid);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.gl_auto_post(p_site_id uuid, p_event_code text, p_source_table text, p_source_id uuid, p_entry_date date, p_amount numeric, p_description text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _rule    gl_posting_rules%ROWTYPE;
  _je_id   UUID;
  _amount  NUMERIC(15,2) := ROUND(COALESCE(p_amount, 0), 2);
  _msg     TEXT;
  _res     JSONB;
  _dims    RECORD;
  _cc      UUID;
BEGIN
  IF EXISTS (SELECT 1 FROM gl_posting_log
              WHERE source_table = p_source_table AND source_id = p_source_id
                AND event_code = p_event_code AND status IN ('posted','skipped')) THEN
    RETURN NULL;
  END IF;

  IF _amount <= 0 THEN
    _msg := 'No value to post (amount is zero or unknown)';
  ELSE
    SELECT * INTO _rule FROM gl_posting_rules
     WHERE site_id = p_site_id AND event_code = p_event_code
       AND is_active AND NOT is_archived;
    IF NOT FOUND OR _rule.debit_account_id IS NULL OR _rule.credit_account_id IS NULL THEN
      _msg := 'No posting rule set up for this event';
    END IF;
  END IF;

  IF _msg IS NOT NULL THEN
    INSERT INTO gl_posting_log (site_id, event_code, source_table, source_id, entry_date,
                                amount, description, status, message, created_by)
    VALUES (p_site_id, p_event_code, p_source_table, p_source_id, p_entry_date,
            _amount, p_description, 'skipped', _msg, auth.uid());
    RETURN NULL;
  END IF;

  SELECT * INTO _dims FROM _gl_source_dims(p_source_table, p_source_id);
  _cc := COALESCE(_dims.cost_centre_id, _rule.cost_centre_id);

  BEGIN
    INSERT INTO journal_entries (site_id, entry_number, entry_date, description, status,
                                 source_module, source_record_id, created_by)
    VALUES (p_site_id, finance_next_entry_number(p_site_id), p_entry_date, p_description,
            'draft', p_event_code, p_source_id, auth.uid())
    RETURNING id INTO _je_id;

    INSERT INTO journal_lines (journal_id, account_id, description, debit, credit, line_order, cost_centre_id, project_id)
    VALUES (_je_id, _rule.debit_account_id,  p_description, _amount, 0, 1, _cc, _dims.project_id),
           (_je_id, _rule.credit_account_id, p_description, 0, _amount, 2, _cc, _dims.project_id);

    _res := finance_post_journal(_je_id);
    IF NOT COALESCE((_res->>'ok')::boolean, false) THEN
      RAISE EXCEPTION '%', _res->>'error';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO gl_posting_log (site_id, event_code, source_table, source_id, entry_date,
                                amount, description, status, message, created_by)
    VALUES (p_site_id, p_event_code, p_source_table, p_source_id, p_entry_date,
            _amount, p_description, 'skipped', 'Posting failed: ' || SQLERRM, auth.uid());
    RETURN NULL;
  END;

  INSERT INTO gl_posting_log (site_id, event_code, source_table, source_id, entry_date,
                              amount, description, journal_id, status, created_by)
  VALUES (p_site_id, p_event_code, p_source_table, p_source_id, p_entry_date,
          _amount, p_description, _je_id, 'posted', auth.uid());
  RETURN _je_id;
END;
$function$;

-- Ledger summary by cost centre or project (posted journals only).
CREATE OR REPLACE FUNCTION fi_dimension_report(p_site_id UUID, p_from DATE, p_to DATE, p_dimension TEXT)
RETURNS TABLE (dim_id UUID, dim_code TEXT, dim_name TEXT, account_id UUID, account_code TEXT, account_name TEXT,
               account_type TEXT, debit NUMERIC, credit NUMERIC, net NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT _has_permission('FI01', p_site_id) THEN RAISE EXCEPTION 'You do not have access to finance reports'; END IF;
  IF p_dimension NOT IN ('cost_centre','project') THEN RAISE EXCEPTION 'Unknown dimension'; END IF;
  RETURN QUERY
  SELECT d.id, d.code, d.name, a.id, a.code, a.name, a.account_type,
         SUM(l.debit), SUM(l.credit), SUM(l.debit - l.credit)
    FROM journal_lines l
    JOIN journal_entries je ON je.id = l.journal_id
    JOIN accounts a ON a.id = l.account_id
    LEFT JOIN LATERAL (
      SELECT cc.id, cc.code, cc.name FROM cost_centres cc WHERE p_dimension = 'cost_centre' AND cc.id = l.cost_centre_id
      UNION ALL
      SELECT pj.id, pj.project_code, pj.name FROM projects pj WHERE p_dimension = 'project' AND pj.id = l.project_id
    ) d ON true
   WHERE je.site_id = p_site_id AND je.status = 'posted' AND NOT COALESCE(je.is_archived, false)
     AND je.entry_date BETWEEN p_from AND p_to
   GROUP BY d.id, d.code, d.name, a.id, a.code, a.name, a.account_type
   ORDER BY d.name NULLS LAST, a.code;
END;
$$;
REVOKE ALL ON FUNCTION fi_dimension_report(UUID, DATE, DATE, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION fi_dimension_report(UUID, DATE, DATE, TEXT) TO authenticated;

-- Allow the fixed-asset events (0186) in posting rules.
ALTER TABLE gl_posting_rules DROP CONSTRAINT IF EXISTS gl_posting_rules_event_code_check;
ALTER TABLE gl_posting_rules ADD CONSTRAINT gl_posting_rules_event_code_check CHECK (event_code IN (
  'fuel_issue','fuel_delivery','grn_accepted','invoice_approved','invoice_paid','payroll_net','payroll_deductions','payroll_paye',
  'payroll_nssa','payroll_nssa_employer','payroll_paid','payroll_loan_recovery','meals_approved','imtt','expense_approved',
  'advance_settled','expense_paid','expense_paid_cash','advance_paid','advance_paid_cash','petty_cash_topup','petty_cash_expense',
  'petty_cash_short','petty_cash_over','staff_loan_paid',
  'asset_capitalised','asset_depreciation','asset_disposal_accum','asset_disposal_loss','asset_disposal_proceeds'));

INSERT INTO schema_migrations (filename) VALUES ('0188_accounting_dimensions.sql') ON CONFLICT DO NOTHING;
