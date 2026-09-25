-- 0214 procurement_home_and_requests — Procurement rewrite P1 + P2 (#51, #52).
--   P1: proc_home(site_ids[]) — tiles, spend vs budget by site, needs-attention list, across the sites the
--       person can see (HQ sees all). Procurement staff (procurement.*) can now read/write requests and POs,
--       not only inventory.* holders.
--   P2: one Requests store (purchase_requisitions) — request type buy/transfer, needed-by, department, work
--       order, free-text service lines, soft-archived lines, fulfilment of transfers between sites' stores,
--       stock check across sites, default "department head" (line manager) approval route per site.

-- ── Requests: new columns ────────────────────────────────────────────────────
ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS request_type text NOT NULL DEFAULT 'buy';
ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS needed_by date;
ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES departments(id);
ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS work_order_id uuid REFERENCES fleet_work_orders(id);
ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS source_site_id uuid REFERENCES sites(id);
ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS fulfilled_at timestamptz;
ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS fulfilled_by uuid REFERENCES profiles(id);
ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false;
ALTER TABLE purchase_requisitions DROP CONSTRAINT IF EXISTS purchase_requisitions_request_type_check;
ALTER TABLE purchase_requisitions ADD CONSTRAINT purchase_requisitions_request_type_check CHECK (request_type IN ('buy','transfer'));
ALTER TABLE purchase_requisitions DROP CONSTRAINT IF EXISTS purchase_requisitions_status_check;
ALTER TABLE purchase_requisitions ADD CONSTRAINT purchase_requisitions_status_check
  CHECK (status IN ('draft','submitted','approved','rejected','ordered','fulfilled','cancelled'));

ALTER TABLE requisition_lines ALTER COLUMN item_id DROP NOT NULL;
ALTER TABLE requisition_lines ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE requisition_lines ADD COLUMN IF NOT EXISTS unit text;
ALTER TABLE requisition_lines ADD COLUMN IF NOT EXISTS ordered_qty numeric NOT NULL DEFAULT 0;
ALTER TABLE requisition_lines ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false;
ALTER TABLE requisition_lines DROP CONSTRAINT IF EXISTS requisition_lines_item_or_text;
ALTER TABLE requisition_lines ADD CONSTRAINT requisition_lines_item_or_text CHECK (item_id IS NOT NULL OR NULLIF(trim(description), '') IS NOT NULL);

-- ── RLS: procurement staff as well as stores staff ───────────────────────────
CREATE OR REPLACE FUNCTION public._proc_can(p_action text, p_site uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _has_permission('procurement.' || p_action, p_site) OR _has_permission('inventory.' || p_action, p_site);
$$;

DROP POLICY IF EXISTS pr_select ON purchase_requisitions;
CREATE POLICY pr_select ON purchase_requisitions FOR SELECT TO authenticated USING (_proc_can('view', site_id) OR requested_by = auth.uid());
DROP POLICY IF EXISTS pr_insert ON purchase_requisitions;
CREATE POLICY pr_insert ON purchase_requisitions FOR INSERT TO authenticated WITH CHECK (_proc_can('create', site_id));
DROP POLICY IF EXISTS pr_update ON purchase_requisitions;
CREATE POLICY pr_update ON purchase_requisitions FOR UPDATE TO authenticated USING (_proc_can('edit', site_id) OR (requested_by = auth.uid() AND status = 'draft'));
DROP POLICY IF EXISTS prl_all ON requisition_lines;
DROP POLICY IF EXISTS prl_select ON requisition_lines;
CREATE POLICY prl_select ON requisition_lines FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM purchase_requisitions r WHERE r.id = requisition_id AND (_proc_can('view', r.site_id) OR r.requested_by = auth.uid())));
-- request lines are written only through proc_request_save

DROP POLICY IF EXISTS po_select ON purchase_orders;
CREATE POLICY po_select ON purchase_orders FOR SELECT TO authenticated USING (_proc_can('view', site_id));
DROP POLICY IF EXISTS po_insert ON purchase_orders;
CREATE POLICY po_insert ON purchase_orders FOR INSERT TO authenticated WITH CHECK (_proc_can('create', site_id));
DROP POLICY IF EXISTS po_update ON purchase_orders;
CREATE POLICY po_update ON purchase_orders FOR UPDATE TO authenticated USING (_proc_can('edit', site_id));

