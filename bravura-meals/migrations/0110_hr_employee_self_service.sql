-- 0110_hr_employee_self_service.sql
-- Roadmap #48 Phase D: employee self-service. Every function acts only on the
-- caller's own employee record (profiles.employee_id), so no table RLS changes.
BEGIN;

CREATE OR REPLACE FUNCTION _ess_employee_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT employee_id FROM profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION _ess_require_employee()
RETURNS UUID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _e UUID := _ess_employee_id();
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _e IS NULL THEN RAISE EXCEPTION 'Your login is not linked to an employee record — ask HR to link it'; END IF;
  RETURN _e;
END;
$$;

-- Weekdays between two dates inclusive (matches the HR leave page)
CREATE OR REPLACE FUNCTION hr_working_days(p_start DATE, p_end DATE)
RETURNS INT LANGUAGE sql IMMUTABLE AS $$
  SELECT COUNT(*)::INT FROM generate_series(p_start, p_end, INTERVAL '1 day') d
   WHERE EXTRACT(ISODOW FROM d) < 6
$$;

CREATE OR REPLACE FUNCTION ess_me()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _e   UUID := _ess_employee_id();
  _out JSONB;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _e IS NULL THEN RETURN jsonb_build_object('linked', false); END IF;
  SELECT jsonb_build_object(
    'linked', true,
    'employee_id', e.id, 'name', e.name, 'employee_number', e.employee_number,
    'site_id', e.site_id, 'site_name', s.name, 'status', e.status, 'start_date', e.start_date,
    'department', d.name, 'designation', g.name,
    'manager', m.name,
    'pending_leave', (SELECT COUNT(*) FROM leave_requests l WHERE l.employee_id = e.id AND l.status = 'pending'),
    'last_payslip', (SELECT jsonb_build_object('period_month', r.period_month, 'period_year', r.period_year, 'net', ss.net_salary)
                       FROM salary_slips ss JOIN payroll_runs r ON r.id = ss.payroll_run_id
                      WHERE ss.employee_id = e.id AND NOT ss.is_archived AND r.status IN ('approved','paid')
                      ORDER BY r.period_year DESC, r.period_month DESC LIMIT 1))
    INTO _out
    FROM employees e
    LEFT JOIN sites s ON s.id = e.site_id
    LEFT JOIN departments d ON d.id = e.department_id
    LEFT JOIN designations g ON g.id = e.designation_id
    LEFT JOIN employees m ON m.id = e.manager_id
   WHERE e.id = _e;
  RETURN COALESCE(_out, jsonb_build_object('linked', false));
END;
$$;

-- Only approved or paid payroll is visible to the employee.
CREATE OR REPLACE FUNCTION ess_my_payslips()
RETURNS TABLE (id UUID, period_month INT, period_year INT, run_status TEXT, basic_salary NUMERIC, gross_salary NUMERIC,
               taxable_income NUMERIC, paye NUMERIC, aids_levy NUMERIC, nssa_employee NUMERIC,
               total_deductions NUMERIC, net_salary NUMERIC, days_worked INT, days_absent INT, components JSONB, paid_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ss.id, r.period_month, r.period_year, r.status, ss.basic_salary, ss.gross_salary,
         ss.taxable_income, ss.paye, ss.aids_levy, ss.nssa_employee,
         ss.total_deductions, ss.net_salary, ss.days_worked, ss.days_absent, ss.components, r.paid_at
    FROM salary_slips ss JOIN payroll_runs r ON r.id = ss.payroll_run_id
   WHERE ss.employee_id = _ess_require_employee() AND NOT ss.is_archived AND r.status IN ('approved','paid')
   ORDER BY r.period_year DESC, r.period_month DESC
$$;

CREATE OR REPLACE FUNCTION ess_my_leave()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _e UUID := _ess_require_employee();
BEGIN
  RETURN jsonb_build_object(
    'balances', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'leave_type_id', t.id, 'leave_type', t.name,
               'allocated', COALESCE(a.allocated_days, 0) + COALESCE(a.carried_over_days, 0),
               'used', COALESCE(a.used_days, 0),
               'remaining', COALESCE(a.allocated_days, 0) + COALESCE(a.carried_over_days, 0) - COALESCE(a.used_days, 0))
             ORDER BY t.name)
        FROM leave_types t
        LEFT JOIN leave_allocations a ON a.leave_type_id = t.id AND a.employee_id = _e
                                     AND a.year = EXTRACT(YEAR FROM CURRENT_DATE)::INT
       WHERE COALESCE(t.is_active, true)), '[]'::jsonb),
    'requests', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', l.id, 'leave_type', t.name, 'start_date', l.start_date, 'end_date', l.end_date,
               'days', l.days_requested, 'reason', l.reason, 'status', l.status,
               'rejected_reason', l.rejected_reason, 'created_at', l.created_at,
               'waiting_on', (SELECT st.label FROM approval_requests ar
                                JOIN approval_route_steps st ON st.route_id = ar.route_id AND st.step_order = ar.current_step AND NOT st.is_archived
                               WHERE ar.entity_type = 'leave_requests' AND ar.entity_id = l.id AND ar.status = 'pending'))
             ORDER BY l.start_date DESC)
        FROM leave_requests l LEFT JOIN leave_types t ON t.id = l.leave_type_id
       WHERE l.employee_id = _e), '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION ess_request_leave(p_leave_type_id UUID, p_start DATE, p_end DATE, p_reason TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _e    UUID := _ess_require_employee();
  _site UUID;
  _days INT;
  _id   UUID;
