-- 0113: Fixed working day (07:00–16:00, overtime after 16:00) replaces shift rosters for phone clock-in,
-- supervisor timesheet approval, and a manager team view (who's on site / on leave, quick approvals).

-- Kamativi geofence (approximate mine centre; refine on site with "Use my current location").
UPDATE sites SET latitude = -18.3190, longitude = 27.0620, geofence_m = 3000
 WHERE name = 'Kamativi' AND latitude IS NULL;

ALTER TABLE sites ADD COLUMN IF NOT EXISTS work_start TIME NOT NULL DEFAULT '07:00';
ALTER TABLE sites ADD COLUMN IF NOT EXISTS work_end   TIME NOT NULL DEFAULT '16:00';

ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE attendance_logs DROP CONSTRAINT IF EXISTS attendance_logs_approval_status_check;
ALTER TABLE attendance_logs ADD CONSTRAINT attendance_logs_approval_status_check CHECK (approval_status IN ('pending','approved','rejected'));
ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES profiles(id);
ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS supervisor_note TEXT;
-- Rows entered by HR/supervisors before this change are treated as already approved.
UPDATE attendance_logs SET approval_status = 'approved' WHERE COALESCE(source, '') <> 'phone' AND approval_status = 'pending';

-- Overtime = time worked after the site's end of day (local time).
CREATE OR REPLACE FUNCTION _overtime_hours(p_in TIMESTAMPTZ, p_out TIMESTAMPTZ, p_end TIME)
RETURNS NUMERIC LANGUAGE sql IMMUTABLE AS $$
  SELECT ROUND(GREATEST(0, EXTRACT(EPOCH FROM (
    (p_out AT TIME ZONE 'Africa/Harare') - GREATEST((p_in AT TIME ZONE 'Africa/Harare'), ((p_in AT TIME ZONE 'Africa/Harare')::date + p_end))
  )) / 3600.0)::numeric, 2)
$$;

CREATE OR REPLACE FUNCTION ess_today()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _e UUID := _ess_require_employee(); _open attendance_logs%ROWTYPE; _site sites%ROWTYPE;
BEGIN
  SELECT * INTO _open FROM attendance_logs WHERE employee_id = _e AND clock_in IS NOT NULL AND clock_out IS NULL
     AND clock_in > now() - INTERVAL '16 hours' ORDER BY clock_in DESC LIMIT 1;
  SELECT s.* INTO _site FROM sites s JOIN employees e ON e.site_id = s.id WHERE e.id = _e;
  RETURN jsonb_build_object(
    'clocked_in_at', _open.clock_in,
    'done_today', EXISTS (SELECT 1 FROM attendance_logs WHERE employee_id = _e AND date = CURRENT_DATE AND clock_out IS NOT NULL),
    'site_located', _site.latitude IS NOT NULL,
    'site_name', _site.name, 'geofence_m', _site.geofence_m,
    'work_start', _site.work_start, 'work_end', _site.work_end);
END;
$$;

CREATE OR REPLACE FUNCTION ess_clock(p_action TEXT, p_lat NUMERIC, p_lng NUMERIC, p_accuracy NUMERIC DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _e UUID := _ess_require_employee(); _site sites%ROWTYPE; _dist NUMERIC;
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
    IF EXISTS (SELECT 1 FROM attendance_logs WHERE employee_id = _e AND clock_in IS NOT NULL AND clock_out IS NULL AND clock_in > now() - INTERVAL '16 hours') THEN
      RAISE EXCEPTION 'You are already clocked in';
    END IF;
    IF EXISTS (SELECT 1 FROM attendance_logs WHERE employee_id = _e AND date = CURRENT_DATE AND clock_in IS NOT NULL) THEN
      RAISE EXCEPTION 'You have already clocked in today — ask your supervisor to correct it if needed';
    END IF;
    INSERT INTO attendance_logs (employee_id, site_id, date, clock_in, is_absent, is_late, clock_in_lat, clock_in_lng, source, created_by, approval_status)
    VALUES (_e, _site.id, CURRENT_DATE, now(), false,
            (now() AT TIME ZONE 'Africa/Harare')::time > _site.work_start + INTERVAL '15 minutes',
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
    _hours := ROUND(EXTRACT(EPOCH FROM (now() - _log.clock_in)) / 3600.0, 2);
    _ot := _overtime_hours(_log.clock_in, now(), _site.work_end);
    UPDATE attendance_logs SET clock_out = now(), hours_worked = _hours, overtime_hours = _ot,
           clock_out_lat = p_lat, clock_out_lng = p_lng WHERE id = _log.id;
    RETURN jsonb_build_object('action', 'out', 'hours', _hours, 'overtime', _ot, 'distance_m', ROUND(_dist));
  END IF;
  RAISE EXCEPTION 'Unknown action';
END;
$$;

-- ── Team view ──────────────────────────────────────────────────────────
-- A supervisor is anyone who is employees.manager_id for someone; HR (hr.approve) may act on anyone at the site.
CREATE OR REPLACE FUNCTION _is_team_lead_of(p_emp UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM employees e JOIN profiles p ON p.employee_id = e.manager_id
                  WHERE e.id = p_emp AND p.id = auth.uid())
$$;

CREATE OR REPLACE FUNCTION ess_team_today()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _me UUID := _ess_require_employee();
BEGIN
  RETURN jsonb_build_object(
    'members', COALESCE((SELECT jsonb_agg(x ORDER BY x->>'state', x->>'name') FROM (
      SELECT jsonb_build_object('id', e.id, 'name', e.name, 'employee_number', e.employee_number, 'designation', d.name,
        'clock_in', a.clock_in, 'clock_out', a.clock_out, 'late', a.is_late,
        'leave_type', lt.name, 'leave_until', lr.end_date,
        'state', CASE WHEN lr.id IS NOT NULL THEN 'b_leave'
                      WHEN a.clock_in IS NOT NULL AND a.clock_out IS NULL THEN 'a_on_site'
                      WHEN a.clock_out IS NOT NULL THEN 'c_done'
                      ELSE 'd_not_in' END) x
        FROM employees e
        LEFT JOIN designations d ON d.id = e.designation_id
        LEFT JOIN attendance_logs a ON a.employee_id = e.id AND a.date = CURRENT_DATE
        LEFT JOIN LATERAL (SELECT r.id, r.end_date, r.leave_type_id FROM leave_requests r WHERE r.employee_id = e.id AND r.status = 'approved'
                            AND CURRENT_DATE BETWEEN r.start_date AND r.end_date LIMIT 1) lr ON true
        LEFT JOIN leave_types lt ON lt.id = lr.leave_type_id
       WHERE e.manager_id = _me AND e.status IN ('active','on_leave')) s), '[]'::jsonb),
    'timesheets', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'name', e.name, 'date', a.date, 'clock_in', a.clock_in,
        'clock_out', a.clock_out, 'hours', a.hours_worked, 'overtime', a.overtime_hours, 'late', a.is_late) ORDER BY a.date, e.name)
        FROM attendance_logs a JOIN employees e ON e.id = a.employee_id
       WHERE e.manager_id = _me AND a.approval_status = 'pending' AND a.clock_out IS NOT NULL), '[]'::jsonb),
    'leave', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'name', e.name, 'type', lt.name, 'start', r.start_date,
        'end', r.end_date, 'days', r.days_requested, 'reason', r.reason) ORDER BY r.start_date)
        FROM leave_requests r JOIN employees e ON e.id = r.employee_id LEFT JOIN leave_types lt ON lt.id = r.leave_type_id
       WHERE e.manager_id = _me AND r.status = 'pending'), '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION ess_team_decide_timesheet(p_ids UUID[], p_approve BOOLEAN, p_note TEXT DEFAULT NULL)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _a attendance_logs%ROWTYPE; _n INT := 0;