-- Approval inbox links point at the one Requests screen; the department is the request's department.
CREATE OR REPLACE FUNCTION public._approval_entity(p_entity text, p_id uuid)
 RETURNS TABLE(site_id uuid, amount numeric, department_id uuid, requested_by uuid, title text, link text, status text)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF p_entity = 'purchase_requisitions' THEN
    RETURN QUERY SELECT r.site_id,
      COALESCE((SELECT SUM(COALESCE(l.quantity,0) * COALESCE(l.estimated_cost,0)) FROM requisition_lines l WHERE l.requisition_id = r.id AND NOT l.is_archived), 0),
      r.department_id, r.requested_by,
      CASE WHEN r.request_type = 'transfer' THEN 'Transfer request ' ELSE 'Purchase request ' END || COALESCE(r.requisition_no, '')
        || COALESCE(' — ' || r.title, ''), '/procurement/proc_requisitions', r.status
      FROM purchase_requisitions r WHERE r.id = p_id;
  ELSIF p_entity = 'purchase_orders' THEN
    RETURN QUERY SELECT o.site_id, COALESCE(o.total_amount, 0), NULL::UUID, o.created_by,
      'Purchase order ' || COALESCE(o.po_number, ''), '/procurement/proc_orders', o.status
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
  ELSIF p_entity = 'salary_advances' THEN
    RETURN QUERY SELECT a.site_id, a.amount, e.department_id, a.requested_by,
      CASE WHEN a.advance_type = 'loan' THEN 'Staff loan ' ELSE 'Salary advance ' END || COALESCE(a.reference, '') || ' — ' || COALESCE(e.name, ''),
      '/workforce/wf_salary_advances', a.status
      FROM salary_advances a LEFT JOIN employees e ON e.id = a.employee_id WHERE a.id = p_id;
  END IF;
END;
$function$;

