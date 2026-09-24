-- 0176_gl_auto_posting.sql
-- Roadmap #48 Phase A: approved operational documents post to the general ledger
-- automatically via triggers, and posted journals are locked (correct by void/reversal).
BEGIN;

-- ═══════════════════════════════════════════════════════════════════════
-- 1. Posting rules: which accounts each event debits / credits, per site
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS gl_posting_rules (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id           UUID NOT NULL REFERENCES sites(id),
  event_code        TEXT NOT NULL CHECK (event_code IN (
                      'fuel_issue','fuel_delivery',
                      'grn_accepted',
                      'invoice_approved','invoice_paid',
                      'payroll_net','payroll_deductions','payroll_paid',
                      'meals_approved')),
  debit_account_id  UUID REFERENCES accounts(id),
  credit_account_id UUID REFERENCES accounts(id),
  cost_centre_id    UUID REFERENCES cost_centres(id),
  is_active         BOOLEAN NOT NULL DEFAULT true,
  is_archived       BOOLEAN NOT NULL DEFAULT false,
  updated_by        UUID REFERENCES auth.users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (site_id, event_code)
);

ALTER TABLE gl_posting_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gpr_select ON gl_posting_rules;
DROP POLICY IF EXISTS gpr_insert ON gl_posting_rules;
DROP POLICY IF EXISTS gpr_update ON gl_posting_rules;
CREATE POLICY gpr_select ON gl_posting_rules FOR SELECT USING (_has_permission('FI01', site_id));
CREATE POLICY gpr_insert ON gl_posting_rules FOR INSERT WITH CHECK (_has_permission('FI04', site_id));
CREATE POLICY gpr_update ON gl_posting_rules FOR UPDATE USING (_has_permission('FI04', site_id));

-- ═══════════════════════════════════════════════════════════════════════
-- 2. Posting log: one row per attempted posting (posted / skipped / reversed)
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS gl_posting_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id        UUID NOT NULL REFERENCES sites(id),
  event_code     TEXT NOT NULL,
  source_table   TEXT NOT NULL,
  source_id      UUID NOT NULL,
  entry_date     DATE NOT NULL,
  amount         NUMERIC(15,2) NOT NULL DEFAULT 0,
  description    TEXT,
  journal_id     UUID REFERENCES journal_entries(id),
  status         TEXT NOT NULL CHECK (status IN ('posted','skipped','reversed','retried')),
  message        TEXT,
  created_by     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- At most one live (posted or waiting) posting per source event
CREATE UNIQUE INDEX IF NOT EXISTS uq_gl_posting_live
  ON gl_posting_log (source_table, source_id, event_code)
  WHERE status IN ('posted','skipped');
CREATE INDEX IF NOT EXISTS ix_gl_posting_site ON gl_posting_log (site_id, created_at DESC);

ALTER TABLE gl_posting_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gpl_select ON gl_posting_log;
CREATE POLICY gpl_select ON gl_posting_log FOR SELECT USING (_has_permission('FI01', site_id));
-- Writes only through SECURITY DEFINER functions below.

