-- 0181_expenses_petty_cash.sql
-- Roadmap #48 Phase D: employee expense claims & advances, and petty cash per site.
-- Everything here is company spending — no revenue accounts are involved.
BEGIN;

-- ═══════════════════════════════════════════════════════════════════════
-- 1. Permissions (granted to finance editors and user admins)
-- ═══════════════════════════════════════════════════════════════════════
INSERT INTO permissions (code, module, action, description) VALUES
  ('expenses.view',    'expenses',  'View',    'See all expense claims at a site'),
  ('expenses.edit',    'expenses',  'Edit',    'Pay approved expense claims and advances'),
  ('expenses.approve', 'expenses',  'Approve', 'Approve or reject expense claims'),
  ('pettycash.view',   'pettycash', 'View',    'See petty cash funds and transactions'),
  ('pettycash.create', 'pettycash', 'Create',  'Record petty cash spending'),
  ('pettycash.edit',   'pettycash', 'Edit',    'Set up funds, top up, count and void')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT DISTINCT rp.role_id, np.id
  FROM role_permissions rp
  JOIN permissions p  ON p.id = rp.permission_id AND p.code IN ('FI04', 'users.edit')
  JOIN permissions np ON np.code IN ('expenses.view','expenses.edit','expenses.approve','pettycash.view','pettycash.create','pettycash.edit')
 WHERE NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = rp.role_id AND x.permission_id = np.id);