-- ── Save a request (header + lines) in one go; old lines are archived, never deleted ──
CREATE OR REPLACE FUNCTION public.proc_request_save(p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid := NULLIF(p->>'id','')::uuid; _site uuid := (p->>'site_id')::uuid; _r purchase_requisitions%ROWTYPE;
        _submit boolean := COALESCE((p->>'submit')::boolean, false); _l jsonb; _n int := 0;
BEGIN
  IF _site IS NULL THEN RAISE EXCEPTION 'Choose the site this request is for'; END IF;
  IF COALESCE(p->>'request_type','buy') = 'transfer' AND NULLIF(p->>'source_site_id','') IS NULL THEN
    RAISE EXCEPTION 'Choose the site to transfer the stock from';
  END IF;
  IF NULLIF(p->>'source_site_id','')::uuid = _site THEN RAISE EXCEPTION 'A transfer must come from another site'; END IF;
  IF _id IS NULL THEN
    IF NOT _proc_can('create', _site) THEN RAISE EXCEPTION 'You cannot raise requests for this site'; END IF;
    INSERT INTO purchase_requisitions (requisition_no, site_id, status, priority, requested_by, notes, cost_centre_id, project_id,
      request_type, title, needed_by, department_id, work_order_id, source_site_id, warehouse_id)
    VALUES ('', _site, 'draft', COALESCE(NULLIF(p->>'priority',''),'normal'), auth.uid(), NULLIF(p->>'notes',''),
      NULLIF(p->>'cost_centre_id','')::uuid, NULLIF(p->>'project_id','')::uuid, COALESCE(NULLIF(p->>'request_type',''),'buy'),
      NULLIF(p->>'title',''), NULLIF(p->>'needed_by','')::date, NULLIF(p->>'department_id','')::uuid,
      NULLIF(p->>'work_order_id','')::uuid, NULLIF(p->>'source_site_id','')::uuid, NULLIF(p->>'warehouse_id','')::uuid)
    RETURNING id INTO _id;
  ELSE
    SELECT * INTO _r FROM purchase_requisitions WHERE id = _id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
    IF _r.status NOT IN ('draft','rejected') THEN RAISE EXCEPTION 'Only a draft or rejected request can be changed'; END IF;
    IF NOT (_proc_can('edit', _r.site_id) OR _r.requested_by = auth.uid()) THEN RAISE EXCEPTION 'No access'; END IF;
    UPDATE purchase_requisitions SET site_id = _site, priority = COALESCE(NULLIF(p->>'priority',''),'normal'), notes = NULLIF(p->>'notes',''),
      cost_centre_id = NULLIF(p->>'cost_centre_id','')::uuid, project_id = NULLIF(p->>'project_id','')::uuid,
      request_type = COALESCE(NULLIF(p->>'request_type',''),'buy'), title = NULLIF(p->>'title',''),
      needed_by = NULLIF(p->>'needed_by','')::date, department_id = NULLIF(p->>'department_id','')::uuid,
      work_order_id = NULLIF(p->>'work_order_id','')::uuid, source_site_id = NULLIF(p->>'source_site_id','')::uuid,
      warehouse_id = NULLIF(p->>'warehouse_id','')::uuid, status = 'draft', updated_at = now()
     WHERE id = _id;
    UPDATE requisition_lines SET is_archived = true WHERE requisition_id = _id AND NOT is_archived;
  END IF;
  FOR _l IN SELECT * FROM jsonb_array_elements(COALESCE(p->'lines','[]'::jsonb)) LOOP
    IF COALESCE((_l->>'quantity')::numeric, 0) <= 0 THEN CONTINUE; END IF;
    IF NULLIF(_l->>'item_id','') IS NULL AND NULLIF(trim(_l->>'description'),'') IS NULL THEN CONTINUE; END IF;
    INSERT INTO requisition_lines (requisition_id, item_id, description, unit, quantity, estimated_cost, notes)
    VALUES (_id, NULLIF(_l->>'item_id','')::uuid, NULLIF(trim(_l->>'description'),''), NULLIF(_l->>'unit',''),
      (_l->>'quantity')::numeric, NULLIF(_l->>'estimated_cost','')::numeric, NULLIF(_l->>'notes',''));
    _n := _n + 1;
  END LOOP;
  IF _n = 0 THEN RAISE EXCEPTION 'Add at least one line with a quantity'; END IF;
  IF (SELECT request_type FROM purchase_requisitions WHERE id = _id) = 'transfer'
     AND EXISTS (SELECT 1 FROM requisition_lines WHERE requisition_id = _id AND NOT is_archived AND item_id IS NULL) THEN
    RAISE EXCEPTION 'A transfer can only include stock items';
  END IF;
  IF _submit THEN UPDATE purchase_requisitions SET status = 'submitted', updated_at = now() WHERE id = _id; END IF;
  RETURN _id;
END $$;

-- Cancel (soft) a request that hasn't been ordered or fulfilled.
CREATE OR REPLACE FUNCTION public.proc_request_cancel(p_id uuid, p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r purchase_requisitions%ROWTYPE;
BEGIN
  SELECT * INTO _r FROM purchase_requisitions WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF NOT (_proc_can('edit', _r.site_id) OR _r.requested_by = auth.uid()) THEN RAISE EXCEPTION 'No access'; END IF;
  IF _r.status IN ('ordered','fulfilled','cancelled') THEN RAISE EXCEPTION 'This request is already %', _r.status; END IF;
  UPDATE purchase_requisitions SET status = 'cancelled', notes = concat_ws(E'\n', notes, 'Cancelled: ' || NULLIF(p_reason,'')), updated_at = now() WHERE id = p_id;
END $$;

-- Stock of the given items at every site's stores (quantities only), for the "check before buying" panel.
CREATE OR REPLACE FUNCTION public.proc_stock_check(p_item_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM sites s WHERE _proc_can('view', s.id)) THEN RAISE EXCEPTION 'No access'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('item_id', b.item_id, 'site_id', w.site_id, 'site', s.name,
            'warehouse_id', w.id, 'warehouse', w.name, 'on_hand', b.on_hand_qty, 'rate', b.valuation_rate))
    FROM stock_balances b JOIN warehouses w ON w.id = b.warehouse_id AND w.is_active JOIN sites s ON s.id = w.site_id
   WHERE b.item_id = ANY(p_item_ids) AND b.on_hand_qty > 0), '[]'::jsonb);
END $$;

