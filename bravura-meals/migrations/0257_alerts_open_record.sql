-- 0257: every alert opens its record (user 28 Sep "do this for all modules"). Links become /module/page:<id>:
--   machine down / service overdue / papers → /fleet/fleet_assets:<asset id> (machine card)
--   small asset not returned → /fleet/fleet_small_assets:<tag>        out of stock → /inventory/inv_position:<item code>
--   duplicate bill / bill mismatch → /finance/fi_pay_suppliers:<bill id>
--   dip gap → /fuel/fuel_reconciliation:<dip id>                       quick second fills → /fuel/fuel_issues:<latest fill id>
DO $$ DECLARE f text; g text; BEGIN
  f := pg_get_functiondef('_ai_alerts_fleet'::regproc);
  g := replace(f, '''/fleet/fleet_maintenance''', '''/fleet/fleet_assets:'' || fa.id');
  g := replace(g, '''/fleet/fleet_preventive''', '''/fleet/fleet_assets:'' || d.asset_id');
  g := replace(g, '''/fleet/fleet_compliance''', '''/fleet/fleet_assets:'' || fa.id');
  g := replace(g, '''/fleet/fleet_small_assets''', '''/fleet/fleet_small_assets:'' || a.tag_number');
  IF (length(g) - length(replace(g, ':'' ||', ''))) / 5 < 4 THEN RAISE EXCEPTION 'fleet patch incomplete'; END IF;
  EXECUTE g;

  f := pg_get_functiondef('_ai_alerts_stock'::regproc);
  g := replace(f, '''/inventory/inv_position''', '''/inventory/inv_position:'' || i.item_code');
  IF g = f THEN RAISE EXCEPTION 'stock patch did not apply'; END IF;
  EXECUTE g;

  f := pg_get_functiondef('_ai_alerts_base'::regproc);
  g := regexp_replace(f, '''/finance/fi_pay_suppliers''', '''/finance/fi_pay_suppliers:'' || b.id', 1, 1);
  g := regexp_replace(g, '''/finance/fi_pay_suppliers''', '''/finance/fi_pay_suppliers:'' || pi.id', 1, 1);
  IF position('fi_pay_suppliers:'' || b.id' in g) = 0 OR position('fi_pay_suppliers:'' || pi.id' in g) = 0 THEN RAISE EXCEPTION 'base patch did not apply'; END IF;
  EXECUTE g;

  f := pg_get_functiondef('_ai_alerts_fuel'::regproc);
  g := replace(f, '''/fuel/fuel_reconciliation''', '''/fuel/fuel_reconciliation:'' || d.id');
  g := replace(g, '''Last 7 days — check the reasons'', ''/fuel/fuel_issues''',
                  '''Last 7 days — check the reasons'', ''/fuel/fuel_issues:'' || (array_agg(t.id ORDER BY t.transaction_date DESC, t.created_at DESC))[1]');
  IF position('fuel_reconciliation:'' || d.id' in g) = 0 OR position('array_agg(t.id' in g) = 0 THEN RAISE EXCEPTION 'fuel patch did not apply'; END IF;
  EXECUTE g;
END $$;
INSERT INTO schema_migrations (filename) VALUES ('0257_alerts_open_record.sql') ON CONFLICT DO NOTHING;

-- 0257b: the 04:30 alerts cron runs with no user; fuel_tank_position refused it ('No access') and broke every alert notification.
DO $$ DECLARE f text := pg_get_functiondef('fuel_tank_position'::regproc); g text; BEGIN
  g := replace(f, 'IF NOT _user_has_fuel_perm(p_site_id,', 'IF auth.uid() IS NOT NULL AND NOT _user_has_fuel_perm(p_site_id,');
  IF g <> f THEN EXECUTE g; END IF;
END $$;
