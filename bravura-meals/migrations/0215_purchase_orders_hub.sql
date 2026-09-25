-- 0215 purchase_orders_hub — Procurement rewrite P3 (#53).
-- One record for the whole cycle (Odoo style): an RFQ is a draft PO.
--   rfq → rfq_sent → (confirm) → pending_approval (approval levels by amount) → sent (ordered, locked)
--   → partially_received → received;  cancelled at any point before goods arrive.
-- Alternatives: the same RFQ sent to several suppliers share rfq_group_id; confirming one cancels the rest.
-- Cancel & amend: a locked PO is cancelled and copied to a new draft PO-xxxx-1 (amended_from).
-- POs are raised from approved request lines; request lines track ordered_qty and the request becomes
-- "ordered" once every line is on a confirmed PO.

-- ── Schema ─────────────────────────────────────────────────────────────────────
ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_status_check;
ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_status_check
  CHECK (status IN ('rfq','rfq_sent','draft','pending_approval','sent','partially_received','received','cancelled'));
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS rfq_group_id uuid;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS amended_from uuid REFERENCES purchase_orders(id);
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS revision int NOT NULL DEFAULT 0;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS cancel_reason text;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS supplier_ref text;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS rfq_sent_at timestamptz;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS confirmed_by uuid REFERENCES profiles(id);
CREATE INDEX IF NOT EXISTS purchase_orders_rfq_group ON purchase_orders (rfq_group_id) WHERE rfq_group_id IS NOT NULL;

ALTER TABLE po_lines ALTER COLUMN item_id DROP NOT NULL;
ALTER TABLE po_lines ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE po_lines ADD COLUMN IF NOT EXISTS unit text;
ALTER TABLE po_lines ADD COLUMN IF NOT EXISTS requisition_line_id uuid REFERENCES requisition_lines(id);
ALTER TABLE po_lines ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false;
ALTER TABLE po_lines DROP CONSTRAINT IF EXISTS po_lines_item_or_text;
ALTER TABLE po_lines ADD CONSTRAINT po_lines_item_or_text CHECK (item_id IS NOT NULL OR NULLIF(trim(description), '') IS NOT NULL);

-- PO lines: procurement or stores staff read; writes go through the RPCs below (and receiving).
DROP POLICY IF EXISTS pol_select ON po_lines;
CREATE POLICY pol_select ON po_lines FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM purchase_orders po WHERE po.id = po_id AND _proc_can('view', po.site_id)));
DROP POLICY IF EXISTS pol_all ON po_lines;
CREATE POLICY pol_all ON po_lines FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM purchase_orders po WHERE po.id = po_id AND _proc_can('edit', po.site_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM purchase_orders po WHERE po.id = po_id AND _proc_can('edit', po.site_id)));

-- ── Locks ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_lock_po_lines() RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE _st TEXT;
BEGIN
  SELECT status INTO _st FROM purchase_orders WHERE id = COALESCE(NEW.po_id, OLD.po_id);
  IF _st IS NULL OR _st IN ('draft','rfq','rfq_sent') THEN RETURN COALESCE(NEW, OLD); END IF;
  -- Receiving goods against an ordered PO only changes received quantities — that's allowed.
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'received_qty' - 'updated_at' - 'line_total')
                        = (to_jsonb(OLD) - 'received_qty' - 'updated_at' - 'line_total') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'This purchase order is % — its lines can no longer be changed. Use Amend to make a new version.', replace(_st, '_', ' ');
END $function$;

CREATE OR REPLACE FUNCTION public.trg_po_header_lock() RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  IF OLD.status IN ('pending_approval','sent','partially_received','received')
     AND (NEW.supplier_id, NEW.site_id, NEW.total_amount, NEW.cost_centre_id, NEW.project_id, NEW.warehouse_id)
         IS DISTINCT FROM (OLD.supplier_id, OLD.site_id, OLD.total_amount, OLD.cost_centre_id, OLD.project_id, OLD.warehouse_id) THEN
    RAISE EXCEPTION 'This purchase order is locked (%). Use Amend to make a new version.', replace(OLD.status, '_', ' ');
  END IF;
  IF OLD.status = 'cancelled' AND NEW.status <> 'cancelled' THEN RAISE EXCEPTION 'A cancelled purchase order cannot be reopened'; END IF;
  RETURN NEW;
END $function$;
DROP TRIGGER IF EXISTS trg_po_header_lock ON purchase_orders;
CREATE TRIGGER trg_po_header_lock BEFORE UPDATE ON purchase_orders FOR EACH ROW EXECUTE FUNCTION trg_po_header_lock();