BEGIN
  IF NOT p_approve AND COALESCE(TRIM(p_note), '') = '' THEN RAISE EXCEPTION 'Say what is wrong so the employee can fix it'; END IF;
  FOR _a IN SELECT * FROM attendance_logs WHERE id = ANY(p_ids) FOR UPDATE LOOP
    IF NOT (_is_team_lead_of(_a.employee_id) OR _has_hr_permission('hr.approve', _a.site_id)) THEN
      RAISE EXCEPTION 'You can only approve timesheets for your own team';
    END IF;
    IF EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND employee_id = _a.employee_id) THEN
      RAISE EXCEPTION 'You cannot approve your own timesheet';
    END IF;
    UPDATE attendance_logs SET approval_status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
           approved_by = auth.uid(), approved_at = now(), supervisor_note = NULLIF(TRIM(p_note), '') WHERE id = _a.id;
    IF NOT p_approve THEN
      INSERT INTO notifications (site_id, user_id, type, title, message, link, category)
      SELECT _a.site_id, p.id, 'timesheet', 'Timesheet for ' || to_char(_a.date, 'DD Mon') || ' not approved', TRIM(p_note), '/me/me_attendance', 'approval'
        FROM profiles p WHERE p.employee_id = _a.employee_id;
    END IF;
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END;
$$;

