-- 0234 — Inventory I3 (issue #59): reservations, stock position (available / on order / in transit), shipments in transit.
--  • stock_reservations: hold stock in a store for a request or a work order. Issues and dispatches can't take stock that is
--    reserved for someone else; an issue against the request / work order uses up its reservation.
--  • inv_shipments + lines ("the truck"): dispatch takes stock out of the sending store (transfer_out, Dr 2500 / Cr 1320 at the
--    sender when it is another site); it is IN TRANSIT until the receiving store confirms what arrived (transfer_in, Dr 1320 /
--    Cr 2500). Anything short is written off at the receiving store as "short in transit" (stock_loss).
--  • Transfer requests (Procurement) now dispatch a shipment: request = 'ordered' while in transit, 'fulfilled' on receipt.
--  • inv_position(sites, store): on hand, reserved, available, on order (open POs), in transit (incoming shipments), value.

-- ── Reservations ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stock_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES items(id),
  warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  qty numeric NOT NULL CHECK (qty > 0),
  qty_issued numeric NOT NULL DEFAULT 0,
  requisition_id uuid REFERENCES purchase_requisitions(id),
  work_order_id uuid REFERENCES fleet_work_orders(id),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','released')),
  needed_by date,
  notes text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  released_by uuid, released_at timestamptz
);
CREATE INDEX IF NOT EXISTS stock_res_open_idx ON stock_reservations (item_id, warehouse_id) WHERE status = 'open';
ALTER TABLE stock_reservations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS res_select ON stock_reservations;
CREATE POLICY res_select ON stock_reservations FOR SELECT TO authenticated USING (_inv_can('view', warehouse_id));
GRANT SELECT ON stock_reservations TO authenticated;

-- Quantity held for others (open reservations not belonging to p_source).
CREATE OR REPLACE FUNCTION public._inv_reserved(p_item uuid, p_wh uuid, p_source uuid DEFAULT NULL) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(sum(GREATEST(qty - qty_issued, 0)), 0) FROM stock_reservations
   WHERE item_id = p_item AND warehouse_id = p_wh AND status = 'open'
     AND (p_source IS NULL OR (requisition_id IS DISTINCT FROM p_source AND work_order_id IS DISTINCT FROM p_source));
$$;

-- Guard + consume, BEFORE the balance trigger (name sorts first: trg_inv_a…).
CREATE OR REPLACE FUNCTION public.trg_inv_reservation_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _have numeric; _held numeric; _item text; _left numeric; _r record;
BEGIN
  IF NEW.movement_type NOT IN ('issue','transfer_out') OR NEW.quantity >= 0 THEN RETURN NEW; END IF;
  SELECT COALESCE(on_hand_qty, 0) INTO _have FROM stock_balances WHERE item_id = NEW.item_id AND warehouse_id = NEW.warehouse_id;
  _held := _inv_reserved(NEW.item_id, NEW.warehouse_id, NEW.source_reference_id);
  IF _held > 0 AND COALESCE(_have, 0) - _held < -NEW.quantity THEN
    SELECT description INTO _item FROM items WHERE id = NEW.item_id;
    RAISE EXCEPTION 'Only % of % is free — % is reserved for other requests or work orders',
      trim(to_char(GREATEST(COALESCE(_have, 0) - _held, 0), 'FM999999990.###')), COALESCE(_item, 'this item'), trim(to_char(_held, 'FM999999990.###'));
  END IF;
  -- An issue against a request / work order uses up its reservation.
  IF NEW.movement_type = 'issue' AND NEW.source_reference_id IS NOT NULL THEN
    _left := -NEW.quantity;
    FOR _r IN SELECT * FROM stock_reservations WHERE item_id = NEW.item_id AND warehouse_id = NEW.warehouse_id AND status = 'open'
               AND (requisition_id = NEW.source_reference_id OR work_order_id = NEW.source_reference_id) ORDER BY created_at LOOP
      EXIT WHEN _left <= 0;
      UPDATE stock_reservations SET qty_issued = qty_issued + LEAST(_left, qty - qty_issued),
             status = CASE WHEN qty_issued + LEAST(_left, qty - qty_issued) >= qty THEN 'done' ELSE 'open' END
       WHERE id = _r.id;
      _left := _left - LEAST(_left, _r.qty - _r.qty_issued);
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_inv_a_reservation ON inventory_movements;
CREATE TRIGGER trg_inv_a_reservation BEFORE INSERT ON inventory_movements FOR EACH ROW EXECUTE FUNCTION trg_inv_reservation_guard();

