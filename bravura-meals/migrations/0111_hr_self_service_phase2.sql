-- 0111_hr_self_service_phase2.sql
-- Self-service additions: hazard reporting, safety profile, roster + GPS clock-in,
-- HR-approved detail changes, annual tax certificate (ITF16), documents & policies,
-- camp life (room, faults, meals), and salary advances / loans recovered via payroll.
-- Every ess_* function acts only on the caller's own employee record.
BEGIN;

-- ═══════════════════════════════════════════════════════════════════════
-- 0. Private bucket for self-service photos: <site_id>/<user_id>/<file>
-- ═══════════════════════════════════════════════════════════════════════
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('ess-uploads', 'ess-uploads', false, 10485760, ARRAY['image/jpeg','image/png','image/webp','image/heic','application/pdf'])
ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS "ess uploads own" ON storage.objects;
DROP POLICY IF EXISTS "ess uploads read" ON storage.objects;
CREATE POLICY "ess uploads own" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'ess-uploads' AND (storage.foldername(name))[2] = auth.uid()::text);
CREATE POLICY "ess uploads read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'ess-uploads' AND (
    (storage.foldername(name))[2] = auth.uid()::text
    OR _has_permission('sheq.view', ((storage.foldername(name))[1])::uuid)
    OR _has_permission('accommodation.view', ((storage.foldername(name))[1])::uuid)));

CREATE OR REPLACE FUNCTION _ess_site() RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.site_id FROM employees e WHERE e.id = _ess_require_employee()
$$;

CREATE OR REPLACE FUNCTION _notify_permission(p_site UUID, p_code TEXT, p_type TEXT, p_title TEXT, p_msg TEXT, p_link TEXT, p_cat TEXT)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO notifications (site_id, user_id, type, title, message, link, category)
  SELECT DISTINCT p_site, ur.user_id, p_type, p_title, p_msg, p_link, p_cat
    FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id
   WHERE p.code = p_code AND COALESCE(ur.is_active, true) AND (ur.site_id IS NULL OR ur.site_id = p_site)
     AND ur.user_id IS DISTINCT FROM auth.uid()
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 1. Hazard & near-miss reporting
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION ess_report_hazard(p_category TEXT, p_location TEXT, p_description TEXT, p_priority TEXT,
                                             p_photo_path TEXT DEFAULT NULL, p_anonymous BOOLEAN DEFAULT false)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _site UUID := _ess_site(); _num TEXT;
BEGIN
  IF COALESCE(TRIM(p_description), '') = '' THEN RAISE EXCEPTION 'Describe what you saw'; END IF;
  IF COALESCE(TRIM(p_location), '') = '' THEN RAISE EXCEPTION 'Say where it is'; END IF;
  _num := sheq_next_number(p_site_id => _site, p_prefix => 'HAZ', p_table => 'sheq_hazard_reports');
  INSERT INTO sheq_hazard_reports (site_id, report_number, report_date, location, category, description, photo_url,
                                   status, priority, reported_by, is_anonymous)
  VALUES (_site, _num, CURRENT_DATE, TRIM(p_location), COALESCE(p_category, 'other'), TRIM(p_description), p_photo_path,
          'open', COALESCE(p_priority, 'medium'), CASE WHEN p_anonymous THEN NULL ELSE auth.uid() END, COALESCE(p_anonymous, false));
  PERFORM _notify_permission(_site, 'sheq.edit', 'sheq_hazard',
    CASE WHEN p_priority IN ('high','critical') THEN 'URGENT hazard reported: ' ELSE 'Hazard reported: ' END || _num,
    TRIM(p_location) || ' — ' || LEFT(TRIM(p_description), 120), '/sheq/sq_hazards',
    CASE WHEN p_priority IN ('high','critical') THEN 'escalation' ELSE 'general' END);
  RETURN _num;
END;
$$;

CREATE OR REPLACE FUNCTION ess_my_hazards()
RETURNS TABLE (report_number TEXT, report_date DATE, category TEXT, location TEXT, description TEXT, priority TEXT, status TEXT, resolution_notes TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT h.report_number, h.report_date, h.category, h.location, h.description, h.priority, h.status, h.resolution_notes
    FROM sheq_hazard_reports h
   WHERE h.reported_by = auth.uid() AND NOT COALESCE(h.is_archived, false)
   ORDER BY h.created_at DESC LIMIT 50
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 2. Safety profile
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION ess_my_safety()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _e UUID := _ess_require_employee();
BEGIN
  RETURN jsonb_build_object(
    'ppe', COALESCE((SELECT jsonb_agg(x ORDER BY x->>'issued' DESC) FROM (
        SELECT jsonb_build_object('item', COALESCE(i.name, 'PPE'), 'size', s.size, 'issued', s.issue_date, 'replace_by', s.expiry_date) x
          FROM sheq_ppe_issues s LEFT JOIN sheq_ppe_items i ON i.id = s.ppe_item_id
         WHERE s.issued_to = _e AND NOT COALESCE(s.is_archived, false) AND s.returned_date IS NULL
        UNION ALL
        SELECT jsonb_build_object('item', p.item_description, 'size', NULL, 'issued', p.date_issued, 'replace_by', p.expected_replacement_date)
          FROM ppe_issues p WHERE p.employee_id = _e AND p.date_returned IS NULL) t), '[]'::jsonb),
    'training', COALESCE((SELECT jsonb_agg(x ORDER BY x->>'completed' DESC) FROM (
        SELECT jsonb_build_object('course', t.course_name, 'provider', t.provider, 'completed', t.date_completed,
                                  'expires', t.expiry_date, 'certificate', t.certificate_number) x
          FROM sheq_training_matrix t WHERE t.employee_id = _e AND NOT COALESCE(t.is_archived, false)
        UNION ALL
        SELECT jsonb_build_object('course', p.title, 'provider', p.trainer, 'completed', en.completion_date, 'expires', NULL, 'certificate', NULL)
          FROM training_enrollments en JOIN training_programs p ON p.id = en.training_program_id
         WHERE en.employee_id = _e AND en.status = 'completed') t), '[]'::jsonb),
    'inductions', COALESCE((SELECT jsonb_agg(jsonb_build_object('type', i.induction_type, 'date', i.induction_date,
                                  'expires', i.expiry_date, 'status', i.status) ORDER BY i.induction_date DESC)
        FROM sheq_inductions i WHERE i.employee_id = _e AND NOT COALESCE(i.is_archived, false)), '[]'::jsonb),
    'medical', COALESCE((SELECT jsonb_agg(x ORDER BY x->>'date' DESC) FROM (
        SELECT jsonb_build_object('exam', m.exam_type, 'date', m.exam_date, 'expires', m.expiry_date,
                                  'status', m.fitness_status, 'restrictions', m.restrictions) x
          FROM sheq_medical_fitness m WHERE m.employee_id = _e AND NOT COALESCE(m.is_archived, false)
        UNION ALL
        SELECT jsonb_build_object('exam', r.exam_type, 'date', r.exam_date, 'expires', r.next_exam_date,
                                  'status', r.result, 'restrictions', r.restrictions)
          FROM medical_records r WHERE r.employee_id = _e) t), '[]'::jsonb));
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 3. Roster + clock in/out by phone inside the site geofence
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS latitude   NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS longitude  NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS geofence_m INT NOT NULL DEFAULT 1500;

ALTER TABLE attendance_logs
  ADD COLUMN IF NOT EXISTS clock_in_lat   NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS clock_in_lng   NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS clock_out_lat  NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS clock_out_lng  NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS source         TEXT;

CREATE OR REPLACE FUNCTION _distance_m(lat1 NUMERIC, lng1 NUMERIC, lat2 NUMERIC, lng2 NUMERIC)
RETURNS NUMERIC LANGUAGE sql IMMUTABLE AS $$
  SELECT 2 * 6371000 * asin(sqrt(
    power(sin(radians((lat2 - lat1) / 2)), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians((lng2 - lng1) / 2)), 2)))
