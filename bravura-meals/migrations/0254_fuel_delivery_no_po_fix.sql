-- 0254: fuel_delivery_save failed with 'record "_line" is not assigned yet' for deliveries WITHOUT a PO (0249 read _line outside the PO branch).
-- Also: the dip-after row put the officer's NAME into read_by (uuid → fuel_operators); name now goes to recorded_by_name.
CREATE OR REPLACE FUNCTION public.fuel_delivery_save(p jsonb)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _id uuid := NULLIF(p->>'id','')::uuid; _d fuel_deliveries%ROWTYPE; _t fuel_tanks%ROWTYPE; _q numeric := (p->>'quantity_delivered')::numeric;
        _price numeric := NULLIF(p->>'unit_price','')::numeric; _total numeric := NULLIF(p->>'total_cost','')::numeric; _tx uuid; _before numeric;
        _date date := COALESCE(NULLIF(p->>'delivery_date','')::date, CURRENT_DATE);
        _pl uuid := NULLIF(p->>'po_line_id','')::uuid; _line record; _po_no text; _po_id uuid; _po_qty numeric; _item uuid; _desc text; _supplier_id uuid; _remaining numeric; _grn uuid; _supplier text := trim(p->>'supplier_name');
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
    _po_no := _line.po_number; _po_id := _line.po_id; _po_qty := _line.quantity; _item := _line.item_id; _desc := _line.description;
    _supplier_id := _line.supplier_id; _remaining := _line.quantity - _line.received_qty;
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
      VALUES ('', _t.site_id, _po_id, _supplier_id, auth.uid(), _date, 'draft', NULLIF(trim(p->>'delivery_note_number'), ''),
              'Fuel into ' || _t.name, _t.id)
      RETURNING id INTO _grn;
      INSERT INTO grn_lines (grn_id, po_line_id, item_id, item_description, quantity_expected, quantity_received, quantity_rejected, unit, unit_price)
      VALUES (_grn, _pl, _item, COALESCE(_desc, 'Fuel'), _remaining, _q, 0, 'L', _price);
      UPDATE goods_received_notes SET status = 'accepted', updated_at = now() WHERE id = _grn;
    END IF;
    INSERT INTO fuel_transactions (site_id, transaction_number, transaction_date, tank_id, transaction_type, litres, unit_price, total_cost,
                                   supplier, docket_number, notes, created_by, grn_id)
    VALUES (_t.site_id, _fuel_next_no(_t.site_id, 'delivery'), _date, _t.id, 'delivery', _q, _price, _total, _supplier,
            NULLIF(trim(p->>'delivery_note_number'), ''), concat_ws(' | ', 'Received by: ' || NULLIF(trim(p->>'receiving_officer'), ''),
            'PO ' || _po_no, NULLIF(trim(p->>'notes'), '')), auth.uid(), _grn)
    RETURNING id INTO _tx;
    INSERT INTO fuel_deliveries (site_id, delivery_number, tank_id, supplier_name, delivery_note_number, delivery_date, quantity_ordered, quantity_delivered,
                                 unit_price, total_cost, dip_before, dip_after, dip_before_mm, dip_after_mm, receiving_officer, notes, status, created_by, transaction_id,
                                 po_id, po_line_id, grn_id)
    VALUES (_t.site_id, (SELECT transaction_number FROM fuel_transactions WHERE id = _tx), _t.id, _supplier, NULLIF(trim(p->>'delivery_note_number'), ''),
            _date, COALESCE(NULLIF(p->>'quantity_ordered','')::numeric, _po_qty), _q, _price, _total, NULLIF(p->>'dip_before','')::numeric, NULLIF(p->>'dip_after','')::numeric,
            NULLIF(p->>'dip_before_mm','')::numeric, NULLIF(p->>'dip_after_mm','')::numeric, NULLIF(trim(p->>'receiving_officer'), ''), NULLIF(trim(p->>'notes'), ''),
            'confirmed', auth.uid(), _tx, _po_id, _pl, _grn)
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
                                   read_by, notes, recorded_by, recorded_by_name)
    VALUES (_t.site_id, _t.id, _date, NULLIF(p->>'delivery_time','')::time, NULLIF(p->>'dip_before_mm','')::numeric, NULLIF(p->>'dip_after_mm','')::numeric,
            NULLIF(p->>'dip_after_mm','')::numeric, NULLIF(p->>'dip_before','')::numeric, (p->>'dip_after')::numeric, (p->>'dip_after')::numeric,
            NULL, 'Dip after delivery', auth.uid(), NULLIF(trim(p->>'receiving_officer'), ''));
  END IF;
  RETURN _id;
END $function$;

INSERT INTO schema_migrations (filename) VALUES ('0254_fuel_delivery_no_po_fix.sql') ON CONFLICT DO NOTHING;
