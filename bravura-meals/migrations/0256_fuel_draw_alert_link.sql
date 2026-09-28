-- 0256: "Unusual fuel draw" alert opens the exact fill (/fuel/fuel_issues:<id>) and stops once someone confirms it (acknowledged).
DO $$ DECLARE f text := pg_get_functiondef('_ai_alerts_base'::regproc); g text; BEGIN
  g := replace(f, '''/fuel/fuel_transactions''', '''/fuel/fuel_issues:'' || ft.id');
  g := replace(g, 'AND ft.litres >= 50', 'AND COALESCE(ft.acknowledgement_status, '''') <> ''acknowledged'' AND ft.litres >= 50');
  IF position('/fuel/fuel_issues:' in g) = 0 OR position('acknowledgement_status' in g) = 0 THEN RAISE EXCEPTION 'patch did not apply'; END IF;
  EXECUTE g;
END $$;
INSERT INTO schema_migrations (filename) VALUES ('0256_fuel_draw_alert_link.sql') ON CONFLICT DO NOTHING;