-- ═══════════════════════════════════════════════════════════════════════
-- 3. Core posting function
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION gl_auto_post(
  p_site_id      UUID,
  p_event_code   TEXT,
  p_source_table TEXT,
  p_source_id    UUID,
  p_entry_date   DATE,
  p_amount       NUMERIC,
  p_description  TEXT
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _rule    gl_posting_rules%ROWTYPE;
  _je_id   UUID;
  _amount  NUMERIC(15,2) := ROUND(COALESCE(p_amount, 0), 2);
  _msg     TEXT;
  _res     JSONB;
BEGIN
  -- Already posted or waiting? Nothing to do.
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

  -- Never let a posting failure block site operations: roll back the journal and log it.
  BEGIN
    INSERT INTO journal_entries (site_id, entry_number, entry_date, description, status,
                                 source_module, source_record_id, created_by)
    VALUES (p_site_id, finance_next_entry_number(p_site_id), p_entry_date, p_description,
            'draft', p_event_code, p_source_id, auth.uid())
    RETURNING id INTO _je_id;

    INSERT INTO journal_lines (journal_id, account_id, description, debit, credit, line_order, cost_centre_id)
    VALUES (_je_id, _rule.debit_account_id,  p_description, _amount, 0, 1, _rule.cost_centre_id),
           (_je_id, _rule.credit_account_id, p_description, 0, _amount, 2, _rule.cost_centre_id);

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
$$;

-- Reverse every live posting for a source record (optionally one event only).
CREATE OR REPLACE FUNCTION gl_auto_reverse(
  p_source_table TEXT,
  p_source_id    UUID,
  p_reason       TEXT,
  p_event_code   TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _log RECORD;
BEGIN
  FOR _log IN SELECT * FROM gl_posting_log
               WHERE source_table = p_source_table AND source_id = p_source_id
                 AND status IN ('posted','skipped')
                 AND (p_event_code IS NULL OR event_code = p_event_code) LOOP
    IF _log.status = 'posted' AND _log.journal_id IS NOT NULL THEN
      PERFORM finance_void_journal(_log.journal_id, p_reason);
    END IF;
    UPDATE gl_posting_log
       SET status = 'reversed', message = p_reason, updated_at = now()
     WHERE id = _log.id;
  END LOOP;
END;
$$;

-- Retry postings that were skipped (e.g. after rules are set up). Finance edit only.
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
    _amount := CASE _log.source_table
      WHEN 'fuel_transactions' THEN (SELECT gl_fuel_value(t) FROM fuel_transactions t WHERE t.id = _log.source_id)
      WHEN 'daily_submissions' THEN gl_meal_submission_value(_log.source_id)
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

-- ═══════════════════════════════════════════════════════════════════════
-- 4. Value helpers
-- ═══════════════════════════════════════════════════════════════════════
-- Fuel issue value: recorded cost, else litres × unit price, else litres × latest delivery price.
CREATE OR REPLACE FUNCTION gl_fuel_value(t fuel_transactions)
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    NULLIF(t.total_cost, 0),
    NULLIF(t.litres * t.unit_price, 0),
    t.litres * (SELECT d.unit_price FROM fuel_transactions d
                 WHERE d.site_id = t.site_id AND d.transaction_type = 'delivery'
                   AND NOT COALESCE(d.is_deleted, false) AND COALESCE(d.unit_price, 0) > 0
                   AND (t.tank_id IS NULL OR d.tank_id = t.tank_id)
                   AND d.transaction_date <= t.transaction_date
                 ORDER BY d.transaction_date DESC, d.created_at DESC LIMIT 1),
    0)
$$;

-- Meal cost for a daily submission, mirroring Billing.jsx (base price + day-of-week overrides).
CREATE OR REPLACE FUNCTION gl_meal_submission_value(p_submission_id UUID)
RETURNS NUMERIC LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _sub  daily_submissions%ROWTYPE;
  _p    meal_prices%ROWTYPE;
  _b NUMERIC; _l NUMERIC; _s NUMERIC;
  _cb INT; _cl INT; _cs INT;
  _dow INT;
BEGIN
  SELECT * INTO _sub FROM daily_submissions WHERE id = p_submission_id;
  IF NOT FOUND THEN RETURN 0; END IF;
  _dow := EXTRACT(DOW FROM _sub.date)::INT;

  SELECT * INTO _p FROM meal_prices
   WHERE site_id = _sub.site_id AND effective_date <= _sub.date
   ORDER BY effective_date DESC LIMIT 1;
  _b := COALESCE(_p.breakfast, 0); _l := COALESCE(_p.lunch, 0); _s := COALESCE(_p.supper, 0);

  SELECT COALESCE((SELECT price_usd FROM meal_price_overrides o WHERE o.site_id = _sub.site_id AND o.is_active
           AND o.day_of_week = _dow AND o.meal_type = 'breakfast' AND o.effective_date <= _sub.date
           ORDER BY o.effective_date DESC LIMIT 1), _b) INTO _b;
  SELECT COALESCE((SELECT price_usd FROM meal_price_overrides o WHERE o.site_id = _sub.site_id AND o.is_active
           AND o.day_of_week = _dow AND o.meal_type = 'lunch' AND o.effective_date <= _sub.date
           ORDER BY o.effective_date DESC LIMIT 1), _l) INTO _l;
  SELECT COALESCE((SELECT price_usd FROM meal_price_overrides o WHERE o.site_id = _sub.site_id AND o.is_active
           AND o.day_of_week = _dow AND o.meal_type = 'supper' AND o.effective_date <= _sub.date
           ORDER BY o.effective_date DESC LIMIT 1), _s) INTO _s;

  SELECT COUNT(*) FILTER (WHERE had_breakfast), COUNT(*) FILTER (WHERE had_lunch), COUNT(*) FILTER (WHERE had_supper)
    INTO _cb, _cl, _cs
    FROM meal_logs WHERE submission_id = p_submission_id;

  RETURN _cb * _b + _cl * _l + _cs * _s;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 5. Source triggers
-- ═══════════════════════════════════════════════════════════════════════

-- Fuel: issues and deliveries post on insert; edits reverse + repost; soft delete reverses.
CREATE OR REPLACE FUNCTION trg_gl_fuel_transactions() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _event TEXT;
  _desc  TEXT;
BEGIN
  _event := CASE NEW.transaction_type WHEN 'issuance' THEN 'fuel_issue'
                                      WHEN 'delivery' THEN 'fuel_delivery' END;
  IF _event IS NULL THEN RETURN NEW; END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.is_deleted IS NOT DISTINCT FROM OLD.is_deleted
       AND NEW.litres IS NOT DISTINCT FROM OLD.litres
       AND NEW.total_cost IS NOT DISTINCT FROM OLD.total_cost
       AND NEW.unit_price IS NOT DISTINCT FROM OLD.unit_price
       AND NEW.transaction_date IS NOT DISTINCT FROM OLD.transaction_date THEN
      RETURN NEW;
    END IF;
    PERFORM gl_auto_reverse('fuel_transactions', NEW.id,
      CASE WHEN COALESCE(NEW.is_deleted, false) THEN 'Fuel transaction deleted'
           ELSE 'Fuel transaction edited' END);
  END IF;

  IF COALESCE(NEW.is_deleted, false) THEN RETURN NEW; END IF;

  _desc := CASE _event WHEN 'fuel_issue' THEN 'Fuel issue ' ELSE 'Fuel delivery ' END
           || COALESCE(NEW.transaction_number, '') || ' — ' || COALESCE(NEW.litres, 0) || ' L';
  PERFORM gl_auto_post(NEW.site_id, _event, 'fuel_transactions', NEW.id,
                       COALESCE(NEW.transaction_date, CURRENT_DATE), gl_fuel_value(NEW), _desc);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gl_fuel_transactions ON fuel_transactions;
CREATE TRIGGER trg_gl_fuel_transactions
  AFTER INSERT OR UPDATE ON fuel_transactions
  FOR EACH ROW EXECUTE FUNCTION trg_gl_fuel_transactions();

-- Goods received: post when accepted, reverse if it leaves an accepted status.
CREATE OR REPLACE FUNCTION trg_gl_grn() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _was BOOLEAN := TG_OP = 'UPDATE' AND OLD.status IN ('accepted','accepted_partial');
  _is  BOOLEAN := NEW.status IN ('accepted','accepted_partial');
  _amt NUMERIC;
BEGIN
  IF _is AND NOT _was THEN
    SELECT COALESCE(SUM(COALESCE(quantity_received, 0) * COALESCE(unit_price, 0)), 0)
      INTO _amt FROM grn_lines WHERE grn_id = NEW.id;
    PERFORM gl_auto_post(NEW.site_id, 'grn_accepted', 'goods_received_notes', NEW.id,
                         COALESCE(NEW.received_date, CURRENT_DATE), _amt,
                         'Goods received ' || COALESCE(NEW.grn_number, ''));
  ELSIF _was AND NOT _is THEN
    PERFORM gl_auto_reverse('goods_received_notes', NEW.id, 'GRN status changed to ' || NEW.status);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gl_grn ON goods_received_notes;
CREATE TRIGGER trg_gl_grn
  AFTER INSERT OR UPDATE OF status ON goods_received_notes
  FOR EACH ROW EXECUTE FUNCTION trg_gl_grn();

-- Supplier invoices: approved → liability; paid → payment; cancelled → reverse both.
CREATE OR REPLACE FUNCTION trg_gl_purchase_invoices() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _old TEXT := CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END;
  _ref TEXT := 'Supplier invoice ' || COALESCE(NEW.invoice_number, '');
BEGIN
  IF NEW.status IS NOT DISTINCT FROM _old THEN RETURN NEW; END IF;

  IF NEW.status IN ('approved','paid') THEN
    PERFORM gl_auto_post(NEW.site_id, 'invoice_approved', 'purchase_invoices', NEW.id,
                         COALESCE(NEW.invoice_date, CURRENT_DATE), NEW.total_amount, _ref);
  END IF;
  IF NEW.status = 'paid' THEN
    PERFORM gl_auto_post(NEW.site_id, 'invoice_paid', 'purchase_invoices', NEW.id,
                         COALESCE(NEW.paid_at::date, CURRENT_DATE), NEW.total_amount, _ref || ' paid');
  END IF;
  IF NEW.status IN ('cancelled','draft','pending_approval') AND _old IN ('approved','paid') THEN
    PERFORM gl_auto_reverse('purchase_invoices', NEW.id, 'Invoice status changed to ' || NEW.status);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gl_purchase_invoices ON purchase_invoices;
CREATE TRIGGER trg_gl_purchase_invoices
  AFTER INSERT OR UPDATE OF status ON purchase_invoices
  FOR EACH ROW EXECUTE FUNCTION trg_gl_purchase_invoices();

-- Payroll: approved → net pay + statutory deductions accrued; paid → net pay settled.
CREATE OR REPLACE FUNCTION trg_gl_payroll_runs() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _old  TEXT := CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END;
  _ref  TEXT := 'Payroll ' || NEW.period_year || '-' || LPAD(NEW.period_month::text, 2, '0');
  _date DATE := (make_date(NEW.period_year, NEW.period_month, 1) + INTERVAL '1 month - 1 day')::date;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM _old THEN RETURN NEW; END IF;

  IF NEW.status IN ('approved','paid') THEN
    PERFORM gl_auto_post(NEW.site_id, 'payroll_net', 'payroll_runs', NEW.id, _date,
                         NEW.total_net, _ref || ' net pay');
    PERFORM gl_auto_post(NEW.site_id, 'payroll_deductions', 'payroll_runs', NEW.id, _date,
                         NEW.total_deductions, _ref || ' deductions');
  END IF;
  IF NEW.status = 'paid' THEN
    PERFORM gl_auto_post(NEW.site_id, 'payroll_paid', 'payroll_runs', NEW.id,
                         COALESCE(NEW.paid_at::date, CURRENT_DATE), NEW.total_net, _ref || ' paid');
  END IF;
  IF NEW.status = 'draft' AND _old IN ('approved','paid') THEN
    PERFORM gl_auto_reverse('payroll_runs', NEW.id, 'Payroll reopened');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gl_payroll_runs ON payroll_runs;
CREATE TRIGGER trg_gl_payroll_runs
  AFTER INSERT OR UPDATE OF status ON payroll_runs
  FOR EACH ROW EXECUTE FUNCTION trg_gl_payroll_runs();

-- Meals: approved daily submission → meal cost; reopened → reverse.
CREATE OR REPLACE FUNCTION trg_gl_daily_submissions() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'approved' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'approved') THEN
    PERFORM gl_auto_post(NEW.site_id, 'meals_approved', 'daily_submissions', NEW.id, NEW.date,
                         gl_meal_submission_value(NEW.id), 'Meals ' || NEW.date);
  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'approved' AND NEW.status IS DISTINCT FROM 'approved' THEN
    PERFORM gl_auto_reverse('daily_submissions', NEW.id, 'Meal submission reopened');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gl_daily_submissions ON daily_submissions;