CREATE OR REPLACE FUNCTION ess_team_decide_leave(p_id UUID, p_approve BOOLEAN, p_reason TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r leave_requests%ROWTYPE; _ar UUID;
BEGIN
  SELECT * INTO _r FROM leave_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR _r.status <> 'pending' THEN RAISE EXCEPTION 'This request is no longer waiting'; END IF;
  IF NOT p_approve AND COALESCE(TRIM(p_reason), '') = '' THEN RAISE EXCEPTION 'Give a reason'; END IF;
  -- If an approval route owns this request, decide through the engine (it checks who may act at this step).
  SELECT id INTO _ar FROM approval_requests WHERE entity_type = 'leave_requests' AND entity_id = p_id AND status = 'pending' LIMIT 1;
  IF _ar IS NOT NULL THEN
    PERFORM approval_decide(_ar, p_approve, p_reason);
    RETURN;
  END IF;
  IF NOT (_is_team_lead_of(_r.employee_id) OR _has_hr_permission('hr.approve', _r.site_id)) THEN
    RAISE EXCEPTION 'You can only decide leave for your own team';
  END IF;
  IF EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND employee_id = _r.employee_id) THEN
    RAISE EXCEPTION 'You cannot approve your own leave';
  END IF;
  IF p_approve THEN PERFORM _leave_apply_approval(p_id); ELSE PERFORM _leave_apply_rejection(p_id, TRIM(p_reason)); END IF;
END;
$$;

REVOKE ALL ON FUNCTION ess_team_today() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION ess_team_decide_timesheet(UUID[], BOOLEAN, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION ess_team_decide_leave(UUID, BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION ess_team_today(), ess_team_decide_timesheet(UUID[], BOOLEAN, TEXT), ess_team_decide_leave(UUID, BOOLEAN, TEXT) TO authenticated;

INSERT INTO schema_migrations (filename) VALUES ('0113_hr_fixed_hours_team_view.sql') ON CONFLICT DO NOTHING;

-- 0113b: my attendance returns local (Harare) clock times and the supervisor's decision.
DROP FUNCTION IF EXISTS ess_my_attendance(date, date);
CREATE FUNCTION ess_my_attendance(p_from date, p_to date)
RETURNS TABLE(date date, clock_in text, clock_out text, hours_worked numeric, is_absent boolean, is_late boolean,
              overtime_hours numeric, notes text, approval_status text, supervisor_note text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT a.date, to_char(a.clock_in AT TIME ZONE 'Africa/Harare', 'HH24:MI'), to_char(a.clock_out AT TIME ZONE 'Africa/Harare', 'HH24:MI'),
         a.hours_worked, a.is_absent, a.is_late, a.overtime_hours, a.notes, a.approval_status, a.supervisor_note
    FROM attendance_logs a
   WHERE a.employee_id = _ess_require_employee() AND a.date BETWEEN p_from AND p_to
   ORDER BY a.date DESC
$$;
REVOKE ALL ON FUNCTION ess_my_attendance(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION ess_my_attendance(date, date) TO authenticated;
