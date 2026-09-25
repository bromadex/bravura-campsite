-- 0235 — Inventory I4 (issue #59): stores dashboard + phone scanning.
--  • inv_home(site_ids): everything the Stores dashboard (IN01) shows — what needs attention today, headline figures
--    (value, issued this month, days of cover, dead stock, count accuracy), 6-month trend, issued by department,
--    reorder-now list, ABC split, expiring batches and the latest moves. One call, site-scoped by inventory.view.
--  • inv_scan(code, site): a scanned barcode / item code / bin label → the item (with stock per store at the site)
--    or the bin (with what is placed in it).

CREATE OR REPLACE FUNCTION public.inv_home(p_site_ids uuid[]) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _sites uuid[]; _m0 date := date_trunc('month', current_date)::date; _out jsonb := '{}';
  _value numeric; _value_m0 numeric; _issued_m numeric; _issued_30 numeric; _depts int; _dead numeric; _acc numeric;
BEGIN
  SELECT array_agg(s) INTO _sites FROM unnest(p_site_ids) s WHERE _has_permission('inventory.view', s) OR _has_permission('procurement.view', s);
  IF _sites IS NULL THEN RETURN jsonb_build_object('error', 'No access to stores at these sites'); END IF;

  CREATE TEMP TABLE IF NOT EXISTS _ih_pos ON COMMIT DROP AS SELECT * FROM inv_position(_sites) WITH NO DATA;
  TRUNCATE _ih_pos; INSERT INTO _ih_pos SELECT * FROM inv_position(_sites);

  SELECT COALESCE(sum(value), 0) INTO _value FROM _ih_pos;
  SELECT _value - COALESCE(sum(value), 0) INTO _value_m0 FROM inventory_movements WHERE site_id = ANY (_sites) AND created_at >= _m0;
  SELECT COALESCE(-sum(value), 0), count(DISTINCT department_id) INTO _issued_m, _depts
    FROM inventory_movements WHERE site_id = ANY (_sites) AND movement_type = 'issue' AND created_at >= _m0;
  SELECT COALESCE(-sum(value), 0) INTO _issued_30 FROM inventory_movements WHERE site_id = ANY (_sites) AND movement_type IN ('issue','return') AND created_at >= now() - interval '30 days';
  SELECT COALESCE(sum(b.stock_value), 0) INTO _dead FROM stock_balances b JOIN warehouses w ON w.id = b.warehouse_id
   WHERE w.site_id = ANY (_sites) AND b.on_hand_qty > 0
     AND NOT EXISTS (SELECT 1 FROM inventory_movements m WHERE m.item_id = b.item_id AND m.warehouse_id = b.warehouse_id AND m.created_at >= now() - interval '180 days' AND m.quantity < 0)
     AND NOT EXISTS (SELECT 1 FROM inventory_movements m WHERE m.item_id = b.item_id AND m.warehouse_id = b.warehouse_id AND m.created_at >= now() - interval '180 days' AND m.quantity > 0);
  SELECT CASE WHEN sum(t.counted_value) > 0 THEN round(100 * (1 - sum(abs(COALESCE(t.variance_value, 0))) / sum(t.counted_value)), 1) END INTO _acc
    FROM stock_takes t JOIN warehouses w ON w.id = t.warehouse_id WHERE w.site_id = ANY (_sites) AND t.status = 'completed' AND t.completed_at >= now() - interval '90 days';

  _out := jsonb_build_object(
    'attention', jsonb_build_object(
      'out_of_stock', (SELECT count(*) FROM _ih_pos WHERE COALESCE(reorder_at, 0) > 0 AND available <= 0),
      'below_reorder', (SELECT count(*) FROM _ih_pos WHERE COALESCE(reorder_at, 0) > 0 AND available + on_order + in_transit <= reorder_at),
      'expiring', (SELECT count(*) FROM inventory_batches b JOIN warehouses w ON w.id = b.warehouse_id
                    WHERE w.site_id = ANY (_sites) AND b.qty_remaining > 0 AND NOT b.is_archived AND b.expiry_date <= current_date + 30),
      'requests_to_issue', (SELECT count(DISTINCT r.id) FROM purchase_requisitions r JOIN requisition_lines l ON l.requisition_id = r.id
                    WHERE r.site_id = ANY (_sites) AND r.status = 'approved' AND r.request_type = 'buy' AND NOT l.is_archived AND l.item_id IS NOT NULL
                      AND COALESCE(l.issued_qty, 0) + COALESCE(l.ordered_qty, 0) < l.quantity
                      AND EXISTS (SELECT 1 FROM stock_balances sb JOIN warehouses w ON w.id = sb.warehouse_id WHERE sb.item_id = l.item_id AND w.site_id = r.site_id AND sb.on_hand_qty > 0)),
      'arriving', (SELECT count(*) FROM inv_shipments WHERE to_site_id = ANY (_sites) AND status = 'in_transit'),
      'counts_open', (SELECT count(*) FROM stock_takes t JOIN warehouses w ON w.id = t.warehouse_id WHERE w.site_id = ANY (_sites) AND t.status IN ('draft','in_progress')),
      'reserved_value', (SELECT round(COALESCE(sum(CASE WHEN on_hand > 0 THEN reserved * value / on_hand END), 0), 2) FROM _ih_pos)),
    'kpi', jsonb_build_object(
      'value', round(_value, 2), 'value_month_start', round(_value_m0, 2),
      'issued_month', round(_issued_m, 2), 'issued_departments', _depts,
      'days_cover', CASE WHEN _issued_30 > 0 THEN round(_value / (_issued_30 / 30)) END,
      'dead_stock', round(_dead, 2), 'count_accuracy', _acc,
      'items', (SELECT count(DISTINCT item_id) FROM _ih_pos WHERE on_hand > 0),
      'stores', (SELECT count(*) FROM warehouses WHERE site_id = ANY (_sites) AND is_active)),
    'trend', (SELECT jsonb_agg(jsonb_build_object('month', to_char(m, 'Mon'),
                'issued', round(COALESCE((SELECT -sum(value) FROM inventory_movements WHERE site_id = ANY (_sites) AND movement_type = 'issue'
                                             AND created_at >= m AND created_at < m + interval '1 month'), 0), 2),
                'received', round(COALESCE((SELECT sum(value) FROM inventory_movements WHERE site_id = ANY (_sites) AND movement_type IN ('grn','opening')
                                             AND created_at >= m AND created_at < m + interval '1 month'), 0), 2),
                'value_end', round(_value - COALESCE((SELECT sum(value) FROM inventory_movements WHERE site_id = ANY (_sites) AND created_at >= m + interval '1 month'), 0), 2))
                ORDER BY m)
              FROM generate_series(_m0 - interval '5 months', _m0, interval '1 month') m),
    'by_department', (SELECT COALESCE(jsonb_agg(x ORDER BY x.value DESC), '[]') FROM (
                SELECT COALESCE(d.name, CASE WHEN m.source_module = 'fleet' THEN 'Fleet work orders' ELSE 'Other' END) name, round(-sum(m.value), 2) value
                  FROM inventory_movements m LEFT JOIN departments d ON d.id = m.department_id
                 WHERE m.site_id = ANY (_sites) AND m.movement_type = 'issue' AND m.created_at >= _m0 GROUP BY 1 ORDER BY 2 DESC LIMIT 8) x),
    'reorder', (SELECT COALESCE(jsonb_agg(x), '[]') FROM (
                SELECT item_id, item_code, description, warehouse, available, reorder_at, on_order, in_transit, unit FROM _ih_pos
                 WHERE COALESCE(reorder_at, 0) > 0 AND available + on_order + in_transit <= reorder_at
                 ORDER BY (available <= 0) DESC, available / NULLIF(reorder_at, 0), description LIMIT 10) x),
    'abc', (SELECT jsonb_agg(jsonb_build_object('class', cls, 'items', n, 'value', v) ORDER BY cls) FROM (
                SELECT cls, count(*) n, round(sum(used), 2) v FROM (
                  SELECT item_id, used, CASE WHEN cum_before < 0.7 THEN 'A' WHEN cum_before < 0.9 THEN 'B' ELSE 'C' END cls FROM (
                    SELECT item_id, used, (sum(used) OVER (ORDER BY used DESC, item_id) - used) / NULLIF(sum(used) OVER (), 0) cum_before FROM (
                      SELECT item_id, -sum(value) used FROM inventory_movements WHERE site_id = ANY (_sites) AND movement_type = 'issue'
                         AND created_at >= now() - interval '12 months' GROUP BY 1 HAVING -sum(value) > 0) u) c) k GROUP BY cls) z),
    'expiring', (SELECT COALESCE(jsonb_agg(x), '[]') FROM (
                SELECT i.description, b.batch_no, b.qty_remaining qty, b.expiry_date, w.name warehouse FROM inventory_batches b
                  JOIN items i ON i.id = b.item_id JOIN warehouses w ON w.id = b.warehouse_id
                 WHERE w.site_id = ANY (_sites) AND b.qty_remaining > 0 AND NOT b.is_archived AND b.expiry_date <= current_date + 60
                 ORDER BY b.expiry_date LIMIT 6) x),
    'latest', (SELECT COALESCE(jsonb_agg(x), '[]') FROM (
                SELECT m.created_at, m.movement_type, m.voucher_no, i.description, m.quantity, m.value, w.name warehouse, d.name department
                  FROM inventory_movements m JOIN items i ON i.id = m.item_id JOIN warehouses w ON w.id = m.warehouse_id LEFT JOIN departments d ON d.id = m.department_id
                 WHERE m.site_id = ANY (_sites) ORDER BY m.created_at DESC LIMIT 8) x)
  );
  RETURN _out;
END $$;

-- A scan: "BIN:<store code or name>:<bin>" → bin; otherwise barcode / item code / part number → item.
CREATE OR REPLACE FUNCTION public.inv_scan(p_code text, p_site_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _c text := trim(COALESCE(p_code, '')); _parts text[]; _bin record; _item items%ROWTYPE;
BEGIN
  IF NOT (_has_permission('inventory.view', p_site_id) OR _has_permission('procurement.view', p_site_id)) THEN
    RETURN jsonb_build_object('error', 'No access to stores at this site'); END IF;
  IF _c = '' THEN RETURN jsonb_build_object('error', 'Nothing scanned'); END IF;
  IF upper(_c) LIKE 'BIN:%' THEN
    _parts := string_to_array(_c, ':');
    SELECT b.id, b.code, b.name, w.id wid, w.name wname INTO _bin FROM warehouse_bins b JOIN warehouses w ON w.id = b.warehouse_id
     WHERE w.site_id = p_site_id AND NOT b.is_archived AND upper(b.code) = upper(_parts[3])
       AND (upper(COALESCE(w.code, '')) = upper(_parts[2]) OR upper(w.name) = upper(_parts[2])) LIMIT 1;
    IF _bin.id IS NULL THEN RETURN jsonb_build_object('error', 'That bin is not at this site'); END IF;
    RETURN jsonb_build_object('kind', 'bin', 'bin', jsonb_build_object('id', _bin.id, 'code', _bin.code, 'name', _bin.name, 'warehouse_id', _bin.wid, 'warehouse', _bin.wname),
      'items', (SELECT COALESCE(jsonb_agg(jsonb_build_object('item_id', i.id, 'item_code', i.item_code, 'description', i.description,
                  'on_hand', COALESCE(sb.on_hand_qty, 0)) ORDER BY i.description), '[]')
                  FROM item_store_settings s JOIN items i ON i.id = s.item_id
                  LEFT JOIN stock_balances sb ON sb.item_id = s.item_id AND sb.warehouse_id = s.warehouse_id
                 WHERE s.bin_id = _bin.id));
  END IF;
  SELECT * INTO _item FROM items WHERE NOT COALESCE(is_archived, false)
     AND (barcode = _c OR upper(item_code) = upper(_c) OR upper(part_number) = upper(_c)) ORDER BY (barcode = _c) DESC LIMIT 1;
  IF _item.id IS NULL THEN RETURN jsonb_build_object('error', 'No item with code "' || _c || '"'); END IF;
  RETURN jsonb_build_object('kind', 'item', 'item', jsonb_build_object('id', _item.id, 'item_code', _item.item_code, 'description', _item.description,
      'unit', (SELECT abbreviation FROM units_of_measure WHERE id = _item.uom_id), 'average_cost', _item.average_cost),
    'stores', (SELECT COALESCE(jsonb_agg(jsonb_build_object('warehouse_id', warehouse_id, 'warehouse', warehouse, 'on_hand', on_hand, 'reserved', reserved,
                 'available', available, 'on_order', on_order, 'in_transit', in_transit, 'bin', bin, 'reorder_at', reorder_at)), '[]')
                 FROM inv_position(ARRAY[p_site_id]) WHERE item_id = _item.id));
END $$;

REVOKE ALL ON FUNCTION inv_home(uuid[]), inv_scan(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION inv_home(uuid[]), inv_scan(text, uuid) TO authenticated;

INSERT INTO schema_migrations (filename) VALUES ('0235_inventory_i4_home_scan.sql') ON CONFLICT DO NOTHING;