CREATE TRIGGER trg_gl_daily_submissions
  AFTER INSERT OR UPDATE OF status ON daily_submissions
  FOR EACH ROW EXECUTE FUNCTION trg_gl_daily_submissions();

-- ═══════════════════════════════════════════════════════════════════════
-- 6. Locking: posted journals are immutable except for voiding
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION trg_lock_posted_journal() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'Posted or voided journals cannot be deleted — void it instead';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'void' THEN
    RAISE EXCEPTION 'Voided journals cannot be changed';
  END IF;
  IF OLD.status = 'posted' THEN
    IF NEW.status <> 'void'
       OR NEW.entry_date   IS DISTINCT FROM OLD.entry_date
       OR NEW.site_id      IS DISTINCT FROM OLD.site_id
       OR NEW.total_debit  IS DISTINCT FROM OLD.total_debit
       OR NEW.total_credit IS DISTINCT FROM OLD.total_credit THEN
      RAISE EXCEPTION 'Posted journals are locked — void and re-enter to correct';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lock_posted_journal ON journal_entries;
CREATE TRIGGER trg_lock_posted_journal
  BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION trg_lock_posted_journal();

CREATE OR REPLACE FUNCTION trg_lock_posted_journal_lines() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  _status TEXT;
BEGIN
  SELECT status INTO _status FROM journal_entries
   WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.journal_id ELSE NEW.journal_id END;
  IF _status IS NOT NULL AND _status <> 'draft' THEN
    RAISE EXCEPTION 'Lines of a posted journal cannot be changed';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS trg_lock_posted_journal_lines ON journal_lines;
