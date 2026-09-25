-- 0237 — Inventory I6 (issue #59): Ask Bravura in the stores.
--  • ai_stock now answers from inv_position: free, reserved, on order, on the way, bin, reorder point per store; and with no
--    search it lists what is short (store levels first), shipments on the road and batches expiring soon.
--  • Proposal cards: "issue 4 oil filters to the Workshop" → ai_prepare_stock_issue → Confirm → inv_issue;
--    "send 10 boots to Selous" → ai_prepare_stock_transfer → Confirm → inv_dispatch. Nothing moves until the person confirms.
--  • Stock alerts join the daily alerts (and the 04:30 notifications): out of stock, shipments on the road over 5 days,
--    counts off by more than 5% of value, batches expiring in 14 days.

ALTER TABLE ai_actions DROP CONSTRAINT IF EXISTS ai_actions_kind_check;
ALTER TABLE ai_actions ADD CONSTRAINT ai_actions_kind_check
  CHECK (kind IN ('receive_delivery','draft_bill','petty_cash_spend','purchase_request','approval_decision','po_from_quote','stock_issue','stock_transfer'));

-- ── Read ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ai_stock(p_site_ids uuid[], p_search text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _s uuid[] := _ai_sites_for('inventory.view', p_site_ids); _q text := '%' || COALESCE(trim(p_search), '') || '%';
BEGIN
  IF _s IS NULL THEN RETURN jsonb_build_object('error', 'You have no stores access to those sites'); END IF;
  IF p_search IS NOT NULL AND trim(p_search) <> '' THEN
    RETURN jsonb_build_object('search', p_search, 'items', COALESCE((SELECT jsonb_agg(x) FROM (
      SELECT jsonb_build_object('code', p.item_code, 'item', p.description, 'unit', p.unit, 'store', p.warehouse, 'site', p.site, 'bin', p.bin,
             'on_hand', p.on_hand, 'reserved', p.reserved, 'free', p.available, 'on_order', p.on_order, 'on_the_way', p.in_transit,
             'reorder_at', p.reorder_at, 'value', round(p.value, 2)) x
        FROM inv_position(_s) p JOIN items i ON i.id = p.item_id
       WHERE p.description ILIKE _q OR p.item_code ILIKE _q OR i.part_number ILIKE _q OR i.barcode = trim(p_search)
       ORDER BY p.description, p.warehouse LIMIT 30) q), '[]'));
  END IF;
  RETURN jsonb_build_object(
    'stock_value', (SELECT round(COALESCE(sum(value), 0), 2) FROM inv_position(_s)),
    'short', COALESCE((SELECT jsonb_agg(x) FROM (
      SELECT jsonb_build_object('code', item_code, 'item', description, 'store', warehouse, 'free', available, 'reorder_at', reorder_at,
             'on_order', on_order, 'on_the_way', in_transit) x
        FROM inv_position(_s) WHERE COALESCE(reorder_at, 0) > 0 AND available + on_order + in_transit <= reorder_at
       ORDER BY available <= 0 DESC, description LIMIT 25) q), '[]'),
    'on_the_road', COALESCE((SELECT jsonb_agg(jsonb_build_object('shipment', s.shipment_no, 'from', f.name, 'to', t.name, 'sent', s.dispatched_at::date,
             'days', current_date - s.dispatched_at::date)) FROM inv_shipments s JOIN warehouses f ON f.id = s.from_warehouse_id JOIN warehouses t ON t.id = s.to_warehouse_id
        WHERE s.status = 'in_transit' AND (s.from_site_id = ANY (_s) OR s.to_site_id = ANY (_s))), '[]'),
    'expiring', COALESCE((SELECT jsonb_agg(jsonb_build_object('item', i.description, 'batch', b.batch_no, 'qty', b.qty_remaining, 'expires', b.expiry_date, 'store', w.name) ORDER BY b.expiry_date)
        FROM inventory_batches b JOIN items i ON i.id = b.item_id JOIN warehouses w ON w.id = b.warehouse_id
       WHERE w.site_id = ANY (_s) AND b.qty_remaining > 0 AND NOT b.is_archived AND b.expiry_date <= current_date + 30), '[]'));
END $$;

-- ── Prepare (read-only checks; the proposal card shows the result) ────────────
CREATE OR REPLACE FUNCTION public._ai_find_store(p_site uuid, p_text text) RETURNS warehouses
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT w.* FROM warehouses w WHERE w.site_id = p_site AND w.is_active
     AND (NULLIF(trim(p_text), '') IS NULL OR w.name ILIKE '%' || trim(p_text) || '%' OR w.code ILIKE trim(p_text))
   ORDER BY (NULLIF(trim(p_text), '') IS NULL AND w.type = 'main') DESC, length(w.name) LIMIT 1;
$$;
CREATE OR REPLACE FUNCTION public._ai_find_item(p_text text) RETURNS items
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT i.* FROM items i WHERE NOT COALESCE(i.is_archived, false)
     AND (upper(i.item_code) = upper(trim(p_text)) OR i.barcode = trim(p_text) OR i.description ILIKE '%' || trim(p_text) || '%' OR i.part_number ILIKE trim(p_text))
   ORDER BY (upper(i.item_code) = upper(trim(p_text))) DESC, length(i.description) LIMIT 1;
$$;

-- p_lines: [{what, qty}]; p_to: department, person (name or employee no.) or work order number.
CREATE OR REPLACE FUNCTION public.ai_prepare_stock_issue(p_site_ids uuid[], p_lines jsonb, p_to text, p_store text DEFAULT NULL, p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _site uuid := p_site_ids[1]; _wh warehouses%ROWTYPE; _l jsonb; _it items%ROWTYPE; _free numeric; _out jsonb := '[]'; _missing jsonb := '[]';
        _dept departments%ROWTYPE; _emp employees%ROWTYPE; _wo fleet_work_orders%ROWTYPE; _to text := trim(COALESCE(p_to, '')); _val numeric := 0;
BEGIN
  IF _site IS NULL THEN RETURN jsonb_build_object('error', 'Say which site'); END IF;
  IF NOT _has_permission('inventory.create', _site) THEN RETURN jsonb_build_object('error', 'You cannot issue stock at this site'); END IF;
  _wh := _ai_find_store(_site, p_store);
  IF _wh.id IS NULL THEN RETURN jsonb_build_object('error', 'No store matching "' || COALESCE(p_store, '') || '" at this site'); END IF;
  IF _to = '' THEN RETURN jsonb_build_object('error', 'Say who the stock is for — a department, a person or a work order'); END IF;
  SELECT * INTO _wo FROM fleet_work_orders WHERE site_id = _site AND upper(work_order_number) = upper(_to) LIMIT 1;
  IF _wo.id IS NULL THEN SELECT * INTO _dept FROM departments WHERE site_id = _site AND name ILIKE '%' || _to || '%' ORDER BY length(name) LIMIT 1; END IF;
  IF _wo.id IS NULL AND _dept.id IS NULL THEN
    SELECT * INTO _emp FROM employees WHERE site_id = _site AND status = 'active'
       AND (name ILIKE '%' || _to || '%' OR employee_number ILIKE _to) ORDER BY length(name) LIMIT 1;
  END IF;
  IF _wo.id IS NULL AND _dept.id IS NULL AND _emp.id IS NULL THEN
    RETURN jsonb_build_object('error', 'No department, person or work order matching "' || _to || '"'); END IF;
  FOR _l IN SELECT * FROM jsonb_array_elements(COALESCE(p_lines, '[]')) LOOP
    _it := _ai_find_item(_l->>'what');
    IF _it.id IS NULL THEN _missing := _missing || to_jsonb(_l->>'what'); CONTINUE; END IF;
    SELECT COALESCE(sb.on_hand_qty, 0) - _inv_reserved(_it.id, _wh.id, _wo.id) INTO _free FROM (SELECT 1) x
      LEFT JOIN stock_balances sb ON sb.item_id = _it.id AND sb.warehouse_id = _wh.id;
    IF NOT _it.is_kit AND COALESCE(_free, 0) < COALESCE((_l->>'qty')::numeric, 1) THEN
      RETURN jsonb_build_object('error', 'Only ' || GREATEST(COALESCE(_free, 0), 0) || ' ' || _it.description || ' free in ' || _wh.name);
    END IF;
    _out := _out || jsonb_build_object('item_id', _it.id, 'what', _it.item_code || ' — ' || _it.description, 'qty', COALESCE((_l->>'qty')::numeric, 1),
              'unit', (SELECT abbreviation FROM units_of_measure WHERE id = _it.uom_id), 'free', _free);
    _val := _val + COALESCE((_l->>'qty')::numeric, 1) * COALESCE(NULLIF((SELECT valuation_rate FROM stock_balances WHERE item_id = _it.id AND warehouse_id = _wh.id), 0), _it.average_cost, 0);
  END LOOP;
  IF jsonb_array_length(_missing) > 0 THEN RETURN jsonb_build_object('error', 'Not found in the item list: ' || (SELECT string_agg(x, ', ') FROM jsonb_array_elements_text(_missing) x)); END IF;
  IF jsonb_array_length(_out) = 0 THEN RETURN jsonb_build_object('error', 'Say what to issue and how many'); END IF;
  RETURN jsonb_build_object('site_id', _site, 'warehouse_id', _wh.id, 'store', _wh.name, 'lines', _out, 'value', round(_val, 2),
    'department_id', _dept.id, 'employee_id', _emp.id, 'work_order_id', _wo.id,
    'to', COALESCE('work order ' || _wo.work_order_number, _dept.name, _emp.name), 'notes', NULLIF(trim(p_notes), ''));
END $$;

CREATE OR REPLACE FUNCTION public.ai_prepare_stock_transfer(p_site_ids uuid[], p_lines jsonb, p_to_store text, p_from_store text DEFAULT NULL, p_vehicle text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _site uuid := p_site_ids[1]; _f warehouses%ROWTYPE; _t record; _l jsonb; _it items%ROWTYPE; _free numeric; _out jsonb := '[]'; _val numeric := 0;
BEGIN
  IF _site IS NULL THEN RETURN jsonb_build_object('error', 'Say which site it leaves from'); END IF;
  IF NOT _has_permission('inventory.create', _site) THEN RETURN jsonb_build_object('error', 'You cannot send stock from this site'); END IF;
  _f := _ai_find_store(_site, p_from_store);
  IF _f.id IS NULL THEN RETURN jsonb_build_object('error', 'No store matching "' || COALESCE(p_from_store, '') || '" here'); END IF;
  SELECT w.id, w.name, s.name site INTO _t FROM warehouses w JOIN sites s ON s.id = w.site_id
   WHERE w.is_active AND w.id <> _f.id AND (w.name ILIKE '%' || trim(p_to_store) || '%' OR s.name ILIKE '%' || trim(p_to_store) || '%')
   ORDER BY (w.type = 'main') DESC, length(w.name) LIMIT 1;
  IF _t.id IS NULL THEN RETURN jsonb_build_object('error', 'No store or site matching "' || COALESCE(p_to_store, '') || '"'); END IF;
  FOR _l IN SELECT * FROM jsonb_array_elements(COALESCE(p_lines, '[]')) LOOP
    _it := _ai_find_item(_l->>'what');
    IF _it.id IS NULL THEN RETURN jsonb_build_object('error', 'Not found in the item list: ' || (_l->>'what')); END IF;
    SELECT COALESCE(sb.on_hand_qty, 0) - _inv_reserved(_it.id, _f.id) INTO _free FROM (SELECT 1) x
      LEFT JOIN stock_balances sb ON sb.item_id = _it.id AND sb.warehouse_id = _f.id;
    IF NOT _it.is_kit AND COALESCE(_free, 0) < COALESCE((_l->>'qty')::numeric, 1) THEN
      RETURN jsonb_build_object('error', 'Only ' || GREATEST(COALESCE(_free, 0), 0) || ' ' || _it.description || ' free in ' || _f.name);
    END IF;
    _out := _out || jsonb_build_object('item_id', _it.id, 'what', _it.item_code || ' — ' || _it.description, 'qty', COALESCE((_l->>'qty')::numeric, 1),
              'unit', (SELECT abbreviation FROM units_of_measure WHERE id = _it.uom_id));
    _val := _val + COALESCE((_l->>'qty')::numeric, 1) * COALESCE(NULLIF((SELECT valuation_rate FROM stock_balances WHERE item_id = _it.id AND warehouse_id = _f.id), 0), _it.average_cost, 0);
  END LOOP;
  IF jsonb_array_length(_out) = 0 THEN RETURN jsonb_build_object('error', 'Say what to send and how many'); END IF;
  RETURN jsonb_build_object('site_id', _site, 'from_warehouse_id', _f.id, 'from', _f.name, 'to_warehouse_id', _t.id, 'to', _t.name || ' (' || _t.site || ')',
    'lines', _out, 'value', round(_val, 2), 'vehicle', NULLIF(trim(p_vehicle), ''));
END $$;

GRANT EXECUTE ON FUNCTION ai_prepare_stock_issue(uuid[], jsonb, text, text, text), ai_prepare_stock_transfer(uuid[], jsonb, text, text, text) TO authenticated;

-- ── Confirm ───────────────────────────────────────────────────────────────────
DO $$ DECLARE d text; BEGIN
  d := pg_get_functiondef('ai_action_confirm(uuid)'::regprocedure);
  IF position('stock_issue' in d) = 0 THEN
    d := replace(d, '  END IF;
  _res := _res || jsonb_build_object(''site_id'', _a.site_id);',
'  ELSIF _a.kind = ''stock_issue'' THEN
    _res := inv_issue(jsonb_build_object(''warehouse_id'', _p->>''warehouse_id'', ''department_id'', _p->>''department_id'', ''employee_id'', _p->>''employee_id'',
      ''work_order_id'', _p->>''work_order_id'', ''notes'', COALESCE(_p->>''notes'', ''Issued via Ask Bravura''),
      ''lines'', (SELECT jsonb_agg(jsonb_build_object(''item_id'', l->>''item_id'', ''qty'', l->>''qty'')) FROM jsonb_array_elements(_p->''lines'') l)));
    _res := jsonb_build_object(''message'', ''Issued '' || (_res->>''voucher'') || '' to '' || (_p->>''to'') || '' — $'' || to_char((_res->>''value'')::numeric, ''FM999,999,990.00''),
      ''path'', ''/inventory/inv_issues'');
  ELSIF _a.kind = ''stock_transfer'' THEN
    _res := inv_dispatch(jsonb_build_object(''from_warehouse_id'', _p->>''from_warehouse_id'', ''to_warehouse_id'', _p->>''to_warehouse_id'',
      ''vehicle'', _p->>''vehicle'', ''notes'', ''Sent via Ask Bravura'',
      ''lines'', (SELECT jsonb_agg(jsonb_build_object(''item_id'', l->>''item_id'', ''qty'', l->>''qty'')) FROM jsonb_array_elements(_p->''lines'') l)));
    _res := jsonb_build_object(''message'', (_res->>''shipment'') || '' dispatched to '' || (_p->>''to'') || '' — in transit until they receive it'',
      ''path'', ''/inventory/inv_transfers'');
  END IF;
  _res := _res || jsonb_build_object(''site_id'', _a.site_id);');
    EXECUTE d;
  END IF;
END $$;

-- ── Stock alerts ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._ai_alerts_stock(p_sites uuid[])
RETURNS TABLE(key text, site_id uuid, kind text, perm text, severity text, title text, detail text, link text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  -- Reads the tables directly (the 04:30 job runs with nobody signed in, so inv_position's access check would hide everything).
  SELECT 'stockout:' || i.id || ':' || w.id || ':' || to_char(current_date, 'IYYY-IW'), w.site_id, 'stock_out', 'inventory.view', 'warning',
         'Out of stock: ' || i.description, w.name || ' — reorder at ' || COALESCE(st.reorder_level, st.min_qty, i.reorder_level), '/inventory/inv_position'
    FROM items i JOIN warehouses w ON w.site_id = ANY (p_sites) AND w.is_active
    LEFT JOIN item_store_settings st ON st.item_id = i.id AND st.warehouse_id = w.id
    LEFT JOIN stock_balances sb ON sb.item_id = i.id AND sb.warehouse_id = w.id
   WHERE NOT COALESCE(i.is_archived, false) AND NOT i.is_kit AND COALESCE(st.reorder_level, st.min_qty, i.reorder_level, 0) > 0
     AND (st.item_id IS NOT NULL OR sb.item_id IS NOT NULL) AND COALESCE(sb.on_hand_qty, 0) <= 0
  UNION ALL
  SELECT 'ship:' || s.id, s.to_site_id, 'shipment_late', 'inventory.view', 'warning',
         s.shipment_no || ' still on the road', 'Sent ' || to_char(s.dispatched_at, 'DD Mon') || ' from ' || f.name || ' to ' || t.name || ' — ' || (current_date - s.dispatched_at::date) || ' days',
         '/inventory/inv_transfers'
    FROM inv_shipments s JOIN warehouses f ON f.id = s.from_warehouse_id JOIN warehouses t ON t.id = s.to_warehouse_id
   WHERE s.status = 'in_transit' AND s.dispatched_at < now() - interval '5 days' AND (s.to_site_id = ANY (p_sites) OR s.from_site_id = ANY (p_sites))
  UNION ALL
  SELECT 'count:' || t.id, w.site_id, 'count_variance', 'inventory.approve', 'warning',
         'Count ' || COALESCE(t.reference, '') || ' was off by $' || to_char(abs(t.variance_value), 'FM999,999,990.00'),
         w.name || ' — ' || round(100 * abs(t.variance_value) / NULLIF(t.counted_value, 0), 1) || '% of the counted value', '/inventory/inv_stock_take'
    FROM stock_takes t JOIN warehouses w ON w.id = t.warehouse_id
   WHERE w.site_id = ANY (p_sites) AND t.status = 'completed' AND t.completed_at >= now() - interval '7 days'
     AND t.counted_value > 0 AND abs(t.variance_value) > 0.05 * t.counted_value
  UNION ALL
  SELECT 'expiry:' || b.id, w.site_id, 'batch_expiry', 'inventory.view', 'warning',
         'Expires ' || to_char(b.expiry_date, 'DD Mon') || ': ' || i.description, b.qty_remaining || ' left in batch ' || b.batch_no || ' at ' || w.name,
         '/inventory/inv_reorder'
    FROM inventory_batches b JOIN items i ON i.id = b.item_id JOIN warehouses w ON w.id = b.warehouse_id
   WHERE w.site_id = ANY (p_sites) AND b.qty_remaining > 0 AND NOT b.is_archived AND b.expiry_date <= current_date + 14;
$$;

-- Keep the existing alerts as the base and add the stock ones (everything that calls _ai_alerts_core gets both).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = '_ai_alerts_base') THEN
    ALTER FUNCTION _ai_alerts_core(uuid[]) RENAME TO _ai_alerts_base;
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public._ai_alerts_core(p_sites uuid[])
RETURNS TABLE(key text, site_id uuid, kind text, perm text, severity text, title text, detail text, link text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM _ai_alerts_base(p_sites) UNION ALL SELECT * FROM _ai_alerts_stock(p_sites);
$$;

INSERT INTO schema_migrations (filename) VALUES ('0237_inventory_i6_ask_bravura_stores.sql') ON CONFLICT DO NOTHING;
