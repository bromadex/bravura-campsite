-- 0190: Inventory controls
--   * automatic reorder: when an issue takes a warehouse's stock (+ what's already on order) to the item's
--     reorder level, the item is added to that warehouse's open automatic requisition (draft, for review)
--   * batch & expiry tracking on receipts/issues, with an expiring-stock report
--   * cycle counts: a stock take can cover just the N items least recently counted (highest value first)
--   * fix: stock balance trigger runs with definer rights so issuing needs only inventory.create

-- ── Balance trigger: definer rights (it updates stock_balances and items) ─
ALTER FUNCTION trg_inventory_movement_balance() SECURITY DEFINER;
ALTER FUNCTION trg_inventory_movement_balance() SET search_path = public;

-- ── Batches & expiry ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_batches (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id        UUID NOT NULL REFERENCES items(id),
  warehouse_id   UUID NOT NULL REFERENCES warehouses(id),
  batch_no       TEXT NOT NULL,
  expiry_date    DATE,
  qty_received   NUMERIC NOT NULL DEFAULT 0,
  qty_remaining  NUMERIC NOT NULL DEFAULT 0,
  first_received TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_archived    BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (item_id, warehouse_id, batch_no)
);
ALTER TABLE inventory_batches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ib_select ON inventory_batches;
CREATE POLICY ib_select ON inventory_batches FOR SELECT USING (
  EXISTS (SELECT 1 FROM warehouses w WHERE w.id = warehouse_id AND _has_permission('inventory.view', w.site_id)));

ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS batch_no    TEXT;
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS expiry_date DATE;
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS batch_id    UUID REFERENCES inventory_batches(id);

-- Runs before the balance trigger (trigger names fire alphabetically: trg_inv_batch < trg_inv_movement).
CREATE OR REPLACE FUNCTION trg_inventory_movement_batch() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _b inventory_batches%ROWTYPE;
BEGIN
  IF NULLIF(TRIM(NEW.batch_no), '') IS NULL THEN RETURN NEW; END IF;
  NEW.batch_no := TRIM(NEW.batch_no);
  IF NEW.quantity > 0 THEN
    INSERT INTO inventory_batches (item_id, warehouse_id, batch_no, expiry_date, qty_received, qty_remaining)
    VALUES (NEW.item_id, NEW.warehouse_id, NEW.batch_no, NEW.expiry_date, NEW.quantity, NEW.quantity)
    ON CONFLICT (item_id, warehouse_id, batch_no) DO UPDATE
      SET qty_received = inventory_batches.qty_received + EXCLUDED.qty_received,
          qty_remaining = inventory_batches.qty_remaining + EXCLUDED.qty_remaining,
          expiry_date = COALESCE(EXCLUDED.expiry_date, inventory_batches.expiry_date)
    RETURNING * INTO _b;
  ELSE
    SELECT * INTO _b FROM inventory_batches WHERE item_id = NEW.item_id AND warehouse_id = NEW.warehouse_id AND batch_no = NEW.batch_no FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Batch % not found for this item in this warehouse', NEW.batch_no; END IF;
    IF _b.qty_remaining + NEW.quantity < 0 THEN
      RAISE EXCEPTION 'Only % left in batch %', _b.qty_remaining, NEW.batch_no;
    END IF;
    UPDATE inventory_batches SET qty_remaining = qty_remaining + NEW.quantity WHERE id = _b.id;
  END IF;
  NEW.batch_id := _b.id;
  NEW.expiry_date := COALESCE(NEW.expiry_date, _b.expiry_date);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_inv_batch ON inventory_movements;
CREATE TRIGGER trg_inv_batch BEFORE INSERT ON inventory_movements FOR EACH ROW EXECUTE FUNCTION trg_inventory_movement_batch();

