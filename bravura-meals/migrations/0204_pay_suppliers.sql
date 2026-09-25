-- 0204 pay_suppliers — Finance rewrite Phase 3 (issue #49): paying suppliers.
--  1. SECURITY FIX: purchase_invoices, invoice_lines, goods_received_notes and grn_lines had
--     row-level security OFF (readable by any signed-in user, any site). Now site + permission
--     scoped: procurement or finance access.
--  2. Supplier payment terms + bank details; bills get an automatic due date from the terms.
--  3. Three-way match (PO ↔ GRN ↔ bill) kept on each bill by trigger: match_status + match_diff.
--  4. Payment runs: pick approved bills → approve the run (finance approve) → mark paid.
--     Marking paid sets each bill to 'paid', which posts invoice_paid + IMTT through gl_auto_post.

-- ── 1. Row-level security ────────────────────────────────────────────────────
ALTER TABLE purchase_invoices   ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_lines       ENABLE ROW LEVEL SECURITY;
ALTER TABLE goods_received_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE grn_lines           ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION _ap_can(p_action text, p_site uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _has_permission('procurement.' || p_action, p_site)
      OR _has_permission(CASE p_action WHEN 'view' THEN 'FI01' WHEN 'create' THEN 'FI03' WHEN 'edit' THEN 'FI04' WHEN 'approve' THEN 'FI02' END, p_site)
      OR (p_action IN ('view','create','edit') AND _has_permission('inventory.' || p_action, p_site));
$$;

DROP POLICY IF EXISTS pi_select ON purchase_invoices;
CREATE POLICY pi_select ON purchase_invoices FOR SELECT TO authenticated USING (_ap_can('view', site_id));
DROP POLICY IF EXISTS pi_insert ON purchase_invoices;
CREATE POLICY pi_insert ON purchase_invoices FOR INSERT TO authenticated WITH CHECK (_ap_can('create', site_id));
DROP POLICY IF EXISTS pi_update ON purchase_invoices;
CREATE POLICY pi_update ON purchase_invoices FOR UPDATE TO authenticated USING (_ap_can('edit', site_id) OR _ap_can('approve', site_id))
  WITH CHECK (_ap_can('edit', site_id) OR _ap_can('approve', site_id));

DROP POLICY IF EXISTS il_select ON invoice_lines;
CREATE POLICY il_select ON invoice_lines FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM purchase_invoices i WHERE i.id = invoice_lines.invoice_id AND _ap_can('view', i.site_id)));
DROP POLICY IF EXISTS il_write ON invoice_lines;
CREATE POLICY il_write ON invoice_lines FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM purchase_invoices i WHERE i.id = invoice_lines.invoice_id AND i.status = 'draft' AND _ap_can('edit', i.site_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM purchase_invoices i WHERE i.id = invoice_lines.invoice_id AND i.status = 'draft' AND (_ap_can('create', i.site_id) OR _ap_can('edit', i.site_id))));

DROP POLICY IF EXISTS grn_select ON goods_received_notes;
CREATE POLICY grn_select ON goods_received_notes FOR SELECT TO authenticated USING (_ap_can('view', site_id));
DROP POLICY IF EXISTS grn_insert ON goods_received_notes;
CREATE POLICY grn_insert ON goods_received_notes FOR INSERT TO authenticated WITH CHECK (_ap_can('create', site_id));
DROP POLICY IF EXISTS grn_update ON goods_received_notes;
CREATE POLICY grn_update ON goods_received_notes FOR UPDATE TO authenticated USING (_ap_can('edit', site_id)) WITH CHECK (_ap_can('edit', site_id));

DROP POLICY IF EXISTS grnl_select ON grn_lines;
CREATE POLICY grnl_select ON grn_lines FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM goods_received_notes g WHERE g.id = grn_lines.grn_id AND _ap_can('view', g.site_id)));
DROP POLICY IF EXISTS grnl_write ON grn_lines;
CREATE POLICY grnl_write ON grn_lines FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM goods_received_notes g WHERE g.id = grn_lines.grn_id AND g.status IN ('draft','inspecting') AND _ap_can('edit', g.site_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM goods_received_notes g WHERE g.id = grn_lines.grn_id AND g.status IN ('draft','inspecting') AND (_ap_can('create', g.site_id) OR _ap_can('edit', g.site_id))));

