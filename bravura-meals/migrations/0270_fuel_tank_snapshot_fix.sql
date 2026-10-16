-- 0270 (user, 16 Oct 2026: "there is something wrong here" — Main Tank picture 0% / 48 L while the strip said 9,655 L).
-- fuel_update_dip_snapshot only ever moved last_dip_date forward and never looked at archiving: a 48 L dip keyed on 14 Oct and then
-- archived kept the tank at 48 L, and the real 10 Oct dips (48 L before / 10,055 L after delivery) were ignored as "older".
-- Now the snapshot is always the latest non-archived dip by date + time (+ entry time), recomputed on insert, edit and archive.
CREATE OR REPLACE FUNCTION fuel_update_dip_snapshot() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _t uuid := COALESCE(NEW.tank_id, OLD.tank_id); _d fuel_dip_readings%ROWTYPE;
BEGIN
  SELECT * INTO _d FROM fuel_dip_readings
   WHERE tank_id = _t AND NOT COALESCE(is_archived, false)
   ORDER BY reading_date DESC, reading_time DESC NULLS LAST, created_at DESC LIMIT 1;
  UPDATE fuel_tanks t SET last_dip_date = _d.reading_date,
         last_dip_reading = COALESCE(_d.level_end_litres, _d.level_litres),
         current_level_litres = CASE WHEN t.level_tracking_method = 'issuance' THEN t.current_level_litres
                                     ELSE COALESCE(_d.level_end_litres, _d.level_litres, t.current_level_litres) END,
         updated_at = now()
   WHERE t.id = _t;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_fuel_update_last_dip ON fuel_dip_readings;
CREATE TRIGGER trg_fuel_update_last_dip AFTER INSERT OR UPDATE ON fuel_dip_readings
  FOR EACH ROW EXECUTE FUNCTION fuel_update_dip_snapshot();

-- repair every dipstick tank now
UPDATE fuel_tanks t SET last_dip_date = d.reading_date, last_dip_reading = d.lvl, current_level_litres = d.lvl, updated_at = now()
  FROM (SELECT DISTINCT ON (tank_id) tank_id, reading_date, COALESCE(level_end_litres, level_litres) lvl FROM fuel_dip_readings
         WHERE NOT COALESCE(is_archived, false) ORDER BY tank_id, reading_date DESC, reading_time DESC NULLS LAST, created_at DESC) d
 WHERE d.tank_id = t.id AND t.level_tracking_method <> 'issuance';

INSERT INTO schema_migrations (filename) VALUES ('0270_fuel_tank_snapshot_fix.sql') ON CONFLICT DO NOTHING;
