-- 0115: Payroll pays overtime from supervisor-approved timesheets.
-- Hourly rate = basic / (working days × hours per day). Weekday/Saturday OT × 1.5, Sunday OT × 2 (site-configurable).
ALTER TABLE hr_statutory_settings ADD COLUMN IF NOT EXISTS ot_hours_per_day NUMERIC NOT NULL DEFAULT 8;
ALTER TABLE hr_statutory_settings ADD COLUMN IF NOT EXISTS ot_rate_normal   NUMERIC NOT NULL DEFAULT 1.5;
ALTER TABLE hr_statutory_settings ADD COLUMN IF NOT EXISTS ot_rate_sunday   NUMERIC NOT NULL DEFAULT 2.0;
ALTER TABLE salary_slips ADD COLUMN IF NOT EXISTS overtime_hours NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE salary_slips ADD COLUMN IF NOT EXISTS overtime_pay   NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS total_overtime NUMERIC NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.hr_run_payroll(p_site_id uuid, p_month integer, p_year integer, p_working_days integer DEFAULT 22)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _run      payroll_runs%ROWTYPE;
  _set      hr_statutory_settings%ROWTYPE;
  _start    DATE := make_date(p_year, p_month, 1);
  _end      DATE := (make_date(p_year, p_month, 1) + INTERVAL '1 month - 1 day')::date;
  _emp      RECORD;
  _c        RECORD;
  _basic NUMERIC; _absent INT; _worked INT; _prorated NUMERIC;
  _gross NUMERIC; _taxable_gross NUMERIC; _other_ded NUMERIC; _val NUMERIC;
  _insurable NUMERIC; _nssa_ee NUMERIC; _nssa_er NUMERIC; _taxable NUMERIC; _paye NUMERIC; _levy NUMERIC;
  _ded NUMERIC; _net NUMERIC; _detail JSONB; _loan NUMERIC; _t_loan NUMERIC := 0; _adv RECORD;
  _hourly NUMERIC; _ot_hrs NUMERIC; _ot_pay NUMERIC; _t_ot NUMERIC := 0;
  _t_gross NUMERIC := 0; _t_ded NUMERIC := 0; _t_net NUMERIC := 0;
  _t_paye NUMERIC := 0; _t_levy NUMERIC := 0; _t_ee NUMERIC := 0; _t_er NUMERIC := 0; _n INT := 0;