CREATE OR REPLACE FUNCTION inv_batches(p_site_id UUID, p_within_days INT DEFAULT NULL)
RETURNS TABLE (batch_id UUID, item_id UUID, item_code TEXT, description TEXT, warehouse TEXT, batch_no TEXT,
               expiry_date DATE, days_left INT, qty_remaining NUMERIC, value NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT _has_permission('inventory.view', p_site_id) THEN RAISE EXCEPTION 'No access'; END IF;
  RETURN QUERY
  SELECT b.id, i.id, i.item_code, i.description, w.name, b.batch_no, b.expiry_date, (b.expiry_date - CURRENT_DATE)::INT,
         b.qty_remaining, ROUND(b.qty_remaining * COALESCE(sb.valuation_rate, i.average_cost, 0), 2)
    FROM inventory_batches b JOIN items i ON i.id = b.item_id JOIN warehouses w ON w.id = b.warehouse_id
    LEFT JOIN stock_balances sb ON sb.item_id = b.item_id AND sb.warehouse_id = b.warehouse_id
   WHERE w.site_id = p_site_id AND b.qty_remaining > 0 AND NOT b.is_archived
     AND (p_within_days IS NULL OR (b.expiry_date IS NOT NULL AND b.expiry_date <= CURRENT_DATE + p_within_days))
   ORDER BY b.expiry_date NULLS LAST, i.description;
END;
$$;

-- ── Automatic reorder ────────────────────────────────────────────────
ALTER TABLE purchase_requisitions ADD COLUMN IF NOT EXISTS is_auto BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION _inv_reorder_core(p_site_id UUID)
RETURNS TABLE (item_id UUID, item_code TEXT, description TEXT, warehouse_id UUID, warehouse TEXT, on_hand NUMERIC,
               on_order NUMERIC, reorder_level NUMERIC, suggested_qty NUMERIC, unit_cost NUMERIC, preferred_supplier_id UUID)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  WITH bal AS (
    SELECT i.id item_id, i.item_code, i.description, w.id wh, w.name wname, COALESCE(sb.on_hand_qty, 0) oh,
           i.reorder_level rl, i.reorder_qty rq, i.max_stock mx, COALESCE(NULLIF(i.last_purchase_price, 0), i.average_cost, i.standard_cost, 0) uc,
           i.preferred_supplier_id sup
      FROM stock_balances sb JOIN items i ON i.id = sb.item_id JOIN warehouses w ON w.id = sb.warehouse_id
     WHERE w.site_id = p_site_id AND w.is_active AND NOT COALESCE(i.is_archived, false) AND COALESCE(i.reorder_level, 0) > 0
  ), ord AS (
    SELECT b.item_id, b.wh,
           COALESCE((SELECT SUM(GREATEST(pl.quantity - COALESCE(pl.received_qty, 0), 0)) FROM po_lines pl JOIN purchase_orders po ON po.id = pl.po_id
                      WHERE pl.item_id = b.item_id AND po.warehouse_id = b.wh AND po.status IN ('pending_approval','sent','partially_received')), 0)
         + COALESCE((SELECT SUM(rl.quantity) FROM requisition_lines rl JOIN purchase_requisitions pr ON pr.id = rl.requisition_id
                      WHERE rl.item_id = b.item_id AND pr.warehouse_id = b.wh AND pr.status IN ('draft','submitted','approved')), 0) q
      FROM bal b
  )
  SELECT b.item_id, b.item_code, b.description, b.wh, b.wname, b.oh, o.q, b.rl,
         GREATEST(COALESCE(NULLIF(b.rq, 0), GREATEST(COALESCE(b.mx, 0), b.rl * 2) - b.oh - o.q), 1),
         b.uc, b.sup
    FROM bal b JOIN ord o ON o.item_id = b.item_id AND o.wh = b.wh
   WHERE b.oh + o.q <= b.rl
   ORDER BY b.description;
END;
$$;

CREATE OR REPLACE FUNCTION inv_reorder_suggestions(p_site_id UUID)
RETURNS TABLE (item_id UUID, item_code TEXT, description TEXT, warehouse_id UUID, warehouse TEXT, on_hand NUMERIC,
               on_order NUMERIC, reorder_level NUMERIC, suggested_qty NUMERIC, unit_cost NUMERIC, preferred_supplier_id UUID)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT _has_permission('inventory.view', p_site_id) THEN RAISE EXCEPTION 'No access'; END IF;
  RETURN QUERY SELECT * FROM _inv_reorder_core(p_site_id);
END;
$$;

-- Put one item (or every item at the site) on the warehouse's open automatic requisition.
CREATE OR REPLACE FUNCTION _inv_auto_reorder(p_site_id UUID, p_item_id UUID DEFAULT NULL)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _s RECORD; _req UUID; _n INT := 0;
BEGIN
  FOR _s IN SELECT * FROM _inv_reorder_core(p_site_id) s WHERE p_item_id IS NULL OR s.item_id = p_item_id LOOP
    SELECT id INTO _req FROM purchase_requisitions
     WHERE site_id = p_site_id AND warehouse_id = _s.warehouse_id AND is_auto AND status = 'draft' ORDER BY created_at DESC LIMIT 1;
    IF _req IS NULL THEN
      INSERT INTO purchase_requisitions (requisition_no, site_id, warehouse_id, status, priority, notes, is_auto, requested_by)
      VALUES ('auto', p_site_id, _s.warehouse_id, 'draft', 'normal',
              'Automatic reorder — items at or below their reorder level. Check quantities, then submit.', true, auth.uid())
      RETURNING id INTO _req;
      PERFORM _notify_permission(p_site_id, 'inventory.approve', 'inventory_reorder', 'Stock below reorder level',
        'An automatic requisition was started for ' || _s.warehouse || '. Review and submit it.', '/inventory/inv_requisitions', 'reminder');
    END IF;
    INSERT INTO requisition_lines (requisition_id, item_id, quantity, estimated_cost, notes)
    VALUES (_req, _s.item_id, _s.suggested_qty, NULLIF(_s.unit_cost, 0),
            'On hand ' || _s.on_hand || ', on order ' || _s.on_order || ', reorder level ' || _s.reorder_level);
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END;
$$;

CREATE OR REPLACE FUNCTION inv_run_reorder(p_site_id UUID)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT _has_permission('inventory.create', p_site_id) THEN RAISE EXCEPTION 'You do not have permission to raise requisitions'; END IF;
  RETURN _inv_auto_reorder(p_site_id, NULL);
END;
$$;

CREATE OR REPLACE FUNCTION trg_inventory_auto_reorder() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _site UUID;
BEGIN
  IF NEW.quantity >= 0 THEN RETURN NEW; END IF;
  SELECT site_id INTO _site FROM warehouses WHERE id = NEW.warehouse_id;
  IF _site IS NOT NULL THEN PERFORM _inv_auto_reorder(_site, NEW.item_id); END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;   -- never block an issue because the reorder helper failed
END;
$$;
DROP TRIGGER IF EXISTS trg_inv_auto_reorder ON inventory_movements;
CREATE TRIGGER trg_inv_auto_reorder AFTER INSERT ON inventory_movements FOR EACH ROW EXECUTE FUNCTION trg_inventory_auto_reorder();

-- ── Cycle counts ─────────────────────────────────────────────────────
ALTER TABLE stock_takes    ADD COLUMN IF NOT EXISTS count_type TEXT NOT NULL DEFAULT 'full';
ALTER TABLE stock_balances ADD COLUMN IF NOT EXISTS last_counted_at TIMESTAMPTZ;

-- Items to count next in a warehouse: never/least recently counted first, then highest stock value.
CREATE OR REPLACE FUNCTION inv_cycle_count_items(p_warehouse_id UUID, p_limit INT)
RETURNS TABLE (item_id UUID, on_hand_qty NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _site UUID;
BEGIN
  SELECT site_id INTO _site FROM warehouses WHERE id = p_warehouse_id;
  IF NOT _has_permission('inventory.view', _site) THEN RAISE EXCEPTION 'No access'; END IF;
  RETURN QUERY SELECT sb.item_id, sb.on_hand_qty FROM stock_balances sb
   WHERE sb.warehouse_id = p_warehouse_id AND sb.on_hand_qty > 0
   ORDER BY sb.last_counted_at NULLS FIRST, sb.stock_value DESC NULLS LAST LIMIT GREATEST(p_limit, 1);
END;
$$;

CREATE OR REPLACE FUNCTION trg_stock_take_counted() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    UPDATE stock_balances sb SET last_counted_at = now()
      FROM stock_take_lines l WHERE l.stock_take_id = NEW.id AND l.counted_qty IS NOT NULL
       AND sb.item_id = l.item_id AND sb.warehouse_id = NEW.warehouse_id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_stock_take_counted ON stock_takes;
CREATE TRIGGER trg_stock_take_counted AFTER UPDATE OF status ON stock_takes FOR EACH ROW EXECUTE FUNCTION trg_stock_take_counted();

REVOKE ALL ON FUNCTION inv_batches(UUID, INT), inv_reorder_suggestions(UUID), inv_run_reorder(UUID), inv_cycle_count_items(UUID, INT), _inv_auto_reorder(UUID, UUID), _inv_reorder_core(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION inv_batches(UUID, INT), inv_reorder_suggestions(UUID), inv_run_reorder(UUID), inv_cycle_count_items(UUID, INT) TO authenticated;

INSERT INTO schema_migrations (filename) VALUES ('0190_inventory_controls.sql') ON CONFLICT DO NOTHING;