-- ── 2. Supplier terms & bank details; due dates ─────────────────────────────
ALTER TABLE procurement_suppliers
  ADD COLUMN IF NOT EXISTS payment_terms_days int NOT NULL DEFAULT 30 CHECK (payment_terms_days BETWEEN 0 AND 365),
  ADD COLUMN IF NOT EXISTS bank_name text,
  ADD COLUMN IF NOT EXISTS bank_branch text,
  ADD COLUMN IF NOT EXISTS bank_account_number text;

ALTER TABLE purchase_invoices
  ADD COLUMN IF NOT EXISTS match_status text NOT NULL DEFAULT 'not_checked'
    CHECK (match_status IN ('not_checked','matched','price_diff','qty_diff','no_grn','service')),
  ADD COLUMN IF NOT EXISTS match_diff numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_run_id uuid;

CREATE OR REPLACE FUNCTION trg_invoice_due_date() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.due_date IS NULL AND NEW.invoice_date IS NOT NULL THEN
    NEW.due_date := NEW.invoice_date + COALESCE((SELECT payment_terms_days FROM procurement_suppliers WHERE id = NEW.supplier_id), 30);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_invoice_due_date ON purchase_invoices;
CREATE TRIGGER trg_invoice_due_date BEFORE INSERT OR UPDATE OF invoice_date, supplier_id, due_date ON purchase_invoices
  FOR EACH ROW EXECUTE FUNCTION trg_invoice_due_date();