BEGIN
  IF NOT _has_hr_permission('hr.edit', p_site_id) THEN
    RAISE EXCEPTION 'You do not have permission to run payroll';
  END IF;

  SELECT * INTO _set FROM hr_statutory_settings WHERE site_id = p_site_id;
  IF NOT FOUND THEN
    INSERT INTO hr_statutory_settings (site_id) VALUES (p_site_id) RETURNING * INTO _set;
  END IF;

  SELECT * INTO _run FROM payroll_runs
   WHERE site_id = p_site_id AND period_month = p_month AND period_year = p_year;
  IF FOUND AND COALESCE(_run.status, 'draft') <> 'draft' THEN
    RAISE EXCEPTION 'Payroll for this month is already %', _run.status;
  END IF;
  IF NOT FOUND THEN
    INSERT INTO payroll_runs (site_id, period_month, period_year, status, created_by)
    VALUES (p_site_id, p_month, p_year, 'draft', auth.uid()) RETURNING * INTO _run;
  ELSE
    UPDATE salary_slips SET is_archived = true WHERE payroll_run_id = _run.id AND NOT is_archived;
  END IF;

  FOR _emp IN
    SELECT e.id,
           COALESCE((SELECT es.basic_salary FROM employee_salary es
                      WHERE es.employee_id = e.id AND es.site_id = p_site_id AND es.effective_date <= _end
                      ORDER BY es.effective_date DESC LIMIT 1), 0) AS basic,
           (SELECT COUNT(*) FROM attendance_logs a
             WHERE a.employee_id = e.id AND a.site_id = p_site_id AND a.is_absent
               AND a.date BETWEEN _start AND _end)::INT AS absent,
           (SELECT COALESCE(SUM(a.overtime_hours) FILTER (WHERE EXTRACT(DOW FROM a.date) <> 0), 0) FROM attendance_logs a
             WHERE a.employee_id = e.id AND a.site_id = p_site_id AND a.approval_status = 'approved'
               AND a.date BETWEEN _start AND _end) AS ot_normal,
           (SELECT COALESCE(SUM(a.overtime_hours) FILTER (WHERE EXTRACT(DOW FROM a.date) = 0), 0) FROM attendance_logs a
             WHERE a.employee_id = e.id AND a.site_id = p_site_id AND a.approval_status = 'approved'
               AND a.date BETWEEN _start AND _end) AS ot_sunday
      FROM employees e
     WHERE e.site_id = p_site_id AND e.status = 'active' AND NOT COALESCE(e.is_archived, false)
  LOOP
    _basic    := _emp.basic;
    _absent   := _emp.absent;
    _worked   := GREATEST(0, p_working_days - _absent);
    _prorated := ROUND(_basic * _worked / NULLIF(p_working_days, 0), 2);
    _gross := _prorated; _taxable_gross := _prorated; _other_ded := 0; _detail := '[]'::jsonb;

    -- Overtime from approved timesheets (taxable earnings).
    _hourly := _basic / NULLIF(p_working_days * _set.ot_hours_per_day, 0);
    _ot_hrs := COALESCE(_emp.ot_normal, 0) + COALESCE(_emp.ot_sunday, 0);
    _ot_pay := ROUND(COALESCE(_hourly, 0) * (COALESCE(_emp.ot_normal, 0) * _set.ot_rate_normal + COALESCE(_emp.ot_sunday, 0) * _set.ot_rate_sunday), 2);
    IF _ot_pay > 0 THEN
      _gross := _gross + _ot_pay; _taxable_gross := _taxable_gross + _ot_pay;
      _detail := _detail || jsonb_build_object('name', 'Overtime (' || ROUND(_ot_hrs, 2) || ' h)', 'code', 'OVERTIME',
                   'type', 'allowance', 'amount', _ot_pay, 'is_taxable', true, 'hours', _ot_hrs);
    END IF;

    FOR _c IN SELECT * FROM salary_components
               WHERE is_active AND code IS DISTINCT FROM 'PAYE' AND code IS DISTINCT FROM 'NSSA' LOOP
      _val := ROUND(CASE WHEN _c.is_percentage THEN _prorated * COALESCE(_c.percentage, 0) / 100
                         ELSE COALESCE(_c.amount, 0) END, 2);
      IF _val = 0 THEN CONTINUE; END IF;
      _detail := _detail || jsonb_build_object('id', _c.id, 'name', _c.name, 'code', _c.code,
                   'type', _c.component_type, 'amount', _val, 'is_taxable', _c.is_taxable);
      IF _c.component_type = 'allowance' THEN
        _gross := _gross + _val;
        IF _c.is_taxable THEN _taxable_gross := _taxable_gross + _val; END IF;
      ELSE
        _other_ded := _other_ded + _val;
      END IF;
    END LOOP;

    _insurable := LEAST(_gross, _set.nssa_ceiling);
    _nssa_ee   := ROUND(_insurable * _set.nssa_employee_rate / 100, 2);
    _nssa_er   := ROUND(_insurable * _set.nssa_employer_rate / 100, 2);
    _taxable   := GREATEST(_taxable_gross - CASE WHEN _set.nssa_tax_deductible THEN _nssa_ee ELSE 0 END, 0);
    _paye      := COALESCE(hr_calc_paye(p_site_id, _taxable, _end), 0);
    _levy      := ROUND(_paye * _set.aids_levy_rate / 100, 2);

    _detail := _detail
      || jsonb_build_object('name', 'PAYE', 'code', 'PAYE', 'type', 'deduction', 'amount', _paye, 'statutory', true)
      || jsonb_build_object('name', 'AIDS Levy', 'code', 'AIDS_LEVY', 'type', 'deduction', 'amount', _levy, 'statutory', true)
      || jsonb_build_object('name', 'NSSA', 'code', 'NSSA', 'type', 'deduction', 'amount', _nssa_ee, 'statutory', true);

    _loan := 0;
    FOR _adv IN SELECT * FROM salary_advances WHERE employee_id = _emp.id AND status = 'active' ORDER BY disbursed_at LOOP
      _val := LEAST(_adv.installment_amount, _adv.amount - _adv.recovered_amount);
      IF _val > 0 THEN
        _loan := _loan + _val;
        _detail := _detail || jsonb_build_object('name', CASE WHEN _adv.advance_type = 'loan' THEN 'Staff loan ' ELSE 'Salary advance ' END || _adv.reference,
                     'code', 'LOAN', 'type', 'deduction', 'amount', _val, 'advance_id', _adv.id);
      END IF;
    END LOOP;
    _ded := _other_ded + _paye + _levy + _nssa_ee + _loan;
    _net := _gross - _ded;

    INSERT INTO salary_slips (payroll_run_id, employee_id, site_id, basic_salary, gross_salary,
                              total_deductions, net_salary, days_worked, days_absent, leave_days, components,
                              taxable_income, paye, aids_levy, nssa_insurable, nssa_employee, nssa_employer, loan_recovery,
                              overtime_hours, overtime_pay)
    VALUES (_run.id, _emp.id, p_site_id, _prorated, _gross, _ded, _net, _worked, _absent, 0, _detail,
            _taxable, _paye, _levy, _insurable, _nssa_ee, _nssa_er, _loan, _ot_hrs, _ot_pay);

    _t_gross := _t_gross + _gross; _t_ded := _t_ded + _ded; _t_net := _t_net + _net; _t_ot := _t_ot + _ot_pay;
    _t_paye := _t_paye + _paye; _t_levy := _t_levy + _levy; _t_ee := _t_ee + _nssa_ee; _t_er := _t_er + _nssa_er; _t_loan := _t_loan + _loan;
    _n := _n + 1;
  END LOOP;

  UPDATE payroll_runs
     SET total_gross = _t_gross, total_deductions = _t_ded, total_net = _t_net, employee_count = _n,
         total_paye = _t_paye, total_aids_levy = _t_levy, total_overtime = _t_ot,
         total_nssa_employee = _t_ee, total_nssa_employer = _t_er, total_loan_recovery = _t_loan, status = 'draft'
   WHERE id = _run.id;

  RETURN jsonb_build_object('run_id', _run.id, 'employees', _n, 'gross', _t_gross, 'net', _t_net, 'overtime', _t_ot,
                            'paye', _t_paye, 'aids_levy', _t_levy, 'nssa_employee', _t_ee, 'nssa_employer', _t_er);
END;
$function$;

INSERT INTO schema_migrations (filename) VALUES ('0115_payroll_overtime.sql') ON CONFLICT DO NOTHING;
