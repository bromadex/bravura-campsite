-- 0197 grn_moves_stock — Purchase orders and goods receiving live in Procurement, and an
-- accepted GRN is what puts stock on the shelf. Previously Inventory's PO page wrote
-- inventory_movements directly (no GRN, no ledger posting) while Procurement's GRN page
-- created GRNs that never moved stock. Now there is one path:
--   GRN accepted  →  stock movement per PO line (into the PO's warehouse)
--                 →  po_lines.received_qty and the PO status updated
--                 →  ledger posting (existing trg_gl_grn)
-- proc_receive_po() does the whole receipt in one call for the "Receive" button.

-- Fix 0185's line lock: line_total is a generated column, which is still NULL in a BEFORE
-- trigger's NEW row, so every received_qty update on a sent PO was wrongly rejected.
CREATE OR REPLACE FUNCTION trg_lock_po_lines() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE _st TEXT;
BEGIN
  SELECT status INTO _st FROM purchase_orders WHERE id = COALESCE(NEW.po_id, OLD.po_id);
  IF _st IS NULL OR _st = 'draft' THEN RETURN COALESCE(NEW, OLD); END IF;
  -- Receiving goods against a sent PO only changes received quantities — that's allowed.
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'received_qty' - 'updated_at' - 'line_total')
                        = (to_jsonb(OLD) - 'received_qty' - 'updated_at' - 'line_total') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'This purchase order is % — its lines can no longer be changed', replace(_st, '_', ' ');
END $$;

ALTER TABLE grn_lines ADD COLUMN IF NOT EXISTS item_id uuid REFERENCES items(id);

CREATE OR REPLACE FUNCTION _po_refresh_status(p_po_id uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE purchase_orders po
     SET status = CASE WHEN NOT EXISTS (SELECT 1 FROM po_lines l WHERE l.po_id = po.id AND l.received_qty < l.quantity)
                       THEN 'received' ELSE 'partially_received' END,
         updated_at = now()
   WHERE po.id = p_po_id AND po.status IN ('sent','partially_received')
     AND EXISTS (SELECT 1 FROM po_lines l WHERE l.po_id = po.id AND l.received_qty > 0);
$$;

CREATE OR REPLACE FUNCTION trg_grn_moves_stock() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _was boolean := TG_OP = 'UPDATE' AND OLD.status IN ('accepted','accepted_partial');
  _is  boolean := NEW.status IN ('accepted','accepted_partial');
  _po  purchase_orders%ROWTYPE;
  _l   record;
  _qty numeric;
BEGIN
  IF _was AND NOT _is THEN
    RAISE EXCEPTION 'This GRN has already put stock on the shelf. Correct it with a stock adjustment or supplier return instead.';
  END IF;
  IF NOT _is OR _was OR NEW.po_id IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO _po FROM purchase_orders WHERE id = NEW.po_id;
  IF _po.warehouse_id IS NULL THEN RETURN NEW; END IF;   -- service PO: nothing to stock

  FOR _l IN
    SELECT g.*, COALESCE(g.item_id, pl.item_id) AS stock_item, pl.unit_cost AS po_cost
      FROM grn_lines g LEFT JOIN po_lines pl ON pl.id = g.po_line_id
     WHERE g.grn_id = NEW.id
  LOOP
    _qty := COALESCE(_l.quantity_received, 0) - COALESCE(_l.quantity_rejected, 0);
    CONTINUE WHEN _qty <= 0 OR _l.stock_item IS NULL;
    INSERT INTO inventory_movements (item_id, warehouse_id, movement_type, quantity, unit_cost, value,
                                     voucher_type, voucher_no, source_module, source_reference_id, notes, created_by)
    VALUES (_l.stock_item, _po.warehouse_id, 'grn', _qty, COALESCE(NULLIF(_l.unit_price, 0), _l.po_cost, 0),
            _qty * COALESCE(NULLIF(_l.unit_price, 0), _l.po_cost, 0),
            'GRN', NEW.grn_number, 'procurement', NEW.id,
            'Received against ' || COALESCE(_po.po_number, 'PO'), COALESCE(NEW.received_by, auth.uid()));
    IF _l.po_line_id IS NOT NULL THEN
      UPDATE po_lines SET received_qty = received_qty + _qty WHERE id = _l.po_line_id;
    END IF;
  END LOOP;
  PERFORM _po_refresh_status(NEW.po_id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_grn_stock ON goods_received_notes;
CREATE TRIGGER trg_grn_stock AFTER INSERT OR UPDATE OF status ON goods_received_notes
  FOR EACH ROW EXECUTE FUNCTION trg_grn_moves_stock();

-- One-call receipt: p_lines = [{ "po_line_id": uuid, "qty": n, "rejected": n, "reason": text }]
CREATE OR REPLACE FUNCTION proc_receive_po(p_po_id uuid, p_lines jsonb, p_delivery_ref text DEFAULT NULL, p_notes text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _po  purchase_orders%ROWTYPE;
  _grn uuid;
  _partial boolean := false;
  _n int := 0;
  _j jsonb;
  _pl record;
BEGIN
  SELECT * INTO _po FROM purchase_orders WHERE id = p_po_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Purchase order not found'; END IF;
  IF NOT (_has_permission('procurement.create', _po.site_id) OR _has_permission('inventory.create', _po.site_id)) THEN
    RAISE EXCEPTION 'You do not have permission to receive goods at this site';
  END IF;
  IF _po.status NOT IN ('sent','partially_received') THEN
    RAISE EXCEPTION 'Only sent purchase orders can be received (this one is %)', _po.status;
  END IF;

  INSERT INTO goods_received_notes (grn_number, site_id, po_id, supplier_id, received_by, received_date, status, delivery_note_ref, notes)
  VALUES ('', _po.site_id, _po.id, _po.supplier_id, auth.uid(), CURRENT_DATE, 'draft', p_delivery_ref, p_notes)
  RETURNING id INTO _grn;

  FOR _j IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    CONTINUE WHEN COALESCE((_j->>'qty')::numeric, 0) <= 0;
    SELECT l.*, i.description AS item_desc INTO _pl
      FROM po_lines l LEFT JOIN items i ON i.id = l.item_id
     WHERE l.id = (_j->>'po_line_id')::uuid AND l.po_id = _po.id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Line does not belong to this purchase order'; END IF;
    IF COALESCE((_j->>'rejected')::numeric, 0) > 0 THEN _partial := true; END IF;
    INSERT INTO grn_lines (grn_id, po_line_id, item_id, item_description, quantity_expected, quantity_received,
                           quantity_rejected, unit_price, rejection_reason)
    VALUES (_grn, _pl.id, _pl.item_id, COALESCE(_pl.item_desc, 'Item'), _pl.quantity - _pl.received_qty,
            (_j->>'qty')::numeric, COALESCE((_j->>'rejected')::numeric, 0), _pl.unit_cost, _j->>'reason');
    _n := _n + 1;
  END LOOP;
  IF _n = 0 THEN RAISE EXCEPTION 'Enter a quantity for at least one line'; END IF;

  UPDATE goods_received_notes SET status = CASE WHEN _partial THEN 'accepted_partial' ELSE 'accepted' END, updated_at = now()
   WHERE id = _grn;
  RETURN _grn;
END $$;
GRANT EXECUTE ON FUNCTION proc_receive_po(uuid, jsonb, text, text) TO authenticated;

INSERT INTO schema_migrations (filename) VALUES ('0197_grn_moves_stock.sql') ON CONFLICT DO NOTHING;
