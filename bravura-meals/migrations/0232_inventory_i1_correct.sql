-- 0232 — Inventory I1 "make it correct" (issue #59).
--  • Access: every stores table checks _has_permission at the store's site (roles for "All sites" work).
--  • Cost is set by the database: stock going out leaves at the store's moving average; stock coming in without
--    a price comes in at that average. Nothing is saved at $0 any more, so Finance postings carry real values.
--  • No stock below zero (per store switch warehouses.allow_negative, default off).
--  • items.average_cost = weighted average across stores (no longer overwritten by the last store that moved).
--  • One database function per move — inv_issue, inv_return, inv_adjust, inv_transfer (same site), inv_receive_nopo,
--    inv_opening, inv_count_post. Screens, fleet work orders and Ask Bravura all use them.
--  • Procurement: a PO received without a store goes into the site's main store; requests can be issued from stock
--    (requisition_lines.issued_qty) and a fully issued request is marked fulfilled.
--  • Finance: moves between sites post through 2500 (stock_transfer_out / stock_transfer_in); opening stock posts
--    Dr 1320 / Cr 3900 (stock_opening). Rules added for every site with books and to the setup template.
--  • Retired: camp_supply_txns and stock_transfers are frozen (empty; replaced by stores + transfer requests).

-- ── Columns ───────────────────────────────────────────────────────────────────
ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS allow_negative boolean NOT NULL DEFAULT false;
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS cost_centre_id uuid REFERENCES cost_centres(id);
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id);
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS counter_warehouse_id uuid REFERENCES warehouses(id);
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS reason text;
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS site_id uuid REFERENCES sites(id);
ALTER TABLE requisition_lines ADD COLUMN IF NOT EXISTS issued_qty numeric NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS inv_mov_site_date_idx ON inventory_movements (site_id, created_at DESC);

-- ── Access ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._inv_can(p_action text, p_warehouse uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM warehouses w WHERE w.id = p_warehouse
     AND (_has_permission('inventory.' || p_action, w.site_id)
          OR (p_action = 'view' AND _has_permission('procurement.view', w.site_id))));
$$;
CREATE OR REPLACE FUNCTION public._inv_any(p_action text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM sites s WHERE _has_permission('inventory.' || p_action, s.id)
     OR (p_action = 'view' AND (_has_permission('procurement.view', s.id) OR _has_permission('fleet.view', s.id))));
$$;
GRANT EXECUTE ON FUNCTION _inv_can(text, uuid), _inv_any(text) TO authenticated;

DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public'
    AND tablename IN ('items','warehouses','stock_balances','inventory_movements','inventory_batches','stock_takes','stock_take_lines',
                      'item_categories','units_of_measure','stock_transfers','camp_supply_txns') LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.policyname, r.tablename);
  END LOOP;
END $$;

ALTER TABLE items ENABLE ROW LEVEL SECURITY;
CREATE POLICY items_select ON items FOR SELECT TO authenticated USING (_inv_any('view'));
CREATE POLICY items_insert ON items FOR INSERT TO authenticated WITH CHECK (_inv_any('create'));
CREATE POLICY items_update ON items FOR UPDATE TO authenticated USING (_inv_any('edit'));
ALTER TABLE item_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY cat_select ON item_categories FOR SELECT TO authenticated USING (_inv_any('view'));
CREATE POLICY cat_insert ON item_categories FOR INSERT TO authenticated WITH CHECK (_inv_any('edit'));
CREATE POLICY cat_update ON item_categories FOR UPDATE TO authenticated USING (_inv_any('edit'));
ALTER TABLE units_of_measure ENABLE ROW LEVEL SECURITY;
CREATE POLICY uom_select ON units_of_measure FOR SELECT TO authenticated USING (_inv_any('view'));
CREATE POLICY uom_insert ON units_of_measure FOR INSERT TO authenticated WITH CHECK (_inv_any('edit'));
CREATE POLICY uom_update ON units_of_measure FOR UPDATE TO authenticated USING (_inv_any('edit'));
ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;
CREATE POLICY wh_select ON warehouses FOR SELECT TO authenticated
  USING (_has_permission('inventory.view', site_id) OR _has_permission('procurement.view', site_id) OR _has_permission('fleet.view', site_id));