-- p: { warehouse_id, requisition_id? | work_order_id?, needed_by?, notes?, lines: [{item_id, qty}] }
CREATE OR REPLACE FUNCTION public.inv_reserve(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _wh warehouses%ROWTYPE; _l jsonb; _n int := 0; _have numeric; _free numeric; _item text;
        _req uuid := NULLIF(p->>'requisition_id', '')::uuid; _wo uuid := NULLIF(p->>'work_order_id', '')::uuid;
BEGIN
  SELECT * INTO _wh FROM warehouses WHERE id = (p->>'warehouse_id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Choose the store'; END IF;
  IF NOT _has_permission('inventory.create', _wh.site_id) THEN RAISE EXCEPTION 'You cannot reserve stock in %', _wh.name; END IF;
  IF _req IS NULL AND _wo IS NULL THEN RAISE EXCEPTION 'Reserve for a request or a work order'; END IF;
  FOR _l IN SELECT * FROM jsonb_array_elements(COALESCE(p->'lines', '[]')) LOOP
    CONTINUE WHEN COALESCE((_l->>'qty')::numeric, 0) <= 0;
    SELECT COALESCE(on_hand_qty, 0) INTO _have FROM stock_balances WHERE item_id = (_l->>'item_id')::uuid AND warehouse_id = _wh.id;
    _free := COALESCE(_have, 0) - _inv_reserved((_l->>'item_id')::uuid, _wh.id);
    IF _free < (_l->>'qty')::numeric THEN
      SELECT description INTO _item FROM items WHERE id = (_l->>'item_id')::uuid;
      RAISE EXCEPTION 'Only % of % is free to reserve in %', trim(to_char(GREATEST(_free, 0), 'FM999999990.###')), COALESCE(_item, 'this item'), _wh.name;
    END IF;
    INSERT INTO stock_reservations (item_id, warehouse_id, qty, requisition_id, work_order_id, needed_by, notes)
    VALUES ((_l->>'item_id')::uuid, _wh.id, (_l->>'qty')::numeric, _req, _wo, NULLIF(p->>'needed_by', '')::date, NULLIF(p->>'notes', ''));
    _n := _n + 1;
  END LOOP;
  IF _n = 0 THEN RAISE EXCEPTION 'Enter a quantity on at least one line'; END IF;
  RETURN jsonb_build_object('reserved', _n);
END $$;

CREATE OR REPLACE FUNCTION public.inv_release(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r stock_reservations%ROWTYPE; _site uuid;
BEGIN
  SELECT * INTO _r FROM stock_reservations WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR _r.status <> 'open' THEN RAISE EXCEPTION 'Reservation not open'; END IF;
  SELECT site_id INTO _site FROM warehouses WHERE id = _r.warehouse_id;
  IF NOT (_has_permission('inventory.create', _site) OR _r.created_by = auth.uid()) THEN RAISE EXCEPTION 'You cannot release this reservation'; END IF;
  UPDATE stock_reservations SET status = 'released', released_by = auth.uid(), released_at = now() WHERE id = p_id;
END $$;

-- ── Shipments (in transit) ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inv_shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_no text NOT NULL,
  from_warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  to_warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  from_site_id uuid NOT NULL REFERENCES sites(id),
  to_site_id uuid NOT NULL REFERENCES sites(id),
  requisition_id uuid REFERENCES purchase_requisitions(id),
  status text NOT NULL DEFAULT 'in_transit' CHECK (status IN ('in_transit','received')),
  vehicle text, driver text, notes text, receive_notes text,
  dispatched_by uuid DEFAULT auth.uid(), dispatched_at timestamptz NOT NULL DEFAULT now(),
  received_by uuid, received_at timestamptz
);
CREATE TABLE IF NOT EXISTS inv_shipment_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id uuid NOT NULL REFERENCES inv_shipments(id),
  item_id uuid NOT NULL REFERENCES items(id),
  qty_sent numeric NOT NULL CHECK (qty_sent > 0),
  qty_received numeric,
  unit_cost numeric NOT NULL DEFAULT 0,
  batch_no text
);
CREATE INDEX IF NOT EXISTS inv_ship_to_idx ON inv_shipments (to_warehouse_id) WHERE status = 'in_transit';
ALTER TABLE inv_shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_shipment_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ship_select ON inv_shipments; DROP POLICY IF EXISTS shipl_select ON inv_shipment_lines;
CREATE POLICY ship_select ON inv_shipments FOR SELECT TO authenticated
  USING (_inv_can('view', from_warehouse_id) OR _inv_can('view', to_warehouse_id));
CREATE POLICY shipl_select ON inv_shipment_lines FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM inv_shipments s WHERE s.id = shipment_id AND (_inv_can('view', s.from_warehouse_id) OR _inv_can('view', s.to_warehouse_id))));
GRANT SELECT ON inv_shipments, inv_shipment_lines TO authenticated;