$$;

CREATE OR REPLACE FUNCTION ess_my_roster(p_from DATE, p_to DATE)
RETURNS TABLE (start_date DATE, end_date DATE, shift_name TEXT, start_time TIME, end_time TIME, duration_hours NUMERIC, is_night_shift BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.start_date, a.end_date, s.name, s.start_time, s.end_time, s.duration_hours, s.is_night_shift
    FROM shift_assignments a JOIN shifts s ON s.id = a.shift_id
   WHERE a.employee_id = _ess_require_employee()
     AND a.start_date <= p_to AND COALESCE(a.end_date, p_to) >= p_from
   ORDER BY a.start_date
$$;

CREATE OR REPLACE FUNCTION ess_today()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _e UUID := _ess_require_employee(); _open attendance_logs%ROWTYPE; _site sites%ROWTYPE; _shift RECORD;
BEGIN
  SELECT * INTO _open FROM attendance_logs WHERE employee_id = _e AND clock_in IS NOT NULL AND clock_out IS NULL
     AND clock_in > now() - INTERVAL '16 hours' ORDER BY clock_in DESC LIMIT 1;
  SELECT s.* INTO _site FROM sites s JOIN employees e ON e.site_id = s.id WHERE e.id = _e;
  SELECT sh.name, sh.start_time, sh.end_time INTO _shift FROM shift_assignments a JOIN shifts sh ON sh.id = a.shift_id
   WHERE a.employee_id = _e AND a.start_date <= CURRENT_DATE AND COALESCE(a.end_date, CURRENT_DATE) >= CURRENT_DATE LIMIT 1;
  RETURN jsonb_build_object(
    'clocked_in_at', _open.clock_in,
    'done_today', EXISTS (SELECT 1 FROM attendance_logs WHERE employee_id = _e AND date = CURRENT_DATE AND clock_out IS NOT NULL),
    'site_located', _site.latitude IS NOT NULL,
    'site_name', _site.name, 'geofence_m', _site.geofence_m,
    'shift', CASE WHEN _shift.name IS NULL THEN NULL ELSE jsonb_build_object('name', _shift.name, 'start', _shift.start_time, 'end', _shift.end_time) END);
END;
$$;

CREATE OR REPLACE FUNCTION ess_clock(p_action TEXT, p_lat NUMERIC, p_lng NUMERIC, p_accuracy NUMERIC DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _e     UUID := _ess_require_employee();
  _site  sites%ROWTYPE;
  _dist  NUMERIC;
  _slack NUMERIC := LEAST(COALESCE(p_accuracy, 0), 150);
  _log   attendance_logs%ROWTYPE;
  _shift RECORD;
  _hours NUMERIC;
BEGIN
  SELECT s.* INTO _site FROM sites s JOIN employees e ON e.site_id = s.id WHERE e.id = _e;
  IF _site.latitude IS NULL THEN RAISE EXCEPTION 'Clock-in by phone is not set up for % yet — ask an administrator to set the site location', _site.name; END IF;
  IF p_lat IS NULL OR p_lng IS NULL THEN RAISE EXCEPTION 'Your location is needed to clock in — allow location access and try again'; END IF;
  _dist := _distance_m(_site.latitude, _site.longitude, p_lat, p_lng);
  IF _dist > _site.geofence_m + _slack THEN
    RAISE EXCEPTION 'You are % km from % — clock in when you are on site', ROUND(_dist / 1000.0, 1), _site.name;
  END IF;

  SELECT sh.start_time, sh.duration_hours INTO _shift FROM shift_assignments a JOIN shifts sh ON sh.id = a.shift_id
   WHERE a.employee_id = _e AND a.start_date <= CURRENT_DATE AND COALESCE(a.end_date, CURRENT_DATE) >= CURRENT_DATE LIMIT 1;

  IF p_action = 'in' THEN
    IF EXISTS (SELECT 1 FROM attendance_logs WHERE employee_id = _e AND clock_in IS NOT NULL AND clock_out IS NULL
                AND clock_in > now() - INTERVAL '16 hours') THEN
      RAISE EXCEPTION 'You are already clocked in';
    END IF;
    IF EXISTS (SELECT 1 FROM attendance_logs WHERE employee_id = _e AND date = CURRENT_DATE AND clock_in IS NOT NULL) THEN
      RAISE EXCEPTION 'You have already clocked in today — ask your supervisor to correct it if needed';
    END IF;
    INSERT INTO attendance_logs (employee_id, site_id, date, clock_in, is_absent, is_late, clock_in_lat, clock_in_lng, source, created_by)
    VALUES (_e, _site.id, CURRENT_DATE, now(), false,
            _shift.start_time IS NOT NULL AND (now() AT TIME ZONE 'Africa/Harare')::time > _shift.start_time + INTERVAL '15 minutes',
            p_lat, p_lng, 'phone', auth.uid())
    ON CONFLICT (employee_id, date) DO UPDATE
      SET clock_in = EXCLUDED.clock_in, is_absent = false, is_late = EXCLUDED.is_late,
          clock_in_lat = EXCLUDED.clock_in_lat, clock_in_lng = EXCLUDED.clock_in_lng, source = 'phone'
    RETURNING * INTO _log;
    RETURN jsonb_build_object('action', 'in', 'at', _log.clock_in, 'late', _log.is_late, 'distance_m', ROUND(_dist));
  ELSIF p_action = 'out' THEN
    SELECT * INTO _log FROM attendance_logs WHERE employee_id = _e AND clock_in IS NOT NULL AND clock_out IS NULL
       AND clock_in > now() - INTERVAL '16 hours' ORDER BY clock_in DESC LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'You are not clocked in'; END IF;
    _hours := ROUND(EXTRACT(EPOCH FROM (now() - _log.clock_in)) / 3600.0, 2);
    UPDATE attendance_logs SET clock_out = now(), hours_worked = _hours,
           overtime_hours = GREATEST(0, _hours - COALESCE(_shift.duration_hours, 8)),
           clock_out_lat = p_lat, clock_out_lng = p_lng
     WHERE id = _log.id;
    RETURN jsonb_build_object('action', 'out', 'hours', _hours, 'distance_m', ROUND(_dist));
  END IF;
  RAISE EXCEPTION 'Unknown action';
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 4. My details — changes are requests that HR must approve
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS residential_address  TEXT,
  ADD COLUMN IF NOT EXISTS bank_name            TEXT,
  ADD COLUMN IF NOT EXISTS bank_branch          TEXT,
  ADD COLUMN IF NOT EXISTS bank_account_number  TEXT;

CREATE TABLE IF NOT EXISTS employee_change_requests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id      UUID NOT NULL REFERENCES sites(id),
  employee_id  UUID NOT NULL REFERENCES employees(id),
  requested_by UUID NOT NULL REFERENCES profiles(id),
  changes      JSONB NOT NULL,
  previous     JSONB NOT NULL,
  reason       TEXT,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  reviewed_by  UUID REFERENCES profiles(id),
  reviewed_at  TIMESTAMPTZ,
  review_note  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ecr_pending ON employee_change_requests (employee_id) WHERE status = 'pending';
ALTER TABLE employee_change_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ecr_select ON employee_change_requests;
CREATE POLICY ecr_select ON employee_change_requests FOR SELECT USING (
  requested_by = auth.uid() OR _has_hr_permission('hr.view', site_id));

CREATE OR REPLACE FUNCTION _ess_detail_snapshot(p_emp UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'phone', e.phone, 'email', e.email, 'residential_address', e.residential_address,
    'bank_name', e.bank_name, 'bank_branch', e.bank_branch, 'bank_account_number', e.bank_account_number,
    'nok_name', c.name, 'nok_relationship', c.relationship, 'nok_phone', c.phone)
    FROM employees e
    LEFT JOIN LATERAL (SELECT * FROM emergency_contacts ec WHERE ec.employee_id = e.id
                        ORDER BY ec.is_primary DESC NULLS LAST, ec.created_at LIMIT 1) c ON true
   WHERE e.id = p_emp
$$;

CREATE OR REPLACE FUNCTION ess_my_details()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _e UUID := _ess_require_employee();
BEGIN
  RETURN jsonb_build_object('current', _ess_detail_snapshot(_e),
    'pending', (SELECT to_jsonb(r) - 'previous' FROM employee_change_requests r WHERE r.employee_id = _e AND r.status = 'pending'),
    'last', (SELECT jsonb_build_object('status', r.status, 'review_note', r.review_note, 'reviewed_at', r.reviewed_at)
               FROM employee_change_requests r WHERE r.employee_id = _e AND r.status IN ('approved','rejected')
              ORDER BY r.reviewed_at DESC LIMIT 1));
END;
$$;

CREATE OR REPLACE FUNCTION ess_request_detail_change(p_changes JSONB, p_reason TEXT DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _e      UUID := _ess_require_employee();
  _site   UUID := _ess_site();
  _prev   JSONB := _ess_detail_snapshot(_e);
  _clean  JSONB := '{}'::jsonb;
  _k      TEXT;
  _id     UUID;
BEGIN
  FOREACH _k IN ARRAY ARRAY['phone','email','residential_address','bank_name','bank_branch','bank_account_number',
                            'nok_name','nok_relationship','nok_phone'] LOOP
    IF p_changes ? _k AND NULLIF(TRIM(p_changes->>_k), '') IS DISTINCT FROM NULLIF(TRIM(_prev->>_k), '') THEN
      _clean := _clean || jsonb_build_object(_k, NULLIF(TRIM(p_changes->>_k), ''));
    END IF;
  END LOOP;
  IF _clean = '{}'::jsonb THEN RAISE EXCEPTION 'Nothing has changed'; END IF;
  -- Next of kin must end up with both a name and a phone number.
  IF _clean ?| ARRAY['nok_name','nok_relationship','nok_phone'] AND (
       COALESCE(CASE WHEN _clean ? 'nok_name' THEN _clean->>'nok_name' ELSE _prev->>'nok_name' END, '') = ''
    OR COALESCE(CASE WHEN _clean ? 'nok_phone' THEN _clean->>'nok_phone' ELSE _prev->>'nok_phone' END, '') = '') THEN
    RAISE EXCEPTION 'Next of kin needs both a name and a phone number';
  END IF;
  IF EXISTS (SELECT 1 FROM employee_change_requests WHERE employee_id = _e AND status = 'pending') THEN
    RAISE EXCEPTION 'You already have a change waiting for HR — cancel it first to send a new one';
  END IF;
  INSERT INTO employee_change_requests (site_id, employee_id, requested_by, changes, previous, reason)
  VALUES (_site, _e, auth.uid(), _clean, _prev, NULLIF(TRIM(p_reason), '')) RETURNING id INTO _id;
  PERFORM _notify_permission(_site, 'hr.edit', 'hr_detail_change', 'Employee details to verify',
    (SELECT name FROM employees WHERE id = _e) || ' asked to update ' ||
      (SELECT string_agg(replace(k, '_', ' '), ', ') FROM jsonb_object_keys(_clean) k),
    '/workforce/wf_detail_changes', 'approval');
  RETURN _id;
END;
$$;

CREATE OR REPLACE FUNCTION ess_cancel_detail_change()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE employee_change_requests SET status = 'cancelled'
   WHERE employee_id = _ess_require_employee() AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'Nothing to cancel'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION hr_decide_detail_change(p_request_id UUID, p_approve BOOLEAN, p_note TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r employee_change_requests%ROWTYPE; _c JSONB;
BEGIN
  SELECT * INTO _r FROM employee_change_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF NOT _has_hr_permission('hr.edit', _r.site_id) THEN RAISE EXCEPTION 'You do not have permission to verify employee details'; END IF;
  IF _r.requested_by = auth.uid() THEN RAISE EXCEPTION 'Someone else in HR must verify your own details'; END IF;
  IF _r.status <> 'pending' THEN RAISE EXCEPTION 'This request is already %', _r.status; END IF;
  IF NOT p_approve AND COALESCE(TRIM(p_note), '') = '' THEN RAISE EXCEPTION 'Say why so the employee can correct it'; END IF;
  _c := _r.changes;
  IF p_approve THEN
    UPDATE employees SET
      phone               = CASE WHEN _c ? 'phone' THEN _c->>'phone' ELSE phone END,
      email               = CASE WHEN _c ? 'email' THEN _c->>'email' ELSE email END,
      residential_address = CASE WHEN _c ? 'residential_address' THEN _c->>'residential_address' ELSE residential_address END,
      bank_name           = CASE WHEN _c ? 'bank_name' THEN _c->>'bank_name' ELSE bank_name END,
      bank_branch         = CASE WHEN _c ? 'bank_branch' THEN _c->>'bank_branch' ELSE bank_branch END,
      bank_account_number = CASE WHEN _c ? 'bank_account_number' THEN _c->>'bank_account_number' ELSE bank_account_number END,
      updated_at = now()
     WHERE id = _r.employee_id;
    IF _c ?| ARRAY['nok_name','nok_relationship','nok_phone'] THEN
      IF EXISTS (SELECT 1 FROM emergency_contacts WHERE employee_id = _r.employee_id) THEN
        UPDATE emergency_contacts SET
          name         = CASE WHEN _c ? 'nok_name' THEN COALESCE(_c->>'nok_name', name) ELSE name END,
          relationship = CASE WHEN _c ? 'nok_relationship' THEN _c->>'nok_relationship' ELSE relationship END,
          phone        = CASE WHEN _c ? 'nok_phone' THEN _c->>'nok_phone' ELSE phone END
         WHERE id = (SELECT id FROM emergency_contacts WHERE employee_id = _r.employee_id
                      ORDER BY is_primary DESC NULLS LAST, created_at LIMIT 1);
      ELSIF _c->>'nok_name' IS NOT NULL THEN
        INSERT INTO emergency_contacts (employee_id, site_id, name, relationship, phone, is_primary)
        VALUES (_r.employee_id, _r.site_id, _c->>'nok_name', _c->>'nok_relationship', _c->>'nok_phone', true);
      END IF;
    END IF;
  END IF;
  UPDATE employee_change_requests SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
         reviewed_by = auth.uid(), reviewed_at = now(), review_note = NULLIF(TRIM(p_note), '')
   WHERE id = p_request_id;
  INSERT INTO notifications (site_id, user_id, type, title, message, link, category)
  VALUES (_r.site_id, _r.requested_by, 'hr_detail_change',
          CASE WHEN p_approve THEN 'Your details were updated' ELSE 'Your detail change was not accepted' END,
          COALESCE(NULLIF(TRIM(p_note), ''), 'HR verified and applied your changes.'), '/me/me_details', 'general');
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 5. Annual tax certificate (ZIMRA ITF16 figures) from approved payroll
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION ess_my_tax_certificate(p_year INT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _e UUID := _ess_require_employee();
BEGIN
  RETURN (SELECT jsonb_build_object(
      'year', p_year, 'name', e.name, 'employee_number', e.employee_number, 'national_id', e.national_id,
      'zimra_tin', e.zimra_tin, 'nssa_number', e.nssa_number, 'site', s.name,
      'months', COUNT(ss.id), 'gross', COALESCE(SUM(ss.gross_salary), 0), 'taxable', COALESCE(SUM(ss.taxable_income), 0),
      'paye', COALESCE(SUM(ss.paye), 0), 'aids_levy', COALESCE(SUM(ss.aids_levy), 0),
      'nssa', COALESCE(SUM(ss.nssa_employee), 0), 'net', COALESCE(SUM(ss.net_salary), 0),
      'available_years', (SELECT COALESCE(jsonb_agg(DISTINCT r2.period_year ORDER BY r2.period_year DESC), '[]'::jsonb)
                            FROM salary_slips s2 JOIN payroll_runs r2 ON r2.id = s2.payroll_run_id
                           WHERE s2.employee_id = _e AND NOT s2.is_archived AND r2.status IN ('approved','paid')))
    FROM employees e JOIN sites s ON s.id = e.site_id
    LEFT JOIN payroll_runs r ON r.period_year = p_year AND r.status IN ('approved','paid')
    LEFT JOIN salary_slips ss ON ss.payroll_run_id = r.id AND ss.employee_id = e.id AND NOT ss.is_archived
   WHERE e.id = _e
   GROUP BY e.id, s.name);
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 6. Documents & policies
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION ess_my_documents()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _e UUID := _ess_require_employee(); _site UUID := _ess_site();
BEGIN
  RETURN jsonb_build_object(
    'documents', COALESCE((SELECT jsonb_agg(jsonb_build_object('type', t.name, 'issued', d.issue_date, 'expires', d.expiry_date,
                               'verified', d.is_verified, 'file_name', d.file_name) ORDER BY d.expiry_date NULLS LAST)
        FROM employee_documents d LEFT JOIN document_types t ON t.id = d.document_type_id
       WHERE d.employee_id = _e AND NOT COALESCE(d.is_archived, false)), '[]'::jsonb),
    'policies', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', g.id, 'title', g.title, 'version', g.version,
                               'category', g.category, 'mandatory', g.is_mandatory, 'acknowledge_by', g.acknowledge_by,
                               'body', g.body, 'response', r.response, 'responded_at', r.created_at)
                               ORDER BY (r.id IS NULL) DESC, g.acknowledge_by NULLS LAST)
        FROM governance_documents g
        LEFT JOIN governance_responses r ON r.document_id = g.id AND r.user_id = auth.uid()
       WHERE g.doc_type = 'policy' AND g.status = 'published' AND NOT COALESCE(g.is_archived, false)
         AND (g.site_id IS NULL OR g.site_id = _site)), '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION ess_acknowledge_policy(p_document_id UUID, p_accept BOOLEAN, p_comment TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM _ess_require_employee();
  IF NOT EXISTS (SELECT 1 FROM governance_documents WHERE id = p_document_id AND doc_type = 'policy' AND status = 'published') THEN
    RAISE EXCEPTION 'Policy not found';
  END IF;
  IF NOT p_accept AND COALESCE(TRIM(p_comment), '') = '' THEN RAISE EXCEPTION 'Say why you do not accept it'; END IF;
  INSERT INTO governance_responses (document_id, user_id, response, comment)
  VALUES (p_document_id, auth.uid(), CASE WHEN p_accept THEN 'accepted' ELSE 'rejected' END, NULLIF(TRIM(p_comment), ''))
  ON CONFLICT (document_id, user_id) DO UPDATE SET response = EXCLUDED.response, comment = EXCLUDED.comment, created_at = now();
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 7. Camp life: my room, faults, meals
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS camp_room_faults (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id          UUID NOT NULL REFERENCES sites(id),
  room_id          UUID REFERENCES camp_rooms(id),
  reported_by      UUID REFERENCES profiles(id),
  employee_id      UUID REFERENCES employees(id),
  category         TEXT NOT NULL CHECK (category IN ('plumbing','electrical','furniture','door_lock','cleaning','pests','aircon_heating','other')),
  description      TEXT NOT NULL,
  photo_path       TEXT,
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','closed')),
  resolved_by      UUID REFERENCES profiles(id),
  resolved_at      TIMESTAMPTZ,
  resolution_notes TEXT,
  is_archived      BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE camp_room_faults ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS crf_select ON camp_room_faults;
DROP POLICY IF EXISTS crf_update ON camp_room_faults;
CREATE POLICY crf_select ON camp_room_faults FOR SELECT USING (reported_by = auth.uid() OR _has_permission('accommodation.view', site_id));
CREATE POLICY crf_update ON camp_room_faults FOR UPDATE USING (_has_permission('accommodation.edit', site_id));

CREATE OR REPLACE FUNCTION _ess_current_room(p_emp UUID)
RETURNS TABLE (room_id UUID, bed_id UUID, check_in DATE, check_out DATE)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.room_id, a.bed_id, a.check_in, a.check_out FROM room_assignments a
   WHERE a.employee_id = p_emp AND a.check_in <= CURRENT_DATE AND (a.check_out IS NULL OR a.check_out >= CURRENT_DATE)
     AND COALESCE(a.status, 'active') NOT IN ('checked_out','cancelled')
   ORDER BY a.check_in DESC LIMIT 1
$$;

CREATE OR REPLACE FUNCTION ess_my_camp()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _e UUID := _ess_require_employee(); _r RECORD;
BEGIN
  SELECT * INTO _r FROM _ess_current_room(_e);
  RETURN jsonb_build_object(
    'room', CASE WHEN _r.room_id IS NULL THEN NULL ELSE (
      SELECT jsonb_build_object('room_number', cr.room_number, 'room_type', cr.room_type, 'block', b.name,
             'bed', bd.bed_number, 'check_in', _r.check_in, 'check_out', _r.check_out,
             'roommates', (SELECT COALESCE(jsonb_agg(COALESCE(e2.name, a2.guest_name)), '[]'::jsonb)
                             FROM room_assignments a2 LEFT JOIN employees e2 ON e2.id = a2.employee_id
                            WHERE a2.room_id = _r.room_id AND a2.employee_id IS DISTINCT FROM _e
                              AND a2.check_in <= CURRENT_DATE AND (a2.check_out IS NULL OR a2.check_out >= CURRENT_DATE)
                              AND COALESCE(a2.status, 'active') NOT IN ('checked_out','cancelled')))
        FROM camp_rooms cr LEFT JOIN camp_blocks b ON b.id = cr.block_id LEFT JOIN beds bd ON bd.id = _r.bed_id
       WHERE cr.id = _r.room_id) END,
    'faults', COALESCE((SELECT jsonb_agg(jsonb_build_object('category', f.category, 'description', f.description,
               'status', f.status, 'created_at', f.created_at, 'resolution_notes', f.resolution_notes) ORDER BY f.created_at DESC)
        FROM camp_room_faults f WHERE f.reported_by = auth.uid() AND NOT f.is_archived), '[]'::jsonb),
    'meals', COALESCE((SELECT jsonb_agg(jsonb_build_object('date', m.date, 'b', COALESCE(m.had_breakfast, false),
               'l', COALESCE(m.had_lunch, false), 's', COALESCE(m.had_supper, false)) ORDER BY m.date DESC)
        FROM meal_logs m WHERE m.employee_id = _e AND m.date >= CURRENT_DATE - 30), '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION ess_report_room_fault(p_category TEXT, p_description TEXT, p_photo_path TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _e UUID := _ess_require_employee(); _site UUID := _ess_site(); _room UUID; _num TEXT;
BEGIN
  SELECT room_id INTO _room FROM _ess_current_room(_e);
  IF _room IS NULL THEN RAISE EXCEPTION 'You are not assigned to a camp room'; END IF;
  IF COALESCE(TRIM(p_description), '') = '' THEN RAISE EXCEPTION 'Describe the problem'; END IF;
  INSERT INTO camp_room_faults (site_id, room_id, reported_by, employee_id, category, description, photo_path)
  VALUES (_site, _room, auth.uid(), _e, COALESCE(p_category, 'other'), TRIM(p_description), p_photo_path);
  SELECT room_number INTO _num FROM camp_rooms WHERE id = _room;
  PERFORM _notify_permission(_site, 'accommodation.edit', 'camp_fault', 'Room fault: room ' || COALESCE(_num, ''),
    replace(COALESCE(p_category, 'other'), '_', ' ') || ' — ' || LEFT(TRIM(p_description), 120), '/campsite/camp_faults', 'general');
END;
$$;

CREATE OR REPLACE FUNCTION camp_update_fault(p_fault_id UUID, p_status TEXT, p_notes TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _f camp_room_faults%ROWTYPE;
BEGIN
  SELECT * INTO _f FROM camp_room_faults WHERE id = p_fault_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fault not found'; END IF;
  IF NOT _has_permission('accommodation.edit', _f.site_id) THEN RAISE EXCEPTION 'You do not have permission to update room faults'; END IF;
  IF p_status NOT IN ('open','in_progress','resolved','closed') THEN RAISE EXCEPTION 'Unknown status'; END IF;
  UPDATE camp_room_faults SET status = p_status, resolution_notes = COALESCE(NULLIF(TRIM(p_notes), ''), resolution_notes),
         resolved_by = CASE WHEN p_status IN ('resolved','closed') THEN auth.uid() ELSE resolved_by END,
         resolved_at = CASE WHEN p_status IN ('resolved','closed') THEN now() ELSE resolved_at END, updated_at = now()
   WHERE id = p_fault_id;
  IF p_status = 'resolved' AND _f.reported_by IS NOT NULL THEN
    INSERT INTO notifications (site_id, user_id, type, title, message, link, category)
    VALUES (_f.site_id, _f.reported_by, 'camp_fault', 'Your room fault was fixed', COALESCE(NULLIF(TRIM(p_notes), ''), _f.description), '/me/me_camp', 'general');
  END IF;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 8. Salary advances & loans, recovered through payroll
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS salary_advances (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id            UUID NOT NULL REFERENCES sites(id),
  reference          TEXT,
  employee_id        UUID NOT NULL REFERENCES employees(id),
  requested_by       UUID NOT NULL REFERENCES profiles(id),
  advance_type       TEXT NOT NULL CHECK (advance_type IN ('salary_advance','loan')),
  amount             NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  installments       INT NOT NULL DEFAULT 1 CHECK (installments BETWEEN 1 AND 24),
  installment_amount NUMERIC(15,2) NOT NULL,
  reason             TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','approved','rejected','active','settled','cancelled')),
  recovered_amount   NUMERIC(15,2) NOT NULL DEFAULT 0,
  approved_by        UUID REFERENCES profiles(id),
  approved_at        TIMESTAMPTZ,
  rejected_reason    TEXT,
  disbursed_by       UUID REFERENCES profiles(id),
  disbursed_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE salary_advances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sa_select ON salary_advances;
CREATE POLICY sa_select ON salary_advances FOR SELECT USING (
  requested_by = auth.uid() OR _has_hr_permission('hr.view', site_id)
  OR EXISTS (SELECT 1 FROM approval_requests r WHERE r.entity_type = 'salary_advances' AND r.entity_id = salary_advances.id
              AND r.status = 'pending' AND approval_can_act(r.id)));

CREATE OR REPLACE FUNCTION ess_request_salary_advance(p_type TEXT, p_amount NUMERIC, p_installments INT, p_reason TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _e UUID := _ess_require_employee(); _site UUID := _ess_site(); _n INT; _ref TEXT; _id UUID; _basic NUMERIC;
BEGIN
  IF p_type NOT IN ('salary_advance','loan') THEN RAISE EXCEPTION 'Choose salary advance or loan'; END IF;
  IF COALESCE(p_amount, 0) <= 0 THEN RAISE EXCEPTION 'Enter the amount'; END IF;
  IF COALESCE(TRIM(p_reason), '') = '' THEN RAISE EXCEPTION 'Give a reason'; END IF;
  IF p_type = 'salary_advance' AND COALESCE(p_installments, 1) <> 1 THEN RAISE EXCEPTION 'A salary advance is recovered from one payroll'; END IF;
  IF EXISTS (SELECT 1 FROM salary_advances WHERE employee_id = _e AND status IN ('submitted','approved','active')) THEN
    RAISE EXCEPTION 'You already have an advance or loan open — it must be settled first';
  END IF;
  SELECT basic_salary INTO _basic FROM employee_salary WHERE employee_id = _e ORDER BY effective_date DESC LIMIT 1;
  IF p_type = 'salary_advance' AND _basic IS NOT NULL AND p_amount > _basic * 0.5 THEN
    RAISE EXCEPTION 'A salary advance can be at most half your basic pay (%)', ROUND(_basic * 0.5, 2);
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('salary_advance_ref:' || _site::text));
  SELECT COALESCE(MAX(NULLIF(split_part(reference, '-', 3), '')::INT), 0) + 1 INTO _n FROM salary_advances
   WHERE site_id = _site AND reference LIKE 'ADV-' || EXTRACT(YEAR FROM now())::INT || '-%';
  _ref := 'ADV-' || EXTRACT(YEAR FROM now())::INT || '-' || LPAD(_n::TEXT, 4, '0');
  INSERT INTO salary_advances (site_id, reference, employee_id, requested_by, advance_type, amount, installments, installment_amount, reason)
  VALUES (_site, _ref, _e, auth.uid(), p_type, ROUND(p_amount, 2), COALESCE(p_installments, 1),
          ROUND(p_amount / COALESCE(p_installments, 1), 2), TRIM(p_reason))
  RETURNING id INTO _id;
  IF NOT EXISTS (SELECT 1 FROM approval_requests WHERE entity_type = 'salary_advances' AND entity_id = _id AND status = 'pending') THEN
    PERFORM _notify_permission(_site, 'hr.approve', 'salary_advance', 'Salary advance / loan to review',
      (SELECT name FROM employees WHERE id = _e) || ' — $' || ROUND(p_amount, 2) || ' — ' || TRIM(p_reason), '/workforce/wf_salary_advances', 'approval');
  END IF;
  RETURN _ref;
END;
$$;

CREATE OR REPLACE FUNCTION ess_my_salary_advances()
RETURNS TABLE (id UUID, reference TEXT, advance_type TEXT, amount NUMERIC, installments INT, installment_amount NUMERIC,
               reason TEXT, status TEXT, recovered_amount NUMERIC, rejected_reason TEXT, created_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.id, a.reference, a.advance_type, a.amount, a.installments, a.installment_amount, a.reason, a.status,
         a.recovered_amount, a.rejected_reason, a.created_at
    FROM salary_advances a WHERE a.employee_id = _ess_require_employee() ORDER BY a.created_at DESC
$$;

CREATE OR REPLACE FUNCTION ess_cancel_salary_advance(p_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE salary_advances SET status = 'cancelled', updated_at = now()
   WHERE id = p_id AND employee_id = _ess_require_employee() AND status = 'submitted';
  IF NOT FOUND THEN RAISE EXCEPTION 'Only a request still waiting for approval can be cancelled'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION hr_decide_salary_advance(p_id UUID, p_approve BOOLEAN, p_reason TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _a salary_advances%ROWTYPE;
BEGIN
  SELECT * INTO _a FROM salary_advances WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not found'; END IF;
  IF NOT _has_hr_permission('hr.approve', _a.site_id) THEN RAISE EXCEPTION 'You do not have permission to approve advances'; END IF;
  IF _a.requested_by = auth.uid() THEN RAISE EXCEPTION 'You cannot approve your own request'; END IF;
  IF _a.status <> 'submitted' THEN RAISE EXCEPTION 'This request is already %', _a.status; END IF;
  IF NOT p_approve AND COALESCE(TRIM(p_reason), '') = '' THEN RAISE EXCEPTION 'Give a reason'; END IF;
  UPDATE salary_advances SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
         approved_by = CASE WHEN p_approve THEN auth.uid() END, approved_at = CASE WHEN p_approve THEN now() END,
         rejected_reason = CASE WHEN p_approve THEN NULL ELSE TRIM(p_reason) END, updated_at = now()
   WHERE id = p_id;
  INSERT INTO notifications (site_id, user_id, type, title, message, link, category)
  VALUES (_a.site_id, _a.requested_by, 'salary_advance',
          CASE WHEN p_approve THEN 'Advance approved: ' ELSE 'Advance not approved: ' END || _a.reference,
          CASE WHEN p_approve THEN 'Finance will pay it out; it is recovered from payroll.' ELSE TRIM(p_reason) END, '/me/me_advances', 'approval');
END;
$$;

CREATE OR REPLACE FUNCTION hr_disburse_salary_advance(p_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _a salary_advances%ROWTYPE;
BEGIN
  SELECT * INTO _a FROM salary_advances WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not found'; END IF;
  IF NOT (_has_hr_permission('hr.approve', _a.site_id) OR _has_permission('expenses.edit', _a.site_id)) THEN
    RAISE EXCEPTION 'You do not have permission to pay out advances';
  END IF;
  IF _a.status <> 'approved' THEN RAISE EXCEPTION 'Only approved advances can be paid out'; END IF;
  UPDATE salary_advances SET status = 'active', disbursed_by = auth.uid(), disbursed_at = now(), updated_at = now() WHERE id = p_id;
  PERFORM gl_auto_post(_a.site_id, 'staff_loan_paid', 'salary_advances', _a.id, CURRENT_DATE, _a.amount,
                       'Staff ' || replace(_a.advance_type, '_', ' ') || ' ' || _a.reference);
  IF gl_imtt_on(_a.site_id, _a.amount) > 0 THEN
    PERFORM gl_auto_post(_a.site_id, 'imtt', 'salary_advances', _a.id, CURRENT_DATE, gl_imtt_on(_a.site_id, _a.amount), 'IMTT on ' || _a.reference);
  END IF;
  INSERT INTO notifications (site_id, user_id, type, title, message, link, category)
  VALUES (_a.site_id, _a.requested_by, 'salary_advance', 'Advance paid: ' || _a.reference,
          '$' || _a.amount || ' paid. $' || _a.installment_amount || ' will be deducted from ' ||
          CASE WHEN _a.installments = 1 THEN 'your next payroll' ELSE 'each of your next ' || _a.installments || ' payrolls' END,
          '/me/me_advances', 'general');
END;
$$;

-- Approval engine: advances are a routable document
ALTER TABLE approval_routes DROP CONSTRAINT IF EXISTS approval_routes_entity_type_check;
ALTER TABLE approval_routes ADD CONSTRAINT approval_routes_entity_type_check CHECK (entity_type IN
  ('purchase_requisitions','purchase_orders','purchase_invoices','fuel_requests','leave_requests','expense_claims','salary_advances'));

CREATE OR REPLACE FUNCTION _approval_submitted_status(p_entity TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_entity
    WHEN 'purchase_requisitions' THEN 'submitted'
    WHEN 'purchase_orders'       THEN 'pending_approval'
    WHEN 'purchase_invoices'     THEN 'pending_approval'
    WHEN 'fuel_requests'         THEN 'pending'
    WHEN 'leave_requests'        THEN 'pending'
    WHEN 'expense_claims'        THEN 'submitted'
    WHEN 'salary_advances'       THEN 'submitted' END
$$;

DO $$
DECLARE _def TEXT;
BEGIN
  -- Add the salary_advances branch to the existing entity adapter and decision applier.
  SELECT pg_get_functiondef('_approval_entity(text,uuid)'::regprocedure) INTO _def;
  IF position('salary_advances' in _def) = 0 THEN
    _def := replace(_def, E'  END IF;\nEND;', E'  ELSIF p_entity = ''salary_advances'' THEN\n    RETURN QUERY SELECT a.site_id, a.amount, e.department_id, a.requested_by,\n      CASE WHEN a.advance_type = ''loan'' THEN ''Staff loan '' ELSE ''Salary advance '' END || COALESCE(a.reference, '''') || '' — '' || COALESCE(e.name, ''''),\n      ''/workforce/wf_salary_advances'', a.status\n      FROM salary_advances a LEFT JOIN employees e ON e.id = a.employee_id WHERE a.id = p_id;\n  END IF;\nEND;');
    EXECUTE _def;
  END IF;
  SELECT pg_get_functiondef('_approval_apply(text,uuid,boolean,text)'::regprocedure) INTO _def;
  IF position('salary_advances' in _def) = 0 THEN
    _def := replace(_def, E'  END IF;\n  PERFORM set_config(''app.approval_engine'', ''off'', true);',
      E'  ELSIF p_entity = ''salary_advances'' THEN\n    UPDATE salary_advances SET status = CASE WHEN p_approved THEN ''approved'' ELSE ''rejected'' END,\n           approved_by = CASE WHEN p_approved THEN auth.uid() END, approved_at = CASE WHEN p_approved THEN now() END,\n           rejected_reason = CASE WHEN p_approved THEN NULL ELSE p_comment END, updated_at = now() WHERE id = p_id;\n  END IF;\n  PERFORM set_config(''app.approval_engine'', ''off'', true);');
    EXECUTE _def;
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_approval_gate ON salary_advances;
CREATE TRIGGER trg_approval_gate BEFORE INSERT OR UPDATE ON salary_advances FOR EACH ROW EXECUTE FUNCTION trg_approval_gate();
DROP TRIGGER IF EXISTS trg_approval_after ON salary_advances;
CREATE TRIGGER trg_approval_after AFTER INSERT OR UPDATE ON salary_advances FOR EACH ROW EXECUTE FUNCTION trg_approval_after();

-- Ledger events for loans
ALTER TABLE gl_posting_rules DROP CONSTRAINT IF EXISTS gl_posting_rules_event_code_check;
ALTER TABLE gl_posting_rules ADD CONSTRAINT gl_posting_rules_event_code_check CHECK (event_code IN (
  'fuel_issue','fuel_delivery','grn_accepted','invoice_approved','invoice_paid',
  'payroll_net','payroll_deductions','payroll_paye','payroll_nssa','payroll_nssa_employer','payroll_paid','payroll_loan_recovery',
  'meals_approved','imtt',
  'expense_approved','advance_settled','expense_paid','expense_paid_cash','advance_paid','advance_paid_cash',
  'petty_cash_topup','petty_cash_expense','petty_cash_short','petty_cash_over',
  'staff_loan_paid'));

-- Payroll: deduct advance/loan instalments and record recoveries on approval
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS total_loan_recovery NUMERIC(15,2) NOT NULL DEFAULT 0;
ALTER TABLE salary_slips ADD COLUMN IF NOT EXISTS loan_recovery NUMERIC(15,2) NOT NULL DEFAULT 0;

DO $$
DECLARE _def TEXT;
BEGIN
  SELECT pg_get_functiondef('hr_run_payroll(uuid,integer,integer,integer)'::regprocedure) INTO _def;
  IF position('loan_recovery' in _def) = 0 THEN
    -- declare
    _def := replace(_def, '_ded NUMERIC; _net NUMERIC; _detail JSONB;', '_ded NUMERIC; _net NUMERIC; _detail JSONB; _loan NUMERIC; _t_loan NUMERIC := 0; _adv RECORD;');
    -- deduct instalments after statutory items
    _def := replace(_def, E'    _ded := _other_ded + _paye + _levy + _nssa_ee;',
      E'    _loan := 0;\n    FOR _adv IN SELECT * FROM salary_advances WHERE employee_id = _emp.id AND status = ''active'' ORDER BY disbursed_at LOOP\n      _val := LEAST(_adv.installment_amount, _adv.amount - _adv.recovered_amount);\n      IF _val > 0 THEN\n        _loan := _loan + _val;\n        _detail := _detail || jsonb_build_object(''name'', CASE WHEN _adv.advance_type = ''loan'' THEN ''Staff loan '' ELSE ''Salary advance '' END || _adv.reference,\n                     ''code'', ''LOAN'', ''type'', ''deduction'', ''amount'', _val, ''advance_id'', _adv.id);\n      END IF;\n    END LOOP;\n    _ded := _other_ded + _paye + _levy + _nssa_ee + _loan;');
    _def := replace(_def, 'taxable_income, paye, aids_levy, nssa_insurable, nssa_employee, nssa_employer)',
                          'taxable_income, paye, aids_levy, nssa_insurable, nssa_employee, nssa_employer, loan_recovery)');
    _def := replace(_def, '_taxable, _paye, _levy, _insurable, _nssa_ee, _nssa_er);',
                          '_taxable, _paye, _levy, _insurable, _nssa_ee, _nssa_er, _loan);');
    _def := replace(_def, '_t_er := _t_er + _nssa_er;', '_t_er := _t_er + _nssa_er; _t_loan := _t_loan + _loan;');
    _def := replace(_def, 'total_nssa_employee = _t_ee, total_nssa_employer = _t_er, status = ''draft''',
                          'total_nssa_employee = _t_ee, total_nssa_employer = _t_er, total_loan_recovery = _t_loan, status = ''draft''');
    EXECUTE _def;
  END IF;
END $$;

-- On payroll approval, apply the recoveries; on reopen, undo them.
CREATE OR REPLACE FUNCTION trg_payroll_loan_recovery() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _sign INT; _c RECORD;
BEGIN
  IF NEW.status IN ('approved','paid') AND COALESCE(OLD.status, 'draft') NOT IN ('approved','paid') THEN _sign := 1;
  ELSIF NEW.status = 'draft' AND OLD.status IN ('approved','paid') THEN _sign := -1;
  ELSE RETURN NEW; END IF;
  FOR _c IN SELECT (c->>'advance_id')::uuid AS advance_id, SUM((c->>'amount')::numeric) AS amt
              FROM salary_slips s, jsonb_array_elements(s.components) c
             WHERE s.payroll_run_id = NEW.id AND NOT s.is_archived AND c->>'code' = 'LOAN' AND c ? 'advance_id'
             GROUP BY 1 LOOP
    UPDATE salary_advances
       SET recovered_amount = GREATEST(0, recovered_amount + _sign * _c.amt),
           status = CASE WHEN recovered_amount + _sign * _c.amt >= amount THEN 'settled' ELSE 'active' END,
           updated_at = now()
     WHERE id = _c.advance_id;
  END LOOP;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_payroll_loan_recovery ON payroll_runs;
CREATE TRIGGER trg_payroll_loan_recovery AFTER UPDATE OF status ON payroll_runs
  FOR EACH ROW EXECUTE FUNCTION trg_payroll_loan_recovery();

-- Payroll ledger: loan recoveries reduce the staff-loans asset, not "other deductions".
DO $$
DECLARE _def TEXT;
BEGIN
  SELECT pg_get_functiondef('trg_gl_payroll_runs()'::regprocedure) INTO _def;
  IF position('payroll_loan_recovery' in _def) = 0 THEN
    _def := replace(_def, '_other NUMERIC := COALESCE(NEW.total_deductions, 0) - _paye - _nssa;',
                          '_loan  NUMERIC := COALESCE(NEW.total_loan_recovery, 0);' || E'\n  ' ||
                          '_other NUMERIC := COALESCE(NEW.total_deductions, 0) - _paye - _nssa - COALESCE(NEW.total_loan_recovery, 0);');
    _def := replace(_def, E'    IF _other > 0 THEN',
      E'    IF _loan > 0 THEN\n      PERFORM gl_auto_post(NEW.site_id, ''payroll_loan_recovery'', ''payroll_runs'', NEW.id, _date,\n                           _loan, _ref || '' advance/loan recoveries'');\n    END IF;\n    IF _other > 0 THEN');
    EXECUTE _def;
  END IF;
END $$;

INSERT INTO schema_migrations (filename) VALUES ('0111_hr_self_service_phase2.sql') ON CONFLICT DO NOTHING;

COMMIT;