CREATE POLICY wh_insert ON warehouses FOR INSERT TO authenticated WITH CHECK (_has_permission('inventory.edit', site_id));
CREATE POLICY wh_update ON warehouses FOR UPDATE TO authenticated USING (_has_permission('inventory.edit', site_id));
ALTER TABLE stock_balances ENABLE ROW LEVEL SECURITY;          -- written only by the movement trigger
CREATE POLICY sb_select ON stock_balances FOR SELECT TO authenticated USING (_inv_can('view', warehouse_id));
ALTER TABLE inventory_batches ENABLE ROW LEVEL SECURITY;       -- written only by the movement trigger
CREATE POLICY ib_select ON inventory_batches FOR SELECT TO authenticated USING (_inv_can('view', warehouse_id));
ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;     -- written by the inv_* functions and receiving
CREATE POLICY im_select ON inventory_movements FOR SELECT TO authenticated USING (_inv_can('view', warehouse_id));
ALTER TABLE stock_takes ENABLE ROW LEVEL SECURITY;
CREATE POLICY st_select ON stock_takes FOR SELECT TO authenticated USING (_inv_can('view', warehouse_id));
CREATE POLICY st_insert ON stock_takes FOR INSERT TO authenticated WITH CHECK (_inv_can('create', warehouse_id));
CREATE POLICY st_update ON stock_takes FOR UPDATE TO authenticated USING (_inv_can('create', warehouse_id) AND status <> 'completed');
ALTER TABLE stock_take_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY stl_select ON stock_take_lines FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM stock_takes t WHERE t.id = stock_take_id AND _inv_can('view', t.warehouse_id)));
CREATE POLICY stl_insert ON stock_take_lines FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM stock_takes t WHERE t.id = stock_take_id AND t.status <> 'completed' AND _inv_can('create', t.warehouse_id)));
CREATE POLICY stl_update ON stock_take_lines FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM stock_takes t WHERE t.id = stock_take_id AND t.status <> 'completed' AND _inv_can('create', t.warehouse_id)));
GRANT SELECT ON stock_balances, inventory_batches, inventory_movements TO authenticated;

-- Retired tables: readable by nobody, writes refused.
ALTER TABLE stock_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE camp_supply_txns ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.trg_retired_stock_table() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'This table is retired — use Stores (issues, transfers, requests) instead'; END $$;
DROP TRIGGER IF EXISTS trg_retired ON stock_transfers;
CREATE TRIGGER trg_retired BEFORE INSERT OR UPDATE ON stock_transfers FOR EACH ROW EXECUTE FUNCTION trg_retired_stock_table();
DROP TRIGGER IF EXISTS trg_retired ON camp_supply_txns;
CREATE TRIGGER trg_retired BEFORE INSERT OR UPDATE ON camp_supply_txns FOR EACH ROW EXECUTE FUNCTION trg_retired_stock_table();

-- ── Cost, balance and the no-negative rule (runs on every movement) ───────────
CREATE OR REPLACE FUNCTION public.trg_inventory_movement_balance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old_qty numeric := 0; v_old_val numeric := 0; v_rate numeric; v_new_qty numeric; v_new_val numeric; v_new_rate numeric;
        v_wh warehouses%ROWTYPE; v_item text;
