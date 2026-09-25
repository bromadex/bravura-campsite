-- 0116: Public holiday calendar. Overtime worked on a public holiday is paid at ot_rate_holiday (2×).
-- site_id NULL = national holiday (all sites); a site row adds a site-only holiday.
CREATE TABLE IF NOT EXISTS public_holidays (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id     UUID REFERENCES sites(id),
  date        DATE NOT NULL,
  name        TEXT NOT NULL,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  created_by  UUID REFERENCES profiles(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_public_holidays ON public_holidays (COALESCE(site_id, '00000000-0000-0000-0000-000000000000'::uuid), date) WHERE NOT is_archived;
ALTER TABLE public_holidays ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ph_select ON public_holidays;
DROP POLICY IF EXISTS ph_insert ON public_holidays;
DROP POLICY IF EXISTS ph_update ON public_holidays;
CREATE POLICY ph_select ON public_holidays FOR SELECT USING (auth.uid() IS NOT NULL);
-- National rows: HR at any site may maintain; site rows: HR at that site.
CREATE POLICY ph_insert ON public_holidays FOR INSERT WITH CHECK (
  CASE WHEN site_id IS NULL THEN EXISTS (SELECT 1 FROM sites s WHERE _has_hr_permission('hr.edit', s.id)) ELSE _has_hr_permission('hr.edit', site_id) END);
CREATE POLICY ph_update ON public_holidays FOR UPDATE USING (
  CASE WHEN site_id IS NULL THEN EXISTS (SELECT 1 FROM sites s WHERE _has_hr_permission('hr.edit', s.id)) ELSE _has_hr_permission('hr.edit', site_id) END);

ALTER TABLE hr_statutory_settings ADD COLUMN IF NOT EXISTS ot_rate_holiday NUMERIC NOT NULL DEFAULT 2.0;

-- Zimbabwe public holidays 2026–2027 (a holiday on a Sunday moves to Monday).
INSERT INTO public_holidays (site_id, date, name)
SELECT NULL, d::date, n FROM (VALUES
  ('2026-01-01','New Year''s Day'), ('2026-02-21','National Youth Day'), ('2026-04-03','Good Friday'),
  ('2026-04-04','Holy Saturday'), ('2026-04-06','Easter Monday'), ('2026-04-18','Independence Day'),
  ('2026-05-01','Workers'' Day'), ('2026-05-25','Africa Day'), ('2026-08-10','Heroes'' Day'),
  ('2026-08-11','Defence Forces Day'), ('2026-12-22','National Unity Day'), ('2026-12-25','Christmas Day'),
  ('2026-12-26','Boxing Day'),
  ('2027-01-01','New Year''s Day'), ('2027-02-22','National Youth Day (observed)'), ('2027-03-26','Good Friday'),
  ('2027-03-27','Holy Saturday'), ('2027-03-29','Easter Monday'), ('2027-04-19','Independence Day (observed)'),
  ('2027-05-01','Workers'' Day'), ('2027-05-25','Africa Day'), ('2027-08-09','Heroes'' Day'),
  ('2027-08-10','Defence Forces Day'), ('2027-12-22','National Unity Day'), ('2027-12-25','Christmas Day'),
  ('2027-12-27','Boxing Day (observed)')
) v(d, n)
WHERE NOT EXISTS (SELECT 1 FROM public_holidays h WHERE h.site_id IS NULL AND h.date = v.d::date AND NOT h.is_archived);

CREATE OR REPLACE FUNCTION _is_public_holiday(p_site UUID, p_date DATE)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public_holidays h WHERE h.date = p_date AND NOT h.is_archived AND (h.site_id IS NULL OR h.site_id = p_site))
$$;

-- Payroll: holiday overtime separated out and paid at ot_rate_holiday.
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
  _hourly NUMERIC; _ot_hrs NUMERIC; _ot_hol NUMERIC; _ot_pay NUMERIC; _t_ot NUMERIC := 0;
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
           (SELECT COALESCE(SUM(a.overtime_hours) FILTER (WHERE EXTRACT(DOW FROM a.date) <> 0 AND NOT _is_public_holiday(p_site_id, a.date)), 0) FROM attendance_logs a
             WHERE a.employee_id = e.id AND a.site_id = p_site_id AND a.approval_status = 'approved'
               AND a.date BETWEEN _start AND _end) AS ot_normal,
           (SELECT COALESCE(SUM(a.overtime_hours) FILTER (WHERE EXTRACT(DOW FROM a.date) = 0 AND NOT _is_public_holiday(p_site_id, a.date)), 0) FROM attendance_logs a
             WHERE a.employee_id = e.id AND a.site_id = p_site_id AND a.approval_status = 'approved'
               AND a.date BETWEEN _start AND _end) AS ot_sunday,
           (SELECT COALESCE(SUM(a.overtime_hours) FILTER (WHERE _is_public_holiday(p_site_id, a.date)), 0) FROM attendance_logs a
             WHERE a.employee_id = e.id AND a.site_id = p_site_id AND a.approval_status = 'approved'
               AND a.date BETWEEN _start AND _end) AS ot_holiday
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
    _ot_hol := COALESCE(_emp.ot_holiday, 0);
    _ot_hrs := COALESCE(_emp.ot_normal, 0) + COALESCE(_emp.ot_sunday, 0) + _ot_hol;
    _ot_pay := ROUND(COALESCE(_hourly, 0) * (COALESCE(_emp.ot_normal, 0) * _set.ot_rate_normal
                 + COALESCE(_emp.ot_sunday, 0) * _set.ot_rate_sunday + _ot_hol * _set.ot_rate_holiday), 2);
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

INSERT INTO schema_migrations (filename) VALUES ('0116_public_holidays.sql') ON CONFLICT DO NOTHING;