-- Budget check also applies when an RFQ is confirmed.
CREATE OR REPLACE FUNCTION public.trg_po_budget_check() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _b RECORD; _yr INT; _used NUMERIC;
BEGIN
  IF NEW.status IN ('draft','cancelled','rfq','rfq_sent') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status NOT IN ('draft','rfq','rfq_sent') THEN RETURN NEW; END IF;
  IF NEW.budget_override_by IS NOT NULL THEN RETURN NEW; END IF;
  _yr := EXTRACT(YEAR FROM COALESCE(NEW.order_date, CURRENT_DATE))::INT;
  FOR _b IN SELECT b.*, COALESCE(cc.name, pj.name) dim_name FROM procurement_budgets b
              LEFT JOIN cost_centres cc ON cc.id = b.cost_centre_id LEFT JOIN projects pj ON pj.id = b.project_id
             WHERE b.site_id = NEW.site_id AND b.fiscal_year = _yr AND NOT b.is_archived
               AND ((b.cost_centre_id IS NOT NULL AND b.cost_centre_id = NEW.cost_centre_id)
                 OR (b.project_id IS NOT NULL AND b.project_id = NEW.project_id)) LOOP
    SELECT COALESCE(SUM(total_amount), 0) INTO _used FROM purchase_orders po
     WHERE po.site_id = NEW.site_id AND po.id <> NEW.id AND po.status NOT IN ('draft','cancelled','rfq','rfq_sent')
       AND EXTRACT(YEAR FROM COALESCE(po.order_date, po.created_at::date)) = _yr
       AND ((_b.cost_centre_id IS NOT NULL AND po.cost_centre_id = _b.cost_centre_id) OR (_b.project_id IS NOT NULL AND po.project_id = _b.project_id));
    IF _used + COALESCE(NEW.total_amount, 0) > _b.amount THEN
      RAISE EXCEPTION 'OVER_BUDGET: This order takes % over its % budget (budget $%, already committed $%, this order $%). Someone with procurement approval can override it.',
        _b.dim_name, _yr, _b.amount, _used, COALESCE(NEW.total_amount, 0) USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$function$;

-- ── Receiving: service lines and archived lines ───────────────────────────────
CREATE OR REPLACE FUNCTION public._po_refresh_status(p_po_id uuid) RETURNS void
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $function$
  UPDATE purchase_orders po
     SET status = CASE WHEN NOT EXISTS (SELECT 1 FROM po_lines l WHERE l.po_id = po.id AND NOT l.is_archived AND l.received_qty < l.quantity)
                       THEN 'received' ELSE 'partially_received' END,
         updated_at = now()
   WHERE po.id = p_po_id AND po.status IN ('sent','partially_received')
     AND EXISTS (SELECT 1 FROM po_lines l WHERE l.po_id = po.id AND NOT l.is_archived AND l.received_qty > 0);
$function$;

CREATE OR REPLACE FUNCTION public.trg_grn_moves_stock() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  _was boolean := TG_OP = 'UPDATE' AND OLD.status IN ('accepted','accepted_partial');
  _is  boolean := NEW.status IN ('accepted','accepted_partial');
  _po  purchase_orders%ROWTYPE; _l record; _qty numeric;