BEGIN
  SELECT * INTO v_wh FROM warehouses WHERE id = NEW.warehouse_id;
  NEW.site_id := v_wh.site_id;
  SELECT COALESCE(on_hand_qty, 0), COALESCE(stock_value, 0) INTO v_old_qty, v_old_val
    FROM stock_balances WHERE item_id = NEW.item_id AND warehouse_id = NEW.warehouse_id FOR UPDATE;
  IF NOT FOUND THEN v_old_qty := 0; v_old_val := 0; END IF;
  -- The store's current average; if it has none, the item's average across stores, last price, standard cost.
  v_rate := CASE WHEN v_old_qty > 0 THEN v_old_val / v_old_qty END;
  IF v_rate IS NULL OR v_rate <= 0 THEN
    SELECT COALESCE(NULLIF(sum(b.stock_value) / NULLIF(sum(b.on_hand_qty), 0), 0), NULLIF(i.last_purchase_price, 0), NULLIF(i.standard_cost, 0), 0)
      INTO v_rate FROM items i LEFT JOIN stock_balances b ON b.item_id = i.id AND b.on_hand_qty > 0
     WHERE i.id = NEW.item_id GROUP BY i.last_purchase_price, i.standard_cost;
  END IF;
  v_rate := COALESCE(v_rate, 0);

  IF NEW.movement_type = 'landed_cost' THEN                     -- value only
    v_new_qty := v_old_qty; v_new_val := v_old_val + COALESCE(NEW.value, 0);
  ELSIF NEW.quantity < 0 THEN                                     -- going out: always at the store's average
    NEW.unit_cost := round(v_rate, 6);
    NEW.value := round(NEW.quantity * v_rate, 2);
    v_new_qty := v_old_qty + NEW.quantity;
    IF v_new_qty < 0 AND NOT v_wh.allow_negative THEN
      SELECT description INTO v_item FROM items WHERE id = NEW.item_id;
      RAISE EXCEPTION 'Only % of % in % — you tried to take %', trim(to_char(v_old_qty, 'FM999999990.###')), COALESCE(v_item, 'this item'), v_wh.name,
        trim(to_char(-NEW.quantity, 'FM999999990.###'));
    END IF;
    v_new_val := CASE WHEN v_new_qty <= 0 THEN 0 ELSE v_old_val + NEW.value END;
  ELSE                                                            -- coming in
    IF COALESCE(NEW.unit_cost, 0) <= 0 THEN NEW.unit_cost := round(v_rate, 6); END IF;
    NEW.value := round(NEW.quantity * NEW.unit_cost, 2);
    v_new_qty := v_old_qty + NEW.quantity;
    v_new_val := v_old_val + NEW.value;
  END IF;
  IF v_new_val < 0 THEN v_new_val := 0; END IF;
  v_new_rate := CASE WHEN v_new_qty > 0 THEN v_new_val / v_new_qty ELSE v_rate END;
  NEW.qty_after := v_new_qty;
  INSERT INTO stock_balances (item_id, warehouse_id, on_hand_qty, valuation_rate, stock_value, updated_at)
  VALUES (NEW.item_id, NEW.warehouse_id, v_new_qty, v_new_rate, v_new_val, now())
  ON CONFLICT (item_id, warehouse_id) DO UPDATE SET on_hand_qty = v_new_qty, valuation_rate = v_new_rate, stock_value = v_new_val, updated_at = now();
  -- Item cost shown in lists = weighted average over every store that holds it.
  UPDATE items SET average_cost = COALESCE((SELECT sum(stock_value) / NULLIF(sum(on_hand_qty), 0) FROM stock_balances WHERE item_id = NEW.item_id AND on_hand_qty > 0), v_new_rate),
                   last_purchase_price = CASE WHEN NEW.movement_type = 'grn' AND NEW.unit_cost > 0 THEN NEW.unit_cost ELSE last_purchase_price END,
                   updated_at = now()
   WHERE id = NEW.item_id;
  RETURN NEW;
END $$;

-- ── Finance postings for stock ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_inv_movement_gl()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _site uuid; _other uuid; _amt numeric; _ev text; _dept text; _item text;
BEGIN
  SELECT site_id INTO _site FROM warehouses WHERE id = NEW.warehouse_id;
  IF _site IS NULL THEN RETURN NEW; END IF;
  _amt := abs(COALESCE(NULLIF(NEW.value, 0), NEW.quantity * NEW.unit_cost, 0));
  SELECT COALESCE(item_code || ' ', '') || COALESCE(description, '') INTO _item FROM items WHERE id = NEW.item_id;
  IF NEW.movement_type = 'issue' THEN
    SELECT name INTO _dept FROM departments WHERE id = NEW.department_id;
    _ev := CASE WHEN _dept ~* '(camp|catering|kitchen|accommodation|housekeeping)' THEN 'stock_issue_camp' ELSE 'stock_issue' END;
  ELSIF NEW.movement_type = 'return' THEN _ev := 'stock_return';
  ELSIF NEW.movement_type IN ('adjustment','stock_take') THEN _ev := CASE WHEN NEW.quantity < 0 THEN 'stock_loss' ELSE 'stock_gain' END;
  ELSIF NEW.movement_type = 'opening' THEN _ev := 'stock_opening';
  ELSIF NEW.movement_type IN ('transfer_out','transfer_in') THEN
    SELECT site_id INTO _other FROM warehouses WHERE id = NEW.counter_warehouse_id;
    IF _other IS NULL OR _other = _site THEN RETURN NEW; END IF;        -- same site: value stays in the same books
    _ev := CASE WHEN NEW.movement_type = 'transfer_out' THEN 'stock_transfer_out' ELSE 'stock_transfer_in' END;
  ELSE RETURN NEW;                                                        -- grn (posted by the GRN), landed_cost (own rule)
  END IF;
  PERFORM gl_auto_post(_site, _ev, 'inventory_movements', NEW.id, NEW.created_at::date, _amt,
    initcap(replace(NEW.movement_type, '_', ' ')) || ' ' || COALESCE(NEW.voucher_no, '') || ' — ' || COALESCE(_item, 'stock item')
    || COALESCE(' to ' || _dept, ''));
  RETURN NEW;
