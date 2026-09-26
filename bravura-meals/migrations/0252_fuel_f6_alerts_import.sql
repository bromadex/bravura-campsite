-- 0252 Fuel F6 (#74) + settings fix.
-- fuel_settings had only 2 of the 9 fields the General tab saves → every save failed. Columns added (docket_prefix is read by
-- Request Fuel, require_approval by Office / batch issue).
-- _ai_alerts_fuel joins _ai_alerts_core (Ask Bravura alerts, "Your day", 04:30 cron notifications): tank below reorder days,
-- dip gap waiting for reason/sign-off > 1 day, tank not dipped 2 days, allowance over 100%, recharge pending > 14 days,
-- 3+ second-fill overrides on one machine in 7 days.
-- fuel_import_issues(site, rows) — office import of paper slips from Excel; each row goes through fuel_pump_issue (same rules;
-- reasons default to 'Imported from paper slip'), returns per-row result.

ALTER TABLE fuel_settings
  ADD COLUMN IF NOT EXISTS docket_prefix text NOT NULL DEFAULT 'FD-',
  ADD COLUMN IF NOT EXISTS docket_padding int NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS require_approval boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS alert_threshold_pct numeric NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS default_price_per_litre numeric,
  ADD COLUMN IF NOT EXISTS allow_manual_litres boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION _ai_alerts_fuel(p_sites uuid[])
RETURNS TABLE(key text, site_id uuid, kind text, perm text, severity text, title text, detail text, link text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT 'fuelreorder:' || p.tank_id || ':' || CURRENT_DATE, s, 'fuel_reorder', 'fuel.view',
         CASE WHEN p.days_cover < 2 THEN 'critical' ELSE 'warning' END,
         'Order fuel: ' || p.tank || ' has ' || p.days_cover || ' days left',
         round(p.book_level) || ' L of ' || round(p.capacity) || ' L at ' || round(p.use_per_day) || ' L/day', '/fuel/fuel_dashboard'
    FROM unnest(p_sites) s, LATERAL fuel_tank_position(s) p
   WHERE p.days_cover IS NOT NULL AND p.days_cover < COALESCE((SELECT reorder_days FROM fuel_settings f WHERE f.site_id = s), 5)
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

CREATE OR REPLACE FUNCTION public._ai_alerts_core(p_sites uuid[])
 RETURNS TABLE(key text, site_id uuid, kind text, perm text, severity text, title text, detail text, link text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT * FROM _ai_alerts_base(p_sites) UNION ALL SELECT * FROM _ai_alerts_stock(p_sites) UNION ALL SELECT * FROM _ai_alerts_fleet(p_sites)
  UNION ALL SELECT * FROM _ai_alerts_fuel(p_sites);
$function$;

-- office import: rows [{date, time, tank, machine, driver, litres, km, hours, signed_by, slip, notes}]
CREATE OR REPLACE FUNCTION fuel_import_issues(p_site uuid, p_rows jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r jsonb; i int := 0; _out jsonb := '[]'; _tank uuid; _asset uuid; _op uuid; _res jsonb; _at timestamptz; _ok int := 0;
BEGIN
  IF NOT _user_has_fuel_perm(p_site, ARRAY['fuel.create','fuel.edit']) THEN RAISE EXCEPTION 'No access'; END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    i := i + 1;
    BEGIN
      SELECT id INTO _tank FROM fuel_tanks WHERE site_id = p_site AND NOT COALESCE(is_archived, false)
        AND (lower(name) = lower(trim(r->>'tank')) OR COALESCE(trim(r->>'tank'), '') = '') ORDER BY (lower(name) = lower(trim(COALESCE(r->>'tank', '')))) DESC, name LIMIT 1;
      IF _tank IS NULL THEN RAISE EXCEPTION 'Tank "%" not found', r->>'tank'; END IF;
      SELECT id INTO _asset FROM fleet_assets WHERE site_id = p_site AND NOT COALESCE(is_archived, false)
        AND lower(trim(r->>'machine')) IN (lower(fleet_number), lower(registration), lower(asset_number), lower(replace(registration, ' ', ''))) LIMIT 1;
      IF _asset IS NULL THEN RAISE EXCEPTION 'Machine "%" not found (use fleet no. or registration)', r->>'machine'; END IF;
      _op := NULL;
      IF COALESCE(trim(r->>'driver'), '') <> '' THEN
        SELECT o.id INTO _op FROM fuel_operators o JOIN employees e ON e.id = o.employee_id
         WHERE o.site_id = p_site AND o.is_active AND (lower(e.employee_number) = lower(trim(r->>'driver')) OR lower(e.name) = lower(trim(r->>'driver'))) LIMIT 1;
      END IF;
      _at := COALESCE(NULLIF(r->>'date', '')::date, CURRENT_DATE) + COALESCE(NULLIF(r->>'time', '')::time, '12:00'::time);
      _res := fuel_pump_issue(jsonb_build_object(
        'client_ref', 'import:' || p_site || ':' || md5(r::text),
        'tank_id', _tank, 'fleet_asset_id', _asset, 'operator_id', COALESCE(_op::text, ''), 'litres', r->>'litres',
        'odometer_km', COALESCE(r->>'km', ''), 'hours_reading', COALESCE(r->>'hours', ''),
        'meter_broken', (COALESCE(r->>'km', '') = '' AND COALESCE(r->>'hours', '') = ''),
        'meter_note', 'Not on the paper slip',
        'issued_at', (_at AT TIME ZONE 'Africa/Harare')::text,
        'signed_by_name', COALESCE(NULLIF(trim(r->>'signed_by'), ''), NULLIF(trim(r->>'driver'), ''), 'Paper slip'),
        'licence_note', 'Imported from paper slip', 'second_fill_reason', 'Imported from paper slip', 'allowance_note', 'Imported from paper slip',
        'notes', concat_ws(' | ', 'Slip ' || NULLIF(trim(r->>'slip'), ''), NULLIF(trim(r->>'notes'), ''))));
      _out := _out || jsonb_build_object('row', i, 'ok', true, 'number', _res->>'number', 'duplicate', COALESCE((_res->>'duplicate')::boolean, false));
      _ok := _ok + 1;
    EXCEPTION WHEN OTHERS THEN
      _out := _out || jsonb_build_object('row', i, 'ok', false, 'error', SQLERRM);
    END;
  END LOOP;
  RETURN jsonb_build_object('saved', _ok, 'rows', _out);
END $$;
GRANT EXECUTE ON FUNCTION fuel_import_issues(uuid, jsonb) TO authenticated;

INSERT INTO schema_migrations (filename) VALUES ('0252_fuel_f6_alerts_import.sql') ON CONFLICT DO NOTHING;
