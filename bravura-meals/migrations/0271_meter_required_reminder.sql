-- 0271 (user, "fix all the outstanding"): meter readings at fuel fills become required on fleet_settings.meter_required_from (1 Nov 2026).
-- Tell everyone who issues fuel now (16 Oct) and again the day before. Only fires while the date is still ahead.
CREATE OR REPLACE FUNCTION fuel_meter_required_notice() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; _n int := 0;
BEGIN
  -- the date comes from _fleet_setting_date (fleet_settings, else 1 Nov 2026 — no site has saved its own yet)
  FOR r IN SELECT s.id site_id, _fleet_setting_date(s.id) d FROM sites s
            WHERE EXISTS (SELECT 1 FROM fuel_tanks t WHERE t.site_id = s.id AND NOT COALESCE(t.is_archived, false))
              AND _fleet_setting_date(s.id) > current_date LOOP
    PERFORM _notify_permission(r.site_id, 'fuel.create', 'fuel_meter_required',
      'Meter readings required from ' || to_char(r.d, 'DD Mon'),
      'From ' || to_char(r.d, 'DD Month YYYY') || ' every fuel fill must have the odometer (km) or hour-meter reading. Fills without it will not save.',
      '/fuel/fuel_pump', 'announcement');
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END $$;

SELECT fuel_meter_required_notice();
SELECT cron.schedule('fuel-meter-required-eve', '0 6 31 10 *', 'SELECT fuel_meter_required_notice()');

INSERT INTO schema_migrations (filename) VALUES ('0271_meter_required_reminder.sql') ON CONFLICT DO NOTHING;
