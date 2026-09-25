-- 0201 landed_cost — freight, customs duty, clearing, insurance and handling paid on top of
-- the supplier price are added to the cost of the goods received on a GRN.
-- A landed-cost voucher is drafted against an accepted GRN, then applied:
--   • the amount is split over the GRN's lines by value (default) or by quantity
--   • stock lines get a value-only 'landed_cost' movement, so the item's moving-average
--     cost and the warehouse stock value go up (quantity is unchanged)
--   • the total posts to the ledger as event 'landed_cost' (Dr stock / Cr clearing or supplier)
-- Applied vouchers are locked; a mistake is corrected with a new (negative) voucher.

CREATE TABLE IF NOT EXISTS grn_landed_costs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id           uuid NOT NULL REFERENCES sites(id),
  grn_id            uuid NOT NULL REFERENCES goods_received_notes(id),
  cost_type         text NOT NULL DEFAULT 'freight'
                    CHECK (cost_type IN ('freight','customs_duty','clearing','insurance','handling','other')),
  description       text,
  amount            numeric(14,2) NOT NULL CHECK (amount <> 0),
  supplier_id       uuid REFERENCES procurement_suppliers(id),   -- transporter / clearing agent
  reference         text,                                         -- their invoice number
  allocation_method text NOT NULL DEFAULT 'value' CHECK (allocation_method IN ('value','quantity')),
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','applied','cancelled')),
  applied_at        timestamptz,
  applied_by        uuid REFERENCES profiles(id),
  allocation        jsonb,                                        -- [{grn_line_id, item, amount}]
  created_by        uuid REFERENCES profiles(id) DEFAULT auth.uid(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  is_archived       boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS grn_landed_costs_grn_idx ON grn_landed_costs (grn_id);
CREATE INDEX IF NOT EXISTS grn_landed_costs_site_idx ON grn_landed_costs (site_id, created_at DESC);

ALTER TABLE grn_landed_costs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS glc_select ON grn_landed_costs;
CREATE POLICY glc_select ON grn_landed_costs FOR SELECT TO authenticated
  USING (_has_permission('procurement.view', site_id));
DROP POLICY IF EXISTS glc_insert ON grn_landed_costs;
CREATE POLICY glc_insert ON grn_landed_costs FOR INSERT TO authenticated
  WITH CHECK (_has_permission('procurement.create', site_id) AND status = 'draft');
DROP POLICY IF EXISTS glc_update ON grn_landed_costs;
CREATE POLICY glc_update ON grn_landed_costs FOR UPDATE TO authenticated
  USING (_has_permission('procurement.edit', site_id) AND status = 'draft')
  WITH CHECK (_has_permission('procurement.edit', site_id) AND status IN ('draft','cancelled'));

-- Value-only stock movement type.
ALTER TABLE inventory_movements DROP CONSTRAINT IF EXISTS inventory_movements_movement_type_check;
ALTER TABLE inventory_movements ADD CONSTRAINT inventory_movements_movement_type_check
  CHECK (movement_type IN ('opening','grn','issue','return','transfer_out','transfer_in','adjustment','stock_take','landed_cost'));

-- Moving-average balance: a landed_cost movement adds value without changing quantity.
CREATE OR REPLACE FUNCTION trg_inventory_movement_balance() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old_qty numeric; v_old_val numeric; v_new_qty numeric; v_new_rate numeric; v_new_val numeric;
BEGIN
  SELECT COALESCE(on_hand_qty,0), COALESCE(stock_value,0) INTO v_old_qty, v_old_val
  FROM stock_balances WHERE item_id=NEW.item_id AND warehouse_id=NEW.warehouse_id FOR UPDATE;
  IF NOT FOUND THEN v_old_qty:=0; v_old_val:=0; END IF;
  v_new_qty := v_old_qty + NEW.quantity;
  IF NEW.movement_type = 'landed_cost' THEN
    v_new_val := v_old_val + COALESCE(NEW.value, 0);
    v_new_rate := CASE WHEN v_new_qty > 0 THEN v_new_val / v_new_qty ELSE 0 END;
  ELSIF NEW.quantity > 0 AND NEW.unit_cost > 0 THEN
    v_new_val := v_old_val + (NEW.quantity * NEW.unit_cost);
    v_new_rate := CASE WHEN v_new_qty > 0 THEN v_new_val / v_new_qty ELSE 0 END;
  ELSE
    v_new_rate := CASE WHEN v_old_qty > 0 THEN v_old_val / v_old_qty ELSE 0 END;
    v_new_val := v_new_qty * v_new_rate;
  END IF;
  IF v_new_val < 0 THEN v_new_val := 0; END IF;
  NEW.qty_after := v_new_qty;
  INSERT INTO stock_balances (item_id, warehouse_id, on_hand_qty, valuation_rate, stock_value, updated_at)
  VALUES (NEW.item_id, NEW.warehouse_id, v_new_qty, v_new_rate, v_new_val, now())
  ON CONFLICT (item_id, warehouse_id) DO UPDATE SET
    on_hand_qty=v_new_qty, valuation_rate=v_new_rate, stock_value=v_new_val, updated_at=now();
  UPDATE items SET average_cost=v_new_rate, updated_at=now() WHERE id=NEW.item_id;
  RETURN NEW;
END $$;

-- Ledger event.
ALTER TABLE gl_posting_rules DROP CONSTRAINT IF EXISTS gl_posting_rules_event_code_check;
ALTER TABLE gl_posting_rules ADD CONSTRAINT gl_posting_rules_event_code_check CHECK (event_code IN (
  'fuel_issue','fuel_delivery','grn_accepted','invoice_approved','invoice_paid','payroll_net','payroll_deductions',
  'payroll_paye','payroll_nssa','payroll_nssa_employer','payroll_paid','payroll_loan_recovery','meals_approved','imtt',
  'expense_approved','advance_settled','expense_paid','expense_paid_cash','advance_paid','advance_paid_cash',
  'petty_cash_topup','petty_cash_expense','petty_cash_short','petty_cash_over','staff_loan_paid',
  'asset_capitalised','asset_depreciation','asset_disposal_accum','asset_disposal_loss','asset_disposal_proceeds',
  'landed_cost'));

-- Apply a draft voucher.
CREATE OR REPLACE FUNCTION proc_apply_landed_cost(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _lc  grn_landed_costs%ROWTYPE;
  _grn goods_received_notes%ROWTYPE;
  _wh  uuid;
  _basis numeric;
  _l   record;
  _share numeric;
  _done numeric := 0;
  _n int; _i int := 0;
  _alloc jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO _lc FROM grn_landed_costs WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Landed cost not found'; END IF;
  IF NOT _has_permission('procurement.approve', _lc.site_id) AND NOT _has_permission('procurement.edit', _lc.site_id) THEN
    RAISE EXCEPTION 'You do not have permission to apply landed costs at this site';
  END IF;
  IF _lc.status <> 'draft' THEN RAISE EXCEPTION 'This landed cost is already %', _lc.status; END IF;

  SELECT * INTO _grn FROM goods_received_notes WHERE id = _lc.grn_id;
  IF _grn.status NOT IN ('accepted','accepted_partial') THEN
    RAISE EXCEPTION 'Landed costs can only be added to an accepted GRN';
  END IF;
  SELECT warehouse_id INTO _wh FROM purchase_orders WHERE id = _grn.po_id;

  SELECT COALESCE(SUM(CASE WHEN _lc.allocation_method = 'quantity'
                           THEN quantity_received - quantity_rejected
                           ELSE (quantity_received - quantity_rejected) * unit_price END), 0),
         COUNT(*) FILTER (WHERE quantity_received - quantity_rejected > 0)
    INTO _basis, _n
    FROM grn_lines WHERE grn_id = _grn.id;
  IF _basis <= 0 THEN RAISE EXCEPTION 'The GRN has no accepted quantity/value to spread the cost over'; END IF;

  FOR _l IN
    SELECT g.*, COALESCE(g.item_id, pl.item_id) AS stock_item
      FROM grn_lines g LEFT JOIN po_lines pl ON pl.id = g.po_line_id
     WHERE g.grn_id = _grn.id AND g.quantity_received - g.quantity_rejected > 0
     ORDER BY g.created_at, g.id
  LOOP
    _i := _i + 1;
    -- Last line takes the rounding remainder so the split always adds up exactly.
    _share := CASE WHEN _i = _n THEN _lc.amount - _done
                   ELSE round(_lc.amount * (CASE WHEN _lc.allocation_method = 'quantity'
                                                 THEN _l.quantity_received - _l.quantity_rejected
                                                 ELSE (_l.quantity_received - _l.quantity_rejected) * _l.unit_price END) / _basis, 2) END;
    _done := _done + _share;
    IF _l.stock_item IS NOT NULL AND _wh IS NOT NULL AND _share <> 0 THEN
      INSERT INTO inventory_movements (item_id, warehouse_id, movement_type, quantity, unit_cost, value,
                                       voucher_type, voucher_no, source_module, source_reference_id, notes, created_by)
      VALUES (_l.stock_item, _wh, 'landed_cost', 0, 0, _share, 'LC', _grn.grn_number, 'procurement', _lc.id,
              initcap(replace(_lc.cost_type, '_', ' ')) || ' on ' || _grn.grn_number, auth.uid());
    END IF;
    _alloc := _alloc || jsonb_build_object('grn_line_id', _l.id, 'item', _l.item_description, 'amount', _share,
                                           'stocked', _l.stock_item IS NOT NULL AND _wh IS NOT NULL);
  END LOOP;

  UPDATE grn_landed_costs SET status = 'applied', applied_at = now(), applied_by = auth.uid(), allocation = _alloc
   WHERE id = _lc.id;

  PERFORM gl_auto_post(_lc.site_id, 'landed_cost', 'grn_landed_costs', _lc.id, CURRENT_DATE, _lc.amount,
                       initcap(replace(_lc.cost_type, '_', ' ')) || ' on ' || _grn.grn_number);
  RETURN _alloc;
END $$;
REVOKE ALL ON FUNCTION proc_apply_landed_cost(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION proc_apply_landed_cost(uuid) TO authenticated;

INSERT INTO schema_migrations (filename) VALUES ('0201_landed_cost.sql') ON CONFLICT DO NOTHING;