BEGIN
  IF p_start IS NULL OR p_end IS NULL OR p_end < p_start THEN RAISE EXCEPTION 'Pick a start date and an end date on or after it'; END IF;
  IF p_start < CURRENT_DATE - 30 THEN RAISE EXCEPTION 'Leave more than 30 days in the past must be captured by HR'; END IF;
  IF NOT EXISTS (SELECT 1 FROM leave_types WHERE id = p_leave_type_id AND COALESCE(is_active, true)) THEN
    RAISE EXCEPTION 'Choose a leave type';
  END IF;
  _days := hr_working_days(p_start, p_end);
  IF _days = 0 THEN RAISE EXCEPTION 'Those dates fall on a weekend — no working days requested'; END IF;
  IF EXISTS (SELECT 1 FROM leave_requests WHERE employee_id = _e AND status IN ('pending','approved')
              AND start_date <= p_end AND end_date >= p_start) THEN
    RAISE EXCEPTION 'You already have leave pending or approved over those dates';
  END IF;
  SELECT site_id INTO _site FROM employees WHERE id = _e;
  INSERT INTO leave_requests (site_id, employee_id, leave_type_id, start_date, end_date, days_requested, reason, status, created_by)
  VALUES (_site, _e, p_leave_type_id, p_start, p_end, _days, NULLIF(TRIM(p_reason), ''), 'pending', auth.uid())
  RETURNING id INTO _id;

  -- Tell HR approvers unless an approval route already notified someone.
  IF NOT EXISTS (SELECT 1 FROM approval_requests WHERE entity_type = 'leave_requests' AND entity_id = _id AND status = 'pending') THEN
    INSERT INTO notifications (site_id, user_id, type, title, message, link, category)
    SELECT DISTINCT _site, ur.user_id, 'hr_leave_submitted', 'Leave request to review',
           (SELECT name FROM employees WHERE id = _e) || ' requested ' || _days || ' day(s) from ' || p_start,
           '/workforce/wf_leave_requests', 'approval'
      FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id
     WHERE p.code = 'hr.approve' AND COALESCE(ur.is_active, true) AND (ur.site_id IS NULL OR ur.site_id = _site)
       AND ur.user_id <> auth.uid();
  END IF;
  RETURN _id;
END;
$$;

CREATE OR REPLACE FUNCTION ess_cancel_leave(p_request_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _e UUID := _ess_require_employee();
BEGIN
  UPDATE leave_requests SET status = 'cancelled', cancelled_at = now()
   WHERE id = p_request_id AND employee_id = _e AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'Only your own pending requests can be cancelled'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION ess_my_attendance(p_from DATE, p_to DATE)
RETURNS TABLE (date DATE, clock_in TEXT, clock_out TEXT, hours_worked NUMERIC, is_absent BOOLEAN, is_late BOOLEAN, overtime_hours NUMERIC, notes TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.date, a.clock_in::TEXT, a.clock_out::TEXT, a.hours_worked, a.is_absent, a.is_late, a.overtime_hours, a.notes
    FROM attendance_logs a
   WHERE a.employee_id = _ess_require_employee() AND a.date BETWEEN p_from AND p_to
   ORDER BY a.date DESC
$$;

REVOKE ALL ON FUNCTION ess_me(), ess_my_payslips(), ess_my_leave(), ess_request_leave(UUID, DATE, DATE, TEXT),
  ess_cancel_leave(UUID), ess_my_attendance(DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ess_me(), ess_my_payslips(), ess_my_leave(), ess_request_leave(UUID, DATE, DATE, TEXT),
  ess_cancel_leave(UUID), ess_my_attendance(DATE, DATE) TO authenticated;

INSERT INTO schema_migrations (filename) VALUES ('0110_hr_employee_self_service.sql') ON CONFLICT DO NOTHING;

COMMIT;
