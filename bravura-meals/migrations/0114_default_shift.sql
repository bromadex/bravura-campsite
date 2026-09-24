-- 0114: Shifts stay (production will need them). Each site gets a default Day Shift 07:00–16:00.
-- Clock-in uses the employee's assigned shift, else the site's default shift; overtime = time after shift end.
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS uq_shifts_default_per_site ON shifts (site_id) WHERE is_default;

INSERT INTO shifts (site_id, name, code, start_time, end_time, duration_hours, is_night_shift, is_active, is_default)
SELECT s.id, 'Day Shift', 'DAY', '07:00', '16:00', 9, false, true, true FROM sites s
 WHERE NOT EXISTS (SELECT 1 FROM shifts x WHERE x.site_id = s.id AND x.is_default);

-- Night shifts end the next day: an end time at/before the start rolls to the following day.
CREATE OR REPLACE FUNCTION _overtime_after(p_in TIMESTAMPTZ, p_out TIMESTAMPTZ, p_start TIME, p_end TIME)
RETURNS NUMERIC LANGUAGE sql IMMUTABLE AS $$
  SELECT ROUND(GREATEST(0, EXTRACT(EPOCH FROM (
    (p_out AT TIME ZONE 'Africa/Harare')
    - GREATEST((p_in AT TIME ZONE 'Africa/Harare'),
               ((p_in AT TIME ZONE 'Africa/Harare')::date + p_end + CASE WHEN p_end <= p_start THEN INTERVAL '1 day' ELSE INTERVAL '0' END))
  )) / 3600.0)::numeric, 2)
$$;

CREATE OR REPLACE FUNCTION _ess_shift_for(p_emp UUID, p_day DATE)
RETURNS TABLE (name TEXT, start_time TIME, end_time TIME)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT x.name, x.start_time, x.end_time FROM (
    SELECT sh.name, sh.start_time, sh.end_time, 1 AS pri FROM shift_assignments a JOIN shifts sh ON sh.id = a.shift_id
     WHERE a.employee_id = p_emp AND a.start_date <= p_day AND COALESCE(a.end_date, p_day) >= p_day AND COALESCE(sh.is_active, true)
    UNION ALL
    SELECT sh.name, sh.start_time, sh.end_time, 2 FROM shifts sh JOIN employees e ON e.site_id = sh.site_id
     WHERE e.id = p_emp AND sh.is_default AND COALESCE(sh.is_active, true)
    UNION ALL
    SELECT 'Work day', s.work_start, s.work_end, 3 FROM sites s JOIN employees e ON e.site_id = s.id WHERE e.id = p_emp
  ) x ORDER BY pri LIMIT 1
$$;

CREATE OR REPLACE FUNCTION ess_today()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _e UUID := _ess_require_employee(); _open attendance_logs%ROWTYPE; _site sites%ROWTYPE; _sh RECORD;
BEGIN
  SELECT * INTO _open FROM attendance_logs WHERE employee_id = _e AND clock_in IS NOT NULL AND clock_out IS NULL
     AND clock_in > now() - INTERVAL '16 hours' ORDER BY clock_in DESC LIMIT 1;
  SELECT s.* INTO _site FROM sites s JOIN employees e ON e.site_id = s.id WHERE e.id = _e;
  SELECT * INTO _sh FROM _ess_shift_for(_e, CURRENT_DATE);
  RETURN jsonb_build_object(
    'clocked_in_at', _open.clock_in,
    'done_today', EXISTS (SELECT 1 FROM attendance_logs WHERE employee_id = _e AND date = CURRENT_DATE AND clock_out IS NOT NULL),
    'site_located', _site.latitude IS NOT NULL, 'site_name', _site.name, 'geofence_m', _site.geofence_m,
    'shift_name', _sh.name, 'work_start', _sh.start_time, 'work_end', _sh.end_time);
END;
$$;

