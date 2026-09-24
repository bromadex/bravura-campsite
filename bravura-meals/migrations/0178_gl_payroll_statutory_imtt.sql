-- 0178_gl_payroll_statutory_imtt.sql
-- Roadmap #48 Phase B (finance side): payroll posts PAYE, NSSA and employer NSSA
-- to their own payables, and IMTT (bank transfer tax) posts on every payment.
BEGIN;

-- New posting events
ALTER TABLE gl_posting_rules DROP CONSTRAINT IF EXISTS gl_posting_rules_event_code_check;
ALTER TABLE gl_posting_rules ADD CONSTRAINT gl_posting_rules_event_code_check CHECK (event_code IN (
  'fuel_issue','fuel_delivery',
  'grn_accepted',
  'invoice_approved','invoice_paid',
  'payroll_net','payroll_deductions','payroll_paye','payroll_nssa','payroll_nssa_employer','payroll_paid',
  'meals_approved',
  'imtt'));

-- IMTT settings per site
CREATE TABLE IF NOT EXISTS finance_tax_settings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id       UUID NOT NULL UNIQUE REFERENCES sites(id),
  imtt_enabled  BOOLEAN NOT NULL DEFAULT true,
  imtt_rate     NUMERIC(5,2) NOT NULL DEFAULT 2.00,   -- % of each electronic payment
  imtt_cap      NUMERIC(15,2),                        -- optional max per transfer (USD); NULL = no cap
  updated_by    UUID REFERENCES auth.users(id),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE finance_tax_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fts_select ON finance_tax_settings;
DROP POLICY IF EXISTS fts_insert ON finance_tax_settings;
DROP POLICY IF EXISTS fts_update ON finance_tax_settings;
CREATE POLICY fts_select ON finance_tax_settings FOR SELECT USING (_has_permission('FI01', site_id));
CREATE POLICY fts_insert ON finance_tax_settings FOR INSERT WITH CHECK (_has_permission('FI04', site_id));
CREATE POLICY fts_update ON finance_tax_settings FOR UPDATE USING (_has_permission('FI04', site_id));
INSERT INTO finance_tax_settings (site_id) SELECT id FROM sites ON CONFLICT (site_id) DO NOTHING;

-- IMTT on one transfer
CREATE OR REPLACE FUNCTION gl_imtt_on(p_site_id UUID, p_amount NUMERIC)
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((
    SELECT CASE WHEN NOT s.imtt_enabled THEN 0
                ELSE ROUND(LEAST(COALESCE(p_amount, 0) * s.imtt_rate / 100,
                                 COALESCE(s.imtt_cap, COALESCE(p_amount, 0) * s.imtt_rate / 100)), 2) END
      FROM finance_tax_settings s WHERE s.site_id = p_site_id), 0)
$$;

-- Supplier invoices: IMTT on payment
CREATE OR REPLACE FUNCTION trg_gl_purchase_invoices() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _old TEXT := CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END;
  _ref TEXT := 'Supplier invoice ' || COALESCE(NEW.invoice_number, '');
  _paid_on DATE := COALESCE(NEW.paid_at::date, CURRENT_DATE);
BEGIN
  IF NEW.status IS NOT DISTINCT FROM _old THEN RETURN NEW; END IF;

  IF NEW.status IN ('approved','paid') THEN
    PERFORM gl_auto_post(NEW.site_id, 'invoice_approved', 'purchase_invoices', NEW.id,
                         COALESCE(NEW.invoice_date, CURRENT_DATE), NEW.total_amount, _ref);
  END IF;
  IF NEW.status = 'paid' THEN
    PERFORM gl_auto_post(NEW.site_id, 'invoice_paid', 'purchase_invoices', NEW.id,
                         _paid_on, NEW.total_amount, _ref || ' paid');
    IF gl_imtt_on(NEW.site_id, NEW.total_amount) > 0 THEN
      PERFORM gl_auto_post(NEW.site_id, 'imtt', 'purchase_invoices', NEW.id,
                           _paid_on, gl_imtt_on(NEW.site_id, NEW.total_amount), 'IMTT on ' || _ref);
    END IF;
  END IF;
  IF NEW.status IN ('cancelled','draft','pending_approval') AND _old IN ('approved','paid') THEN
    PERFORM gl_auto_reverse('purchase_invoices', NEW.id, 'Invoice status changed to ' || NEW.status);
  END IF;
  RETURN NEW;
END;
$$;

