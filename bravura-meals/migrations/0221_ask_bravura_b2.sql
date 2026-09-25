-- 0221 — Ask Bravura B2 (issue #58): read-only ai_* functions for every module + ai_find.
-- Each runs as the asking user and only covers sites where they hold that module's view permission.

CREATE OR REPLACE FUNCTION public._ai_sites_for(p_perm text, p_site_ids uuid[]) RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT array_agg(s.id) FROM sites s
   WHERE (p_site_ids IS NULL OR cardinality(p_site_ids) = 0 OR s.id = ANY(p_site_ids))
     AND _has_permission(p_perm, s.id);
$$;

-- Fuel: litres issued/delivered, top users, daily trend, tank levels.
CREATE OR REPLACE FUNCTION public.ai_fuel(p_site_ids uuid[], p_from date, p_to date, p_search text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _s uuid[] := _ai_sites_for('fuel.view', p_site_ids); _q text := '%' || COALESCE(trim(p_search), '') || '%';
BEGIN
  IF _s IS NULL THEN RETURN jsonb_build_object('error', 'You have no fuel access to those sites'); END IF;
  RETURN (WITH t AS (
      SELECT ft.transaction_type tt, ft.litres, ft.total_cost, ft.transaction_date d, ft.transaction_number,
             COALESCE(concat_ws(' ', COALESCE(fa.fleet_number, fa.asset_number), fa.registration, fa.make, fa.model), ft.asset_description, '(no vehicle)') who, s.name site
        FROM fuel_transactions ft JOIN sites s ON s.id = ft.site_id LEFT JOIN fleet_assets fa ON fa.id = ft.fleet_asset_id
       WHERE ft.site_id = ANY(_s) AND NOT COALESCE(ft.is_deleted, false) AND ft.transaction_date BETWEEN p_from AND p_to
         AND (p_search IS NULL OR trim(p_search) = '' OR fa.fleet_number ILIKE _q OR fa.registration ILIKE _q OR fa.description ILIKE _q
              OR fa.make ILIKE _q OR fa.model ILIKE _q OR ft.asset_description ILIKE _q))
    SELECT jsonb_build_object('from', p_from, 'to', p_to, 'filter', p_search,
      'litres_issued', COALESCE((SELECT sum(litres) FROM t WHERE tt = 'issuance'), 0),
      'issues', (SELECT count(*) FROM t WHERE tt = 'issuance'),
      'litres_delivered', COALESCE((SELECT sum(litres) FROM t WHERE tt = 'delivery'), 0),
      'cost_recorded', COALESCE((SELECT round(sum(total_cost), 2) FROM t), 0),
      'top_users', COALESCE((SELECT jsonb_agg(x) FROM (SELECT jsonb_build_object('vehicle', who, 'litres', sum(litres), 'issues', count(*)) x
          FROM t WHERE tt = 'issuance' GROUP BY who ORDER BY sum(litres) DESC LIMIT 10) q), '[]'),
      'by_day', COALESCE((SELECT jsonb_agg(x ORDER BY d) FROM (SELECT d, jsonb_build_object('date', d, 'litres', sum(litres)) x
          FROM t WHERE tt = 'issuance' GROUP BY d) q), '[]'),
      'tanks', COALESCE((SELECT jsonb_agg(jsonb_build_object('tank', tk.name, 'site', s.name, 'litres_now', tk.current_level_litres,
          'capacity', tk.capacity_litres, 'low', tk.current_level_litres < COALESCE(tk.min_threshold_litres, 0), 'last_dip', tk.last_dip_date))
          FROM fuel_tanks tk JOIN sites s ON s.id = tk.site_id WHERE tk.site_id = ANY(_s) AND NOT COALESCE(tk.is_archived, false)), '[]')));
END $$;

-- Fleet: status counts, open work orders, services and papers coming due, maintenance in period.
CREATE OR REPLACE FUNCTION public.ai_fleet(p_site_ids uuid[], p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _s uuid[] := _ai_sites_for('fleet.view', p_site_ids);
BEGIN
  IF _s IS NULL THEN RETURN jsonb_build_object('error', 'You have no fleet access to those sites'); END IF;
  RETURN jsonb_build_object('from', p_from, 'to', p_to,
    'assets_by_status', (SELECT jsonb_object_agg(COALESCE(status, '?'), n) FROM (SELECT status, count(*) n FROM fleet_assets WHERE site_id = ANY(_s) AND NOT COALESCE(is_archived, false) GROUP BY status) q),
    'open_work_orders', COALESCE((SELECT jsonb_agg(x) FROM (SELECT jsonb_build_object('wo', w.work_order_number, 'asset', COALESCE(fa.fleet_number, fa.registration), 'fault', left(w.fault_description, 80), 'priority', w.priority, 'status', w.status, 'opened', w.created_at::date) x
        FROM fleet_work_orders w LEFT JOIN fleet_assets fa ON fa.id = w.asset_id WHERE w.site_id = ANY(_s) AND COALESCE(w.status, '') NOT IN ('completed','closed','cancelled') ORDER BY w.created_at LIMIT 15) q), '[]'),
    'service_due_14_days', COALESCE((SELECT jsonb_agg(x) FROM (SELECT DISTINCT ON (m.asset_id) jsonb_build_object('asset', fa.fleet_number, 'due', m.next_service_due_date) x
        FROM fleet_maintenance m JOIN fleet_assets fa ON fa.id = m.asset_id WHERE m.site_id = ANY(_s) AND m.next_service_due_date <= CURRENT_DATE + 14
        ORDER BY m.asset_id, m.service_date DESC) q), '[]'),
    'papers_expiring_30_days', COALESCE((SELECT jsonb_agg(jsonb_build_object('asset', COALESCE(fleet_number, registration), 'licence', licence_expiry, 'insurance', insurance_expiry, 'roadworthy', roadworthy_expiry))
        FROM fleet_assets WHERE site_id = ANY(_s) AND NOT COALESCE(is_archived, false)
         AND LEAST(licence_expiry, insurance_expiry, roadworthy_expiry) <= CURRENT_DATE + 30), '[]'),
    'maintenance_in_period', (SELECT jsonb_build_object('jobs', count(*), 'actual_cost', COALESCE(round(sum(actual_cost), 2), 0), 'downtime_hours', COALESCE(sum(downtime_hours), 0))
        FROM fleet_maintenance WHERE site_id = ANY(_s) AND service_date BETWEEN p_from AND p_to));
END $$;

-- Stores: stock of matching items per store, or (no search) items at/below reorder level.
CREATE OR REPLACE FUNCTION public.ai_stock(p_site_ids uuid[], p_search text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _s uuid[] := _ai_sites_for('inventory.view', p_site_ids); _q text := '%' || COALESCE(trim(p_search), '') || '%';
BEGIN
  IF _s IS NULL THEN RETURN jsonb_build_object('error', 'You have no stores access to those sites'); END IF;
  IF p_search IS NOT NULL AND trim(p_search) <> '' THEN
    RETURN jsonb_build_object('search', p_search, 'items', COALESCE((SELECT jsonb_agg(x) FROM (
      SELECT jsonb_build_object('code', i.item_code, 'item', i.description, 'store', w.name, 'site', s.name, 'on_hand', b.on_hand_qty,
             'value', round(b.stock_value, 2), 'reorder_level', i.reorder_level) x
        FROM items i JOIN stock_balances b ON b.item_id = i.id JOIN warehouses w ON w.id = b.warehouse_id JOIN sites s ON s.id = w.site_id
       WHERE w.site_id = ANY(_s) AND NOT COALESCE(i.is_archived, false)
         AND (i.description ILIKE _q OR i.item_code ILIKE _q OR i.part_number ILIKE _q) ORDER BY i.description LIMIT 25) q), '[]'));
  END IF;
  RETURN jsonb_build_object('stock_value', (SELECT round(COALESCE(sum(b.stock_value), 0), 2) FROM stock_balances b JOIN warehouses w ON w.id = b.warehouse_id WHERE w.site_id = ANY(_s)),
    'low_stock', COALESCE((SELECT jsonb_agg(x) FROM (
      SELECT jsonb_build_object('code', i.item_code, 'item', i.description, 'on_hand', sum(b.on_hand_qty), 'reorder_level', i.reorder_level) x
        FROM items i JOIN stock_balances b ON b.item_id = i.id JOIN warehouses w ON w.id = b.warehouse_id
       WHERE w.site_id = ANY(_s) AND NOT COALESCE(i.is_archived, false) AND COALESCE(i.reorder_level, 0) > 0
       GROUP BY i.id HAVING sum(b.on_hand_qty) <= i.reorder_level ORDER BY i.description LIMIT 25) q), '[]'));
END $$;

-- People: headcount by department, who is on leave, pending leave, attendance in period.
CREATE OR REPLACE FUNCTION public.ai_people(p_site_ids uuid[], p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _s uuid[] := _ai_sites_for('hr.view', p_site_ids);
BEGIN
  IF _s IS NULL THEN RETURN jsonb_build_object('error', 'You have no HR access to those sites'); END IF;
  RETURN jsonb_build_object('from', p_from, 'to', p_to,
    'active_employees', (SELECT count(*) FROM employees WHERE site_id = ANY(_s) AND status = 'active' AND NOT COALESCE(is_archived, false)),
    'by_department', COALESCE((SELECT jsonb_object_agg(k, n) FROM (SELECT COALESCE(d.name, '(none)') k, count(*) n FROM employees e LEFT JOIN departments d ON d.id = e.department_id
        WHERE e.site_id = ANY(_s) AND e.status = 'active' AND NOT COALESCE(e.is_archived, false) GROUP BY 1) q), '{}'),
    'on_leave_today', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', e.name, 'type', lt.name, 'until', lr.end_date))
        FROM leave_requests lr JOIN employees e ON e.id = lr.employee_id LEFT JOIN leave_types lt ON lt.id = lr.leave_type_id
       WHERE lr.site_id = ANY(_s) AND lr.status = 'approved' AND CURRENT_DATE BETWEEN lr.start_date AND lr.end_date), '[]'),
    'leave_waiting_approval', (SELECT count(*) FROM leave_requests WHERE site_id = ANY(_s) AND status = 'pending'),
    'attendance', (SELECT jsonb_build_object('records', count(*), 'absent', count(*) FILTER (WHERE is_absent), 'late', count(*) FILTER (WHERE is_late),
        'hours', COALESCE(sum(hours_worked), 0), 'overtime_hours', COALESCE(sum(overtime_hours), 0))
        FROM attendance_logs WHERE site_id = ANY(_s) AND date BETWEEN p_from AND p_to));
END $$;

-- SHEQ: incidents in period, open incidents, open/overdue corrective actions.
CREATE OR REPLACE FUNCTION public.ai_sheq(p_site_ids uuid[], p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _s uuid[] := _ai_sites_for('sheq.view', p_site_ids);
BEGIN
  IF _s IS NULL THEN RETURN jsonb_build_object('error', 'You have no SHEQ access to those sites'); END IF;
  RETURN jsonb_build_object('from', p_from, 'to', p_to,
    'incidents_in_period', COALESCE((SELECT jsonb_agg(x) FROM (SELECT jsonb_build_object('no', incident_number, 'date', incident_date, 'type', incident_type,
        'severity', severity, 'status', status, 'what', left(description, 80), 'days_lost', days_lost) x
        FROM sheq_incidents WHERE site_id = ANY(_s) AND NOT COALESCE(is_archived, false) AND incident_date BETWEEN p_from AND p_to ORDER BY incident_date DESC LIMIT 20) q), '[]'),
    'open_incidents', (SELECT count(*) FROM sheq_incidents WHERE site_id = ANY(_s) AND NOT COALESCE(is_archived, false) AND COALESCE(status, '') NOT IN ('closed','cancelled')),
    'open_actions', (SELECT count(*) FROM sheq_capa WHERE site_id = ANY(_s) AND NOT COALESCE(is_archived, false) AND COALESCE(status, '') NOT IN ('closed','completed','verified','cancelled')),
    'overdue_actions', COALESCE((SELECT jsonb_agg(jsonb_build_object('no', capa_number, 'what', left(description, 80), 'due', due_date, 'priority', priority))
        FROM sheq_capa WHERE site_id = ANY(_s) AND NOT COALESCE(is_archived, false) AND COALESCE(status, '') NOT IN ('closed','completed','verified','cancelled') AND due_date < CURRENT_DATE), '[]'));
END $$;

-- Meals: meals served per day in period (from meal logs of the site's people).
CREATE OR REPLACE FUNCTION public.ai_meals(p_site_ids uuid[], p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _s uuid[] := _ai_sites_for('meals.view', p_site_ids);
BEGIN
  IF _s IS NULL THEN RETURN jsonb_build_object('error', 'You have no meals access to those sites'); END IF;
  RETURN (WITH m AS (SELECT ml.date, COALESCE(ml.had_breakfast, ml.breakfast, false) b, COALESCE(ml.had_lunch, ml.lunch, false) l, COALESCE(ml.had_supper, ml.supper, false) s
                       FROM meal_logs ml JOIN employees e ON e.id = ml.employee_id WHERE e.site_id = ANY(_s) AND ml.date BETWEEN p_from AND p_to)
    SELECT jsonb_build_object('from', p_from, 'to', p_to,
      'breakfasts', count(*) FILTER (WHERE b), 'lunches', count(*) FILTER (WHERE l), 'suppers', count(*) FILTER (WHERE s),
      'by_day', COALESCE((SELECT jsonb_agg(jsonb_build_object('date', date, 'breakfast', bb, 'lunch', ll, 'supper', ss) ORDER BY date) FROM
          (SELECT date, count(*) FILTER (WHERE b) bb, count(*) FILTER (WHERE l) ll, count(*) FILTER (WHERE s) ss FROM m GROUP BY date) d), '[]')) FROM m);
END $$;

-- Camp: rooms, beds, who is checked in.
CREATE OR REPLACE FUNCTION public.ai_camp(p_site_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _s uuid[] := _ai_sites_for('accommodation.view', p_site_ids);
BEGIN
  IF _s IS NULL THEN RETURN jsonb_build_object('error', 'You have no camp access to those sites'); END IF;
  RETURN jsonb_build_object(
    'rooms', (SELECT count(*) FROM camp_rooms WHERE site_id = ANY(_s) AND NOT COALESCE(is_archived, false)),
    'beds', (SELECT count(*) FROM beds WHERE site_id = ANY(_s)),
    'occupied_now', (SELECT count(*) FROM room_assignments WHERE site_id = ANY(_s) AND check_in <= CURRENT_DATE AND (check_out IS NULL OR check_out >= CURRENT_DATE) AND COALESCE(status, 'active') NOT IN ('cancelled','checked_out')),
    'checking_out_7_days', COALESCE((SELECT jsonb_agg(jsonb_build_object('who', COALESCE(e.name, ra.guest_name), 'room', r.room_number, 'out', ra.check_out))
        FROM room_assignments ra LEFT JOIN employees e ON e.id = ra.employee_id LEFT JOIN camp_rooms r ON r.id = ra.room_id
       WHERE ra.site_id = ANY(_s) AND ra.check_out BETWEEN CURRENT_DATE AND CURRENT_DATE + 7 AND COALESCE(ra.status, 'active') NOT IN ('cancelled','checked_out')), '[]'));
END $$;

-- Procurement: what is waiting — requests, POs awaiting approval, late deliveries.
CREATE OR REPLACE FUNCTION public.ai_procurement(p_site_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _s uuid[] := _ai_sites_for('procurement.view', p_site_ids);
BEGIN
  IF _s IS NULL THEN RETURN jsonb_build_object('error', 'You have no procurement access to those sites'); END IF;
  RETURN jsonb_build_object(
    'requests_by_status', (SELECT jsonb_object_agg(status, n) FROM (SELECT status, count(*) n FROM purchase_requisitions WHERE site_id = ANY(_s) AND NOT COALESCE(is_archived, false)
        AND status NOT IN ('cancelled','fulfilled','closed') GROUP BY status) q),
    'pos_by_status', (SELECT jsonb_object_agg(status, n) FROM (SELECT status, count(*) n FROM purchase_orders WHERE site_id = ANY(_s) AND status NOT IN ('cancelled','received') GROUP BY status) q),
    'awaiting_approval', COALESCE((SELECT jsonb_agg(jsonb_build_object('po', po_number, 'amount', total_amount)) FROM purchase_orders WHERE site_id = ANY(_s) AND status = 'pending_approval'), '[]'),
    'late_deliveries', COALESCE((SELECT jsonb_agg(x) FROM (SELECT jsonb_build_object('po', po.po_number, 'supplier', ps.supplier_name, 'due', po.expected_date) x
        FROM purchase_orders po LEFT JOIN procurement_suppliers ps ON ps.id = po.supplier_id
       WHERE po.site_id = ANY(_s) AND po.status IN ('sent','partially_received') AND po.expected_date < CURRENT_DATE ORDER BY po.expected_date LIMIT 15) q), '[]'));
END $$;

-- Find any record by number or name, across the modules the person can see.
CREATE OR REPLACE FUNCTION public.ai_find(p_site_ids uuid[], p_search text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _q text := '%' || trim(COALESCE(p_search, '')) || '%'; _r jsonb := '[]';
  _pr uuid[] := _ai_sites_for('procurement.view', p_site_ids); _fl uuid[] := _ai_sites_for('fleet.view', p_site_ids);
  _hr uuid[] := _ai_sites_for('hr.view', p_site_ids); _iv uuid[] := _ai_sites_for('inventory.view', p_site_ids);
  _sq uuid[] := _ai_sites_for('sheq.view', p_site_ids);
BEGIN
  IF length(trim(COALESCE(p_search, ''))) < 2 THEN RETURN jsonb_build_object('error', 'Say what to look for'); END IF;
  IF _pr IS NOT NULL THEN
    _r := _r || COALESCE((SELECT jsonb_agg(jsonb_build_object('type', 'purchase order', 'ref', po.po_number, 'id', po.id, 'detail', ps.supplier_name || ' · ' || po.status || ' · $' || COALESCE(po.total_amount, 0)))
      FROM (SELECT * FROM purchase_orders WHERE site_id = ANY(_pr) AND po_number ILIKE _q LIMIT 5) po LEFT JOIN procurement_suppliers ps ON ps.id = po.supplier_id), '[]')
      || COALESCE((SELECT jsonb_agg(jsonb_build_object('type', 'request', 'ref', requisition_no, 'id', id, 'detail', COALESCE(title, '') || ' · ' || status))
      FROM (SELECT * FROM purchase_requisitions WHERE site_id = ANY(_pr) AND NOT COALESCE(is_archived, false) AND (requisition_no ILIKE _q OR title ILIKE _q) LIMIT 5) x), '[]')
      || COALESCE((SELECT jsonb_agg(jsonb_build_object('type', 'supplier', 'ref', supplier_name, 'id', id))
      FROM (SELECT * FROM procurement_suppliers WHERE site_id = ANY(_pr) AND supplier_name ILIKE _q LIMIT 5) x), '[]');
  END IF;
  IF _fl IS NOT NULL THEN
    _r := _r || COALESCE((SELECT jsonb_agg(jsonb_build_object('type', 'fleet asset', 'ref', COALESCE(fleet_number, registration, asset_number), 'id', id, 'detail', concat_ws(' ', registration, make, model, '·', status)))
      FROM (SELECT * FROM fleet_assets WHERE site_id = ANY(_fl) AND NOT COALESCE(is_archived, false)
             AND (fleet_number ILIKE _q OR registration ILIKE _q OR description ILIKE _q OR make ILIKE _q OR model ILIKE _q) LIMIT 5) x), '[]');
  END IF;
  IF _hr IS NOT NULL THEN
    _r := _r || COALESCE((SELECT jsonb_agg(jsonb_build_object('type', 'employee', 'ref', employee_number, 'id', id, 'detail', name || ' · ' || COALESCE(position_title, '') || ' · ' || status))
      FROM (SELECT * FROM employees WHERE site_id = ANY(_hr) AND NOT COALESCE(is_archived, false) AND (name ILIKE _q OR employee_number ILIKE _q) LIMIT 5) x), '[]');
  END IF;
  IF _iv IS NOT NULL THEN
    _r := _r || COALESCE((SELECT jsonb_agg(jsonb_build_object('type', 'stock item', 'ref', item_code, 'id', id, 'detail', description))
      FROM (SELECT * FROM items WHERE NOT COALESCE(is_archived, false) AND (item_code ILIKE _q OR description ILIKE _q OR part_number ILIKE _q) LIMIT 5) x), '[]');
  END IF;
  IF _sq IS NOT NULL THEN
    _r := _r || COALESCE((SELECT jsonb_agg(jsonb_build_object('type', 'incident', 'ref', incident_number, 'id', id, 'detail', incident_date || ' · ' || COALESCE(severity, '') || ' · ' || left(description, 60)))
      FROM (SELECT * FROM sheq_incidents WHERE site_id = ANY(_sq) AND NOT COALESCE(is_archived, false) AND (incident_number ILIKE _q OR description ILIKE _q) LIMIT 5) x), '[]');
  END IF;
  RETURN jsonb_build_object('search', p_search, 'results', _r);
END $$;

REVOKE ALL ON FUNCTION _ai_sites_for(text, uuid[]), ai_fuel(uuid[], date, date, text), ai_fleet(uuid[], date, date), ai_stock(uuid[], text),
  ai_people(uuid[], date, date), ai_sheq(uuid[], date, date), ai_meals(uuid[], date, date), ai_camp(uuid[]), ai_procurement(uuid[]),
  ai_find(uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION ai_fuel(uuid[], date, date, text), ai_fleet(uuid[], date, date), ai_stock(uuid[], text),
  ai_people(uuid[], date, date), ai_sheq(uuid[], date, date), ai_meals(uuid[], date, date), ai_camp(uuid[]), ai_procurement(uuid[]),
  ai_find(uuid[], text) TO authenticated;

INSERT INTO schema_migrations (filename) VALUES ('0221_ask_bravura_b2.sql') ON CONFLICT DO NOTHING;