-- Fulfil an approved transfer request: the sending site's stores moves the stock out, the requesting
-- site's stores receives it, at the sending store's valuation rate.
CREATE OR REPLACE FUNCTION public.proc_request_fulfil_transfer(p_id uuid, p_from_warehouse uuid, p_to_warehouse uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r purchase_requisitions%ROWTYPE; _fw warehouses%ROWTYPE; _tw warehouses%ROWTYPE; _l record; _rate numeric; _have numeric; _n int := 0;
BEGIN
  SELECT * INTO _r FROM purchase_requisitions WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR _r.request_type <> 'transfer' THEN RAISE EXCEPTION 'Transfer request not found'; END IF;
  IF _r.status <> 'approved' THEN RAISE EXCEPTION 'Only an approved transfer can be sent'; END IF;
  SELECT * INTO _fw FROM warehouses WHERE id = p_from_warehouse;
  SELECT * INTO _tw FROM warehouses WHERE id = p_to_warehouse;
  IF _fw.site_id IS DISTINCT FROM _r.source_site_id THEN RAISE EXCEPTION 'Send from a store at the sending site'; END IF;
  IF _tw.site_id IS DISTINCT FROM _r.site_id THEN RAISE EXCEPTION 'Receive into a store at the requesting site'; END IF;
  IF NOT _has_permission('inventory.edit', _fw.site_id) AND NOT _has_permission('inventory.create', _fw.site_id) THEN
    RAISE EXCEPTION 'Only the sending site''s stores can send this transfer';
  END IF;
  FOR _l IN SELECT * FROM requisition_lines WHERE requisition_id = p_id AND NOT is_archived AND item_id IS NOT NULL LOOP
    SELECT on_hand_qty, valuation_rate INTO _have, _rate FROM stock_balances WHERE item_id = _l.item_id AND warehouse_id = _fw.id;
    IF COALESCE(_have, 0) < _l.quantity THEN
      RAISE EXCEPTION 'Not enough stock at % for one of the items (have %, need %)', _fw.name, COALESCE(_have, 0), _l.quantity;
    END IF;
    INSERT INTO inventory_movements (item_id, warehouse_id, movement_type, quantity, unit_cost, value, voucher_type, voucher_no, source_module, source_reference_id, created_by, notes)
    VALUES (_l.item_id, _fw.id, 'transfer_out', -_l.quantity, _rate, -_l.quantity * _rate, 'requisition', _r.requisition_no, 'procurement', _r.id, auth.uid(), 'Transfer to ' || _tw.name),
           (_l.item_id, _tw.id, 'transfer_in',   _l.quantity, _rate,  _l.quantity * _rate, 'requisition', _r.requisition_no, 'procurement', _r.id, auth.uid(), 'Transfer from ' || _fw.name);
    UPDATE requisition_lines SET ordered_qty = quantity WHERE id = _l.id;
    _n := _n + 1;
  END LOOP;
  UPDATE purchase_requisitions SET status = 'fulfilled', fulfilled_at = now(), fulfilled_by = auth.uid(), updated_at = now() WHERE id = p_id;
  RETURN jsonb_build_object('lines', _n);
END $$;

-- ── Procurement Home ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.proc_home(p_site_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _sites uuid[]; _m0 date := date_trunc('month', current_date)::date; _me uuid := auth.uid();
BEGIN
  SELECT array_agg(s) INTO _sites FROM unnest(p_site_ids) s WHERE _proc_can('view', s);
  IF _sites IS NULL THEN RAISE EXCEPTION 'No access'; END IF;
  RETURN jsonb_build_object(
    'tiles', jsonb_build_object(
      'requests_to_approve', (SELECT count(*) FROM purchase_requisitions WHERE site_id = ANY(_sites) AND status = 'submitted' AND NOT is_archived),
      'requests_to_order',   (SELECT count(*) FROM purchase_requisitions WHERE site_id = ANY(_sites) AND status = 'approved' AND request_type = 'buy' AND NOT is_archived),
      'transfers_to_send',   (SELECT count(*) FROM purchase_requisitions WHERE source_site_id = ANY(_sites) AND status = 'approved' AND request_type = 'transfer' AND NOT is_archived),
      'pos_to_approve',      (SELECT count(*) FROM purchase_orders WHERE site_id = ANY(_sites) AND status = 'pending_approval'),
      'pos_draft',           (SELECT count(*) FROM purchase_orders WHERE site_id = ANY(_sites) AND status = 'draft'),
      'pos_waiting',         (SELECT count(*) FROM purchase_orders WHERE site_id = ANY(_sites) AND status IN ('sent','partially_received')),
      'late_deliveries',     (SELECT count(*) FROM purchase_orders WHERE site_id = ANY(_sites) AND status IN ('sent','partially_received') AND expected_date < current_date),
      'received_not_billed', (SELECT count(*) FROM goods_received_notes g WHERE g.site_id = ANY(_sites) AND g.status IN ('accepted','accepted_partial')
                                AND NOT EXISTS (SELECT 1 FROM purchase_invoices i WHERE i.grn_id = g.id AND i.status <> 'cancelled')),
      'mine_open',           (SELECT count(*) FROM purchase_requisitions WHERE requested_by = _me AND status IN ('draft','submitted','approved') AND NOT is_archived)),
    'spend_by_site', COALESCE((SELECT jsonb_agg(x ORDER BY x->>'site') FROM (
        SELECT jsonb_build_object('site_id', s.id, 'site', s.name,
          'ordered', COALESCE((SELECT sum(total_amount) FROM purchase_orders o WHERE o.site_id = s.id AND o.status IN ('sent','partially_received','received') AND COALESCE(o.order_date, o.created_at::date) >= _m0), 0),
          'budget',  COALESCE((SELECT sum(CASE WHEN b.monthly_split THEN COALESCE(bm.amount, 0) ELSE b.amount / 12.0 END)
                                 FROM procurement_budgets b
                                 LEFT JOIN budget_months bm ON bm.budget_id = b.id AND bm.month = extract(month FROM _m0)::int
                                WHERE b.site_id = s.id AND NOT COALESCE(b.is_archived, false)
                                  AND b.fiscal_year = extract(year FROM _m0)::int), 0)) AS x
          FROM sites s WHERE s.id = ANY(_sites)) q), '[]'::jsonb),
    'attention', COALESCE((SELECT jsonb_agg(a ORDER BY a->>'sort') FROM (
        SELECT jsonb_build_object('kind','late','sort','1'||COALESCE(o.expected_date::text,''), 'label', 'PO ' || o.po_number || ' is late', 'detail',
               COALESCE(ps.supplier_name,'') || ' · due ' || to_char(o.expected_date,'DD Mon'), 'page','proc_orders', 'site', s.name) AS a
          FROM purchase_orders o JOIN sites s ON s.id = o.site_id LEFT JOIN procurement_suppliers ps ON ps.id = o.supplier_id
         WHERE o.site_id = ANY(_sites) AND o.status IN ('sent','partially_received') AND o.expected_date < current_date
        UNION ALL
        SELECT jsonb_build_object('kind','urgent','sort','0'||r.created_at::text, 'label', 'Urgent request ' || r.requisition_no || ' waiting', 'detail',
               COALESCE(r.title,'') || ' · ' || r.status, 'page','proc_requisitions', 'site', s.name)
          FROM purchase_requisitions r JOIN sites s ON s.id = r.site_id
         WHERE r.site_id = ANY(_sites) AND r.priority = 'urgent' AND r.status IN ('submitted','approved') AND NOT r.is_archived
        UNION ALL
        SELECT jsonb_build_object('kind','needed','sort','2'||r.needed_by::text, 'label', 'Request ' || r.requisition_no || ' needed by ' || to_char(r.needed_by,'DD Mon'),
               'detail', COALESCE(r.title,'') || ' · not ordered yet', 'page','proc_requisitions', 'site', s.name)
          FROM purchase_requisitions r JOIN sites s ON s.id = r.site_id
         WHERE r.site_id = ANY(_sites) AND r.status IN ('submitted','approved') AND r.needed_by <= current_date + 7 AND NOT r.is_archived
        LIMIT 30) q), '[]'::jsonb));
END $$;

REVOKE ALL ON FUNCTION proc_request_save(jsonb), proc_request_cancel(uuid, text), proc_stock_check(uuid[]),
  proc_request_fulfil_transfer(uuid, uuid, uuid), proc_home(uuid[]), _proc_can(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION proc_request_save(jsonb), proc_request_cancel(uuid, text), proc_stock_check(uuid[]),
  proc_request_fulfil_transfer(uuid, uuid, uuid), proc_home(uuid[]), _proc_can(text, uuid) TO authenticated;

-- ── Default approval: the requester's line manager (department head), one route per site ──
INSERT INTO approval_routes (site_id, entity_type, name, min_amount, priority, is_active, is_archived)
SELECT s.id, 'purchase_requisitions', 'Requests — department head', 0, 100, true, false
  FROM sites s
 WHERE NOT EXISTS (SELECT 1 FROM approval_routes r WHERE r.site_id = s.id AND r.entity_type = 'purchase_requisitions' AND NOT r.is_archived);
INSERT INTO approval_route_steps (route_id, step_order, label, approver_type)
SELECT r.id, 1, 'Department head', 'line_manager'
  FROM approval_routes r
 WHERE r.entity_type = 'purchase_requisitions' AND r.name = 'Requests — department head'
   AND NOT EXISTS (SELECT 1 FROM approval_route_steps st WHERE st.route_id = r.id AND NOT st.is_archived);

INSERT INTO schema_migrations (filename) VALUES ('0214_procurement_home_and_requests.sql') ON CONFLICT DO NOTHING;