-- ═══════════════════════════════════════════════════════════════════════
-- 2. Tables
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS petty_cash_funds (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id       UUID NOT NULL REFERENCES sites(id),
  name          TEXT NOT NULL,
  custodian_id  UUID REFERENCES profiles(id),
  float_amount  NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (float_amount >= 0),
  balance       NUMERIC(15,2) NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  is_archived   BOOLEAN NOT NULL DEFAULT false,
  created_by    UUID REFERENCES profiles(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS expense_claims (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id            UUID NOT NULL REFERENCES sites(id),
  claim_number       TEXT,
  employee_id        UUID NOT NULL REFERENCES employees(id),
  requested_by       UUID NOT NULL REFERENCES profiles(id),
  claim_type         TEXT NOT NULL DEFAULT 'reimbursement' CHECK (claim_type IN ('reimbursement','advance')),
  purpose            TEXT NOT NULL,
  total_amount       NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  advance_id         UUID REFERENCES expense_claims(id),
  settled_amount     NUMERIC(15,2) NOT NULL DEFAULT 0,   -- part of this claim covered by the linked advance
  status             TEXT NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft','submitted','approved','rejected','paid','cancelled')),
  payment_method     TEXT CHECK (payment_method IN ('bank','petty_cash')),
  petty_cash_fund_id UUID REFERENCES petty_cash_funds(id),
  payment_ref        TEXT,
  submitted_at       TIMESTAMPTZ,
  approved_by        UUID REFERENCES profiles(id),
  approved_at        TIMESTAMPTZ,
  rejected_reason    TEXT,
  paid_by            UUID REFERENCES profiles(id),
  paid_at            TIMESTAMPTZ,
  is_archived        BOOLEAN NOT NULL DEFAULT false,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (claim_type = 'reimbursement' OR advance_id IS NULL)
);
CREATE INDEX IF NOT EXISTS ix_expense_claims_site ON expense_claims (site_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_expense_claims_employee ON expense_claims (employee_id, created_at DESC);

CREATE TABLE IF NOT EXISTS expense_claim_lines (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id      UUID NOT NULL REFERENCES expense_claims(id),
  expense_date  DATE NOT NULL,
  category      TEXT NOT NULL CHECK (category IN ('travel','accommodation','meals','fuel','tools','medical','communication','other')),
  description   TEXT NOT NULL,
  amount        NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  receipt_path  TEXT,
  is_archived   BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_expense_claim_lines_claim ON expense_claim_lines (claim_id);

CREATE TABLE IF NOT EXISTS petty_cash_transactions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id          UUID NOT NULL REFERENCES sites(id),
  fund_id          UUID NOT NULL REFERENCES petty_cash_funds(id),
  txn_date         DATE NOT NULL DEFAULT CURRENT_DATE,
  txn_type         TEXT NOT NULL CHECK (txn_type IN ('top_up','expense','claim_payment','advance','adjustment')),
  direction        TEXT NOT NULL CHECK (direction IN ('in','out')),
  amount           NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  category         TEXT,
  description      TEXT NOT NULL,
  receipt_path     TEXT,
  reference        TEXT,
  expense_claim_id UUID REFERENCES expense_claims(id),
  status           TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','void')),
  void_reason      TEXT,
  created_by       UUID REFERENCES profiles(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_petty_cash_txn_fund ON petty_cash_transactions (fund_id, txn_date DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS petty_cash_counts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id          UUID NOT NULL REFERENCES sites(id),
  fund_id          UUID NOT NULL REFERENCES petty_cash_funds(id),
  count_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  expected_balance NUMERIC(15,2) NOT NULL,
  counted_amount   NUMERIC(15,2) NOT NULL CHECK (counted_amount >= 0),
  variance         NUMERIC(15,2) NOT NULL,
  notes            TEXT,
  counted_by       UUID REFERENCES profiles(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════════
-- 3. Helpers
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION expense_advance_outstanding(p_advance_id UUID)
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN a.status <> 'paid' THEN 0 ELSE
    a.total_amount - COALESCE((SELECT SUM(c.settled_amount) FROM expense_claims c
                                WHERE c.advance_id = a.id AND c.status IN ('approved','paid')), 0) END
    FROM expense_claims a WHERE a.id = p_advance_id AND a.claim_type = 'advance'
$$;

-- Claim numbers per site and year: EXP-2026-0001
CREATE OR REPLACE FUNCTION trg_expense_claim_number() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n INT;
BEGIN
  IF NEW.claim_number IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('expense_claim_number:' || NEW.site_id::text));
    SELECT COALESCE(MAX(NULLIF(split_part(claim_number, '-', 3), '')::INT), 0) + 1 INTO _n
      FROM expense_claims
     WHERE site_id = NEW.site_id AND claim_number LIKE 'EXP-' || EXTRACT(YEAR FROM now())::INT || '-%';
    NEW.claim_number := 'EXP-' || EXTRACT(YEAR FROM now())::INT || '-' || LPAD(_n::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_expense_claim_number ON expense_claims;
CREATE TRIGGER trg_expense_claim_number BEFORE INSERT ON expense_claims
  FOR EACH ROW EXECUTE FUNCTION trg_expense_claim_number();

-- On approval, a claim linked to an advance uses up as much of the advance as it can.
CREATE OR REPLACE FUNCTION trg_expense_claim_settle() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
    NEW.approved_at := COALESCE(NEW.approved_at, now());
    NEW.approved_by := COALESCE(NEW.approved_by, auth.uid());
    IF NEW.advance_id IS NOT NULL THEN
      NEW.settled_amount := LEAST(NEW.total_amount, GREATEST(expense_advance_outstanding(NEW.advance_id), 0));
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_expense_claim_settle ON expense_claims;
CREATE TRIGGER trg_expense_claim_settle BEFORE UPDATE ON expense_claims
  FOR EACH ROW EXECUTE FUNCTION trg_expense_claim_settle();

-- ═══════════════════════════════════════════════════════════════════════
-- 4. Petty cash balance + guard
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION trg_petty_cash_guard() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _bal NUMERIC;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.direction = 'out' AND NEW.status = 'posted' THEN
    SELECT balance INTO _bal FROM petty_cash_funds WHERE id = NEW.fund_id FOR UPDATE;
    IF NEW.amount > _bal THEN
      RAISE EXCEPTION 'Not enough cash in this fund (balance %, needed %). Top it up first.', _bal, NEW.amount;
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.amount IS DISTINCT FROM OLD.amount OR NEW.direction IS DISTINCT FROM OLD.direction
                           OR NEW.fund_id IS DISTINCT FROM OLD.fund_id OR (OLD.status = 'void' AND NEW.status <> 'void')) THEN
    RAISE EXCEPTION 'Petty cash entries cannot be edited — void it and record it again';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_petty_cash_guard ON petty_cash_transactions;
CREATE TRIGGER trg_petty_cash_guard BEFORE INSERT OR UPDATE ON petty_cash_transactions
  FOR EACH ROW EXECUTE FUNCTION trg_petty_cash_guard();

-- ═══════════════════════════════════════════════════════════════════════
-- 5. Posting events
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE gl_posting_rules DROP CONSTRAINT IF EXISTS gl_posting_rules_event_code_check;
ALTER TABLE gl_posting_rules ADD CONSTRAINT gl_posting_rules_event_code_check CHECK (event_code IN (
  'fuel_issue','fuel_delivery',
  'grn_accepted',
  'invoice_approved','invoice_paid',
  'payroll_net','payroll_deductions','payroll_paye','payroll_nssa','payroll_nssa_employer','payroll_paid',
  'meals_approved',
  'imtt',
  'expense_approved','advance_settled','expense_paid','expense_paid_cash','advance_paid','advance_paid_cash',
  'petty_cash_topup','petty_cash_expense','petty_cash_short','petty_cash_over'));

CREATE OR REPLACE FUNCTION trg_petty_cash_after() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _delta NUMERIC;
  _event TEXT;
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
  -- Claim payments and advances are posted from the claim itself.
  _event := CASE
    WHEN NEW.txn_type = 'top_up' THEN 'petty_cash_topup'
    WHEN NEW.txn_type = 'expense' THEN 'petty_cash_expense'
    WHEN NEW.txn_type = 'adjustment' AND NEW.direction = 'out' THEN 'petty_cash_short'
    WHEN NEW.txn_type = 'adjustment' AND NEW.direction = 'in' THEN 'petty_cash_over' END;
  IF _event IS NOT NULL THEN
    PERFORM gl_auto_post(NEW.site_id, _event, 'petty_cash_transactions', NEW.id, NEW.txn_date, NEW.amount,
                         'Petty cash: ' || NEW.description);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_petty_cash_after ON petty_cash_transactions;
CREATE TRIGGER trg_petty_cash_after AFTER INSERT OR UPDATE ON petty_cash_transactions
  FOR EACH ROW EXECUTE FUNCTION trg_petty_cash_after();

CREATE OR REPLACE FUNCTION trg_gl_expense_claims() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _ref     TEXT := COALESCE(NEW.claim_number, 'Expense claim') || ' — ' || COALESCE(NEW.purpose, '');
  _payable NUMERIC;
  _cash    BOOLEAN := NEW.payment_method = 'petty_cash';
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;

  IF NEW.status = 'approved' AND NEW.claim_type = 'reimbursement' THEN
    PERFORM gl_auto_post(NEW.site_id, 'expense_approved', 'expense_claims', NEW.id, CURRENT_DATE, NEW.total_amount, _ref);
    IF NEW.settled_amount > 0 THEN
      PERFORM gl_auto_post(NEW.site_id, 'advance_settled', 'expense_claims', NEW.id, CURRENT_DATE, NEW.settled_amount,
                           _ref || ' (against advance)');
    END IF;
  ELSIF NEW.status = 'paid' THEN
    IF NEW.claim_type = 'advance' THEN
      PERFORM gl_auto_post(NEW.site_id, CASE WHEN _cash THEN 'advance_paid_cash' ELSE 'advance_paid' END,
                           'expense_claims', NEW.id, COALESCE(NEW.paid_at::date, CURRENT_DATE), NEW.total_amount, 'Advance ' || _ref);
      _payable := NEW.total_amount;
    ELSE
      _payable := NEW.total_amount - NEW.settled_amount;
      IF _payable > 0 THEN
        PERFORM gl_auto_post(NEW.site_id, CASE WHEN _cash THEN 'expense_paid_cash' ELSE 'expense_paid' END,
                             'expense_claims', NEW.id, COALESCE(NEW.paid_at::date, CURRENT_DATE), _payable, _ref || ' paid');
      END IF;
    END IF;
    IF NOT _cash AND gl_imtt_on(NEW.site_id, _payable) > 0 THEN
      PERFORM gl_auto_post(NEW.site_id, 'imtt', 'expense_claims', NEW.id, COALESCE(NEW.paid_at::date, CURRENT_DATE),
                           gl_imtt_on(NEW.site_id, _payable), 'IMTT on ' || _ref);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_gl_expense_claims ON expense_claims;
CREATE TRIGGER trg_gl_expense_claims AFTER UPDATE OF status ON expense_claims
  FOR EACH ROW EXECUTE FUNCTION trg_gl_expense_claims();

-- ═══════════════════════════════════════════════════════════════════════
-- 6. Approval engine: expense claims become a routable document
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE approval_routes DROP CONSTRAINT IF EXISTS approval_routes_entity_type_check;
ALTER TABLE approval_routes ADD CONSTRAINT approval_routes_entity_type_check CHECK (entity_type IN
  ('purchase_requisitions','purchase_orders','purchase_invoices','fuel_requests','leave_requests','expense_claims'));

CREATE OR REPLACE FUNCTION _approval_submitted_status(p_entity TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_entity
    WHEN 'purchase_requisitions' THEN 'submitted'
    WHEN 'purchase_orders'       THEN 'pending_approval'
    WHEN 'purchase_invoices'     THEN 'pending_approval'
    WHEN 'fuel_requests'         THEN 'pending'
    WHEN 'leave_requests'        THEN 'pending'
    WHEN 'expense_claims'        THEN 'submitted' END
$$;

CREATE OR REPLACE FUNCTION _approval_entity(p_entity TEXT, p_id UUID)
RETURNS TABLE (site_id UUID, amount NUMERIC, department_id UUID, requested_by UUID, title TEXT, link TEXT, status TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_entity = 'purchase_requisitions' THEN
    RETURN QUERY SELECT r.site_id,
      COALESCE((SELECT SUM(COALESCE(l.quantity,0) * COALESCE(l.estimated_cost,0)) FROM requisition_lines l WHERE l.requisition_id = r.id), 0),
      NULL::UUID, r.requested_by, 'Requisition ' || COALESCE(r.requisition_no, ''), '/inventory/inv_requisitions', r.status
      FROM purchase_requisitions r WHERE r.id = p_id;
  ELSIF p_entity = 'purchase_orders' THEN
    RETURN QUERY SELECT o.site_id, COALESCE(o.total_amount, 0), NULL::UUID, o.created_by,
      'Purchase order ' || COALESCE(o.po_number, ''), '/inventory/inv_purchase_orders', o.status
      FROM purchase_orders o WHERE o.id = p_id;
  ELSIF p_entity = 'purchase_invoices' THEN
    RETURN QUERY SELECT i.site_id, COALESCE(i.total_amount, 0), NULL::UUID, i.created_by,
      'Supplier invoice ' || COALESCE(i.invoice_number, ''), '/procurement/proc_invoices', i.status
      FROM purchase_invoices i WHERE i.id = p_id;
  ELSIF p_entity = 'fuel_requests' THEN
    RETURN QUERY SELECT f.site_id, COALESCE(f.quantity_requested, 0), NULL::UUID, COALESCE(f.requested_by, f.created_by),
      'Fuel request ' || COALESCE(f.request_number, '') || ' (' || COALESCE(f.quantity_requested, 0) || ' L)', '/fuel/fuel_requests_list', f.status
      FROM fuel_requests f WHERE f.id = p_id;
  ELSIF p_entity = 'leave_requests' THEN
    RETURN QUERY SELECT l.site_id, COALESCE(l.days_requested, 0), e.department_id, l.created_by,
      'Leave — ' || COALESCE(e.name, 'employee') || ' (' || COALESCE(l.days_requested, 0) || ' days)', '/workforce/wf_leave_requests', l.status
      FROM leave_requests l LEFT JOIN employees e ON e.id = l.employee_id WHERE l.id = p_id;
  ELSIF p_entity = 'expense_claims' THEN
    RETURN QUERY SELECT c.site_id, COALESCE(c.total_amount, 0), e.department_id, c.requested_by,
      CASE WHEN c.claim_type = 'advance' THEN 'Advance ' ELSE 'Expense claim ' END || COALESCE(c.claim_number, '')
        || ' — ' || COALESCE(e.name, ''), '/finance/fi_expense_claims', c.status
      FROM expense_claims c LEFT JOIN employees e ON e.id = c.employee_id WHERE c.id = p_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION _approval_apply(p_entity TEXT, p_id UUID, p_approved BOOLEAN, p_comment TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM set_config('app.approval_engine', 'on', true);
  IF p_entity = 'purchase_requisitions' THEN
    IF p_approved THEN
      UPDATE purchase_requisitions SET status = 'approved', approved_by = auth.uid(), approved_at = now(), updated_at = now() WHERE id = p_id;
    ELSE
      UPDATE purchase_requisitions SET status = 'rejected', updated_at = now() WHERE id = p_id;
    END IF;
  ELSIF p_entity = 'purchase_orders' THEN
    UPDATE purchase_orders SET status = CASE WHEN p_approved THEN 'sent' ELSE 'draft' END,
           approved_by = CASE WHEN p_approved THEN auth.uid() ELSE approved_by END, updated_at = now() WHERE id = p_id;
  ELSIF p_entity = 'purchase_invoices' THEN
    UPDATE purchase_invoices SET status = CASE WHEN p_approved THEN 'approved' ELSE 'draft' END,
           approved_by = CASE WHEN p_approved THEN auth.uid() ELSE approved_by END, updated_at = now() WHERE id = p_id;
  ELSIF p_entity = 'fuel_requests' THEN
    IF p_approved THEN
      UPDATE fuel_requests SET status = 'approved', approved_by = auth.uid(), approved_at = now() WHERE id = p_id;
    ELSE
      UPDATE fuel_requests SET status = 'rejected', rejected_reason = p_comment WHERE id = p_id;
    END IF;
  ELSIF p_entity = 'leave_requests' THEN
    IF p_approved THEN PERFORM _leave_apply_approval(p_id); ELSE PERFORM _leave_apply_rejection(p_id, p_comment); END IF;
  ELSIF p_entity = 'expense_claims' THEN
    IF p_approved THEN
      UPDATE expense_claims SET status = 'approved', approved_by = auth.uid(), approved_at = now() WHERE id = p_id;
    ELSE
      UPDATE expense_claims SET status = 'rejected', rejected_reason = p_comment WHERE id = p_id;
    END IF;
  END IF;
  PERFORM set_config('app.approval_engine', 'off', true);
END;
$$;

DROP TRIGGER IF EXISTS trg_approval_gate ON expense_claims;
CREATE TRIGGER trg_approval_gate BEFORE INSERT OR UPDATE ON expense_claims FOR EACH ROW EXECUTE FUNCTION trg_approval_gate();
DROP TRIGGER IF EXISTS trg_approval_after ON expense_claims;
CREATE TRIGGER trg_approval_after AFTER INSERT OR UPDATE ON expense_claims FOR EACH ROW EXECUTE FUNCTION trg_approval_after();

-- ═══════════════════════════════════════════════════════════════════════
-- 7. Actions
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION expense_submit(p_claim_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _c     expense_claims%ROWTYPE;
  _total NUMERIC;
BEGIN
  SELECT * INTO _c FROM expense_claims WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND OR _c.requested_by <> auth.uid() THEN RAISE EXCEPTION 'Claim not found'; END IF;
  IF _c.status <> 'draft' THEN RAISE EXCEPTION 'This claim has already been submitted'; END IF;
  IF _c.advance_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM expense_claims a WHERE a.id = _c.advance_id AND a.requested_by = auth.uid()
          AND a.claim_type = 'advance' AND a.status = 'paid') THEN
    RAISE EXCEPTION 'The linked advance must be one of your own paid advances';
  END IF;
  IF _c.claim_type = 'reimbursement' THEN
    SELECT COALESCE(SUM(amount), 0) INTO _total FROM expense_claim_lines WHERE claim_id = p_claim_id AND NOT is_archived;
    IF _total <= 0 THEN RAISE EXCEPTION 'Add at least one expense line before submitting'; END IF;
    IF EXISTS (SELECT 1 FROM expense_claim_lines WHERE claim_id = p_claim_id AND NOT is_archived AND receipt_path IS NULL AND amount > 20) THEN
      RAISE EXCEPTION 'Attach a receipt to every line over $20';
    END IF;
  ELSE
    _total := _c.total_amount;
    IF _total <= 0 THEN RAISE EXCEPTION 'Enter the advance amount'; END IF;
  END IF;
  UPDATE expense_claims SET total_amount = _total, status = 'submitted', submitted_at = now() WHERE id = p_claim_id;

  -- Without an approval route, tell whoever can approve expenses at the site.
  IF NOT EXISTS (SELECT 1 FROM approval_requests WHERE entity_type = 'expense_claims' AND entity_id = p_claim_id AND status = 'pending') THEN
    INSERT INTO notifications (site_id, user_id, type, title, message, link, category)
    SELECT DISTINCT _c.site_id, ur.user_id, 'expense_submitted',
           CASE WHEN _c.claim_type = 'advance' THEN 'Advance request to review' ELSE 'Expense claim to review' END,
           COALESCE(_c.claim_number, '') || ' — $' || _total || ' — ' || _c.purpose, '/finance/fi_expense_claims', 'approval'
      FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id
     WHERE p.code = 'expenses.approve' AND COALESCE(ur.is_active, true)
       AND (ur.site_id IS NULL OR ur.site_id = _c.site_id) AND ur.user_id <> auth.uid();
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION expense_cancel(p_claim_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE expense_claims SET status = 'cancelled'
   WHERE id = p_claim_id AND requested_by = auth.uid() AND status IN ('draft','submitted');
  IF NOT FOUND THEN RAISE EXCEPTION 'Only your own draft or submitted claims can be cancelled'; END IF;
END;
$$;

-- Single-approver decision when no approval route applies (the gate blocks it otherwise).
CREATE OR REPLACE FUNCTION expense_decide(p_claim_id UUID, p_approve BOOLEAN, p_reason TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _c expense_claims%ROWTYPE;
BEGIN
  SELECT * INTO _c FROM expense_claims WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Claim not found'; END IF;
  IF NOT _has_permission('expenses.approve', _c.site_id) THEN RAISE EXCEPTION 'You do not have permission to approve expenses'; END IF;
  IF _c.requested_by = auth.uid() THEN RAISE EXCEPTION 'You cannot approve your own claim'; END IF;
  IF _c.status <> 'submitted' THEN RAISE EXCEPTION 'Only submitted claims can be decided'; END IF;
  IF NOT p_approve AND COALESCE(TRIM(p_reason), '') = '' THEN RAISE EXCEPTION 'A reason is required to reject'; END IF;
  IF p_approve THEN
    UPDATE expense_claims SET status = 'approved', approved_by = auth.uid(), approved_at = now() WHERE id = p_claim_id;
  ELSE
    UPDATE expense_claims SET status = 'rejected', rejected_reason = TRIM(p_reason) WHERE id = p_claim_id;
  END IF;
  INSERT INTO notifications (site_id, user_id, type, title, message, link, category)
  VALUES (_c.site_id, _c.requested_by, 'expense_decided',
          CASE WHEN p_approve THEN 'Claim approved: ' ELSE 'Claim rejected: ' END || COALESCE(_c.claim_number, ''),
          CASE WHEN p_approve THEN 'It will be paid by finance.' ELSE TRIM(p_reason) END, '/me/me_expenses', 'approval');
END;
$$;

CREATE OR REPLACE FUNCTION expense_pay(p_claim_id UUID, p_method TEXT, p_fund_id UUID DEFAULT NULL, p_reference TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _c       expense_claims%ROWTYPE;
  _payable NUMERIC;
BEGIN
  SELECT * INTO _c FROM expense_claims WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Claim not found'; END IF;
  IF NOT _has_permission('expenses.edit', _c.site_id) THEN RAISE EXCEPTION 'You do not have permission to pay claims'; END IF;
  IF _c.status <> 'approved' THEN RAISE EXCEPTION 'Only approved claims can be paid'; END IF;
  IF p_method NOT IN ('bank','petty_cash') THEN RAISE EXCEPTION 'Choose bank or petty cash'; END IF;
  _payable := CASE WHEN _c.claim_type = 'advance' THEN _c.total_amount ELSE _c.total_amount - _c.settled_amount END;

  IF p_method = 'petty_cash' AND _payable > 0 THEN
    IF NOT EXISTS (SELECT 1 FROM petty_cash_funds WHERE id = p_fund_id AND site_id = _c.site_id AND is_active AND NOT is_archived) THEN
      RAISE EXCEPTION 'Choose an active petty cash fund at this site';
    END IF;
    INSERT INTO petty_cash_transactions (site_id, fund_id, txn_type, direction, amount, description, reference, expense_claim_id, created_by)
    VALUES (_c.site_id, p_fund_id, CASE WHEN _c.claim_type = 'advance' THEN 'advance' ELSE 'claim_payment' END, 'out', _payable,
            COALESCE(_c.claim_number, 'Claim') || ' — ' || _c.purpose, p_reference, _c.id, auth.uid());
  END IF;

  UPDATE expense_claims SET status = 'paid', payment_method = p_method,
         petty_cash_fund_id = CASE WHEN p_method = 'petty_cash' THEN p_fund_id END,
         payment_ref = NULLIF(TRIM(p_reference), ''), paid_by = auth.uid(), paid_at = now()
   WHERE id = p_claim_id;

  INSERT INTO notifications (site_id, user_id, type, title, message, link, category)
  VALUES (_c.site_id, _c.requested_by, 'expense_paid', 'Paid: ' || COALESCE(_c.claim_number, ''),
          '$' || _payable || CASE WHEN p_method = 'petty_cash' THEN ' in cash from petty cash' ELSE ' by bank transfer' END
          || CASE WHEN _c.settled_amount > 0 THEN ' ($' || _c.settled_amount || ' covered by your advance)' ELSE '' END,
          '/me/me_expenses', 'general');
END;
$$;

CREATE OR REPLACE FUNCTION petty_cash_record(p_fund_id UUID, p_type TEXT, p_amount NUMERIC, p_description TEXT,
                                             p_category TEXT DEFAULT NULL, p_date DATE DEFAULT CURRENT_DATE,
                                             p_receipt_path TEXT DEFAULT NULL, p_reference TEXT DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _f  petty_cash_funds%ROWTYPE;
  _id UUID;
BEGIN
  SELECT * INTO _f FROM petty_cash_funds WHERE id = p_fund_id;
  IF NOT FOUND OR _f.is_archived OR NOT _f.is_active THEN RAISE EXCEPTION 'Choose an active petty cash fund'; END IF;
  IF p_type = 'expense' THEN
    IF NOT (_has_permission('pettycash.create', _f.site_id) OR _f.custodian_id = auth.uid()) THEN
      RAISE EXCEPTION 'Only the fund custodian or petty cash staff can record spending';
    END IF;
    IF COALESCE(TRIM(p_description), '') = '' THEN RAISE EXCEPTION 'Say what the cash was spent on'; END IF;
    IF p_amount > 20 AND p_receipt_path IS NULL THEN RAISE EXCEPTION 'Attach a receipt for amounts over $20'; END IF;
  ELSIF p_type = 'top_up' THEN
    IF NOT _has_permission('pettycash.edit', _f.site_id) THEN RAISE EXCEPTION 'You do not have permission to top up funds'; END IF;
  ELSE
    RAISE EXCEPTION 'Unknown petty cash entry type';
  END IF;
  IF COALESCE(p_amount, 0) <= 0 THEN RAISE EXCEPTION 'Enter an amount above zero'; END IF;

  INSERT INTO petty_cash_transactions (site_id, fund_id, txn_date, txn_type, direction, amount, category, description,
                                       receipt_path, reference, created_by)
  VALUES (_f.site_id, p_fund_id, COALESCE(p_date, CURRENT_DATE), p_type, CASE WHEN p_type = 'top_up' THEN 'in' ELSE 'out' END,
          ROUND(p_amount, 2), p_category, COALESCE(NULLIF(TRIM(p_description), ''), 'Top-up from bank'),
          p_receipt_path, NULLIF(TRIM(p_reference), ''), auth.uid())
  RETURNING id INTO _id;
  RETURN _id;
END;
$$;

CREATE OR REPLACE FUNCTION petty_cash_void(p_txn_id UUID, p_reason TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _t petty_cash_transactions%ROWTYPE; _bal NUMERIC;
BEGIN
  SELECT * INTO _t FROM petty_cash_transactions WHERE id = p_txn_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Entry not found'; END IF;
  IF NOT _has_permission('pettycash.edit', _t.site_id) THEN RAISE EXCEPTION 'You do not have permission to void entries'; END IF;
  IF _t.status = 'void' THEN RAISE EXCEPTION 'Already voided'; END IF;
  IF _t.txn_type IN ('claim_payment','advance') THEN RAISE EXCEPTION 'Claim payments are corrected from the claim, not here'; END IF;
  IF COALESCE(TRIM(p_reason), '') = '' THEN RAISE EXCEPTION 'Give a reason for voiding'; END IF;
  IF _t.direction = 'in' THEN
    SELECT balance INTO _bal FROM petty_cash_funds WHERE id = _t.fund_id FOR UPDATE;
    IF _bal < _t.amount THEN RAISE EXCEPTION 'Voiding this top-up would make the fund negative'; END IF;
  END IF;
  UPDATE petty_cash_transactions SET status = 'void', void_reason = TRIM(p_reason) WHERE id = p_txn_id;
END;
$$;

-- Cash count: records the count and books any difference as an adjustment.
CREATE OR REPLACE FUNCTION petty_cash_count(p_fund_id UUID, p_counted NUMERIC, p_notes TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _f   petty_cash_funds%ROWTYPE;
  _var NUMERIC;
BEGIN
  SELECT * INTO _f FROM petty_cash_funds WHERE id = p_fund_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fund not found'; END IF;
  IF NOT (_has_permission('pettycash.edit', _f.site_id) OR _f.custodian_id = auth.uid()) THEN
    RAISE EXCEPTION 'Only the custodian or petty cash staff can count this fund';
  END IF;
  IF p_counted IS NULL OR p_counted < 0 THEN RAISE EXCEPTION 'Enter the cash counted'; END IF;
  _var := ROUND(p_counted - _f.balance, 2);
  IF _var <> 0 AND COALESCE(TRIM(p_notes), '') = '' THEN RAISE EXCEPTION 'Explain the difference of %', _var; END IF;
  INSERT INTO petty_cash_counts (site_id, fund_id, expected_balance, counted_amount, variance, notes, counted_by)
  VALUES (_f.site_id, p_fund_id, _f.balance, p_counted, _var, NULLIF(TRIM(p_notes), ''), auth.uid());
  IF _var <> 0 THEN
    INSERT INTO petty_cash_transactions (site_id, fund_id, txn_type, direction, amount, description, created_by)
    VALUES (_f.site_id, p_fund_id, 'adjustment', CASE WHEN _var > 0 THEN 'in' ELSE 'out' END, ABS(_var),
            CASE WHEN _var > 0 THEN 'Cash count over: ' ELSE 'Cash count short: ' END || TRIM(p_notes), auth.uid());
  END IF;
  RETURN jsonb_build_object('expected', _f.balance, 'counted', p_counted, 'variance', _var);
END;
$$;

-- My advances that still have money to account for
CREATE OR REPLACE FUNCTION ess_my_open_advances()
RETURNS TABLE (id UUID, claim_number TEXT, purpose TEXT, total_amount NUMERIC, outstanding NUMERIC, paid_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.id, a.claim_number, a.purpose, a.total_amount, expense_advance_outstanding(a.id), a.paid_at
    FROM expense_claims a
   WHERE a.requested_by = auth.uid() AND a.claim_type = 'advance' AND a.status = 'paid'
     AND expense_advance_outstanding(a.id) > 0
   ORDER BY a.paid_at
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 8. RLS
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE expense_claims          ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_claim_lines     ENABLE ROW LEVEL SECURITY;
ALTER TABLE petty_cash_funds        ENABLE ROW LEVEL SECURITY;
ALTER TABLE petty_cash_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE petty_cash_counts       ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION _expense_claim_visible(p_claim_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM expense_claims c WHERE c.id = p_claim_id AND (
    c.requested_by = auth.uid()
    OR _has_permission('expenses.view', c.site_id)
    OR _has_permission('expenses.approve', c.site_id)
    OR EXISTS (SELECT 1 FROM approval_requests r WHERE r.entity_type = 'expense_claims' AND r.entity_id = c.id
                AND r.status = 'pending' AND approval_can_act(r.id))))
$$;

DROP POLICY IF EXISTS ec_select ON expense_claims;
DROP POLICY IF EXISTS ec_insert ON expense_claims;
DROP POLICY IF EXISTS ec_update ON expense_claims;
-- Checks the row's own columns (not a lookup) so INSERT ... RETURNING sees the new row.
CREATE POLICY ec_select ON expense_claims FOR SELECT USING (
  requested_by = auth.uid()
  OR _has_permission('expenses.view', site_id)
  OR _has_permission('expenses.approve', site_id)
  OR EXISTS (SELECT 1 FROM approval_requests r WHERE r.entity_type = 'expense_claims' AND r.entity_id = expense_claims.id
              AND r.status = 'pending' AND approval_can_act(r.id)));
CREATE POLICY ec_insert ON expense_claims FOR INSERT WITH CHECK (
  requested_by = auth.uid() AND status = 'draft'
  AND employee_id = (SELECT employee_id FROM profiles WHERE id = auth.uid())
  AND site_id = (SELECT e.site_id FROM employees e JOIN profiles p ON p.employee_id = e.id WHERE p.id = auth.uid()));
-- Owners edit their drafts; every status change goes through the functions above.
CREATE POLICY ec_update ON expense_claims FOR UPDATE USING (requested_by = auth.uid() AND status = 'draft')
  WITH CHECK (requested_by = auth.uid() AND status = 'draft'
    AND employee_id = (SELECT employee_id FROM profiles WHERE id = auth.uid())
    AND site_id = (SELECT e.site_id FROM employees e JOIN profiles p ON p.employee_id = e.id WHERE p.id = auth.uid()));

DROP POLICY IF EXISTS ecl_select ON expense_claim_lines;
DROP POLICY IF EXISTS ecl_insert ON expense_claim_lines;
DROP POLICY IF EXISTS ecl_update ON expense_claim_lines;
CREATE POLICY ecl_select ON expense_claim_lines FOR SELECT USING (_expense_claim_visible(claim_id));
CREATE POLICY ecl_insert ON expense_claim_lines FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM expense_claims c
  WHERE c.id = claim_id AND c.requested_by = auth.uid() AND c.status = 'draft'));
CREATE POLICY ecl_update ON expense_claim_lines FOR UPDATE USING (EXISTS (SELECT 1 FROM expense_claims c
  WHERE c.id = claim_id AND c.requested_by = auth.uid() AND c.status = 'draft'));

DROP POLICY IF EXISTS pcf_select ON petty_cash_funds;
DROP POLICY IF EXISTS pcf_insert ON petty_cash_funds;
DROP POLICY IF EXISTS pcf_update ON petty_cash_funds;
CREATE POLICY pcf_select ON petty_cash_funds FOR SELECT USING (
  _has_permission('pettycash.view', site_id) OR custodian_id = auth.uid() OR _has_permission('expenses.edit', site_id));
CREATE POLICY pcf_insert ON petty_cash_funds FOR INSERT WITH CHECK (_has_permission('pettycash.edit', site_id) AND balance = 0);
CREATE POLICY pcf_update ON petty_cash_funds FOR UPDATE USING (_has_permission('pettycash.edit', site_id));

-- The balance column is maintained only by transactions.
CREATE OR REPLACE FUNCTION trg_petty_cash_fund_balance_lock() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.balance IS DISTINCT FROM OLD.balance AND pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'The fund balance changes only through petty cash entries';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_petty_cash_fund_balance_lock ON petty_cash_funds;
CREATE TRIGGER trg_petty_cash_fund_balance_lock BEFORE UPDATE ON petty_cash_funds
  FOR EACH ROW EXECUTE FUNCTION trg_petty_cash_fund_balance_lock();

DROP POLICY IF EXISTS pct_select ON petty_cash_transactions;
CREATE POLICY pct_select ON petty_cash_transactions FOR SELECT USING (
  _has_permission('pettycash.view', site_id)
  OR EXISTS (SELECT 1 FROM petty_cash_funds f WHERE f.id = fund_id AND f.custodian_id = auth.uid()));

DROP POLICY IF EXISTS pcc_select ON petty_cash_counts;
CREATE POLICY pcc_select ON petty_cash_counts FOR SELECT USING (
  _has_permission('pettycash.view', site_id)
  OR EXISTS (SELECT 1 FROM petty_cash_funds f WHERE f.id = fund_id AND f.custodian_id = auth.uid()));

-- ═══════════════════════════════════════════════════════════════════════
-- 9. Receipts storage: <site_id>/<user_id>/<file>
-- ═══════════════════════════════════════════════════════════════════════
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('expense-receipts', 'expense-receipts', false, 10485760,
        ARRAY['image/jpeg','image/png','image/webp','image/heic','application/pdf'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "expense receipts upload own" ON storage.objects;
DROP POLICY IF EXISTS "expense receipts read" ON storage.objects;
CREATE POLICY "expense receipts upload own" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'expense-receipts' AND (storage.foldername(name))[2] = auth.uid()::text);
CREATE POLICY "expense receipts read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'expense-receipts' AND (
    (storage.foldername(name))[2] = auth.uid()::text
    OR _has_permission('expenses.view', ((storage.foldername(name))[1])::uuid)
    OR _has_permission('expenses.approve', ((storage.foldername(name))[1])::uuid)
    OR _has_permission('pettycash.view', ((storage.foldername(name))[1])::uuid)));

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE expense_claims;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

INSERT INTO schema_migrations (filename) VALUES ('0181_expenses_petty_cash.sql') ON CONFLICT DO NOTHING;

COMMIT;