BEGIN
  IF _was AND NOT _is THEN
    RAISE EXCEPTION 'This GRN has already put stock on the shelf. Correct it with a stock adjustment or supplier return instead.';
  END IF;
  IF NOT _is OR _was OR NEW.po_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO _po FROM purchase_orders WHERE id = NEW.po_id;
  FOR _l IN
    SELECT g.*, COALESCE(g.item_id, pl.item_id) AS stock_item, pl.unit_cost AS po_cost
      FROM grn_lines g LEFT JOIN po_lines pl ON pl.id = g.po_line_id WHERE g.grn_id = NEW.id
  LOOP
    _qty := COALESCE(_l.quantity_received, 0) - COALESCE(_l.quantity_rejected, 0);
    CONTINUE WHEN _qty <= 0;
    -- Stock items go on the shelf; services are simply confirmed as done.
    IF _l.stock_item IS NOT NULL AND _po.warehouse_id IS NOT NULL THEN
      INSERT INTO inventory_movements (item_id, warehouse_id, movement_type, quantity, unit_cost, value,
                                       voucher_type, voucher_no, source_module, source_reference_id, notes, created_by)
      VALUES (_l.stock_item, _po.warehouse_id, 'grn', _qty, COALESCE(NULLIF(_l.unit_price, 0), _l.po_cost, 0),
              _qty * COALESCE(NULLIF(_l.unit_price, 0), _l.po_cost, 0),
              'GRN', NEW.grn_number, 'procurement', NEW.id,
              'Received against ' || COALESCE(_po.po_number, 'PO'), COALESCE(NEW.received_by, auth.uid()));
    END IF;
    IF _l.po_line_id IS NOT NULL THEN
      UPDATE po_lines SET received_qty = received_qty + _qty WHERE id = _l.po_line_id;
    END IF;
  END LOOP;
  PERFORM _po_refresh_status(NEW.po_id);
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.proc_receive_po(p_po_id uuid, p_lines jsonb, p_delivery_ref text DEFAULT NULL, p_notes text DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _po purchase_orders%ROWTYPE; _grn uuid; _partial boolean := false; _n int := 0; _j jsonb; _pl record;
BEGIN
  SELECT * INTO _po FROM purchase_orders WHERE id = p_po_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Purchase order not found'; END IF;
  IF NOT (_has_permission('procurement.create', _po.site_id) OR _has_permission('inventory.create', _po.site_id)) THEN
    RAISE EXCEPTION 'You do not have permission to receive goods at this site';
  END IF;
  IF _po.status NOT IN ('sent','partially_received') THEN
    RAISE EXCEPTION 'Only ordered purchase orders can be received (this one is %)', replace(_po.status, '_', ' ');
  END IF;
  INSERT INTO goods_received_notes (grn_number, site_id, po_id, supplier_id, received_by, received_date, status, delivery_note_ref, notes)
  VALUES ('', _po.site_id, _po.id, _po.supplier_id, auth.uid(), CURRENT_DATE, 'draft', p_delivery_ref, p_notes)
  RETURNING id INTO _grn;
  FOR _j IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    CONTINUE WHEN COALESCE((_j->>'qty')::numeric, 0) <= 0;
    SELECT l.*, i.description AS item_desc INTO _pl
      FROM po_lines l LEFT JOIN items i ON i.id = l.item_id
     WHERE l.id = (_j->>'po_line_id')::uuid AND l.po_id = _po.id AND NOT l.is_archived;
    IF NOT FOUND THEN RAISE EXCEPTION 'Line does not belong to this purchase order'; END IF;
    IF COALESCE((_j->>'rejected')::numeric, 0) > 0 THEN _partial := true; END IF;
    INSERT INTO grn_lines (grn_id, po_line_id, item_id, item_description, quantity_expected, quantity_received,
                           quantity_rejected, unit_price, rejection_reason)
    VALUES (_grn, _pl.id, _pl.item_id, COALESCE(_pl.item_desc, _pl.description, 'Item'), _pl.quantity - _pl.received_qty,
            (_j->>'qty')::numeric, COALESCE((_j->>'rejected')::numeric, 0), _pl.unit_cost, _j->>'reason');
    _n := _n + 1;
  END LOOP;
  IF _n = 0 THEN RAISE EXCEPTION 'Enter a quantity for at least one line'; END IF;
  UPDATE goods_received_notes SET status = CASE WHEN _partial THEN 'accepted_partial' ELSE 'accepted' END, updated_at = now() WHERE id = _grn;
  RETURN _grn;
END $function$;

-- ── Requests ↔ POs: ordered quantities follow confirmed POs ────────────────────
CREATE OR REPLACE FUNCTION public._proc_refresh_requests(p_po uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _rid uuid;
BEGIN
  UPDATE requisition_lines rl SET ordered_qty = COALESCE((
      SELECT sum(pl.quantity) FROM po_lines pl JOIN purchase_orders po ON po.id = pl.po_id
       WHERE pl.requisition_line_id = rl.id AND NOT pl.is_archived
         AND po.status IN ('pending_approval','sent','partially_received','received')), 0)
   WHERE rl.id IN (SELECT requisition_line_id FROM po_lines WHERE po_id = p_po AND requisition_line_id IS NOT NULL);
  FOR _rid IN SELECT DISTINCT rl.requisition_id FROM po_lines pl JOIN requisition_lines rl ON rl.id = pl.requisition_line_id WHERE pl.po_id = p_po LOOP
    UPDATE purchase_requisitions r SET status = CASE
        WHEN NOT EXISTS (SELECT 1 FROM requisition_lines l WHERE l.requisition_id = r.id AND NOT l.is_archived AND l.ordered_qty < l.quantity) THEN 'ordered'
        ELSE 'approved' END, updated_at = now()
     WHERE r.id = _rid AND r.status IN ('approved','ordered');
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.trg_po_requests_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN PERFORM _proc_refresh_requests(NEW.id); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_po_requests_sync ON purchase_orders;
CREATE TRIGGER trg_po_requests_sync AFTER UPDATE OF status ON purchase_orders FOR EACH ROW EXECUTE FUNCTION trg_po_requests_sync();

-- ── Helpers ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._po_recalc(p_po uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE purchase_orders SET total_amount = COALESCE((SELECT sum(quantity * unit_cost) FROM po_lines WHERE po_id = p_po AND NOT is_archived), 0),
         updated_at = now() WHERE id = p_po;
$$;

-- Last agreed price for an item from a supplier (or from anyone), for pre-filling lines.
CREATE OR REPLACE FUNCTION public._po_last_price(p_item uuid, p_supplier uuid) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT pl.unit_cost FROM po_lines pl JOIN purchase_orders po ON po.id = pl.po_id
   WHERE pl.item_id = p_item AND NOT pl.is_archived AND po.status IN ('sent','partially_received','received')
   ORDER BY (po.supplier_id = p_supplier) DESC NULLS LAST, COALESCE(po.order_date, po.created_at::date) DESC LIMIT 1;
$$;

-- ── Create RFQs / POs from approved request lines ─────────────────────────────
CREATE OR REPLACE FUNCTION public.proc_po_from_requests(p_line_ids uuid[], p_supplier_ids uuid[], p_warehouse_id uuid DEFAULT NULL, p_expected date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _site uuid; _nsites int; _grp uuid; _sup uuid; _po uuid; _ids uuid[] := '{}'; _cc uuid; _pj uuid; _ncc int; _npj int; _req uuid;
        _multi boolean := COALESCE(array_length(p_supplier_ids, 1), 0) > 1;
BEGIN
  IF COALESCE(array_length(p_line_ids, 1), 0) = 0 THEN RAISE EXCEPTION 'Pick at least one request line'; END IF;
  IF COALESCE(array_length(p_supplier_ids, 1), 0) = 0 THEN RAISE EXCEPTION 'Pick at least one supplier'; END IF;
  SELECT count(DISTINCT r.site_id), min(r.site_id::text)::uuid, count(DISTINCT r.cost_centre_id), min(r.cost_centre_id::text)::uuid,
         count(DISTINCT r.project_id), min(r.project_id::text)::uuid, min(r.id::text)::uuid
    INTO _nsites, _site, _ncc, _cc, _npj, _pj, _req
    FROM requisition_lines l JOIN purchase_requisitions r ON r.id = l.requisition_id
   WHERE l.id = ANY(p_line_ids) AND NOT l.is_archived AND r.status = 'approved' AND r.request_type = 'buy';
  IF _nsites IS NULL OR _nsites = 0 THEN RAISE EXCEPTION 'Those lines are not on approved purchase requests'; END IF;
  IF _nsites > 1 THEN RAISE EXCEPTION 'Order for one site at a time — the lines picked are for % sites', _nsites; END IF;
  IF NOT _proc_can('create', _site) THEN RAISE EXCEPTION 'You cannot raise purchase orders for this site'; END IF;
  IF p_warehouse_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM warehouses WHERE id = p_warehouse_id AND site_id = _site) THEN
    RAISE EXCEPTION 'Deliver into a store at the same site';
  END IF;
  _grp := CASE WHEN _multi THEN gen_random_uuid() END;
  FOREACH _sup IN ARRAY p_supplier_ids LOOP
    INSERT INTO purchase_orders (po_number, site_id, supplier_id, warehouse_id, requisition_id, status, expected_date, total_amount,
      created_by, cost_centre_id, project_id, rfq_group_id, priority)
    VALUES ('', _site, _sup, COALESCE(p_warehouse_id, (SELECT id FROM warehouses WHERE site_id = _site AND is_active ORDER BY name LIMIT 1)),
      _req, CASE WHEN _multi THEN 'rfq' ELSE 'draft' END, p_expected, 0, auth.uid(),
      CASE WHEN _ncc = 1 THEN _cc END, CASE WHEN _npj = 1 THEN _pj END, _grp,
      COALESCE((SELECT r.priority FROM requisition_lines l JOIN purchase_requisitions r ON r.id = l.requisition_id WHERE l.id = ANY(p_line_ids)
                ORDER BY array_position(ARRAY['urgent','high','normal','low'], r.priority) LIMIT 1), 'normal'))
    RETURNING id INTO _po;
    INSERT INTO po_lines (po_id, item_id, description, unit, quantity, unit_cost, requisition_line_id, notes)
    SELECT _po, l.item_id, l.description, l.unit, l.quantity - l.ordered_qty,
           CASE WHEN _multi THEN 0 ELSE COALESCE(_po_last_price(l.item_id, _sup), l.estimated_cost, 0) END, l.id, l.notes
      FROM requisition_lines l WHERE l.id = ANY(p_line_ids) AND NOT l.is_archived AND l.quantity > l.ordered_qty;
    PERFORM _po_recalc(_po);
    _ids := _ids || _po;
  END LOOP;
  RETURN jsonb_build_object('po_ids', _ids, 'rfq_group_id', _grp);
END $$;

-- Save a PO / RFQ that is still editable: header fields and lines (kept lines by id, new ones added,
-- missing ones archived — never deleted).
CREATE OR REPLACE FUNCTION public.proc_po_save(p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid := NULLIF(p->>'id','')::uuid; _po purchase_orders%ROWTYPE; _l jsonb; _keep uuid[] := '{}'; _lid uuid; _site uuid;
BEGIN
  IF _id IS NULL THEN
    _site := (p->>'site_id')::uuid;
    IF _site IS NULL THEN RAISE EXCEPTION 'Choose the site this order is for'; END IF;
    IF NOT _proc_can('create', _site) THEN RAISE EXCEPTION 'You cannot raise purchase orders for this site'; END IF;
    INSERT INTO purchase_orders (po_number, site_id, status, total_amount, created_by) VALUES ('', _site, 'draft', 0, auth.uid()) RETURNING id INTO _id;
  END IF;
  SELECT * INTO _po FROM purchase_orders WHERE id = _id FOR UPDATE;
  IF _po.status NOT IN ('draft','rfq','rfq_sent') THEN RAISE EXCEPTION 'This order is % — use Amend to change it', replace(_po.status, '_', ' '); END IF;
  IF NOT _proc_can('edit', _po.site_id) AND NOT (_proc_can('create', _po.site_id) AND _po.created_by = auth.uid()) THEN RAISE EXCEPTION 'No access'; END IF;
  UPDATE purchase_orders SET
    supplier_id = NULLIF(p->>'supplier_id','')::uuid, warehouse_id = NULLIF(p->>'warehouse_id','')::uuid,
    expected_date = NULLIF(p->>'expected_date','')::date, delivery_address = NULLIF(p->>'delivery_address',''),
    notes = NULLIF(p->>'notes',''), priority = COALESCE(NULLIF(p->>'priority',''), 'normal'),
    cost_centre_id = NULLIF(p->>'cost_centre_id','')::uuid, project_id = NULLIF(p->>'project_id','')::uuid,
    supplier_ref = NULLIF(p->>'supplier_ref',''), updated_at = now()
   WHERE id = _id;
  FOR _l IN SELECT * FROM jsonb_array_elements(COALESCE(p->'lines','[]'::jsonb)) LOOP
    IF COALESCE((_l->>'quantity')::numeric, 0) <= 0 THEN CONTINUE; END IF;
    IF NULLIF(_l->>'item_id','') IS NULL AND NULLIF(trim(_l->>'description'),'') IS NULL THEN CONTINUE; END IF;
    _lid := NULLIF(_l->>'id','')::uuid;
    IF _lid IS NOT NULL AND EXISTS (SELECT 1 FROM po_lines WHERE id = _lid AND po_id = _id AND NOT is_archived) THEN
      UPDATE po_lines SET item_id = NULLIF(_l->>'item_id','')::uuid, description = NULLIF(trim(_l->>'description'),''),
        unit = NULLIF(_l->>'unit',''), quantity = (_l->>'quantity')::numeric, unit_cost = COALESCE(NULLIF(_l->>'unit_cost','')::numeric, 0),
        notes = NULLIF(_l->>'notes','') WHERE id = _lid;
    ELSE
      INSERT INTO po_lines (po_id, item_id, description, unit, quantity, unit_cost, notes)
      VALUES (_id, NULLIF(_l->>'item_id','')::uuid, NULLIF(trim(_l->>'description'),''), NULLIF(_l->>'unit',''),
        (_l->>'quantity')::numeric, COALESCE(NULLIF(_l->>'unit_cost','')::numeric, 0), NULLIF(_l->>'notes',''))
      RETURNING id INTO _lid;
    END IF;
    _keep := _keep || _lid;
  END LOOP;
  UPDATE po_lines SET is_archived = true WHERE po_id = _id AND NOT is_archived AND NOT (id = ANY(_keep));
  PERFORM _po_recalc(_id);
  RETURN _id;
END $$;

-- Ask one more supplier for a price on the same RFQ.
CREATE OR REPLACE FUNCTION public.proc_rfq_add_supplier(p_po uuid, p_supplier uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _po purchase_orders%ROWTYPE; _new uuid; _grp uuid;
BEGIN
  SELECT * INTO _po FROM purchase_orders WHERE id = p_po FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF NOT _proc_can('create', _po.site_id) THEN RAISE EXCEPTION 'No access'; END IF;
  IF _po.status NOT IN ('draft','rfq','rfq_sent') THEN RAISE EXCEPTION 'Only a quote or draft can get alternatives'; END IF;
  IF EXISTS (SELECT 1 FROM purchase_orders WHERE supplier_id = p_supplier AND status <> 'cancelled'
              AND (id = p_po OR (rfq_group_id IS NOT NULL AND rfq_group_id = _po.rfq_group_id))) THEN
    RAISE EXCEPTION 'That supplier is already on this quote';
  END IF;
  _grp := COALESCE(_po.rfq_group_id, gen_random_uuid());
  UPDATE purchase_orders SET rfq_group_id = _grp, status = CASE WHEN status = 'draft' THEN 'rfq' ELSE status END WHERE id = p_po;
  INSERT INTO purchase_orders (po_number, site_id, supplier_id, warehouse_id, requisition_id, status, expected_date, total_amount, created_by,
    cost_centre_id, project_id, rfq_group_id, priority, delivery_address, notes)
  VALUES ('', _po.site_id, p_supplier, _po.warehouse_id, _po.requisition_id, 'rfq', _po.expected_date, 0, auth.uid(),
    _po.cost_centre_id, _po.project_id, _grp, _po.priority, _po.delivery_address, _po.notes)
  RETURNING id INTO _new;
  INSERT INTO po_lines (po_id, item_id, description, unit, quantity, unit_cost, requisition_line_id, notes)
  SELECT _new, item_id, description, unit, quantity, 0, requisition_line_id, notes FROM po_lines WHERE po_id = p_po AND NOT is_archived;
  RETURN _new;
END $$;

CREATE OR REPLACE FUNCTION public.proc_rfq_mark_sent(p_po uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _po purchase_orders%ROWTYPE;
BEGIN
  SELECT * INTO _po FROM purchase_orders WHERE id = p_po FOR UPDATE;
  IF NOT _proc_can('edit', _po.site_id) AND NOT _proc_can('create', _po.site_id) THEN RAISE EXCEPTION 'No access'; END IF;
  IF _po.status NOT IN ('draft','rfq') THEN RAISE EXCEPTION 'Only a quote request can be marked as sent'; END IF;
  UPDATE purchase_orders SET status = 'rfq_sent', rfq_sent_at = now(), updated_at = now() WHERE id = p_po;
END $$;

-- Confirm the order: goes for approval by amount (approval routes) or straight to ordered.
-- Other suppliers' alternatives on the same RFQ are cancelled.
CREATE OR REPLACE FUNCTION public.proc_po_confirm(p_po uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _po purchase_orders%ROWTYPE; _st text; _n int;
BEGIN
  SELECT * INTO _po FROM purchase_orders WHERE id = p_po FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF NOT _proc_can('create', _po.site_id) AND NOT _proc_can('edit', _po.site_id) THEN RAISE EXCEPTION 'No access'; END IF;
  IF _po.status NOT IN ('draft','rfq','rfq_sent') THEN RAISE EXCEPTION 'This order is already %', replace(_po.status, '_', ' '); END IF;
  IF _po.supplier_id IS NULL THEN RAISE EXCEPTION 'Choose the supplier first'; END IF;
  IF EXISTS (SELECT 1 FROM procurement_suppliers WHERE id = _po.supplier_id AND status IS DISTINCT FROM 'active') THEN
    RAISE EXCEPTION 'This supplier is not active';
  END IF;
  SELECT count(*) INTO _n FROM po_lines WHERE po_id = p_po AND NOT is_archived;
  IF _n = 0 THEN RAISE EXCEPTION 'Add at least one line'; END IF;
  IF EXISTS (SELECT 1 FROM po_lines WHERE po_id = p_po AND NOT is_archived AND unit_cost <= 0) THEN
    RAISE EXCEPTION 'Every line needs the supplier''s price before confirming';
  END IF;
  IF _po.warehouse_id IS NULL AND EXISTS (SELECT 1 FROM po_lines WHERE po_id = p_po AND NOT is_archived AND item_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Choose the store the stock items will be delivered into';
  END IF;
  PERFORM _po_recalc(p_po);
  UPDATE purchase_orders SET status = 'sent', order_date = CURRENT_DATE, confirmed_at = now(), confirmed_by = auth.uid(), updated_at = now()
   WHERE id = p_po;
  SELECT status INTO _st FROM purchase_orders WHERE id = p_po;
  IF _po.rfq_group_id IS NOT NULL THEN
    UPDATE purchase_orders SET status = 'cancelled', cancel_reason = 'Another supplier was chosen (' || _po.po_number || ')', updated_at = now()
     WHERE rfq_group_id = _po.rfq_group_id AND id <> p_po AND status IN ('draft','rfq','rfq_sent');
  END IF;
  RETURN jsonb_build_object('status', _st);
END $$;

CREATE OR REPLACE FUNCTION public.proc_po_cancel(p_po uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _po purchase_orders%ROWTYPE;
BEGIN
  SELECT * INTO _po FROM purchase_orders WHERE id = p_po FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF NOT _proc_can('edit', _po.site_id) AND NOT (_proc_can('create', _po.site_id) AND _po.status IN ('draft','rfq','rfq_sent')) THEN RAISE EXCEPTION 'No access'; END IF;
  IF _po.status IN ('cancelled','received') THEN RAISE EXCEPTION 'This order is already %', _po.status; END IF;
  IF EXISTS (SELECT 1 FROM po_lines WHERE po_id = p_po AND received_qty > 0) THEN
    RAISE EXCEPTION 'Goods have already been received against this order — it can''t be cancelled';
  END IF;
  IF _po.status = 'pending_approval' THEN PERFORM _approval_cancel('purchase_orders', p_po, 'Order cancelled'); END IF;
  PERFORM set_config('app.approval_engine', 'on', true);
  UPDATE purchase_orders SET status = 'cancelled', cancel_reason = NULLIF(trim(p_reason), ''), updated_at = now() WHERE id = p_po;
  PERFORM set_config('app.approval_engine', 'off', true);
END $$;

-- Cancel & amend: the locked order is cancelled and copied to a new draft with the next revision number.
CREATE OR REPLACE FUNCTION public.proc_po_amend(p_po uuid, p_reason text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _po purchase_orders%ROWTYPE; _new uuid; _base text; _rev int;
BEGIN
  SELECT * INTO _po FROM purchase_orders WHERE id = p_po FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF NOT _proc_can('edit', _po.site_id) THEN RAISE EXCEPTION 'No access'; END IF;
  IF _po.status NOT IN ('pending_approval','sent') THEN RAISE EXCEPTION 'Only an ordered or pending order can be amended (drafts can simply be edited)'; END IF;
  IF EXISTS (SELECT 1 FROM po_lines WHERE po_id = p_po AND received_qty > 0) THEN
    RAISE EXCEPTION 'Goods have been received against this order — raise a new order for the difference instead';
  END IF;
  IF EXISTS (SELECT 1 FROM purchase_invoices WHERE po_id = p_po AND status <> 'cancelled') THEN
    RAISE EXCEPTION 'A bill is recorded against this order — cancel the bill first';
  END IF;
  PERFORM proc_po_cancel(p_po, 'Amended' || COALESCE(': ' || NULLIF(trim(p_reason), ''), ''));
  _base := regexp_replace(_po.po_number, '-[0-9]+$', '') ;
  IF _po.revision = 0 THEN _base := _po.po_number; END IF;
  _rev := _po.revision + 1;
  INSERT INTO purchase_orders (po_number, site_id, supplier_id, warehouse_id, requisition_id, status, expected_date, total_amount, created_by,
    cost_centre_id, project_id, priority, delivery_address, notes, amended_from, revision, supplier_ref)
  VALUES ('', _po.site_id, _po.supplier_id, _po.warehouse_id, _po.requisition_id, 'draft', _po.expected_date, 0, auth.uid(),
    _po.cost_centre_id, _po.project_id, _po.priority, _po.delivery_address, _po.notes, _po.id, _rev, _po.supplier_ref)
  RETURNING id INTO _new;
  UPDATE purchase_orders SET po_number = _base || '-' || _rev WHERE id = _new;
  INSERT INTO po_lines (po_id, item_id, description, unit, quantity, unit_cost, requisition_line_id, notes)
  SELECT _new, item_id, description, unit, quantity, unit_cost, requisition_line_id, notes FROM po_lines WHERE po_id = p_po AND NOT is_archived;
  PERFORM _po_recalc(_new);
  RETURN _new;
END $$;

-- ── Lists ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.proc_po_list(p_site_ids uuid[]) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _sites uuid[];
BEGIN
  SELECT array_agg(s) INTO _sites FROM unnest(p_site_ids) s WHERE _proc_can('view', s);
  IF _sites IS NULL THEN RAISE EXCEPTION 'No access'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(x ORDER BY x->>'created_at' DESC) FROM (
    SELECT jsonb_build_object(
      'id', po.id, 'po_number', po.po_number, 'status', po.status, 'site_id', po.site_id, 'site', s.name,
      'supplier_id', po.supplier_id, 'supplier', ps.supplier_name, 'total', po.total_amount, 'priority', po.priority,
      'order_date', po.order_date, 'expected_date', po.expected_date, 'created_at', po.created_at, 'rfq_group_id', po.rfq_group_id,
      'revision', po.revision, 'amended_from', po.amended_from, 'cancel_reason', po.cancel_reason,
      'delivery_status', po.delivery_status,
      'lines', (SELECT count(*) FROM po_lines l WHERE l.po_id = po.id AND NOT l.is_archived),
      'receipt', CASE
          WHEN po.status NOT IN ('sent','partially_received','received') THEN NULL
          WHEN NOT EXISTS (SELECT 1 FROM po_lines l WHERE l.po_id = po.id AND NOT l.is_archived AND l.received_qty > 0) THEN 'none'
          WHEN EXISTS (SELECT 1 FROM po_lines l WHERE l.po_id = po.id AND NOT l.is_archived AND l.received_qty < l.quantity) THEN 'partial'
          ELSE 'full' END,
      'billed', COALESCE((SELECT sum(i.total_amount) FROM purchase_invoices i WHERE i.po_id = po.id AND i.status NOT IN ('cancelled','rejected')), 0),
      'late', po.status IN ('sent','partially_received') AND po.expected_date < CURRENT_DATE,
      'alternatives', CASE WHEN po.rfq_group_id IS NULL THEN 0 ELSE
          (SELECT count(*) FROM purchase_orders a WHERE a.rfq_group_id = po.rfq_group_id AND a.id <> po.id AND a.status <> 'cancelled') END,
      'requests', (SELECT string_agg(DISTINCT r.requisition_no, ', ') FROM po_lines l JOIN requisition_lines rl ON rl.id = l.requisition_line_id
                     JOIN purchase_requisitions r ON r.id = rl.requisition_id WHERE l.po_id = po.id)) AS x
      FROM purchase_orders po JOIN sites s ON s.id = po.site_id LEFT JOIN procurement_suppliers ps ON ps.id = po.supplier_id
     WHERE po.site_id = ANY(_sites)
     ORDER BY po.created_at DESC LIMIT 800) q), '[]'::jsonb);
END $$;

-- Approved request lines not yet fully on a confirmed order.
CREATE OR REPLACE FUNCTION public.proc_lines_to_order(p_site_ids uuid[]) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'line_id', l.id, 'request_id', r.id, 'requisition_no', r.requisition_no, 'title', r.title, 'site_id', r.site_id, 'site', s.name,
      'priority', r.priority, 'needed_by', r.needed_by, 'item_id', l.item_id,
      'what', COALESCE(i.item_code || ' — ' || i.description, l.description), 'unit', l.unit,
      'remaining', l.quantity - l.ordered_qty, 'estimated_cost', l.estimated_cost,
      'last_price', _po_last_price(l.item_id, NULL), 'preferred_supplier_id', i.preferred_supplier_id)
      ORDER BY array_position(ARRAY['urgent','high','normal','low'], r.priority), r.needed_by NULLS LAST, r.requisition_no)
    FROM requisition_lines l JOIN purchase_requisitions r ON r.id = l.requisition_id JOIN sites s ON s.id = r.site_id
    LEFT JOIN items i ON i.id = l.item_id
   WHERE r.site_id = ANY(p_site_ids) AND _proc_can('view', r.site_id) AND r.status = 'approved' AND r.request_type = 'buy'
     AND NOT r.is_archived AND NOT l.is_archived AND l.quantity > l.ordered_qty
     -- not already on an open quote/draft
     AND NOT EXISTS (SELECT 1 FROM po_lines pl JOIN purchase_orders po ON po.id = pl.po_id
                      WHERE pl.requisition_line_id = l.id AND NOT pl.is_archived AND po.status IN ('draft','rfq','rfq_sent'))), '[]'::jsonb);
END $$;

-- Recent prices paid for items (for "last price" hints while ordering).
CREATE OR REPLACE FUNCTION public.proc_item_price_history(p_item_ids uuid[]) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN COALESCE((SELECT jsonb_agg(x) FROM (
    SELECT jsonb_build_object('item_id', h.item_id, 'unit_cost', h.unit_cost, 'supplier', h.supplier_name, 'date', h.d, 'po_number', h.po_number, 'site', h.site) AS x
      FROM (SELECT pl.item_id, pl.unit_cost, ps.supplier_name, COALESCE(po.order_date, po.created_at::date) d, po.po_number, s.name site,
                   row_number() OVER (PARTITION BY pl.item_id ORDER BY COALESCE(po.order_date, po.created_at::date) DESC) rn
              FROM po_lines pl JOIN purchase_orders po ON po.id = pl.po_id JOIN sites s ON s.id = po.site_id
              LEFT JOIN procurement_suppliers ps ON ps.id = po.supplier_id
             WHERE pl.item_id = ANY(p_item_ids) AND NOT pl.is_archived AND po.status IN ('sent','partially_received','received')
               AND _proc_can('view', po.site_id)) h
     WHERE h.rn <= 5) q), '[]'::jsonb);
END $$;

REVOKE ALL ON FUNCTION proc_po_from_requests(uuid[], uuid[], uuid, date), proc_po_save(jsonb), proc_rfq_add_supplier(uuid, uuid),
  proc_rfq_mark_sent(uuid), proc_po_confirm(uuid), proc_po_cancel(uuid, text), proc_po_amend(uuid, text), proc_po_list(uuid[]),
  proc_lines_to_order(uuid[]), proc_item_price_history(uuid[]), _po_recalc(uuid), _po_last_price(uuid, uuid), _proc_refresh_requests(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION proc_po_from_requests(uuid[], uuid[], uuid, date), proc_po_save(jsonb), proc_rfq_add_supplier(uuid, uuid),
  proc_rfq_mark_sent(uuid), proc_po_confirm(uuid), proc_po_cancel(uuid, text), proc_po_amend(uuid, text), proc_po_list(uuid[]),
  proc_lines_to_order(uuid[]), proc_item_price_history(uuid[]) TO authenticated;

-- ── Default approval levels for POs, per site (configurable in the approval routes) ──
DO $$
DECLARE _s record; _r uuid;
BEGIN
  FOR _s IN SELECT id FROM sites s WHERE NOT EXISTS (SELECT 1 FROM approval_routes r WHERE r.site_id = s.id AND r.entity_type = 'purchase_orders' AND NOT r.is_archived) LOOP
    INSERT INTO approval_routes (site_id, entity_type, name, min_amount, max_amount, priority, is_active, is_archived)
    VALUES (_s.id, 'purchase_orders', 'POs up to $1,000', 0, 1000, 100, true, false) RETURNING id INTO _r;
    INSERT INTO approval_route_steps (route_id, step_order, label, approver_type, approver_permission)
    VALUES (_r, 1, 'Procurement approver', 'permission', 'procurement.approve');

    INSERT INTO approval_routes (site_id, entity_type, name, min_amount, max_amount, priority, is_active, is_archived)
    VALUES (_s.id, 'purchase_orders', 'POs $1,000 – $10,000', 1000.01, 10000, 100, true, false) RETURNING id INTO _r;
    INSERT INTO approval_route_steps (route_id, step_order, label, approver_type, approver_permission) VALUES
      (_r, 1, 'Procurement approver', 'permission', 'procurement.approve'),
      (_r, 2, 'Second procurement approver', 'permission', 'procurement.approve');

    INSERT INTO approval_routes (site_id, entity_type, name, min_amount, max_amount, priority, is_active, is_archived)
    VALUES (_s.id, 'purchase_orders', 'POs over $10,000', 10000.01, NULL, 100, true, false) RETURNING id INTO _r;
    INSERT INTO approval_route_steps (route_id, step_order, label, approver_type, approver_permission) VALUES
      (_r, 1, 'Procurement approver', 'permission', 'procurement.approve'),
      (_r, 2, 'Second procurement approver', 'permission', 'procurement.approve'),
      (_r, 3, 'Finance approval', 'permission', 'finance.approve');
  END LOOP;
END $$;

INSERT INTO schema_migrations (filename) VALUES ('0215_purchase_orders_hub.sql') ON CONFLICT DO NOTHING;
