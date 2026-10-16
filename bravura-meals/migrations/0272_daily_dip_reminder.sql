-- 0272 (user, 16 Oct 2026: "wendy usually forgets to log the dipstick every day"). No Main Tank dip 11–16 Oct.
-- Per tank: who to remind (fuel_tanks.dip_reminder_users, default Wendy Mpala for the Kamativi main tank).
-- pg_cron 08:00 UTC (10:00 Harare): reminder to those people if today's dip is missing.
--          14:00 UTC (16:00 Harare): second reminder, and fuel.approve holders are told too (with how many days in a row are missing).
ALTER TABLE fuel_tanks
  ADD COLUMN IF NOT EXISTS dip_reminder_users uuid[] NOT NULL DEFAULT '{}';

UPDATE fuel_tanks SET dip_reminder_users = ARRAY['f414993c-ee47-4a53-ab7a-ab6874eddef2']::uuid[]
 WHERE id = '5bd0dc58-83ef-4284-b208-554ad7a13a81' AND dip_reminder_users = '{}';

CREATE OR REPLACE FUNCTION fuel_dip_reminders(p_escalate boolean DEFAULT false) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t record; _today date := (now() AT TIME ZONE 'Africa/Harare')::date; _last date; _miss int; _n int := 0; _k int; _msg text;
BEGIN
  FOR t IN SELECT * FROM fuel_tanks WHERE NOT COALESCE(is_archived, false) AND status = 'active'
             AND level_tracking_method <> 'issuance' LOOP
    IF EXISTS (SELECT 1 FROM fuel_dip_readings d WHERE d.tank_id = t.id AND NOT COALESCE(d.is_archived, false) AND d.reading_date = _today) THEN
      CONTINUE;
    END IF;
    SELECT max(reading_date) INTO _last FROM fuel_dip_readings d WHERE d.tank_id = t.id AND NOT COALESCE(d.is_archived, false);
    _miss := CASE WHEN _last IS NULL THEN NULL ELSE _today - _last END;
    _msg := 'No dip for ' || t.name || ' today yet' || CASE WHEN _miss > 1 THEN ' — last dip ' || to_char(_last, 'DD Mon') || ' (' || (_miss - 1) || ' day(s) missed)' ELSE '' END
            || '. Take the dip and log it in Dips & reconciliation.';
    INSERT INTO notifications (site_id, user_id, type, title, message, link, category)
    SELECT t.site_id, u, 'fuel_dip_due', CASE WHEN p_escalate THEN 'Still no dip today: ' ELSE 'Dip due: ' END || t.name, _msg, '/fuel/fuel_dips', 'reminder'
      FROM unnest(t.dip_reminder_users) u;
    GET DIAGNOSTICS _k = ROW_COUNT; _n := _n + _k;
    IF p_escalate THEN
      PERFORM _notify_permission(t.site_id, 'fuel.approve', 'fuel_dip_due', 'No dip today: ' || t.name, _msg, '/fuel/fuel_dips', 'reminder');
    END IF;
  END LOOP;
  RETURN _n;
END $$;

SELECT cron.schedule('fuel-dip-reminder', '0 8 * * *', 'SELECT fuel_dip_reminders(false)');
SELECT cron.schedule('fuel-dip-reminder-late', '0 14 * * *', 'SELECT fuel_dip_reminders(true)');

INSERT INTO schema_migrations (filename) VALUES ('0272_daily_dip_reminder.sql') ON CONFLICT DO NOTHING;