END $$;

-- New posting rules for every site that has books, and in the template for new sites.
INSERT INTO gl_posting_rules (site_id, event_code, debit_account_id, credit_account_id, is_active)
SELECT fs.site_id, v.ev, (SELECT id FROM accounts WHERE site_id = fs.site_id AND code = v.dr), (SELECT id FROM accounts WHERE site_id = fs.site_id AND code = v.cr), true
  FROM finance_setup fs CROSS JOIN (VALUES ('stock_transfer_out', '2500', '1320'), ('stock_transfer_in', '1320', '2500'), ('stock_opening', '1320', '3900')) v(ev, dr, cr)
 WHERE NOT EXISTS (SELECT 1 FROM gl_posting_rules r WHERE r.site_id = fs.site_id AND r.event_code = v.ev AND NOT r.is_archived)
   AND EXISTS (SELECT 1 FROM accounts WHERE site_id = fs.site_id AND code = v.dr) AND EXISTS (SELECT 1 FROM accounts WHERE site_id = fs.site_id AND code = v.cr);

DO $$ DECLARE d text; BEGIN
  d := pg_get_functiondef('finance_rule_template()'::regprocedure);
  IF position('stock_transfer_out' in d) = 0 THEN
    d := replace(d, '(''stock_issue'',''6310'',''1320''),', '(''stock_issue'',''6310'',''1320''), (''stock_transfer_out'',''2500'',''1320''), (''stock_transfer_in'',''1320'',''2500''), (''stock_opening'',''1320'',''3900''),');
    EXECUTE d;
  END IF;
END $$;