-- ── 3. Three-way match ──────────────────────────────────────────────────────
-- Compares the bill with what was actually received (GRN accepted qty) at the PO price.
-- Tolerance: $1 or 0.5 % of the bill, whichever is larger.
CREATE OR REPLACE FUNCTION ap_match_invoice(p_invoice uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _i purchase_invoices%ROWTYPE; _bill_qty numeric; _grn_qty numeric; _grn_val numeric; _st text; _diff numeric := 0;
BEGIN
  SELECT * INTO _i FROM purchase_invoices WHERE id = p_invoice;
  IF NOT FOUND THEN RETURN; END IF;
  IF _i.po_id IS NULL AND _i.grn_id IS NULL THEN
    _st := 'service';
  ELSIF _i.grn_id IS NULL THEN
    _st := 'no_grn';
  ELSE
    SELECT COALESCE(sum(quantity), 0) INTO _bill_qty FROM invoice_lines WHERE invoice_id = _i.id;
    SELECT COALESCE(sum(g.quantity_received - g.quantity_rejected), 0),
           COALESCE(sum((g.quantity_received - g.quantity_rejected) * COALESCE(pl.unit_cost, NULLIF(g.unit_price, 0), 0)), 0)
      INTO _grn_qty, _grn_val
      FROM grn_lines g LEFT JOIN po_lines pl ON pl.id = g.po_line_id
     WHERE g.grn_id = _i.grn_id;
    _diff := round(COALESCE(_i.subtotal, _i.total_amount, 0) - _grn_val, 2);
    IF _bill_qty > 0 AND abs(_bill_qty - _grn_qty) > 0.0001 THEN _st := 'qty_diff';
    ELSIF abs(_diff) > GREATEST(1, 0.005 * COALESCE(_i.total_amount, 0)) THEN _st := 'price_diff';
    ELSE _st := 'matched'; END IF;
  END IF;
  UPDATE purchase_invoices SET match_status = _st, match_diff = _diff
   WHERE id = _i.id AND (match_status IS DISTINCT FROM _st OR match_diff IS DISTINCT FROM _diff);
END $$;

CREATE OR REPLACE FUNCTION trg_invoice_match() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_TABLE_NAME = 'invoice_lines' THEN
    PERFORM ap_match_invoice(COALESCE(NEW.invoice_id, OLD.invoice_id));
  ELSE
    PERFORM ap_match_invoice(NEW.id);
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_invoice_match ON purchase_invoices;
CREATE TRIGGER trg_invoice_match AFTER INSERT OR UPDATE OF po_id, grn_id, subtotal, total_amount ON purchase_invoices
  FOR EACH ROW EXECUTE FUNCTION trg_invoice_match();
DROP TRIGGER IF EXISTS trg_invoice_lines_match ON invoice_lines;
CREATE TRIGGER trg_invoice_lines_match AFTER INSERT OR UPDATE OR DELETE ON invoice_lines
  FOR EACH ROW EXECUTE FUNCTION trg_invoice_match();

-- ── 4. Payment runs ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ap_payment_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id         uuid NOT NULL REFERENCES sites(id),
  run_number      text,
  pay_date        date NOT NULL DEFAULT CURRENT_DATE,
  bank_account_id uuid REFERENCES bank_accounts(id),
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','paid','cancelled')),
  total_amount    numeric(14,2) NOT NULL DEFAULT 0,
  imtt_amount     numeric(14,2) NOT NULL DEFAULT 0,
  bill_count      int NOT NULL DEFAULT 0,
  payment_ref     text,
  notes           text,
  created_by      uuid REFERENCES profiles(id) DEFAULT auth.uid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  approved_by     uuid REFERENCES profiles(id),
  approved_at     timestamptz,
  paid_by         uuid REFERENCES profiles(id),
  paid_at         timestamptz,
  is_archived     boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS ap_payment_runs_site_idx ON ap_payment_runs (site_id, created_at DESC);
ALTER TABLE purchase_invoices DROP CONSTRAINT IF EXISTS purchase_invoices_payment_run_fkey;
ALTER TABLE purchase_invoices ADD CONSTRAINT purchase_invoices_payment_run_fkey FOREIGN KEY (payment_run_id) REFERENCES ap_payment_runs(id);

ALTER TABLE ap_payment_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS apr_select ON ap_payment_runs;
CREATE POLICY apr_select ON ap_payment_runs FOR SELECT TO authenticated USING (_has_permission('FI01', site_id) OR _has_permission('FI04', site_id));
-- writes only through the RPCs below

DROP TRIGGER IF EXISTS trg_doc_number ON ap_payment_runs;
CREATE TRIGGER trg_doc_number BEFORE INSERT ON ap_payment_runs FOR EACH ROW EXECUTE FUNCTION trg_assign_doc_number('run_number', 'PAY');

CREATE OR REPLACE FUNCTION _ap_run_totals(p_run uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _site uuid;
BEGIN
  SELECT site_id INTO _site FROM ap_payment_runs WHERE id = p_run;
  UPDATE ap_payment_runs r SET
    total_amount = COALESCE((SELECT sum(total_amount) FROM purchase_invoices WHERE payment_run_id = p_run), 0),
    imtt_amount  = COALESCE((SELECT sum(gl_imtt_on(_site, total_amount)) FROM purchase_invoices WHERE payment_run_id = p_run), 0),
    bill_count   = (SELECT count(*) FROM purchase_invoices WHERE payment_run_id = p_run)
   WHERE r.id = p_run;
END $$;

-- Create a draft run from approved, unpaid bills that are not already in an open run.
CREATE OR REPLACE FUNCTION ap_run_create(p_site uuid, p_invoice_ids uuid[], p_pay_date date, p_bank_account uuid DEFAULT NULL, p_notes text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _run uuid; _n int;
BEGIN
  IF NOT (_has_permission('FI03', p_site) OR _has_permission('FI04', p_site)) THEN
    RAISE EXCEPTION 'You need finance permission to prepare a payment run';
  END IF;
  SELECT count(*) INTO _n FROM purchase_invoices i
   WHERE i.id = ANY(p_invoice_ids) AND i.site_id = p_site AND i.status = 'approved'
     AND (i.payment_run_id IS NULL OR EXISTS (SELECT 1 FROM ap_payment_runs r WHERE r.id = i.payment_run_id AND r.status = 'cancelled'));
  IF _n = 0 THEN RAISE EXCEPTION 'Choose approved bills that are not already in a payment run'; END IF;
  IF _n <> COALESCE(array_length(p_invoice_ids, 1), 0) THEN
    RAISE EXCEPTION 'Some chosen bills are not approved, belong to another site, or are already in a payment run';
  END IF;
  INSERT INTO ap_payment_runs (site_id, run_number, pay_date, bank_account_id, notes)
  VALUES (p_site, '', COALESCE(p_pay_date, CURRENT_DATE), p_bank_account, p_notes) RETURNING id INTO _run;
  UPDATE purchase_invoices SET payment_run_id = _run WHERE id = ANY(p_invoice_ids);
  PERFORM _ap_run_totals(_run);
  RETURN _run;
END $$;

CREATE OR REPLACE FUNCTION ap_run_approve(p_run uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r ap_payment_runs%ROWTYPE;
BEGIN
  SELECT * INTO _r FROM ap_payment_runs WHERE id = p_run FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment run not found'; END IF;
  IF NOT _has_permission('FI02', _r.site_id) THEN RAISE EXCEPTION 'Approving a payment run needs finance approval permission'; END IF;
  IF _r.status <> 'draft' THEN RAISE EXCEPTION 'Only a draft run can be approved (this one is %)', _r.status; END IF;
  UPDATE ap_payment_runs SET status = 'approved', approved_by = auth.uid(), approved_at = now() WHERE id = p_run;
END $$;

-- Marks every bill in the run paid → posts invoice_paid and IMTT for each.
CREATE OR REPLACE FUNCTION ap_run_mark_paid(p_run uuid, p_payment_ref text DEFAULT NULL, p_paid_on date DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r ap_payment_runs%ROWTYPE; _on date;
BEGIN
  SELECT * INTO _r FROM ap_payment_runs WHERE id = p_run FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment run not found'; END IF;
  IF NOT (_has_permission('FI02', _r.site_id) OR _has_permission('FI04', _r.site_id)) THEN RAISE EXCEPTION 'You need finance permission to record the payment'; END IF;
  IF _r.status <> 'approved' THEN RAISE EXCEPTION 'The run must be approved before it is paid'; END IF;
  _on := COALESCE(p_paid_on, _r.pay_date, CURRENT_DATE);
  UPDATE purchase_invoices SET status = 'paid', paid_at = _on::timestamptz,
         payment_ref = COALESCE(NULLIF(p_payment_ref, ''), _r.run_number), updated_at = now()
   WHERE payment_run_id = p_run AND status = 'approved';
  UPDATE ap_payment_runs SET status = 'paid', paid_by = auth.uid(), paid_at = now(), payment_ref = p_payment_ref WHERE id = p_run;
END $$;

CREATE OR REPLACE FUNCTION ap_run_cancel(p_run uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r ap_payment_runs%ROWTYPE;
BEGIN
  SELECT * INTO _r FROM ap_payment_runs WHERE id = p_run FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment run not found'; END IF;
  IF NOT (_has_permission('FI02', _r.site_id) OR _has_permission('FI04', _r.site_id)) THEN RAISE EXCEPTION 'You need finance permission'; END IF;
  IF _r.status = 'paid' THEN RAISE EXCEPTION 'A paid run cannot be cancelled'; END IF;
  UPDATE purchase_invoices SET payment_run_id = NULL WHERE payment_run_id = p_run;
  UPDATE ap_payment_runs SET status = 'cancelled' WHERE id = p_run;
END $$;

REVOKE ALL ON FUNCTION ap_run_create(uuid, uuid[], date, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION ap_run_approve(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION ap_run_mark_paid(uuid, text, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION ap_run_cancel(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION _ap_run_totals(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION ap_match_invoice(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ap_run_create(uuid, uuid[], date, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION ap_run_approve(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION ap_run_mark_paid(uuid, text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION ap_run_cancel(uuid) TO authenticated;

-- Existing bills get due dates and match results.
UPDATE purchase_invoices SET due_date = due_date WHERE due_date IS NULL;
SELECT ap_match_invoice(id) FROM purchase_invoices;

INSERT INTO schema_migrations (filename) VALUES ('0204_pay_suppliers.sql') ON CONFLICT DO NOTHING;
