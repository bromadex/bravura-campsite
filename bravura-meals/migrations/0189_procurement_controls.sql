-- 0189: Procurement controls
--   * supplier quotes against RFQs, side-by-side comparison and award (creates a draft PO)
--   * annual budgets per cost centre / project; a PO can't leave draft if it would exceed its budget
--     unless someone with procurement.approve overrides (reason recorded)
--   * supplier aging (unpaid invoices by days overdue) and supplier scorecards

INSERT INTO permissions (code, module, action, description) VALUES
  ('procurement.approve', 'procurement', 'Approve', 'Award quotes, set budgets and override budget limits')
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT DISTINCT rp.role_id, np.id FROM role_permissions rp
  JOIN permissions p  ON p.id = rp.permission_id AND p.code IN ('procurement.delete', 'users.edit')
  JOIN permissions np ON np.code = 'procurement.approve'
 WHERE NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = rp.role_id AND x.permission_id = np.id);

-- ── Budgets ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS procurement_budgets (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id        UUID NOT NULL REFERENCES sites(id),
  fiscal_year    INT  NOT NULL,
  cost_centre_id UUID REFERENCES cost_centres(id),
  project_id     UUID REFERENCES projects(id),
  amount         NUMERIC(15,2) NOT NULL CHECK (amount >= 0),
  notes          TEXT,
  is_archived    BOOLEAN NOT NULL DEFAULT false,
  created_by     UUID REFERENCES profiles(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((cost_centre_id IS NULL) <> (project_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_proc_budget ON procurement_budgets
  (site_id, fiscal_year, COALESCE(cost_centre_id, project_id)) WHERE NOT is_archived;
ALTER TABLE procurement_budgets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pb_select ON procurement_budgets; DROP POLICY IF EXISTS pb_write ON procurement_budgets;
CREATE POLICY pb_select ON procurement_budgets FOR SELECT USING (_has_permission('procurement.view', site_id));
CREATE POLICY pb_write  ON procurement_budgets FOR ALL USING (_has_permission('procurement.approve', site_id))
  WITH CHECK (_has_permission('procurement.approve', site_id));

ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS budget_override_by     UUID REFERENCES profiles(id);
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS budget_override_reason TEXT;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS budget_override_at     TIMESTAMPTZ;

-- Committed spend = POs that have left draft (not cancelled) in the budget's year.
CREATE OR REPLACE FUNCTION proc_budget_status(p_site_id UUID, p_year INT)
RETURNS TABLE (id UUID, cost_centre_id UUID, project_id UUID, dim_code TEXT, dim_name TEXT, amount NUMERIC,
               committed NUMERIC, remaining NUMERIC, po_count BIGINT, notes TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT _has_permission('procurement.view', p_site_id) THEN RAISE EXCEPTION 'No access'; END IF;
  RETURN QUERY
  SELECT b.id, b.cost_centre_id, b.project_id,
         COALESCE(cc.code, pj.project_code), COALESCE(cc.name, pj.name), b.amount,
         COALESCE(s.total, 0), b.amount - COALESCE(s.total, 0), COALESCE(s.n, 0), b.notes
    FROM procurement_budgets b
    LEFT JOIN cost_centres cc ON cc.id = b.cost_centre_id
    LEFT JOIN projects pj ON pj.id = b.project_id
    LEFT JOIN LATERAL (
      SELECT SUM(po.total_amount) total, COUNT(*) n FROM purchase_orders po
       WHERE po.site_id = b.site_id AND po.status NOT IN ('draft','cancelled')
         AND EXTRACT(YEAR FROM COALESCE(po.order_date, po.created_at::date)) = b.fiscal_year
         AND ((b.cost_centre_id IS NOT NULL AND po.cost_centre_id = b.cost_centre_id)
           OR (b.project_id IS NOT NULL AND po.project_id = b.project_id))
    ) s ON true
   WHERE b.site_id = p_site_id AND b.fiscal_year = p_year AND NOT b.is_archived
   ORDER BY COALESCE(cc.code, pj.project_code, pj.name);
END;
$$;

CREATE OR REPLACE FUNCTION trg_po_budget_check() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _b RECORD; _yr INT; _used NUMERIC;
BEGIN
  IF NEW.status IN ('draft','cancelled') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status NOT IN ('draft') THEN RETURN NEW; END IF;   -- only when leaving draft
  IF NEW.budget_override_by IS NOT NULL THEN RETURN NEW; END IF;
  _yr := EXTRACT(YEAR FROM COALESCE(NEW.order_date, CURRENT_DATE))::INT;
  FOR _b IN SELECT b.*, COALESCE(cc.name, pj.name) dim_name FROM procurement_budgets b
              LEFT JOIN cost_centres cc ON cc.id = b.cost_centre_id LEFT JOIN projects pj ON pj.id = b.project_id
             WHERE b.site_id = NEW.site_id AND b.fiscal_year = _yr AND NOT b.is_archived
               AND ((b.cost_centre_id IS NOT NULL AND b.cost_centre_id = NEW.cost_centre_id)
                 OR (b.project_id IS NOT NULL AND b.project_id = NEW.project_id)) LOOP
    SELECT COALESCE(SUM(total_amount), 0) INTO _used FROM purchase_orders po
     WHERE po.site_id = NEW.site_id AND po.id <> NEW.id AND po.status NOT IN ('draft','cancelled')
       AND EXTRACT(YEAR FROM COALESCE(po.order_date, po.created_at::date)) = _yr
       AND ((_b.cost_centre_id IS NOT NULL AND po.cost_centre_id = _b.cost_centre_id)
         OR (_b.project_id IS NOT NULL AND po.project_id = _b.project_id));
    IF _used + COALESCE(NEW.total_amount, 0) > _b.amount THEN
      RAISE EXCEPTION 'OVER_BUDGET: This order takes % over its % budget (budget $%, already committed $%, this order $%). Someone with procurement approval can override it.',
        _b.dim_name, _yr, _b.amount, _used, COALESCE(NEW.total_amount, 0)
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_po_budget_check ON purchase_orders;
CREATE TRIGGER trg_po_budget_check BEFORE INSERT OR UPDATE OF status ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION trg_po_budget_check();

CREATE OR REPLACE FUNCTION proc_override_budget(p_po_id UUID, p_reason TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _po purchase_orders%ROWTYPE;
BEGIN
  SELECT * INTO _po FROM purchase_orders WHERE id = p_po_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF NOT _has_permission('procurement.approve', _po.site_id) THEN RAISE EXCEPTION 'Only someone with procurement approval can override a budget'; END IF;
  IF COALESCE(TRIM(p_reason), '') = '' THEN RAISE EXCEPTION 'Give a reason for going over budget'; END IF;
  UPDATE purchase_orders SET budget_override_by = auth.uid(), budget_override_reason = TRIM(p_reason), budget_override_at = now() WHERE id = p_po_id;
END;
$$;

-- ── Quotes ───────────────────────────────────────────────────────────
ALTER TABLE rfq_responses ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES profiles(id);
ALTER TABLE rfq_responses ADD COLUMN IF NOT EXISTS po_id UUID REFERENCES purchase_orders(id);
ALTER TABLE rfqs          ADD COLUMN IF NOT EXISTS awarded_response_id UUID REFERENCES rfq_responses(id);
ALTER TABLE rfqs          ADD COLUMN IF NOT EXISTS award_reason TEXT;

CREATE OR REPLACE FUNCTION proc_record_quote(p_rfq_id UUID, p_supplier_id UUID, p_lead_time_days INT, p_validity_days INT,
                                             p_notes TEXT, p_lines JSONB)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r rfqs%ROWTYPE; _id UUID; _total NUMERIC := 0; _l JSONB; _q NUMERIC;
BEGIN
  SELECT * INTO _r FROM rfqs WHERE id = p_rfq_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'RFQ not found'; END IF;
  IF NOT _has_permission('procurement.create', _r.site_id) THEN RAISE EXCEPTION 'You do not have permission to record quotes'; END IF;
  IF _r.status IN ('awarded','cancelled') THEN RAISE EXCEPTION 'This RFQ is already %', _r.status; END IF;
  IF p_supplier_id IS NULL THEN RAISE EXCEPTION 'Pick the supplier'; END IF;
  IF EXISTS (SELECT 1 FROM rfq_responses WHERE rfq_id = p_rfq_id AND supplier_id = p_supplier_id AND status <> 'rejected') THEN
    RAISE EXCEPTION 'This supplier''s quote is already recorded';
  END IF;
  INSERT INTO rfq_responses (rfq_id, supplier_id, lead_time_days, validity_days, status, notes, created_by)
  VALUES (p_rfq_id, p_supplier_id, p_lead_time_days, p_validity_days, 'received', NULLIF(TRIM(p_notes), ''), auth.uid())
  RETURNING id INTO _id;
  FOR _l IN SELECT * FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) LOOP
    IF NULLIF(_l->>'unit_price', '') IS NULL THEN CONTINUE; END IF;
    SELECT quantity INTO _q FROM rfq_lines WHERE id = (_l->>'rfq_line_id')::uuid AND rfq_id = p_rfq_id;
    IF _q IS NULL THEN CONTINUE; END IF;
    INSERT INTO rfq_response_lines (response_id, rfq_line_id, unit_price, notes)
    VALUES (_id, (_l->>'rfq_line_id')::uuid, (_l->>'unit_price')::numeric, NULLIF(_l->>'notes', ''));
    _total := _total + _q * (_l->>'unit_price')::numeric;
  END LOOP;
  UPDATE rfq_responses SET total_amount = ROUND(_total, 2) WHERE id = _id;
  UPDATE rfqs SET status = 'responses_received', updated_at = now() WHERE id = p_rfq_id AND status IN ('draft','sent');
  RETURN _id;
END;
$$;

CREATE OR REPLACE FUNCTION proc_award_rfq(p_response_id UUID, p_reason TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _resp rfq_responses%ROWTYPE; _r rfqs%ROWTYPE; _po UUID; _total NUMERIC; _skipped INT;
BEGIN
  SELECT * INTO _resp FROM rfq_responses WHERE id = p_response_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quote not found'; END IF;
  SELECT * INTO _r FROM rfqs WHERE id = _resp.rfq_id FOR UPDATE;
  IF NOT _has_permission('procurement.approve', _r.site_id) THEN RAISE EXCEPTION 'Only someone with procurement approval can award'; END IF;
  IF _r.status IN ('awarded','cancelled') THEN RAISE EXCEPTION 'This RFQ is already %', _r.status; END IF;
  -- Not the cheapest? A reason is required.
  IF EXISTS (SELECT 1 FROM rfq_responses x WHERE x.rfq_id = _r.id AND x.status <> 'rejected' AND x.total_amount < _resp.total_amount)
     AND COALESCE(TRIM(p_reason), '') = '' THEN
    RAISE EXCEPTION 'This isn''t the lowest quote — give a reason for choosing it';
  END IF;
  UPDATE rfq_responses SET status = CASE WHEN id = p_response_id THEN 'awarded' ELSE 'rejected' END WHERE rfq_id = _r.id;
  UPDATE rfqs SET status = 'awarded', awarded_response_id = p_response_id, award_reason = NULLIF(TRIM(p_reason), ''), updated_at = now() WHERE id = _r.id;

  SELECT COALESCE(SUM(l.quantity * rl.unit_price), 0) INTO _total
    FROM rfq_response_lines rl JOIN rfq_lines l ON l.id = rl.rfq_line_id WHERE rl.response_id = p_response_id AND l.item_id IS NOT NULL;
  SELECT COUNT(*) INTO _skipped FROM rfq_lines l WHERE l.rfq_id = _r.id AND l.item_id IS NULL;
  INSERT INTO purchase_orders (site_id, supplier_id, status, order_date, expected_date, total_amount, notes, created_by)
  VALUES (_r.site_id, _resp.supplier_id, 'draft', CURRENT_DATE,
          CASE WHEN _resp.lead_time_days IS NOT NULL THEN CURRENT_DATE + _resp.lead_time_days END, ROUND(_total, 2),
          'From ' || _r.rfq_number || ' — ' || _r.title || CASE WHEN _skipped > 0 THEN ' (' || _skipped || ' line(s) with no stock item — add them manually)' ELSE '' END,
          auth.uid())
  RETURNING id INTO _po;
  INSERT INTO po_lines (po_id, item_id, quantity, unit_cost)
  SELECT _po, l.item_id, l.quantity, rl.unit_price FROM rfq_response_lines rl JOIN rfq_lines l ON l.id = rl.rfq_line_id
   WHERE rl.response_id = p_response_id AND l.item_id IS NOT NULL;
  UPDATE rfq_responses SET po_id = _po WHERE id = p_response_id;
  RETURN _po;
END;
$$;

-- ── Supplier aging & scorecards ─────────────────────────────────────
CREATE OR REPLACE FUNCTION proc_supplier_aging(p_site_id UUID)
RETURNS TABLE (supplier_id UUID, supplier_name TEXT, invoices BIGINT, not_due NUMERIC, d1_30 NUMERIC, d31_60 NUMERIC,
               d61_90 NUMERIC, d90_plus NUMERIC, total NUMERIC, oldest_due DATE)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT _has_permission('procurement.view', p_site_id) THEN RAISE EXCEPTION 'No access'; END IF;
  RETURN QUERY
  SELECT s.id, s.supplier_name, COUNT(*),
         SUM(i.total_amount) FILTER (WHERE COALESCE(i.due_date, i.invoice_date) >= CURRENT_DATE),
         SUM(i.total_amount) FILTER (WHERE CURRENT_DATE - COALESCE(i.due_date, i.invoice_date) BETWEEN 1 AND 30),
         SUM(i.total_amount) FILTER (WHERE CURRENT_DATE - COALESCE(i.due_date, i.invoice_date) BETWEEN 31 AND 60),
         SUM(i.total_amount) FILTER (WHERE CURRENT_DATE - COALESCE(i.due_date, i.invoice_date) BETWEEN 61 AND 90),
         SUM(i.total_amount) FILTER (WHERE CURRENT_DATE - COALESCE(i.due_date, i.invoice_date) > 90),
         SUM(i.total_amount), MIN(COALESCE(i.due_date, i.invoice_date))
    FROM purchase_invoices i JOIN procurement_suppliers s ON s.id = i.supplier_id
   WHERE i.site_id = p_site_id AND i.status IN ('pending_approval','approved')
   GROUP BY s.id, s.supplier_name
   ORDER BY SUM(i.total_amount) DESC;
END;
$$;

CREATE OR REPLACE FUNCTION proc_supplier_scorecard(p_site_id UUID, p_from DATE, p_to DATE)
RETURNS TABLE (supplier_id UUID, supplier_name TEXT, orders BIGINT, spend NUMERIC, deliveries BIGINT, on_time_pct NUMERIC,
               quality_pct NUMERIC, avg_lead_days NUMERIC, quotes BIGINT, quotes_won BIGINT, score NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT _has_permission('procurement.view', p_site_id) THEN RAISE EXCEPTION 'No access'; END IF;
  RETURN QUERY
  WITH po AS (
    SELECT p.* FROM purchase_orders p WHERE p.site_id = p_site_id AND p.status NOT IN ('draft','cancelled')
       AND COALESCE(p.order_date, p.created_at::date) BETWEEN p_from AND p_to
  ), grn AS (
    SELECT g.*, p.supplier_id sup, p.expected_date, COALESCE(p.order_date, p.created_at::date) od
      FROM goods_received_notes g JOIN po p ON p.id = g.po_id WHERE g.status <> 'draft'
  ), q AS (
    SELECT g.sup, SUM(l.quantity_received) rec, SUM(COALESCE(l.quantity_rejected, 0)) rej
      FROM grn g JOIN grn_lines l ON l.grn_id = g.id GROUP BY g.sup
  ), rq AS (
    SELECT r.supplier_id sup, COUNT(*) n, COUNT(*) FILTER (WHERE r.status = 'awarded') won
      FROM rfq_responses r JOIN rfqs f ON f.id = r.rfq_id
     WHERE f.site_id = p_site_id AND r.created_at::date BETWEEN p_from AND p_to GROUP BY r.supplier_id
  ), base AS (
    SELECT s.id, s.supplier_name,
           (SELECT COUNT(*) FROM po WHERE po.supplier_id = s.id) o,
           (SELECT COALESCE(SUM(total_amount), 0) FROM po WHERE po.supplier_id = s.id) sp,
           (SELECT COUNT(*) FROM grn WHERE grn.sup = s.id) d,
           (SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE grn.expected_date IS NULL OR grn.received_date <= grn.expected_date) / NULLIF(COUNT(*), 0), 1)
              FROM grn WHERE grn.sup = s.id) ot,
           (SELECT ROUND(100.0 * (q.rec - q.rej) / NULLIF(q.rec, 0), 1) FROM q WHERE q.sup = s.id) qp,
           (SELECT ROUND(AVG(grn.received_date - grn.od), 1) FROM grn WHERE grn.sup = s.id) lt,
           COALESCE((SELECT n FROM rq WHERE rq.sup = s.id), 0) qn,
           COALESCE((SELECT won FROM rq WHERE rq.sup = s.id), 0) qw
      FROM procurement_suppliers s WHERE s.site_id = p_site_id
  )
  SELECT base.id, base.supplier_name, base.o, base.sp, base.d, base.ot, base.qp, base.lt, base.qn, base.qw,
         CASE WHEN base.ot IS NULL AND base.qp IS NULL THEN NULL
              ELSE ROUND(COALESCE(base.ot, base.qp) * 0.5 + COALESCE(base.qp, base.ot) * 0.5, 0) END
    FROM base WHERE base.o > 0 OR base.qn > 0
   ORDER BY base.sp DESC;
END;
$$;

REVOKE ALL ON FUNCTION proc_budget_status(UUID, INT), proc_override_budget(UUID, TEXT), proc_record_quote(UUID, UUID, INT, INT, TEXT, JSONB),
  proc_award_rfq(UUID, TEXT), proc_supplier_aging(UUID), proc_supplier_scorecard(UUID, DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION proc_budget_status(UUID, INT), proc_override_budget(UUID, TEXT), proc_record_quote(UUID, UUID, INT, INT, TEXT, JSONB),
  proc_award_rfq(UUID, TEXT), proc_supplier_aging(UUID), proc_supplier_scorecard(UUID, DATE, DATE) TO authenticated;

INSERT INTO schema_migrations (filename) VALUES ('0189_procurement_controls.sql') ON CONFLICT DO NOTHING;
