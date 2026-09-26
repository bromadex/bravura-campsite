-- 0249 Fuel F3 (#71): fuel deliveries received on a purchase order.
-- fuel_delivery_save with po_line_id: checks the PO (sent / partly received, same site, fuel line), creates an
-- accepted GRN (goods_received_notes.fuel_tank_id) so the PO status, bill three-way match and paper trail work,
-- then the fuel transaction (grn_id) → tank level + Stores mirror. The GRN itself moves no Stores stock and posts
-- nothing (trg_grn_moves_stock / trg_gl_grn skip fuel GRNs); the fuel transaction posts fuel_delivery_po
-- (Dr fuel stock / Cr goods received not invoiced), which the supplier's bill clears as usual.
-- Cancelling such a delivery rejects the GRN and gives the litres back to the PO line.
-- fuel_open_po_lines(site) lists fuel lines still to receive.

ALTER TABLE goods_received_notes ADD COLUMN IF NOT EXISTS fuel_tank_id uuid REFERENCES fuel_tanks(id);
ALTER TABLE fuel_transactions ADD COLUMN IF NOT EXISTS grn_id uuid REFERENCES goods_received_notes(id);
ALTER TABLE fuel_deliveries ADD COLUMN IF NOT EXISTS po_id uuid REFERENCES purchase_orders(id),
  ADD COLUMN IF NOT EXISTS po_line_id uuid REFERENCES po_lines(id),
  ADD COLUMN IF NOT EXISTS grn_id uuid REFERENCES goods_received_notes(id);

ALTER TABLE gl_posting_rules DROP CONSTRAINT IF EXISTS gl_posting_rules_event_code_check;
ALTER TABLE gl_posting_rules ADD CONSTRAINT gl_posting_rules_event_code_check CHECK (event_code = ANY (ARRAY['fuel_issue','fuel_delivery','fuel_delivery_po','fuel_loss','fuel_gain','grn_accepted','invoice_approved','invoice_paid','payroll_net','payroll_deductions','payroll_paye','payroll_nssa','payroll_nssa_employer','payroll_paid','payroll_loan_recovery','meals_approved','imtt','expense_approved','advance_settled','expense_paid','expense_paid_cash','advance_paid','advance_paid_cash','petty_cash_topup','petty_cash_expense','petty_cash_short','petty_cash_over','staff_loan_paid','asset_capitalised','asset_capitalised_grn','asset_transfer_out','asset_transfer_out_accum','asset_transfer_in','asset_transfer_in_accum','asset_depreciation','asset_disposal_accum','asset_disposal_loss','asset_disposal_proceeds','landed_cost','stock_opening','stock_transfer_out','stock_transfer_in','stock_issue','stock_issue_camp','stock_return','stock_loss','stock_gain','contractor_labour','hired_plant_usage','sheq_incident_cost','invoice_accrual','accrual_release','accrual_topup','invoice_paid_by_hq','hq_paid_for_site','petty_cash_topup_hq','hq_funded_site_cash']::text[]));

INSERT INTO gl_posting_rules (site_id, event_code, debit_account_id, credit_account_id, is_active, is_archived)
SELECT fd.site_id, 'fuel_delivery_po', fd.debit_account_id, g.credit_account_id, true, false
  FROM gl_posting_rules fd JOIN gl_posting_rules g ON g.site_id = fd.site_id AND g.event_code = 'grn_accepted' AND NOT g.is_archived
 WHERE fd.event_code = 'fuel_delivery' AND NOT fd.is_archived
   AND NOT EXISTS (SELECT 1 FROM gl_posting_rules x WHERE x.site_id = fd.site_id AND x.event_code = 'fuel_delivery_po');

-- GRN triggers: a fuel GRN updates the PO line but moves no Stores stock and posts nothing
CREATE OR REPLACE FUNCTION public.trg_grn_moves_stock()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _was boolean := TG_OP = 'UPDATE' AND OLD.status IN ('accepted','accepted_partial');
  _is  boolean := NEW.status IN ('accepted','accepted_partial');
  _po  purchase_orders%ROWTYPE; _l record; _qty numeric; _cost numeric; _f numeric; _wh uuid;
BEGIN
  IF _was AND NOT _is THEN
    IF NEW.fuel_tank_id IS NOT NULL AND current_setting('fuel.grn_void', true) = 'on' THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'This GRN has already put stock on the shelf. Correct it with a stock adjustment or supplier return instead.';
  END IF;
  IF NOT _is OR _was OR NEW.po_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO _po FROM purchase_orders WHERE id = NEW.po_id;
  _wh := COALESCE(_po.warehouse_id, _inv_main_store(_po.site_id));
  FOR _l IN
    SELECT g.*, COALESCE(g.item_id, pl.item_id) AS stock_item, pl.unit_cost AS po_cost, pl.unit AS po_unit,
           i.purchase_factor, pu.abbreviation AS p_abbr, pu.name AS p_name
      FROM grn_lines g LEFT JOIN po_lines pl ON pl.id = g.po_line_id
      LEFT JOIN items i ON i.id = COALESCE(g.item_id, pl.item_id)
      LEFT JOIN units_of_measure pu ON pu.id = i.purchase_uom_id
     WHERE g.grn_id = NEW.id
  LOOP
    _qty := COALESCE(_l.quantity_received, 0) - COALESCE(_l.quantity_rejected, 0);
    CONTINUE WHEN _qty <= 0;
    _cost := COALESCE(NULLIF(_l.unit_price, 0), _l.po_cost, 0);
    _f := CASE WHEN COALESCE(_l.purchase_factor, 1) <> 1 AND _l.po_unit IS NOT NULL
                AND lower(trim(_l.po_unit)) IN (lower(_l.p_abbr), lower(_l.p_name)) THEN _l.purchase_factor ELSE 1 END;
    IF _l.stock_item IS NOT NULL AND _wh IS NOT NULL AND NEW.fuel_tank_id IS NULL THEN
      INSERT INTO inventory_movements (item_id, warehouse_id, movement_type, quantity, unit_cost, value,
                                       voucher_type, voucher_no, source_module, source_reference_id, notes, created_by, bin_id)
      VALUES (_l.stock_item, _wh, 'grn', _qty * _f, _cost / _f, _qty * _cost,
              'GRN', NEW.grn_number, 'procurement', NEW.id,
              'Received against ' || COALESCE(_po.po_number, 'PO') || CASE WHEN _f <> 1 THEN ' (' || _qty || ' ' || _l.po_unit || ' × ' || _f || ')' ELSE '' END,
              COALESCE(NEW.received_by, auth.uid()),
              (SELECT bin_id FROM item_store_settings WHERE item_id = _l.stock_item AND warehouse_id = _wh));
    END IF;
    IF _l.po_line_id IS NOT NULL THEN
      UPDATE po_lines SET received_qty = received_qty + _qty WHERE id = _l.po_line_id;
    END IF;
  END LOOP;
  PERFORM _po_refresh_status(NEW.po_id);
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.trg_gl_grn()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _was BOOLEAN := TG_OP = 'UPDATE' AND OLD.status IN ('accepted','accepted_partial');
  _is  BOOLEAN := NEW.status IN ('accepted','accepted_partial');
  _amt NUMERIC;
BEGIN
  IF NEW.fuel_tank_id IS NOT NULL THEN RETURN NEW; END IF;  -- fuel posts fuel_delivery_po from the fuel transaction
  IF _is AND NOT _was THEN
    SELECT COALESCE(SUM(COALESCE(quantity_received, 0) * COALESCE(unit_price, 0)), 0)
      INTO _amt FROM grn_lines WHERE grn_id = NEW.id;
    PERFORM gl_auto_post(NEW.site_id, 'grn_accepted', 'goods_received_notes', NEW.id,
                         COALESCE(NEW.received_date, CURRENT_DATE), _amt,
                         'Goods received ' || COALESCE(NEW.grn_number, ''));
  ELSIF _was AND NOT _is THEN
    PERFORM gl_auto_reverse('goods_received_notes', NEW.id, 'GRN status changed to ' || NEW.status);
  END IF;
  RETURN NEW;
END;
$function$;

-- fuel GL: PO deliveries credit goods received not invoiced
CREATE OR REPLACE FUNCTION public.trg_gl_fuel_transactions()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _event TEXT; _desc TEXT;
BEGIN
  _event := CASE NEW.transaction_type WHEN 'issuance' THEN 'fuel_issue'
                                      WHEN 'delivery' THEN CASE WHEN NEW.grn_id IS NOT NULL THEN 'fuel_delivery_po' ELSE 'fuel_delivery' END END;
  IF _event IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.is_deleted IS NOT DISTINCT FROM OLD.is_deleted AND NEW.litres IS NOT DISTINCT FROM OLD.litres
       AND NEW.total_cost IS NOT DISTINCT FROM OLD.total_cost AND NEW.unit_price IS NOT DISTINCT FROM OLD.unit_price
       AND NEW.transaction_date IS NOT DISTINCT FROM OLD.transaction_date THEN
      RETURN NEW;
    END IF;
    PERFORM gl_auto_reverse('fuel_transactions', NEW.id,
      CASE WHEN COALESCE(NEW.is_deleted, false) THEN 'Fuel transaction deleted' ELSE 'Fuel transaction edited' END);
  END IF;
  IF COALESCE(NEW.is_deleted, false) THEN RETURN NEW; END IF;
  _desc := CASE WHEN _event = 'fuel_issue' THEN 'Fuel issue ' ELSE 'Fuel delivery ' END
           || COALESCE(NEW.transaction_number, '') || ' — ' || COALESCE(NEW.litres, 0) || ' L';
  PERFORM gl_auto_post(NEW.site_id, _event, 'fuel_transactions', NEW.id,
                       COALESCE(NEW.transaction_date, CURRENT_DATE), gl_fuel_value(NEW), _desc);
  RETURN NEW;
END;
$function$;

-- open fuel PO lines at a site
CREATE OR REPLACE FUNCTION fuel_open_po_lines(p_site uuid)
RETURNS TABLE(po_id uuid, po_line_id uuid, po_number text, supplier text, order_date date, fuel_type_id uuid, fuel text,
  ordered numeric, received numeric, remaining numeric, unit_cost numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT _user_has_fuel_perm(p_site, ARRAY['fuel.create','fuel.edit']) THEN RAISE EXCEPTION 'No access'; END IF;
  RETURN QUERY
  SELECT po.id, l.id, po.po_number, s.supplier_name, po.order_date, ft.id, ft.name, l.quantity, l.received_qty, l.quantity - l.received_qty, l.unit_cost
    FROM purchase_orders po JOIN po_lines l ON l.po_id = po.id AND NOT l.is_archived
    JOIN fuel_types ft ON ft.item_id = l.item_id
    LEFT JOIN procurement_suppliers s ON s.id = po.supplier_id
   WHERE po.site_id = p_site AND po.status IN ('sent','partially_received') AND l.received_qty < l.quantity
   ORDER BY po.order_date, po.po_number;
END $$;
GRANT EXECUTE ON FUNCTION fuel_open_po_lines(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.fuel_delivery_save(p jsonb)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _id uuid := NULLIF(p->>'id','')::uuid; _d fuel_deliveries%ROWTYPE; _t fuel_tanks%ROWTYPE; _q numeric := (p->>'quantity_delivered')::numeric;
        _price numeric := NULLIF(p->>'unit_price','')::numeric; _total numeric := NULLIF(p->>'total_cost','')::numeric; _tx uuid; _before numeric;
        _date date := COALESCE(NULLIF(p->>'delivery_date','')::date, CURRENT_DATE);
        _pl uuid := NULLIF(p->>'po_line_id','')::uuid; _line record; _grn uuid; _supplier text := trim(p->>'supplier_name');
BEGIN
  SELECT * INTO _t FROM fuel_tanks WHERE id = (p->>'tank_id')::uuid;
  IF _t.id IS NULL THEN RAISE EXCEPTION 'Choose the tank'; END IF;
  IF NOT _user_has_fuel_perm(_t.site_id, CASE WHEN _id IS NULL THEN ARRAY['fuel.create','fuel.edit'] ELSE ARRAY['fuel.edit','fuel.approve'] END) THEN
    RAISE EXCEPTION 'You do not have permission to % deliveries', CASE WHEN _id IS NULL THEN 'record' ELSE 'change' END;
  END IF;
  IF COALESCE(_q, 0) <= 0 THEN RAISE EXCEPTION 'Enter the litres delivered'; END IF;

  IF _id IS NULL AND _pl IS NOT NULL THEN
    SELECT l.*, po.po_number, po.site_id AS po_site, po.status AS po_status, po.supplier_id, s.supplier_name, ft.id AS ft_id
      INTO _line FROM po_lines l JOIN purchase_orders po ON po.id = l.po_id
      LEFT JOIN procurement_suppliers s ON s.id = po.supplier_id LEFT JOIN fuel_types ft ON ft.item_id = l.item_id
     WHERE l.id = _pl AND NOT l.is_archived;
    IF _line.id IS NULL THEN RAISE EXCEPTION 'Purchase order line not found'; END IF;
    IF _line.po_site <> _t.site_id THEN RAISE EXCEPTION 'That purchase order is for another site'; END IF;
    IF _line.po_status NOT IN ('sent','partially_received') THEN RAISE EXCEPTION 'Purchase order % is %, not open for receiving', _line.po_number, replace(_line.po_status, '_', ' '); END IF;
    IF _line.ft_id IS DISTINCT FROM _t.fuel_type_id THEN RAISE EXCEPTION 'That order line is not for the fuel in %', _t.name; END IF;
    IF _q > (_line.quantity - _line.received_qty) * 1.05 THEN
      RAISE EXCEPTION 'Only % L are still to come on %; % L is more than 5%% over', _line.quantity - _line.received_qty, _line.po_number, _q;
    END IF;
    _supplier := COALESCE(NULLIF(_supplier, ''), _line.supplier_name);
    _price := COALESCE(_price, _line.unit_cost);
    _total := NULL;
  END IF;
  IF COALESCE(_supplier, '') = '' THEN RAISE EXCEPTION 'Enter the supplier'; END IF;
  _total := COALESCE(_total, round(_q * _price, 2));
  _price := COALESCE(_price, round(_total / _q, 4));
  _before := COALESCE(NULLIF(p->>'dip_before','')::numeric, (_fuel_tank_book(_t.id)->>'book')::numeric);
  IF _id IS NULL AND _t.capacity_litres IS NOT NULL AND _before + _q > _t.capacity_litres * 1.02 THEN
    RAISE EXCEPTION '% holds % L and had about % L before this delivery — % L will not fit. Check the litres or the dip.',
      _t.name, _t.capacity_litres, round(_before), _q;
  END IF;
  IF _id IS NULL THEN
    IF _pl IS NOT NULL THEN
      INSERT INTO goods_received_notes (grn_number, site_id, po_id, supplier_id, received_by, received_date, status, delivery_note_ref, notes, fuel_tank_id)
      VALUES ('', _t.site_id, _line.po_id, _line.supplier_id, auth.uid(), _date, 'draft', NULLIF(trim(p->>'delivery_note_number'), ''),
              'Fuel into ' || _t.name, _t.id)
      RETURNING id INTO _grn;
      INSERT INTO grn_lines (grn_id, po_line_id, item_id, item_description, quantity_expected, quantity_received, quantity_rejected, unit, unit_price)
      VALUES (_grn, _pl, _line.item_id, COALESCE(_line.description, 'Fuel'), _line.quantity - _line.received_qty, _q, 0, 'L', _price);
      UPDATE goods_received_notes SET status = 'accepted', updated_at = now() WHERE id = _grn;
    END IF;
    INSERT INTO fuel_transactions (site_id, transaction_number, transaction_date, tank_id, transaction_type, litres, unit_price, total_cost,
                                   supplier, docket_number, notes, created_by, grn_id)
    VALUES (_t.site_id, _fuel_next_no(_t.site_id, 'delivery'), _date, _t.id, 'delivery', _q, _price, _total, _supplier,
            NULLIF(trim(p->>'delivery_note_number'), ''), concat_ws(' | ', 'Received by: ' || NULLIF(trim(p->>'receiving_officer'), ''),
            'PO ' || _line.po_number, NULLIF(trim(p->>'notes'), '')), auth.uid(), _grn)
    RETURNING id INTO _tx;
    INSERT INTO fuel_deliveries (site_id, delivery_number, tank_id, supplier_name, delivery_note_number, delivery_date, quantity_ordered, quantity_delivered,
                                 unit_price, total_cost, dip_before, dip_after, dip_before_mm, dip_after_mm, receiving_officer, notes, status, created_by, transaction_id,
                                 po_id, po_line_id, grn_id)
    VALUES (_t.site_id, (SELECT transaction_number FROM fuel_transactions WHERE id = _tx), _t.id, _supplier, NULLIF(trim(p->>'delivery_note_number'), ''),
            _date, COALESCE(NULLIF(p->>'quantity_ordered','')::numeric, _line.quantity), _q, _price, _total, NULLIF(p->>'dip_before','')::numeric, NULLIF(p->>'dip_after','')::numeric,
            NULLIF(p->>'dip_before_mm','')::numeric, NULLIF(p->>'dip_after_mm','')::numeric, NULLIF(trim(p->>'receiving_officer'), ''), NULLIF(trim(p->>'notes'), ''),
            'confirmed', auth.uid(), _tx, _line.po_id, _pl, _grn)
    RETURNING id INTO _id;
  ELSE
    SELECT * INTO _d FROM fuel_deliveries WHERE id = _id FOR UPDATE;
    IF _d.id IS NULL OR _d.is_archived THEN RAISE EXCEPTION 'Delivery not found'; END IF;
    IF _d.grn_id IS NOT NULL AND (_q IS DISTINCT FROM _d.quantity_delivered OR _price IS DISTINCT FROM _d.unit_price OR _t.id <> _d.tank_id) THEN
      RAISE EXCEPTION 'This delivery was received on a purchase order — cancel it and receive it again to change litres, price or tank';
    END IF;
    UPDATE fuel_deliveries SET tank_id = _t.id, supplier_name = _supplier, delivery_note_number = NULLIF(trim(p->>'delivery_note_number'), ''),
           delivery_date = _date, quantity_ordered = NULLIF(p->>'quantity_ordered','')::numeric, quantity_delivered = _q, unit_price = _price, total_cost = _total,
           dip_before = NULLIF(p->>'dip_before','')::numeric, dip_after = NULLIF(p->>'dip_after','')::numeric,
           dip_before_mm = NULLIF(p->>'dip_before_mm','')::numeric, dip_after_mm = NULLIF(p->>'dip_after_mm','')::numeric,
           receiving_officer = NULLIF(trim(p->>'receiving_officer'), ''), notes = NULLIF(trim(p->>'notes'), ''), updated_by = auth.uid()
     WHERE id = _id;
    UPDATE fuel_transactions SET tank_id = _t.id, transaction_date = _date, litres = _q, unit_price = _price, total_cost = _total,
           supplier = _supplier, docket_number = NULLIF(trim(p->>'delivery_note_number'), ''), updated_by = auth.uid(),
           edit_reason = COALESCE(NULLIF(trim(p->>'edit_reason'), ''), 'Delivery corrected')
     WHERE id = _d.transaction_id;
  END IF;
  IF NULLIF(p->>'dip_after','')::numeric IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM fuel_dip_readings WHERE tank_id = _t.id AND reading_date = _date AND level_litres = (p->>'dip_after')::numeric AND NOT is_archived) THEN
    INSERT INTO fuel_dip_readings (site_id, tank_id, reading_date, reading_time, dip_start_mm, dip_end_mm, dip_mm, level_start_litres, level_end_litres, level_litres,
                                   read_by, notes, recorded_by)
    VALUES (_t.site_id, _t.id, _date, NULLIF(p->>'delivery_time','')::time, NULLIF(p->>'dip_before_mm','')::numeric, NULLIF(p->>'dip_after_mm','')::numeric,
            NULLIF(p->>'dip_after_mm','')::numeric, NULLIF(p->>'dip_before','')::numeric, (p->>'dip_after')::numeric, (p->>'dip_after')::numeric,
            NULLIF(trim(p->>'receiving_officer'), ''), 'Dip after delivery', auth.uid());
  END IF;
  RETURN _id;
END $function$;

CREATE OR REPLACE FUNCTION public.fuel_delivery_void(p_id uuid, p_reason text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _d fuel_deliveries%ROWTYPE; _po uuid;
BEGIN
  SELECT * INTO _d FROM fuel_deliveries WHERE id = p_id FOR UPDATE;
  IF _d.id IS NULL OR _d.is_archived THEN RAISE EXCEPTION 'Delivery not found'; END IF;
  IF NOT _user_has_fuel_perm(_d.site_id, ARRAY['fuel.edit','fuel.approve']) THEN RAISE EXCEPTION 'You do not have permission to cancel deliveries'; END IF;
  IF COALESCE(trim(p_reason), '') = '' THEN RAISE EXCEPTION 'Say why this delivery is being cancelled'; END IF;
  IF _d.grn_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM invoice_lines il JOIN purchase_invoices pi ON pi.id = il.invoice_id
                WHERE il.grn_line_id IN (SELECT id FROM grn_lines WHERE grn_id = _d.grn_id) AND pi.status <> 'cancelled') THEN
      RAISE EXCEPTION 'A supplier bill is already matched to this delivery — cancel the bill first';
    END IF;
    PERFORM set_config('fuel.grn_void', 'on', true);
    UPDATE goods_received_notes SET status = 'rejected', notes = trim(COALESCE(notes, '') || ' | Cancelled: ' || trim(p_reason)), updated_at = now() WHERE id = _d.grn_id;
    PERFORM set_config('fuel.grn_void', 'off', true);
    UPDATE po_lines SET received_qty = GREATEST(received_qty - _d.quantity_delivered, 0) WHERE id = _d.po_line_id;
    SELECT po_id INTO _po FROM po_lines WHERE id = _d.po_line_id;
    -- back to 'partially_received' (still open for receiving); setting 'sent' again would restart the approval route
    UPDATE purchase_orders SET status = 'partially_received', updated_at = now() WHERE id = _po AND status = 'received';
  END IF;
  UPDATE fuel_deliveries SET is_archived = true, archived_at = now(), status = 'cancelled', query_notes = trim(p_reason), updated_by = auth.uid() WHERE id = p_id;
  UPDATE fuel_transactions SET is_deleted = true, deleted_at = now(), deleted_by = auth.uid(), edit_reason = 'Delivery cancelled: ' || trim(p_reason)
   WHERE id = _d.transaction_id AND NOT COALESCE(is_deleted, false);
END $function$;

INSERT INTO schema_migrations (filename) VALUES ('0249_fuel_f3_po_deliveries.sql') ON CONFLICT DO NOTHING;