-- ── Receiving always lands in a store ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._inv_main_store(p_site uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM warehouses WHERE site_id = p_site AND is_active ORDER BY (type = 'main') DESC, created_at LIMIT 1;
$$;
DO $$ DECLARE d text; BEGIN
  d := pg_get_functiondef('trg_grn_moves_stock()'::regprocedure);
  d := replace(d, 'IF _l.stock_item IS NOT NULL AND _po.warehouse_id IS NOT NULL THEN', 'IF _l.stock_item IS NOT NULL AND COALESCE(_po.warehouse_id, _inv_main_store(_po.site_id)) IS NOT NULL THEN');
  d := replace(d, 'VALUES (_l.stock_item, _po.warehouse_id, ''grn''', 'VALUES (_l.stock_item, COALESCE(_po.warehouse_id, _inv_main_store(_po.site_id)), ''grn''');
  EXECUTE d;
END $$;

-- Transfers between sites (Procurement transfer requests) record the other store, so Finance can post through 2500.
DO $$ DECLARE d text; BEGIN
  d := pg_get_functiondef('proc_request_fulfil_transfer(uuid,uuid,uuid)'::regprocedure);
  IF position('counter_warehouse_id' in d) = 0 THEN
    d := replace(d, 'INSERT INTO inventory_movements (item_id, warehouse_id, movement_type, quantity, unit_cost, value, voucher_type, voucher_no, source_module, source_reference_id, created_by, notes)',
                    'INSERT INTO inventory_movements (item_id, warehouse_id, movement_type, quantity, unit_cost, value, voucher_type, voucher_no, source_module, source_reference_id, created_by, notes, counter_warehouse_id)');
    d := replace(d, '''Transfer to '' || _tw.name),', '''Transfer to '' || _tw.name, _tw.id),');
    d := replace(d, '''Transfer from '' || _fw.name);', '''Transfer from '' || _fw.name, _fw.id);');
    EXECUTE d;
  END IF;
END $$;

-- ── One function per move ─────────────────────────────────────────────────────
-- Lines: [{ item_id, qty, batch_no?, notes? }]. Quantities are always positive; the function signs them.
CREATE OR REPLACE FUNCTION public.inv_issue(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _wh warehouses%ROWTYPE; _no text; _l jsonb; _n int := 0; _val numeric := 0; _mv inventory_movements%ROWTYPE;
        _req uuid := NULLIF(p->>'requisition_id', '')::uuid; _wo uuid := NULLIF(p->>'work_order_id', '')::uuid; _rl uuid;
BEGIN
  SELECT * INTO _wh FROM warehouses WHERE id = (p->>'warehouse_id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Choose the store to issue from'; END IF;
  IF NOT _has_permission('inventory.create', _wh.site_id) THEN RAISE EXCEPTION 'You cannot issue stock from %', _wh.name; END IF;
  IF COALESCE(p->>'employee_id', p->>'contractor_id', p->>'department_id', p->>'work_order_id', p->>'requisition_id') IS NULL THEN
    RAISE EXCEPTION 'Say who or what the stock is for (person, contractor, department, work order or request)'; END IF;
  _no := doc_next_number(_wh.site_id, 'ISS');
  FOR _l IN SELECT * FROM jsonb_array_elements(COALESCE(p->'lines', '[]')) LOOP
    CONTINUE WHEN COALESCE((_l->>'qty')::numeric, 0) <= 0;
    INSERT INTO inventory_movements (item_id, warehouse_id, movement_type, quantity, voucher_type, voucher_no, source_module, source_reference_id,
      issued_to_employee_id, issued_to_contractor_id, department_id, cost_centre_id, project_id, batch_no, notes, created_by)
    VALUES ((_l->>'item_id')::uuid, _wh.id, 'issue', -(_l->>'qty')::numeric, 'ISSUE', _no, COALESCE(NULLIF(p->>'source', ''), 'inventory'), COALESCE(_wo, _req),
      NULLIF(p->>'employee_id', '')::uuid, NULLIF(p->>'contractor_id', '')::uuid, NULLIF(p->>'department_id', '')::uuid,
      NULLIF(p->>'cost_centre_id', '')::uuid, NULLIF(p->>'project_id', '')::uuid, NULLIF(trim(_l->>'batch_no'), ''),
      NULLIF(concat_ws(' — ', NULLIF(p->>'notes', ''), NULLIF(_l->>'notes', '')), ''), auth.uid())
    RETURNING * INTO _mv;
    _n := _n + 1; _val := _val + abs(_mv.value);
    -- Issuing against a request line counts toward that request.
    IF _req IS NOT NULL THEN
      _rl := NULLIF(_l->>'requisition_line_id', '')::uuid;
      UPDATE requisition_lines SET issued_qty = issued_qty + (_l->>'qty')::numeric
       WHERE requisition_id = _req AND NOT is_archived AND (id = _rl OR (_rl IS NULL AND item_id = (_l->>'item_id')::uuid));
    END IF;
  END LOOP;
  IF _n = 0 THEN RAISE EXCEPTION 'Enter a quantity on at least one line'; END IF;
  IF _req IS NOT NULL AND NOT EXISTS (SELECT 1 FROM requisition_lines WHERE requisition_id = _req AND NOT is_archived
                                        AND COALESCE(issued_qty, 0) + COALESCE(ordered_qty, 0) < quantity) THEN
    UPDATE purchase_requisitions SET status = 'fulfilled', fulfilled_at = now(), fulfilled_by = auth.uid(), updated_at = now()
     WHERE id = _req AND status IN ('approved','ordered');
  END IF;
  RETURN jsonb_build_object('voucher', _no, 'lines', _n, 'value', round(_val, 2));
END $$;

CREATE OR REPLACE FUNCTION public.inv_return(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _wh warehouses%ROWTYPE; _no text; _l jsonb; _n int := 0; _val numeric := 0; _mv inventory_movements%ROWTYPE;
BEGIN
  SELECT * INTO _wh FROM warehouses WHERE id = (p->>'warehouse_id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Choose the store to return into'; END IF;
  IF NOT _has_permission('inventory.create', _wh.site_id) THEN RAISE EXCEPTION 'You cannot take returns into %', _wh.name; END IF;
  _no := doc_next_number(_wh.site_id, 'RET');
  FOR _l IN SELECT * FROM jsonb_array_elements(COALESCE(p->'lines', '[]')) LOOP
    CONTINUE WHEN COALESCE((_l->>'qty')::numeric, 0) <= 0;
    INSERT INTO inventory_movements (item_id, warehouse_id, movement_type, quantity, voucher_type, voucher_no, source_module, source_reference_id,
      issued_to_employee_id, issued_to_contractor_id, department_id, cost_centre_id, project_id, batch_no, reason, notes, created_by)
    VALUES ((_l->>'item_id')::uuid, _wh.id, 'return', (_l->>'qty')::numeric, 'RETURN', _no, COALESCE(NULLIF(p->>'source', ''), 'inventory'), NULLIF(p->>'work_order_id', '')::uuid,
      NULLIF(p->>'employee_id', '')::uuid, NULLIF(p->>'contractor_id', '')::uuid, NULLIF(p->>'department_id', '')::uuid,
      NULLIF(p->>'cost_centre_id', '')::uuid, NULLIF(p->>'project_id', '')::uuid, NULLIF(trim(_l->>'batch_no'), ''),
      NULLIF(p->>'reason', ''), NULLIF(p->>'notes', ''), auth.uid())
    RETURNING * INTO _mv;
    _n := _n + 1; _val := _val + abs(_mv.value);
  END LOOP;
  IF _n = 0 THEN RAISE EXCEPTION 'Enter a quantity on at least one line'; END IF;
  RETURN jsonb_build_object('voucher', _no, 'lines', _n, 'value', round(_val, 2));
END $$;

-- Adjust: signed quantities with a reason (damaged, expired, found, correction…). Needs inventory.edit.
CREATE OR REPLACE FUNCTION public.inv_adjust(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _wh warehouses%ROWTYPE; _no text; _l jsonb; _n int := 0; _val numeric := 0; _mv inventory_movements%ROWTYPE;
BEGIN
  SELECT * INTO _wh FROM warehouses WHERE id = (p->>'warehouse_id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Choose the store'; END IF;
  IF NOT _has_permission('inventory.edit', _wh.site_id) THEN RAISE EXCEPTION 'You cannot adjust stock in %', _wh.name; END IF;
  IF COALESCE(trim(p->>'reason'), '') = '' THEN RAISE EXCEPTION 'Say why the stock is being adjusted'; END IF;
  _no := doc_next_number(_wh.site_id, 'ADJ');
  FOR _l IN SELECT * FROM jsonb_array_elements(COALESCE(p->'lines', '[]')) LOOP
    CONTINUE WHEN COALESCE((_l->>'qty')::numeric, 0) = 0;
    INSERT INTO inventory_movements (item_id, warehouse_id, movement_type, quantity, unit_cost, voucher_type, voucher_no, source_module, batch_no, expiry_date, reason, notes, created_by)
    VALUES ((_l->>'item_id')::uuid, _wh.id, 'adjustment', (_l->>'qty')::numeric, NULLIF(_l->>'unit_cost', '')::numeric, 'ADJ', _no, 'inventory',
      NULLIF(trim(_l->>'batch_no'), ''), NULLIF(_l->>'expiry_date', '')::date, p->>'reason', NULLIF(p->>'notes', ''), auth.uid())
    RETURNING * INTO _mv;
    _n := _n + 1; _val := _val + _mv.value;
  END LOOP;
  IF _n = 0 THEN RAISE EXCEPTION 'Enter a quantity on at least one line'; END IF;
  RETURN jsonb_build_object('voucher', _no, 'lines', _n, 'value', round(_val, 2));
END $$;

-- Move between two stores at the SAME site (between sites use a transfer request in Procurement).
CREATE OR REPLACE FUNCTION public.inv_transfer(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _f warehouses%ROWTYPE; _t warehouses%ROWTYPE; _no text; _l jsonb; _n int := 0; _out inventory_movements%ROWTYPE;
BEGIN
  SELECT * INTO _f FROM warehouses WHERE id = (p->>'from_warehouse_id')::uuid;
  SELECT * INTO _t FROM warehouses WHERE id = (p->>'to_warehouse_id')::uuid;
  IF _f.id IS NULL OR _t.id IS NULL OR _f.id = _t.id THEN RAISE EXCEPTION 'Choose two different stores'; END IF;
  IF _f.site_id <> _t.site_id THEN RAISE EXCEPTION 'To send stock to another site, raise a transfer request (Procurement → Requests → Transfer)'; END IF;
  IF NOT _has_permission('inventory.create', _f.site_id) THEN RAISE EXCEPTION 'You cannot move stock at this site'; END IF;
  _no := doc_next_number(_f.site_id, 'TRF');
  FOR _l IN SELECT * FROM jsonb_array_elements(COALESCE(p->'lines', '[]')) LOOP
    CONTINUE WHEN COALESCE((_l->>'qty')::numeric, 0) <= 0;
    INSERT INTO inventory_movements (item_id, warehouse_id, movement_type, quantity, voucher_type, voucher_no, source_module, counter_warehouse_id, batch_no, notes, created_by)
    VALUES ((_l->>'item_id')::uuid, _f.id, 'transfer_out', -(_l->>'qty')::numeric, 'TRF', _no, 'inventory', _t.id, NULLIF(trim(_l->>'batch_no'), ''), 'To ' || _t.name, auth.uid())
    RETURNING * INTO _out;
    INSERT INTO inventory_movements (item_id, warehouse_id, movement_type, quantity, unit_cost, voucher_type, voucher_no, source_module, counter_warehouse_id, batch_no, notes, created_by)
    VALUES (_out.item_id, _t.id, 'transfer_in', -_out.quantity, _out.unit_cost, 'TRF', _no, 'inventory', _f.id, _out.batch_no, 'From ' || _f.name, auth.uid());
    _n := _n + 1;
  END LOOP;
  IF _n = 0 THEN RAISE EXCEPTION 'Enter a quantity on at least one line'; END IF;
  RETURN jsonb_build_object('voucher', _no, 'lines', _n);
END $$;

-- Stock received without a PO (opening, donated, found, returned from a project/site). Each reason posts correctly.
CREATE OR REPLACE FUNCTION public.inv_receive_nopo(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _wh warehouses%ROWTYPE; _no text; _l jsonb; _n int := 0; _reason text := COALESCE(p->>'reason', ''); _type text; _val numeric := 0; _mv inventory_movements%ROWTYPE;
BEGIN
  SELECT * INTO _wh FROM warehouses WHERE id = (p->>'warehouse_id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Choose the store'; END IF;
  IF NOT _has_permission('inventory.create', _wh.site_id) THEN RAISE EXCEPTION 'You cannot receive stock into %', _wh.name; END IF;
  IF _reason NOT IN ('opening','donation','found','returned','other') THEN RAISE EXCEPTION 'Choose why this stock is received without a purchase order'; END IF;
  IF _reason = 'other' AND COALESCE(trim(p->>'notes'), '') = '' THEN RAISE EXCEPTION 'Explain where this stock came from'; END IF;
  _type := CASE _reason WHEN 'opening' THEN 'opening' WHEN 'returned' THEN 'return' ELSE 'adjustment' END;
  _no := COALESCE(NULLIF(trim(p->>'voucher_no'), ''), doc_next_number(_wh.site_id, 'RCV'));
  FOR _l IN SELECT * FROM jsonb_array_elements(COALESCE(p->'lines', '[]')) LOOP
    CONTINUE WHEN COALESCE((_l->>'qty')::numeric, 0) <= 0;
    INSERT INTO inventory_movements (item_id, warehouse_id, movement_type, quantity, unit_cost, voucher_type, voucher_no, source_module, batch_no, expiry_date, reason, notes, created_by)
    VALUES ((_l->>'item_id')::uuid, _wh.id, _type, (_l->>'qty')::numeric, NULLIF(_l->>'unit_cost', '')::numeric, 'RCV-NOPO', _no, 'inventory',
      NULLIF(trim(_l->>'batch_no'), ''), NULLIF(_l->>'expiry_date', '')::date, _reason, NULLIF(p->>'notes', ''), auth.uid())
    RETURNING * INTO _mv;
    _n := _n + 1; _val := _val + _mv.value;
  END LOOP;
  IF _n = 0 THEN RAISE EXCEPTION 'Add at least one item line'; END IF;
  RETURN jsonb_build_object('voucher', _no, 'lines', _n, 'value', round(_val, 2));
END $$;

-- Opening stock (one store, many lines) — used by the item import too.
CREATE OR REPLACE FUNCTION public.inv_opening(p jsonb)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT inv_receive_nopo(p || jsonb_build_object('reason', 'opening'));
$$;

-- Post a count in one step: variance = counted − on hand now. Records shrinkage in $ on the count.
ALTER TABLE stock_takes ADD COLUMN IF NOT EXISTS variance_value numeric;
ALTER TABLE stock_takes ADD COLUMN IF NOT EXISTS counted_value numeric;
CREATE OR REPLACE FUNCTION public.inv_count_post(p_stock_take_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _t stock_takes%ROWTYPE; _site uuid; _l record; _have numeric; _var numeric; _n int := 0; _vv numeric := 0; _cv numeric := 0; _mv inventory_movements%ROWTYPE; _rate numeric;
BEGIN
  SELECT * INTO _t FROM stock_takes WHERE id = p_stock_take_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Count not found'; END IF;
  IF _t.status = 'completed' THEN RAISE EXCEPTION 'This count was already posted'; END IF;
  SELECT site_id INTO _site FROM warehouses WHERE id = _t.warehouse_id;
  IF NOT (_has_permission('inventory.approve', _site) OR _has_permission('inventory.edit', _site)) THEN RAISE EXCEPTION 'You cannot post counts at this site'; END IF;
  FOR _l IN SELECT * FROM stock_take_lines WHERE stock_take_id = _t.id AND counted_qty IS NOT NULL LOOP
    SELECT COALESCE(on_hand_qty, 0), COALESCE(valuation_rate, 0) INTO _have, _rate FROM stock_balances WHERE item_id = _l.item_id AND warehouse_id = _t.warehouse_id;
    _have := COALESCE(_have, 0);
    _var := _l.counted_qty - _have;
    _cv := _cv + _l.counted_qty * COALESCE(_rate, 0);
    UPDATE stock_take_lines SET system_qty = _have, variance = _var WHERE id = _l.id;
    IF _var <> 0 THEN
      INSERT INTO inventory_movements (item_id, warehouse_id, movement_type, quantity, voucher_type, voucher_no, source_module, source_reference_id, reason, notes, created_by)
      VALUES (_l.item_id, _t.warehouse_id, 'stock_take', _var, 'COUNT', _t.reference, 'inventory', _t.id, 'count',
              'Count ' || COALESCE(_t.reference, '') || ': system ' || _have || ', counted ' || _l.counted_qty, auth.uid())
      RETURNING * INTO _mv;
      _vv := _vv + _mv.value; _n := _n + 1;
    END IF;
    UPDATE stock_balances SET last_counted_at = now() WHERE item_id = _l.item_id AND warehouse_id = _t.warehouse_id;
  END LOOP;
  UPDATE stock_takes SET status = 'completed', completed_at = now(), approved_by = auth.uid(), variance_value = round(_vv, 2), counted_value = round(_cv, 2) WHERE id = _t.id;
  RETURN jsonb_build_object('adjusted_lines', _n, 'variance_value', round(_vv, 2), 'counted_value', round(_cv, 2));
END $$;

REVOKE ALL ON FUNCTION inv_issue(jsonb), inv_return(jsonb), inv_adjust(jsonb), inv_transfer(jsonb), inv_receive_nopo(jsonb), inv_opening(jsonb), inv_count_post(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION inv_issue(jsonb), inv_return(jsonb), inv_adjust(jsonb), inv_transfer(jsonb), inv_receive_nopo(jsonb), inv_opening(jsonb), inv_count_post(uuid) TO authenticated;

-- Backfill site on existing movements (none today, kept for safety).
UPDATE inventory_movements m SET site_id = w.site_id FROM warehouses w WHERE w.id = m.warehouse_id AND m.site_id IS NULL;

INSERT INTO schema_migrations (filename) VALUES ('0232_inventory_i1_correct.sql') ON CONFLICT DO NOTHING;