CREATE TRIGGER trg_lock_posted_journal_lines
  BEFORE INSERT OR UPDATE OR DELETE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION trg_lock_posted_journal_lines();

-- Approved source documents: amounts locked once they have posted.
CREATE OR REPLACE FUNCTION trg_lock_approved_amounts() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'purchase_invoices' THEN
    IF OLD.status IN ('approved','paid') AND NEW.status = OLD.status
       AND (NEW.total_amount IS DISTINCT FROM OLD.total_amount
            OR NEW.subtotal IS DISTINCT FROM OLD.subtotal
            OR NEW.tax_amount IS DISTINCT FROM OLD.tax_amount) THEN
      RAISE EXCEPTION 'Approved invoices are locked — cancel and re-enter to correct';
    END IF;
  ELSIF TG_TABLE_NAME = 'payroll_runs' THEN
    IF OLD.status IN ('approved','paid') AND NEW.status = OLD.status
       AND (NEW.total_gross IS DISTINCT FROM OLD.total_gross
            OR NEW.total_net IS DISTINCT FROM OLD.total_net
            OR NEW.total_deductions IS DISTINCT FROM OLD.total_deductions) THEN
      RAISE EXCEPTION 'Approved payroll is locked — reopen to draft to correct';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lock_invoice_amounts ON purchase_invoices;
CREATE TRIGGER trg_lock_invoice_amounts
  BEFORE UPDATE ON purchase_invoices
  FOR EACH ROW EXECUTE FUNCTION trg_lock_approved_amounts();

DROP TRIGGER IF EXISTS trg_lock_payroll_amounts ON payroll_runs;
CREATE TRIGGER trg_lock_payroll_amounts
  BEFORE UPDATE ON payroll_runs
  FOR EACH ROW EXECUTE FUNCTION trg_lock_approved_amounts();

INSERT INTO schema_migrations (filename)
VALUES ('0176_gl_auto_posting.sql')
ON CONFLICT DO NOTHING;

COMMIT;