-- Payroll: split statutory liabilities, employer NSSA, IMTT per employee transfer
CREATE OR REPLACE FUNCTION trg_gl_payroll_runs() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _old   TEXT := CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END;
  _ref   TEXT := 'Payroll ' || NEW.period_year || '-' || LPAD(NEW.period_month::text, 2, '0');
  _date  DATE := (make_date(NEW.period_year, NEW.period_month, 1) + INTERVAL '1 month - 1 day')::date;
  _paid  DATE := COALESCE(NEW.paid_at::date, CURRENT_DATE);
  _paye  NUMERIC := COALESCE(NEW.total_paye, 0) + COALESCE(NEW.total_aids_levy, 0);
  _nssa  NUMERIC := COALESCE(NEW.total_nssa_employee, 0);
  _other NUMERIC := COALESCE(NEW.total_deductions, 0) - _paye - _nssa;
  _imtt  NUMERIC;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM _old THEN RETURN NEW; END IF;

  IF NEW.status IN ('approved','paid') THEN
    PERFORM gl_auto_post(NEW.site_id, 'payroll_net', 'payroll_runs', NEW.id, _date,
                         NEW.total_net, _ref || ' net pay');
    -- Zero components (e.g. no other deductions) are simply not posted.
    IF _paye > 0 THEN
      PERFORM gl_auto_post(NEW.site_id, 'payroll_paye', 'payroll_runs', NEW.id, _date,
                           _paye, _ref || ' PAYE & AIDS levy');
    END IF;
    IF _nssa > 0 THEN
      PERFORM gl_auto_post(NEW.site_id, 'payroll_nssa', 'payroll_runs', NEW.id, _date,
                           _nssa, _ref || ' NSSA (employee)');
    END IF;
    IF COALESCE(NEW.total_nssa_employer, 0) > 0 THEN
      PERFORM gl_auto_post(NEW.site_id, 'payroll_nssa_employer', 'payroll_runs', NEW.id, _date,
                           NEW.total_nssa_employer, _ref || ' NSSA (employer)');
    END IF;
    IF _other > 0 THEN
      PERFORM gl_auto_post(NEW.site_id, 'payroll_deductions', 'payroll_runs', NEW.id, _date,
                           _other, _ref || ' other deductions');
    END IF;
  END IF;
  IF NEW.status = 'paid' THEN
    PERFORM gl_auto_post(NEW.site_id, 'payroll_paid', 'payroll_runs', NEW.id, _paid,
                         NEW.total_net, _ref || ' paid');
    SELECT COALESCE(SUM(gl_imtt_on(NEW.site_id, s.net_salary)), 0) INTO _imtt
      FROM salary_slips s WHERE s.payroll_run_id = NEW.id AND NOT s.is_archived AND s.net_salary > 0;
    IF _imtt > 0 THEN
      PERFORM gl_auto_post(NEW.site_id, 'imtt', 'payroll_runs', NEW.id, _paid, _imtt, 'IMTT on ' || _ref);
    END IF;
  END IF;
  IF NEW.status = 'draft' AND _old IN ('approved','paid') THEN
    PERFORM gl_auto_reverse('payroll_runs', NEW.id, 'Payroll reopened');
  END IF;
  RETURN NEW;
END;
$$;

-- Retries must recompute IMTT with current settings
CREATE OR REPLACE FUNCTION gl_retry_skipped(p_site_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _log    RECORD;
  _posted INT := 0;
  _still  INT := 0;
  _amount NUMERIC;
BEGIN
  IF NOT _has_permission('FI04', p_site_id) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  FOR _log IN SELECT * FROM gl_posting_log
               WHERE site_id = p_site_id AND status = 'skipped' ORDER BY created_at LOOP
    UPDATE gl_posting_log SET status = 'retried', updated_at = now() WHERE id = _log.id;
    _amount := CASE
      WHEN _log.source_table = 'fuel_transactions' THEN (SELECT gl_fuel_value(t) FROM fuel_transactions t WHERE t.id = _log.source_id)
      WHEN _log.source_table = 'daily_submissions' THEN gl_meal_submission_value(_log.source_id)
      WHEN _log.event_code = 'imtt' AND _log.source_table = 'purchase_invoices' THEN
        (SELECT gl_imtt_on(i.site_id, i.total_amount) FROM purchase_invoices i WHERE i.id = _log.source_id)
      WHEN _log.event_code = 'imtt' AND _log.source_table = 'payroll_runs' THEN
        (SELECT COALESCE(SUM(gl_imtt_on(s.site_id, s.net_salary)), 0) FROM salary_slips s
          WHERE s.payroll_run_id = _log.source_id AND NOT s.is_archived AND s.net_salary > 0)
      ELSE _log.amount END;
    IF gl_auto_post(_log.site_id, _log.event_code, _log.source_table, _log.source_id,
                    _log.entry_date, _amount, _log.description) IS NOT NULL THEN
      _posted := _posted + 1;
    ELSE
      _still := _still + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('posted', _posted, 'still_skipped', _still);
END;
$$;

INSERT INTO schema_migrations (filename)
VALUES ('0178_gl_payroll_statutory_imtt.sql')
ON CONFLICT DO NOTHING;

COMMIT;