-- All active stores by name (to choose where to send) — names only.
CREATE OR REPLACE FUNCTION public.inv_store_list() RETURNS TABLE (id uuid, name text, site_id uuid, site_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT w.id, w.name, w.site_id, s.name FROM warehouses w JOIN sites s ON s.id = w.site_id
   WHERE w.is_active AND auth.uid() IS NOT NULL ORDER BY s.name, w.name;
$$;

-- p: { from_warehouse_id, to_warehouse_id, requisition_id?, vehicle?, driver?, notes?, lines: [{item_id, qty, batch_no?}] }
CREATE OR REPLACE FUNCTION public.inv_dispatch(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _f warehouses%ROWTYPE; _t warehouses%ROWTYPE; _s inv_shipments%ROWTYPE; _l jsonb; _mv inventory_movements%ROWTYPE; _n int := 0; _val numeric := 0;
        _req uuid := NULLIF(p->>'requisition_id', '')::uuid;
BEGIN
  SELECT * INTO _f FROM warehouses WHERE id = (p->>'from_warehouse_id')::uuid;
  SELECT * INTO _t FROM warehouses WHERE id = (p->>'to_warehouse_id')::uuid;
  IF _f.id IS NULL OR _t.id IS NULL OR _f.id = _t.id THEN RAISE EXCEPTION 'Choose the sending and the receiving store'; END IF;
  IF NOT _has_permission('inventory.create', _f.site_id) THEN RAISE EXCEPTION 'You cannot send stock from %', _f.name; END IF;
  INSERT INTO inv_shipments (shipment_no, from_warehouse_id, to_warehouse_id, from_site_id, to_site_id, requisition_id, vehicle, driver, notes)
  VALUES (doc_next_number(_f.site_id, 'SHP'), _f.id, _t.id, _f.site_id, _t.site_id, _req,
          NULLIF(trim(p->>'vehicle'), ''), NULLIF(trim(p->>'driver'), ''), NULLIF(p->>'notes', ''))
  RETURNING * INTO _s;
  FOR _l IN SELECT * FROM jsonb_array_elements(COALESCE(p->'lines', '[]')) LOOP
    CONTINUE WHEN COALESCE((_l->>'qty')::numeric, 0) <= 0;
    INSERT INTO inventory_movements (item_id, warehouse_id, movement_type, quantity, voucher_type, voucher_no, source_module, source_reference_id,
                                     counter_warehouse_id, batch_no, notes, created_by)
    VALUES ((_l->>'item_id')::uuid, _f.id, 'transfer_out', -(_l->>'qty')::numeric, 'SHIPMENT', _s.shipment_no, 'inventory', COALESCE(_req, _s.id),
            _t.id, NULLIF(trim(_l->>'batch_no'), ''), 'In transit to ' || _t.name, auth.uid())
    RETURNING * INTO _mv;
    INSERT INTO inv_shipment_lines (shipment_id, item_id, qty_sent, unit_cost, batch_no)
    VALUES (_s.id, _mv.item_id, -_mv.quantity, _mv.unit_cost, _mv.batch_no);
    _n := _n + 1; _val := _val + abs(_mv.value);
  END LOOP;
  IF _n = 0 THEN RAISE EXCEPTION 'Add at least one item to the shipment'; END IF;
  RETURN jsonb_build_object('id', _s.id, 'shipment', _s.shipment_no, 'lines', _n, 'value', round(_val, 2));
END $$;

-- p_lines: [{line_id, qty_received}] (missing lines = received in full). Shortfalls are written off at the receiving store.
CREATE OR REPLACE FUNCTION public.inv_receive_shipment(p_id uuid, p_lines jsonb DEFAULT '[]', p_notes text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _s inv_shipments%ROWTYPE; _t warehouses%ROWTYPE; _f warehouses%ROWTYPE; _l inv_shipment_lines%ROWTYPE; _got numeric; _short numeric := 0; _n int := 0;
BEGIN
  SELECT * INTO _s FROM inv_shipments WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Shipment not found'; END IF;
  IF _s.status <> 'in_transit' THEN RAISE EXCEPTION 'This shipment was already received'; END IF;
  SELECT * INTO _t FROM warehouses WHERE id = _s.to_warehouse_id;
  SELECT * INTO _f FROM warehouses WHERE id = _s.from_warehouse_id;
  IF NOT _has_permission('inventory.create', _t.site_id) THEN RAISE EXCEPTION 'Only % can receive this shipment', _t.name; END IF;
  FOR _l IN SELECT * FROM inv_shipment_lines WHERE shipment_id = _s.id LOOP
    _got := NULL;
    SELECT (x->>'qty_received')::numeric INTO _got FROM jsonb_array_elements(COALESCE(p_lines, '[]')) x WHERE (x->>'line_id')::uuid = _l.id;
    _got := COALESCE(_got, _l.qty_sent);
    IF _got < 0 OR _got > _l.qty_sent THEN RAISE EXCEPTION 'Received quantity must be between 0 and what was sent (%)', _l.qty_sent; END IF;
    -- Full quantity comes in at the sending cost (so 2500 mirrors the sender), then any shortfall is written off here.
    INSERT INTO inventory_movements (item_id, warehouse_id, movement_type, quantity, unit_cost, voucher_type, voucher_no, source_module, source_reference_id,
                                     counter_warehouse_id, batch_no, notes, created_by)
    VALUES (_l.item_id, _t.id, 'transfer_in', _l.qty_sent, NULLIF(_l.unit_cost, 0), 'SHIPMENT', _s.shipment_no, 'inventory', COALESCE(_s.requisition_id, _s.id),
            _f.id, _l.batch_no, 'Received from ' || _f.name, auth.uid());
    IF _got < _l.qty_sent THEN
      INSERT INTO inventory_movements (item_id, warehouse_id, movement_type, quantity, voucher_type, voucher_no, source_module, source_reference_id, reason, notes, created_by)
      VALUES (_l.item_id, _t.id, 'adjustment', _got - _l.qty_sent, 'SHIPMENT', _s.shipment_no, 'inventory', _s.id, 'short in transit',
              'Short on ' || _s.shipment_no || ': sent ' || _l.qty_sent || ', received ' || _got, auth.uid());
      _short := _short + (_l.qty_sent - _got) * _l.unit_cost;
    END IF;
    UPDATE inv_shipment_lines SET qty_received = _got WHERE id = _l.id;
    _n := _n + 1;
  END LOOP;
  UPDATE inv_shipments SET status = 'received', received_by = auth.uid(), received_at = now(), receive_notes = NULLIF(p_notes, '') WHERE id = _s.id;
  IF _s.requisition_id IS NOT NULL THEN
    UPDATE purchase_requisitions SET status = 'fulfilled', fulfilled_at = now(), fulfilled_by = auth.uid(), updated_at = now()
     WHERE id = _s.requisition_id AND status IN ('approved','ordered');
  END IF;
  RETURN jsonb_build_object('lines', _n, 'short_value', round(_short, 2));
END $$;

-- Transfer requests now dispatch a shipment (same signature, same screen button).
CREATE OR REPLACE FUNCTION public.proc_request_fulfil_transfer(p_id uuid, p_from_warehouse uuid, p_to_warehouse uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE _r purchase_requisitions%ROWTYPE; _fw warehouses%ROWTYPE; _tw warehouses%ROWTYPE; _res jsonb;
BEGIN
  SELECT * INTO _r FROM purchase_requisitions WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR _r.request_type <> 'transfer' THEN RAISE EXCEPTION 'Transfer request not found'; END IF;
  IF _r.status <> 'approved' THEN RAISE EXCEPTION 'Only an approved transfer can be sent'; END IF;
  SELECT * INTO _fw FROM warehouses WHERE id = p_from_warehouse;
  SELECT * INTO _tw FROM warehouses WHERE id = p_to_warehouse;
  IF _fw.site_id IS DISTINCT FROM _r.source_site_id THEN RAISE EXCEPTION 'Send from a store at the sending site'; END IF;
  IF _tw.site_id IS DISTINCT FROM _r.site_id THEN RAISE EXCEPTION 'Receive into a store at the requesting site'; END IF;
  _res := inv_dispatch(jsonb_build_object('from_warehouse_id', _fw.id, 'to_warehouse_id', _tw.id, 'requisition_id', _r.id,
            'notes', 'Transfer request ' || _r.requisition_no,
            'lines', (SELECT jsonb_agg(jsonb_build_object('item_id', item_id, 'qty', quantity)) FROM requisition_lines
                       WHERE requisition_id = p_id AND NOT is_archived AND item_id IS NOT NULL)));
  UPDATE requisition_lines SET ordered_qty = quantity WHERE requisition_id = p_id AND NOT is_archived AND item_id IS NOT NULL;
  UPDATE purchase_requisitions SET status = 'ordered', updated_at = now() WHERE id = p_id;
  RETURN _res;
END $function$;

-- ── Stock position ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.inv_position(p_site_ids uuid[], p_warehouse uuid DEFAULT NULL)
RETURNS TABLE (item_id uuid, item_code text, description text, unit text, warehouse_id uuid, warehouse text, site text,
               on_hand numeric, reserved numeric, available numeric, on_order numeric, in_transit numeric,
               reorder_at numeric, value numeric, bin text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH wh AS (
    SELECT w.id, w.name, w.site_id, s.name sname FROM warehouses w JOIN sites s ON s.id = w.site_id
     WHERE w.is_active AND w.site_id = ANY (p_site_ids) AND (p_warehouse IS NULL OR w.id = p_warehouse) AND _inv_can('view', w.id)
  ), res AS (
    SELECT r.item_id, r.warehouse_id, sum(GREATEST(r.qty - r.qty_issued, 0)) q FROM stock_reservations r JOIN wh ON wh.id = r.warehouse_id
     WHERE r.status = 'open' GROUP BY 1, 2
  ), ord AS (
    SELECT pl.item_id, COALESCE(po.warehouse_id, _inv_main_store(po.site_id)) wid,
           sum(GREATEST(pl.quantity - COALESCE(pl.received_qty, 0), 0) *
               CASE WHEN COALESCE(i.purchase_factor, 1) <> 1 AND lower(trim(pl.unit)) IN (lower(pu.abbreviation), lower(pu.name)) THEN i.purchase_factor ELSE 1 END) q
      FROM po_lines pl JOIN purchase_orders po ON po.id = pl.po_id JOIN items i ON i.id = pl.item_id
      LEFT JOIN units_of_measure pu ON pu.id = i.purchase_uom_id
     WHERE po.status IN ('pending_approval','sent','partially_received') AND NOT COALESCE(pl.is_archived, false) AND po.site_id = ANY (p_site_ids)
     GROUP BY 1, 2
  ), tr AS (
    SELECT l.item_id, s.to_warehouse_id wid, sum(l.qty_sent) q FROM inv_shipment_lines l JOIN inv_shipments s ON s.id = l.shipment_id
     WHERE s.status = 'in_transit' GROUP BY 1, 2
  ), pairs AS (
    SELECT sb.item_id, sb.warehouse_id FROM stock_balances sb JOIN wh ON wh.id = sb.warehouse_id
    UNION SELECT r.item_id, r.warehouse_id FROM res r
    UNION SELECT o.item_id, o.wid FROM ord o JOIN wh ON wh.id = o.wid
    UNION SELECT t.item_id, t.wid FROM tr t JOIN wh ON wh.id = t.wid
    UNION SELECT s.item_id, s.warehouse_id FROM item_store_settings s JOIN wh ON wh.id = s.warehouse_id
  )
  SELECT i.id, i.item_code, i.description, u.abbreviation, wh.id, wh.name, wh.sname,
         COALESCE(sb.on_hand_qty, 0), COALESCE(res.q, 0), COALESCE(sb.on_hand_qty, 0) - COALESCE(res.q, 0),
         COALESCE(ord.q, 0), COALESCE(tr.q, 0),
         COALESCE(st.reorder_level, st.min_qty, i.reorder_level), COALESCE(sb.stock_value, 0), b.code
    FROM pairs p JOIN items i ON i.id = p.item_id JOIN wh ON wh.id = p.warehouse_id
    LEFT JOIN units_of_measure u ON u.id = i.uom_id
    LEFT JOIN stock_balances sb ON sb.item_id = p.item_id AND sb.warehouse_id = p.warehouse_id
    LEFT JOIN res ON res.item_id = p.item_id AND res.warehouse_id = p.warehouse_id
    LEFT JOIN ord ON ord.item_id = p.item_id AND ord.wid = p.warehouse_id
    LEFT JOIN tr ON tr.item_id = p.item_id AND tr.wid = p.warehouse_id
    LEFT JOIN item_store_settings st ON st.item_id = p.item_id AND st.warehouse_id = p.warehouse_id
    LEFT JOIN warehouse_bins b ON b.id = st.bin_id
   WHERE NOT COALESCE(i.is_archived, false)
   ORDER BY i.description, wh.name;
$$;

REVOKE ALL ON FUNCTION inv_reserve(jsonb), inv_release(uuid), inv_dispatch(jsonb), inv_receive_shipment(uuid, jsonb, text), inv_position(uuid[], uuid), inv_store_list() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION inv_reserve(jsonb), inv_release(uuid), inv_dispatch(jsonb), inv_receive_shipment(uuid, jsonb, text), inv_position(uuid[], uuid), inv_store_list() TO authenticated;

INSERT INTO schema_migrations (filename) VALUES ('0234_inventory_i3_reservations_transit.sql') ON CONFLICT DO NOTHING;