CREATE OR REPLACE FUNCTION ess_clock(p_action TEXT, p_lat NUMERIC, p_lng NUMERIC, p_accuracy NUMERIC DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _e UUID := _ess_require_employee(); _site sites%ROWTYPE; _dist NUMERIC; _sh RECORD;
  _slack NUMERIC := LEAST(COALESCE(p_accuracy, 0), 150); _log attendance_logs%ROWTYPE; _hours NUMERIC; _ot NUMERIC;
BEGIN
  SELECT s.* INTO _site FROM sites s JOIN employees e ON e.site_id = s.id WHERE e.id = _e;
  IF _site.latitude IS NULL THEN RAISE EXCEPTION 'Clock-in by phone is not set up for % yet — ask an administrator to set the site location', _site.name; END IF;
  IF p_lat IS NULL OR p_lng IS NULL THEN RAISE EXCEPTION 'Your location is needed to clock in — allow location access and try again'; END IF;
  _dist := _distance_m(_site.latitude, _site.longitude, p_lat, p_lng);
  IF _dist > _site.geofence_m + _slack THEN
    RAISE EXCEPTION 'You are % km from % — clock in when you are on site', ROUND(_dist / 1000.0, 1), _site.name;
  END IF;
  IF p_action = 'in' THEN
    SELECT * INTO _sh FROM _ess_shift_for(_e, CURRENT_DATE);
    IF EXISTS (SELECT 1 FROM attendance_logs WHERE employee_id = _e AND clock_in IS NOT NULL AND clock_out IS NULL AND clock_in > now() - INTERVAL '16 hours') THEN
      RAISE EXCEPTION 'You are already clocked in';
    END IF;
    IF EXISTS (SELECT 1 FROM attendance_logs WHERE employee_id = _e AND date = CURRENT_DATE AND clock_in IS NOT NULL) THEN
      RAISE EXCEPTION 'You have already clocked in today — ask your supervisor to correct it if needed';
    END IF;
    INSERT INTO attendance_logs (employee_id, site_id, date, clock_in, is_absent, is_late, clock_in_lat, clock_in_lng, source, created_by, approval_status)
    VALUES (_e, _site.id, CURRENT_DATE, now(), false,
            (now() AT TIME ZONE 'Africa/Harare')::time > _sh.start_time + INTERVAL '15 minutes',
            p_lat, p_lng, 'phone', auth.uid(), 'pending')
    ON CONFLICT (employee_id, date) DO UPDATE
      SET clock_in = EXCLUDED.clock_in, is_absent = false, is_late = EXCLUDED.is_late,
          clock_in_lat = EXCLUDED.clock_in_lat, clock_in_lng = EXCLUDED.clock_in_lng, source = 'phone', approval_status = 'pending'
    RETURNING * INTO _log;
    RETURN jsonb_build_object('action', 'in', 'at', _log.clock_in, 'late', _log.is_late, 'distance_m', ROUND(_dist));
  ELSIF p_action = 'out' THEN
    SELECT * INTO _log FROM attendance_logs WHERE employee_id = _e AND clock_in IS NOT NULL AND clock_out IS NULL
       AND clock_in > now() - INTERVAL '16 hours' ORDER BY clock_in DESC LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'You are not clocked in'; END IF;
    SELECT * INTO _sh FROM _ess_shift_for(_e, _log.date);
    _hours := ROUND(EXTRACT(EPOCH FROM (now() - _log.clock_in)) / 3600.0, 2);
    _ot := _overtime_after(_log.clock_in, now(), _sh.start_time, _sh.end_time);
    UPDATE attendance_logs SET clock_out = now(), hours_worked = _hours, overtime_hours = _ot,
           clock_out_lat = p_lat, clock_out_lng = p_lng WHERE id = _log.id;
    RETURN jsonb_build_object('action', 'out', 'hours', _hours, 'overtime', _ot, 'distance_m', ROUND(_dist));
  END IF;
  RAISE EXCEPTION 'Unknown action';
END;
$$;

INSERT INTO schema_migrations (filename) VALUES ('0114_default_shift.sql') ON CONFLICT DO NOTHING;
