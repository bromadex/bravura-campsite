-- 0251 Fuel F5 (#73): charge-out + fuel dashboard.
-- Every fill carries the machine's department, cost centre and project (trg_fuel_dims, back-filled). The ledger already
-- takes cost centre / project from the fill (_gl_source_dims); department is kept on the fill for the charge-out report.
-- fuel_settings.reorder_days (default 5) = order when a tank has fewer days of cover than this.
-- fuel_home(site) feeds FU01 (FuelHome.jsx, finance look).

ALTER TABLE fuel_transactions ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES departments(id);
ALTER TABLE fuel_settings ADD COLUMN IF NOT EXISTS reorder_days numeric NOT NULL DEFAULT 5;

CREATE OR REPLACE FUNCTION trg_fuel_dims() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _a fleet_assets%ROWTYPE;
BEGIN
  IF NEW.fleet_asset_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.fleet_asset_id IS DISTINCT FROM OLD.fleet_asset_id) THEN
    SELECT * INTO _a FROM fleet_assets WHERE id = NEW.fleet_asset_id;
    NEW.department_id  := COALESCE(NEW.department_id, _a.department_id);
    NEW.cost_centre_id := COALESCE(NEW.cost_centre_id, _a.cost_centre_id);
    NEW.project_id     := COALESCE(NEW.project_id, _a.project_id);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_fuel_dims ON fuel_transactions;
CREATE TRIGGER trg_fuel_dims BEFORE INSERT OR UPDATE OF fleet_asset_id ON fuel_transactions FOR EACH ROW EXECUTE FUNCTION trg_fuel_dims();

-- when a machine gets its department / cost centre / project, give its fills from the last 90 days the same (only where empty)
CREATE OR REPLACE FUNCTION trg_fleet_dims_to_fuel() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  UPDATE fuel_transactions SET department_id = COALESCE(department_id, NEW.department_id),
         cost_centre_id = COALESCE(cost_centre_id, NEW.cost_centre_id), project_id = COALESCE(project_id, NEW.project_id)
   WHERE fleet_asset_id = NEW.id AND transaction_date > CURRENT_DATE - 90
     AND ((department_id IS NULL AND NEW.department_id IS NOT NULL) OR (cost_centre_id IS NULL AND NEW.cost_centre_id IS NOT NULL)
          OR (project_id IS NULL AND NEW.project_id IS NOT NULL));
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_fleet_dims_to_fuel ON fleet_assets;
CREATE TRIGGER trg_fleet_dims_to_fuel AFTER UPDATE OF department_id, cost_centre_id, project_id ON fleet_assets
  FOR EACH ROW EXECUTE FUNCTION trg_fleet_dims_to_fuel();

UPDATE fuel_transactions t SET department_id = COALESCE(t.department_id, a.department_id), cost_centre_id = COALESCE(t.cost_centre_id, a.cost_centre_id),
       project_id = COALESCE(t.project_id, a.project_id)
  FROM fleet_assets a WHERE a.id = t.fleet_asset_id
   AND (a.department_id IS NOT NULL OR a.cost_centre_id IS NOT NULL OR a.project_id IS NOT NULL);

