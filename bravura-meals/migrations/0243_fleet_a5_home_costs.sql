-- 0243 — Fleet A5 (#66): fleet dashboard (finance look) + cost per machine.
--  • fleet_machine_costs(site, from, to): per machine — fuel (litres, $), parts from Stores to its jobs, workshop bills on
--    POs linked to its jobs, hours and km run (from unflagged meter readings), cost per hour / per km, book value, and
--    lifetime cost of ownership = purchase cost + all running costs − book value (book value stands in for resale).
--  • fleet_home(site): "needs you today" chips, headline figures, a board of every machine, service due list.

CREATE OR REPLACE FUNCTION public.fleet_machine_costs(p_site_id uuid, p_from date, p_to date) RETURNS TABLE
  (asset_id uuid, machine text, machine_type text, status text, fuel_litres numeric, fuel_cost numeric, parts_cost numeric, bills_cost numeric,
   running_cost numeric, hours_run numeric, km_run numeric, cost_per_hour numeric, cost_per_km numeric, litres_per_hour numeric,
   expected_lph numeric, litres_per_100km numeric, expected_lp100 numeric, purchase_cost numeric, book_value numeric,
   lifetime_running numeric, tco numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT _has_permission('fleet.view', p_site_id) THEN RAISE EXCEPTION 'No access'; END IF;
  RETURN QUERY
  WITH m AS (
    SELECT fa.id, COALESCE(fa.fleet_number, fa.asset_number, fa.registration) || COALESCE(' · ' || NULLIF(trim(COALESCE(NULLIF(fa.description, ''), concat_ws(' ', fa.make, fa.model))), ''), '') AS lbl,
           t.name AS tname, fa.status AS st, fa.purchase_cost AS pc, fa.expected_consumption_lph AS elph, fa.expected_consumption_lpkm AS elkm
      FROM fleet_assets fa LEFT JOIN fleet_asset_types t ON t.id = fa.asset_type_id
     WHERE fa.site_id = p_site_id AND NOT COALESCE(fa.is_archived, false) AND fa.status <> 'decommissioned'
  ), fuel AS (
    SELECT f.fleet_asset_id AS aid, sum(f.litres) FILTER (WHERE f.transaction_date BETWEEN p_from AND p_to) AS l,
           sum(f.total_cost) FILTER (WHERE f.transaction_date BETWEEN p_from AND p_to) AS c, sum(f.total_cost) AS c_all
      FROM fuel_transactions f WHERE f.site_id = p_site_id AND f.transaction_type = 'issuance' AND f.fleet_asset_id IS NOT NULL GROUP BY 1
  ), parts AS (
    SELECT w.asset_id AS aid,
           sum(CASE WHEN im.movement_type = 'return' THEN -1 ELSE 1 END * abs(COALESCE(im.value, im.quantity * im.unit_cost, 0)))
             FILTER (WHERE im.created_at::date BETWEEN p_from AND p_to) AS c,
           sum(CASE WHEN im.movement_type = 'return' THEN -1 ELSE 1 END * abs(COALESCE(im.value, im.quantity * im.unit_cost, 0))) AS c_all
      FROM inventory_movements im JOIN fleet_work_orders w ON w.id = im.source_reference_id
     WHERE w.site_id = p_site_id AND im.movement_type IN ('issue','return') GROUP BY 1
  ), bills AS (
    SELECT w.asset_id AS aid, sum(pi.total_amount) FILTER (WHERE pi.invoice_date BETWEEN p_from AND p_to) AS c, sum(pi.total_amount) AS c_all
      FROM purchase_invoices pi JOIN purchase_orders po ON po.id = pi.po_id JOIN fleet_work_orders w ON w.id = po.work_order_id
     WHERE w.site_id = p_site_id AND pi.status NOT IN ('cancelled','void','rejected','draft') GROUP BY 1
  ), meters AS (
    SELECT r.asset_id AS aid,
           max(r.reading_value) FILTER (WHERE r.reading_type = 'hours') - min(r.reading_value) FILTER (WHERE r.reading_type = 'hours') AS hrs,
           max(r.reading_value) FILTER (WHERE r.reading_type = 'odometer') - min(r.reading_value) FILTER (WHERE r.reading_type = 'odometer') AS kms
      FROM fleet_meter_readings r
     WHERE r.site_id = p_site_id AND NOT COALESCE(r.is_flagged, false) AND r.reading_date BETWEEN p_from AND p_to GROUP BY 1
  ), book AS (
    SELECT x.fleet_asset_id AS aid, sum(x.cost - x.accumulated_depreciation) AS bv, sum(x.cost) AS cost
      FROM fixed_assets x WHERE NOT x.is_archived AND x.status = 'active' AND x.fleet_asset_id IS NOT NULL GROUP BY 1
  )
  SELECT m.id, m.lbl, m.tname, m.st,
         round(COALESCE(fuel.l, 0), 1), round(COALESCE(fuel.c, 0), 2), round(COALESCE(parts.c, 0), 2), round(COALESCE(bills.c, 0), 2),
         round(COALESCE(fuel.c, 0) + COALESCE(parts.c, 0) + COALESCE(bills.c, 0), 2),
         round(NULLIF(meters.hrs, 0), 1), round(NULLIF(meters.kms, 0), 0),
         round((COALESCE(fuel.c, 0) + COALESCE(parts.c, 0) + COALESCE(bills.c, 0)) / NULLIF(meters.hrs, 0), 2),
         round((COALESCE(fuel.c, 0) + COALESCE(parts.c, 0) + COALESCE(bills.c, 0)) / NULLIF(meters.kms, 0), 2),
         round(fuel.l / NULLIF(meters.hrs, 0), 1), m.elph,
         round(100 * fuel.l / NULLIF(meters.kms, 0), 1), m.elkm,
         COALESCE(book.cost, m.pc), book.bv,
         round(COALESCE(fuel.c_all, 0) + COALESCE(parts.c_all, 0) + COALESCE(bills.c_all, 0), 2),
         CASE WHEN COALESCE(book.cost, m.pc) IS NOT NULL THEN
           round(COALESCE(book.cost, m.pc) + COALESCE(fuel.c_all, 0) + COALESCE(parts.c_all, 0) + COALESCE(bills.c_all, 0) - COALESCE(book.bv, 0), 2) END
    FROM m LEFT JOIN fuel ON fuel.aid = m.id LEFT JOIN parts ON parts.aid = m.id LEFT JOIN bills ON bills.aid = m.id
    LEFT JOIN meters ON meters.aid = m.id LEFT JOIN book ON book.aid = m.id
   ORDER BY 9 DESC, 2;
END $$;

CREATE OR REPLACE FUNCTION public.fleet_home(p_site_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE _r jsonb; _from date := CURRENT_DATE - 29; _mfrom date := date_trunc('month', CURRENT_DATE)::date;
BEGIN
  IF NOT _has_permission('fleet.view', p_site_id) THEN RAISE EXCEPTION 'No access'; END IF;
  CREATE TEMP TABLE IF NOT EXISTS _fh_cost ON COMMIT DROP AS SELECT * FROM fleet_machine_costs(p_site_id, _from, CURRENT_DATE) LIMIT 0;
  TRUNCATE _fh_cost; INSERT INTO _fh_cost SELECT * FROM fleet_machine_costs(p_site_id, _from, CURRENT_DATE);
  CREATE TEMP TABLE IF NOT EXISTS _fh_down ON COMMIT DROP AS SELECT * FROM fleet_downtime_core(p_site_id, _from, CURRENT_DATE) LIMIT 0;
  TRUNCATE _fh_down; INSERT INTO _fh_down SELECT * FROM fleet_downtime_core(p_site_id, _from, CURRENT_DATE);
  CREATE TEMP TABLE IF NOT EXISTS _fh_due ON COMMIT DROP AS SELECT * FROM _fleet_pm_due_core(p_site_id) LIMIT 0;
  TRUNCATE _fh_due; INSERT INTO _fh_due SELECT * FROM _fleet_pm_due_core(p_site_id);

  SELECT jsonb_build_object(
    'chips', jsonb_build_object(
      'down_now', (SELECT count(*) FROM fleet_assets WHERE site_id = p_site_id AND NOT COALESCE(is_archived, false) AND status IN ('maintenance','grounded','awaiting_parts')),
      'service_overdue', (SELECT count(*) FROM _fh_due WHERE state = 'overdue'),
      'service_soon', (SELECT count(*) FROM _fh_due WHERE state = 'due_soon'),
      'papers_30', (SELECT count(*) FROM fleet_assets fa, LATERAL (VALUES (fa.licence_expiry), (fa.insurance_expiry), (fa.roadworthy_expiry)) v(d)
                     WHERE fa.site_id = p_site_id AND NOT COALESCE(fa.is_archived, false) AND fa.status <> 'decommissioned' AND v.d <= CURRENT_DATE + 30),
      'failed_prestarts', (SELECT count(*) FROM fleet_inspections WHERE site_id = p_site_id AND kind = 'prestart' AND overall_result IN ('fail','conditional') AND inspection_date >= CURRENT_DATE - 6),
      'open_jobs', (SELECT count(*) FROM fleet_work_orders WHERE site_id = p_site_id AND COALESCE(status, '') NOT IN ('completed','cancelled','closed')),
      'open_faults', (SELECT count(*) FROM fleet_defects WHERE site_id = p_site_id AND status IN ('open','in_work') AND NOT is_archived),
      'contracts_due', (SELECT count(*) FROM fleet_contracts WHERE site_id = p_site_id AND status = 'active' AND NOT is_archived AND end_date - CURRENT_DATE <= remind_days),
      'no_reading_7d', (SELECT count(*) FROM fleet_meter_gaps(p_site_id, 7))),
    'figures', jsonb_build_object(
      'machines', (SELECT count(*) FROM _fh_cost),
      'availability_30', (SELECT round(avg(availability_pct), 1) FROM _fh_down),
      'utilisation_30', (SELECT round(100.0 * count(*) FILTER (WHERE COALESCE(hours_run, 0) > 0 OR COALESCE(km_run, 0) > 0 OR fuel_litres > 0) / NULLIF(count(*), 0), 0) FROM _fh_cost),
      'fuel_month_litres', (SELECT round(COALESCE(sum(litres), 0), 0) FROM fuel_transactions WHERE site_id = p_site_id AND transaction_type = 'issuance' AND transaction_date >= _mfrom),
      'fuel_month_cost', (SELECT round(COALESCE(sum(total_cost), 0), 2) FROM fuel_transactions WHERE site_id = p_site_id AND transaction_type = 'issuance' AND transaction_date >= _mfrom),
      'running_cost_30', (SELECT round(COALESCE(sum(running_cost), 0), 2) FROM _fh_cost),
      'hours_30', (SELECT round(COALESCE(sum(hours_run), 0), 0) FROM _fh_cost),
      'cost_per_hour_30', (SELECT round(sum(running_cost) FILTER (WHERE hours_run > 0) / NULLIF(sum(hours_run), 0), 2) FROM _fh_cost),
      'book_value', (SELECT round(COALESCE(sum(book_value), 0), 2) FROM _fh_cost),
      'capitalised', (SELECT count(*) FROM _fh_cost WHERE book_value IS NOT NULL)),
    'fuel_trend', (SELECT COALESCE(jsonb_agg(jsonb_build_object('month', to_char(mo, 'Mon'), 'litres', l, 'cost', c) ORDER BY mo), '[]')
                     FROM (SELECT date_trunc('month', transaction_date) mo, round(sum(litres), 0) l, round(sum(total_cost), 0) c FROM fuel_transactions
                            WHERE site_id = p_site_id AND transaction_type = 'issuance' AND transaction_date >= date_trunc('month', CURRENT_DATE) - interval '5 months'
                            GROUP BY 1) t),
    'board', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', c.asset_id, 'machine', c.machine, 'type', c.machine_type, 'status', c.status,
                 'lph', c.litres_per_hour, 'expected_lph', c.expected_lph, 'lp100', c.litres_per_100km, 'expected_lp100', c.expected_lp100,
                 'cost_per_hour', c.cost_per_hour, 'availability', d.availability_pct,
                 'service', (SELECT state FROM _fh_due u WHERE u.asset_id = c.asset_id ORDER BY pct_used DESC LIMIT 1))
               ORDER BY CASE c.status WHEN 'grounded' THEN 0 WHEN 'maintenance' THEN 1 WHEN 'awaiting_parts' THEN 2 ELSE 3 END, c.machine), '[]')
                FROM _fh_cost c LEFT JOIN _fh_down d ON d.asset_id = c.asset_id),
    'service_due', (SELECT COALESCE(jsonb_agg(to_jsonb(u) ORDER BY u.pct_used DESC), '[]') FROM (SELECT * FROM _fh_due WHERE state <> 'ok' ORDER BY pct_used DESC LIMIT 12) u),
    'top_cost', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', asset_id, 'machine', machine, 'cost', running_cost, 'per_hour', cost_per_hour) ORDER BY running_cost DESC), '[]')
                   FROM (SELECT * FROM _fh_cost WHERE running_cost > 0 ORDER BY running_cost DESC LIMIT 8) t)
  ) INTO _r;
  RETURN _r;
END $$;

GRANT EXECUTE ON FUNCTION public.fleet_machine_costs(uuid, date, date), public.fleet_home(uuid) TO authenticated;

INSERT INTO schema_migrations (filename) VALUES ('0243_fleet_a5_home_costs.sql') ON CONFLICT DO NOTHING;
