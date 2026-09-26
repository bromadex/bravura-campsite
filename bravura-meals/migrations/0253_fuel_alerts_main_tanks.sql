-- 0253: backup drums / bowsers (level_tracking_method 'issuance') don't raise 'Order fuel' alerts (user 26 Sep).
CREATE OR REPLACE FUNCTION _ai_alerts_fuel(p_sites uuid[])
RETURNS TABLE(key text, site_id uuid, kind text, perm text, severity text, title text, detail text, link text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT 'fuelreorder:' || p.tank_id || ':' || CURRENT_DATE, s, 'fuel_reorder', 'fuel.view',
         CASE WHEN p.days_cover < 2 THEN 'critical' ELSE 'warning' END,
         'Order fuel: ' || p.tank || ' has ' || p.days_cover || ' days left',
         round(p.book_level) || ' L of ' || round(p.capacity) || ' L at ' || round(p.use_per_day) || ' L/day', '/fuel/fuel_dashboard'
    FROM unnest(p_sites) s, LATERAL fuel_tank_position(s) p
   WHERE p.method = 'dipstick' AND p.days_cover IS NOT NULL AND p.days_cover < COALESCE((SELECT reorder_days FROM fuel_settings f WHERE f.site_id = s), 5)
  UNION ALL
  SELECT 'fuelgap:' || d.id, d.site_id, 'fuel_dip_gap', 'fuel.approve', 'warning',
         'Dip gap ' || d.variance_litres || ' L on ' || k.name || ' needs ' || CASE WHEN d.gap_status = 'needs_reason' THEN 'a reason' ELSE 'sign-off' END,
         'Dipped ' || to_char(d.reading_date, 'DD Mon'), '/fuel/fuel_reconciliation'
    FROM fuel_dip_readings d JOIN fuel_tanks k ON k.id = d.tank_id
   WHERE d.site_id = ANY (p_sites) AND NOT d.is_archived AND d.gap_status IN ('needs_reason','explained')
     AND d.created_at > COALESCE(k.stores_from, '-infinity') AND d.created_at < now() - interval '1 day'
  UNION ALL
  SELECT 'fuelnodip:' || k.id || ':' || CURRENT_DATE, k.site_id, 'fuel_no_dip', 'fuel.create', 'info',
         'No dip on ' || k.name || ' for 2 days', 'Last dip ' || COALESCE(to_char(max(d.reading_date), 'DD Mon'), 'never'), '/fuel/fuel_dips'
    FROM fuel_tanks k LEFT JOIN fuel_dip_readings d ON d.tank_id = k.id AND NOT d.is_archived
   WHERE k.site_id = ANY (p_sites) AND NOT COALESCE(k.is_archived, false) AND k.level_tracking_method = 'dipstick'
   GROUP BY k.id, k.site_id, k.name HAVING COALESCE(max(d.reading_date), '2000-01-01') < CURRENT_DATE - 1
  UNION ALL
  SELECT 'fuelallow:' || a.id || ':' || _fuel_period_start(a.period, CURRENT_DATE), a.site_id, 'fuel_allowance', 'fuel.approve', 'warning',
         'Fuel allowance used up: ' || COALESCE(concat_ws(' ', m.fleet_number, m.registration), dp.name),
         a.litres || ' L per ' || a.period, '/fuel/fuel_allowances'
    FROM fuel_allowances a LEFT JOIN fleet_assets m ON m.id = a.fleet_asset_id LEFT JOIN departments dp ON dp.id = a.department_id
   WHERE a.site_id = ANY (p_sites) AND a.is_active
     AND EXISTS (SELECT 1 FROM fuel_allowance_alerts x WHERE x.allowance_id = a.id AND x.level = 100 AND x.period_start = _fuel_period_start(a.period, CURRENT_DATE))
  UNION ALL
  SELECT 'fuelrecharge:' || t.recharge_contractor_id || ':' || to_char(CURRENT_DATE, 'IYYY-IW'), t.site_id, 'fuel_recharge', 'fuel.approve', 'info',
         'Charge fuel back to ' || c.name, count(*) || ' fills, ' || round(sum(t.litres)) || ' L, $' || round(sum(t.total_cost), 2) || ' waiting over 14 days',
         '/fuel/fuel_allowances'
    FROM fuel_transactions t JOIN contractors c ON c.id = t.recharge_contractor_id
   WHERE t.site_id = ANY (p_sites) AND t.recharge_status = 'pending' AND NOT COALESCE(t.is_deleted, false) AND t.transaction_date < CURRENT_DATE - 14
   GROUP BY t.recharge_contractor_id, t.site_id, c.name
  UNION ALL
  SELECT 'fuelsecond:' || t.fleet_asset_id || ':' || to_char(CURRENT_DATE, 'IYYY-IW'), t.site_id, 'fuel_second_fill', 'fuel.approve', 'warning',
         count(*) || ' quick second fills: ' || COALESCE(concat_ws(' ', m.fleet_number, m.registration), 'machine'), 'Last 7 days — check the reasons', '/fuel/fuel_issues'
    FROM fuel_transactions t JOIN fleet_assets m ON m.id = t.fleet_asset_id
   WHERE t.site_id = ANY (p_sites) AND t.second_fill_reason IS NOT NULL AND NOT COALESCE(t.is_deleted, false) AND t.transaction_date > CURRENT_DATE - 7
   GROUP BY t.fleet_asset_id, t.site_id, m.fleet_number, m.registration HAVING count(*) >= 3;
$$;

INSERT INTO schema_migrations (filename) VALUES ('0253_fuel_alerts_main_tanks.sql') ON CONFLICT DO NOTHING;