CREATE OR REPLACE FUNCTION fuel_home(p_site uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _m date := date_trunc('month', CURRENT_DATE)::date; _pm date := (date_trunc('month', CURRENT_DATE) - interval '1 month')::date;
        _reorder numeric; _tanks jsonb; _lph jsonb; _res jsonb;
BEGIN
  IF NOT _user_has_fuel_perm(p_site, ARRAY['fuel.view','fuel.create','fuel.edit']) THEN RAISE EXCEPTION 'No access'; END IF;
  _reorder := COALESCE((SELECT reorder_days FROM fuel_settings WHERE site_id = p_site), 5);

  SELECT COALESCE(jsonb_agg(to_jsonb(p) || jsonb_build_object(
           'reorder', p.days_cover IS NOT NULL AND p.days_cover < _reorder,
           'order_litres', GREATEST(round(COALESCE(p.capacity, 0) * 0.95 - COALESCE(p.book_level, 0), -2), 0))), '[]')
    INTO _tanks FROM fuel_tank_position(p_site) p;

  BEGIN
    SELECT COALESCE(jsonb_agg(x ORDER BY x.fuel_litres DESC), '[]') INTO _lph FROM (
      SELECT machine, fuel_litres, fuel_cost, hours_run, litres_per_hour, expected_lph, km_run, litres_per_100km, expected_lp100
        FROM fleet_machine_costs(p_site, CURRENT_DATE - 30, CURRENT_DATE) WHERE fuel_litres > 0 ORDER BY fuel_litres DESC LIMIT 10) x;
  EXCEPTION WHEN OTHERS THEN _lph := NULL;
  END;

  SELECT jsonb_build_object(
    'chips', jsonb_build_object(
      'gaps_to_explain', (SELECT count(*) FROM fuel_dip_readings d JOIN fuel_tanks k ON k.id = d.tank_id WHERE d.site_id = p_site AND NOT d.is_archived
                            AND d.gap_status IN ('needs_reason','explained') AND d.created_at > COALESCE(k.stores_from, '-infinity')),
      'tanks_to_reorder', (SELECT count(*) FROM jsonb_array_elements(_tanks) e WHERE (e->>'reorder')::boolean),
      'no_dip_2d', (SELECT count(*) FROM fuel_tanks k WHERE k.site_id = p_site AND NOT COALESCE(k.is_archived, false) AND k.level_tracking_method = 'dipstick'
                      AND NOT EXISTS (SELECT 1 FROM fuel_dip_readings d WHERE d.tank_id = k.id AND NOT d.is_archived AND d.reading_date >= CURRENT_DATE - 1)),
      'allowances_80', (SELECT count(*) FROM fuel_allowance_list(p_site) a WHERE a.is_active AND a.pct >= 80),
      'recharges', (SELECT count(*) FROM fuel_transactions WHERE site_id = p_site AND recharge_status = 'pending' AND NOT COALESCE(is_deleted, false)),
      'open_shifts', (SELECT count(*) FROM fuel_pump_shifts WHERE site_id = p_site AND status = 'open' AND shift_date < CURRENT_DATE),
      'fills_no_meter_7d', (SELECT count(*) FROM fuel_transactions WHERE site_id = p_site AND transaction_type = 'issuance' AND NOT COALESCE(is_deleted, false)
                              AND transaction_date > CURRENT_DATE - 7 AND fleet_asset_id IS NOT NULL AND odometer_km IS NULL AND hours_reading IS NULL),
      'machines_no_dept', (SELECT count(DISTINCT t.fleet_asset_id) FROM fuel_transactions t JOIN fleet_assets a ON a.id = t.fleet_asset_id
                            WHERE t.site_id = p_site AND t.transaction_date > CURRENT_DATE - 30 AND NOT COALESCE(t.is_deleted, false)
                              AND a.department_id IS NULL AND a.cost_centre_id IS NULL)),
    'figures', (SELECT jsonb_build_object(
        'month_litres', COALESCE(sum(litres) FILTER (WHERE transaction_date >= _m), 0),
        'month_cost', COALESCE(sum(total_cost) FILTER (WHERE transaction_date >= _m), 0),
        'last_month_litres', COALESCE(sum(litres) FILTER (WHERE transaction_date >= _pm AND transaction_date < _m), 0),
        'last_month_cost', COALESCE(sum(total_cost) FILTER (WHERE transaction_date >= _pm AND transaction_date < _m), 0),
        'litres_30', COALESCE(sum(litres) FILTER (WHERE transaction_date > CURRENT_DATE - 30), 0),
        'fills_30', count(*) FILTER (WHERE transaction_date > CURRENT_DATE - 30),
        'machines_30', count(DISTINCT fleet_asset_id) FILTER (WHERE transaction_date > CURRENT_DATE - 30))
        FROM fuel_transactions WHERE site_id = p_site AND transaction_type = 'issuance' AND NOT COALESCE(is_deleted, false)),
    'stock', (SELECT jsonb_build_object('litres', COALESCE(sum(store_litres), 0), 'value', COALESCE(sum(stock_value), 0),
                'cost_per_litre', round(sum(stock_value) / NULLIF(sum(store_litres), 0), 4),
                'gap_30d', COALESCE(sum(gap_30d), 0), 'issued_30d', COALESCE(sum(issued_30d), 0))
                FROM fuel_tank_position(p_site)),
    'last_price', (SELECT unit_price FROM fuel_transactions WHERE site_id = p_site AND transaction_type = 'delivery' AND NOT COALESCE(is_deleted, false)
                     AND unit_price > 0 ORDER BY transaction_date DESC, created_at DESC LIMIT 1),
    'tanks', _tanks,
    'trend', (SELECT COALESCE(jsonb_agg(jsonb_build_object('day', d::date, 'litres', COALESCE(x.l, 0)) ORDER BY d), '[]')
                FROM generate_series(CURRENT_DATE - 29, CURRENT_DATE, interval '1 day') d
                LEFT JOIN (SELECT transaction_date, sum(litres) l FROM fuel_transactions WHERE site_id = p_site AND transaction_type = 'issuance'
                             AND NOT COALESCE(is_deleted, false) AND transaction_date > CURRENT_DATE - 30 GROUP BY 1) x ON x.transaction_date = d::date),
    'top_users', COALESCE(_lph, (SELECT COALESCE(jsonb_agg(x ORDER BY x.fuel_litres DESC), '[]') FROM (
                   SELECT COALESCE(concat_ws(' · ', a.fleet_number, a.registration, a.description), t.asset_description) machine,
                          sum(t.litres) fuel_litres, sum(t.total_cost) fuel_cost
                     FROM fuel_transactions t LEFT JOIN fleet_assets a ON a.id = t.fleet_asset_id
                    WHERE t.site_id = p_site AND t.transaction_type = 'issuance' AND NOT COALESCE(t.is_deleted, false) AND t.transaction_date > CURRENT_DATE - 30
                    GROUP BY 1 ORDER BY 2 DESC LIMIT 10) x)),
    'charge_out', (SELECT COALESCE(jsonb_agg(x ORDER BY x.cost DESC), '[]') FROM (
                     SELECT COALESCE(d.name, 'No department') department, COALESCE(cc.name, '—') cost_centre, COALESCE(pr.name, '—') project,
                            sum(t.litres) litres, sum(t.total_cost) cost
                       FROM fuel_transactions t LEFT JOIN departments d ON d.id = t.department_id
                       LEFT JOIN cost_centres cc ON cc.id = t.cost_centre_id LEFT JOIN projects pr ON pr.id = t.project_id
                      WHERE t.site_id = p_site AND t.transaction_type = 'issuance' AND NOT COALESCE(t.is_deleted, false) AND t.transaction_date >= _m
                      GROUP BY 1, 2, 3) x),
    'reorder_days', _reorder)
  INTO _res;
  RETURN _res;
END $$;
GRANT EXECUTE ON FUNCTION fuel_home(uuid) TO authenticated;

INSERT INTO schema_migrations (filename) VALUES ('0251_fuel_f5_home_chargeout.sql') ON CONFLICT DO NOTHING;
