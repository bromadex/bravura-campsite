-- 0109_hr_zim_statutory_payroll.sql
-- Roadmap #48 Phase B: Zimbabwe PAYE bands, AIDS levy and NSSA computed server-side,
-- replacing the flat 25% PAYE / 4.5% NSSA salary components. USD only.
BEGIN;

-- ═══════════════════════════════════════════════════════════════════════
-- 1. PAYE bands (monthly, USD) — editable per site, dated for yearly changes
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS hr_paye_bands (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id        UUID NOT NULL REFERENCES sites(id),
  effective_from DATE NOT NULL,
  lower_bound    NUMERIC(15,2) NOT NULL,
  upper_bound    NUMERIC(15,2),              -- NULL = no upper limit
  rate           NUMERIC(5,2) NOT NULL CHECK (rate >= 0 AND rate <= 100),
  deduct_amount  NUMERIC(15,2) NOT NULL DEFAULT 0,
  is_archived    BOOLEAN NOT NULL DEFAULT false,
  created_by     UUID REFERENCES auth.users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_hr_paye_bands_site ON hr_paye_bands (site_id, effective_from DESC);

ALTER TABLE hr_paye_bands ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hpb_select ON hr_paye_bands;
DROP POLICY IF EXISTS hpb_insert ON hr_paye_bands;
DROP POLICY IF EXISTS hpb_update ON hr_paye_bands;
CREATE POLICY hpb_select ON hr_paye_bands FOR SELECT USING (_has_hr_permission('hr.view', site_id));
CREATE POLICY hpb_insert ON hr_paye_bands FOR INSERT WITH CHECK (_has_hr_permission('hr.settings', site_id));
CREATE POLICY hpb_update ON hr_paye_bands FOR UPDATE USING (_has_hr_permission('hr.settings', site_id));

-- ═══════════════════════════════════════════════════════════════════════
-- 2. Statutory rates per site
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS hr_statutory_settings (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id              UUID NOT NULL UNIQUE REFERENCES sites(id),
  aids_levy_rate       NUMERIC(5,2)  NOT NULL DEFAULT 3.00,   -- % of PAYE
  nssa_employee_rate   NUMERIC(5,2)  NOT NULL DEFAULT 4.50,   -- % of insurable earnings
  nssa_employer_rate   NUMERIC(5,2)  NOT NULL DEFAULT 4.50,
  nssa_ceiling         NUMERIC(15,2) NOT NULL DEFAULT 700.00, -- monthly insurable earnings cap (USD)
  nssa_tax_deductible  BOOLEAN       NOT NULL DEFAULT true,   -- employee NSSA reduces taxable income
  updated_by           UUID REFERENCES auth.users(id),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE hr_statutory_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hss_select ON hr_statutory_settings;
DROP POLICY IF EXISTS hss_insert ON hr_statutory_settings;
DROP POLICY IF EXISTS hss_update ON hr_statutory_settings;
CREATE POLICY hss_select ON hr_statutory_settings FOR SELECT USING (_has_hr_permission('hr.view', site_id));
CREATE POLICY hss_insert ON hr_statutory_settings FOR INSERT WITH CHECK (_has_hr_permission('hr.settings', site_id));
CREATE POLICY hss_update ON hr_statutory_settings FOR UPDATE USING (_has_hr_permission('hr.settings', site_id));

-- Seed every site: settings + the USD monthly bands in force from 1 Jan 2025.
INSERT INTO hr_statutory_settings (site_id)
SELECT id FROM sites ON CONFLICT (site_id) DO NOTHING;

INSERT INTO hr_paye_bands (site_id, effective_from, lower_bound, upper_bound, rate, deduct_amount)
SELECT s.id, DATE '2025-01-01', b.lo, b.hi, b.rate, b.ded
  FROM sites s
 CROSS JOIN (VALUES
   (0.00,    100.00,  0.00,   0.00),
   (100.01,  300.00,  20.00,  20.00),
   (300.01,  1000.00, 25.00,  35.00),
   (1000.01, 2000.00, 30.00,  85.00),
   (2000.01, 3000.00, 35.00,  185.00),
   (3000.01, NULL,    40.00,  335.00)
 ) AS b(lo, hi, rate, ded)
 WHERE NOT EXISTS (SELECT 1 FROM hr_paye_bands x WHERE x.site_id = s.id);

-- ═══════════════════════════════════════════════════════════════════════
-- 3. Employee statutory numbers, slip + run breakdown columns
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS nssa_number TEXT,
  ADD COLUMN IF NOT EXISTS zimra_tin   TEXT;

ALTER TABLE salary_slips
  ADD COLUMN IF NOT EXISTS taxable_income  NUMERIC(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paye            NUMERIC(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS aids_levy       NUMERIC(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nssa_insurable  NUMERIC(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nssa_employee   NUMERIC(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nssa_employer   NUMERIC(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_archived     BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE payroll_runs
  ADD COLUMN IF NOT EXISTS total_paye           NUMERIC(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_aids_levy      NUMERIC(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_nssa_employee  NUMERIC(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_nssa_employer  NUMERIC(15,2) NOT NULL DEFAULT 0;

-- PAYE and NSSA are now statutory, not flat components.
UPDATE salary_components SET is_active = false WHERE code IN ('PAYE','NSSA');

-- ═══════════════════════════════════════════════════════════════════════
-- 4. PAYE calculation
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION hr_calc_paye(p_site_id UUID, p_taxable NUMERIC, p_on DATE)
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH eff AS (
    SELECT MAX(effective_from) d FROM hr_paye_bands
     WHERE site_id = p_site_id AND NOT is_archived AND effective_from <= p_on
  )
  SELECT COALESCE(GREATEST(ROUND(p_taxable * b.rate / 100 - b.deduct_amount, 2), 0), 0)
    FROM hr_paye_bands b, eff
   WHERE b.site_id = p_site_id AND NOT b.is_archived AND b.effective_from = eff.d
     AND b.lower_bound <= p_taxable   -- highest band whose floor is reached; no gaps between bands
   ORDER BY b.lower_bound DESC
   LIMIT 1
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 5. Payroll run (server-side). Re-running a draft archives its old slips.
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION hr_run_payroll(p_site_id UUID, p_month INT, p_year INT, p_working_days INT DEFAULT 22)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
  _ded NUMERIC; _net NUMERIC; _detail JSONB;
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
               AND a.date BETWEEN _start AND _end)::INT AS absent
      FROM employees e
     WHERE e.site_id = p_site_id AND e.status = 'active' AND NOT COALESCE(e.is_archived, false)
  LOOP
    _basic    := _emp.basic;
    _absent   := _emp.absent;
    _worked   := GREATEST(0, p_working_days - _absent);
    _prorated := ROUND(_basic * _worked / NULLIF(p_working_days, 0), 2);
    _gross := _prorated; _taxable_gross := _prorated; _other_ded := 0; _detail := '[]'::jsonb;

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

    _ded := _other_ded + _paye + _levy + _nssa_ee;
    _net := _gross - _ded;

    INSERT INTO salary_slips (payroll_run_id, employee_id, site_id, basic_salary, gross_salary,
                              total_deductions, net_salary, days_worked, days_absent, leave_days, components,
                              taxable_income, paye, aids_levy, nssa_insurable, nssa_employee, nssa_employer)
    VALUES (_run.id, _emp.id, p_site_id, _prorated, _gross, _ded, _net, _worked, _absent, 0, _detail,
            _taxable, _paye, _levy, _insurable, _nssa_ee, _nssa_er);

    _t_gross := _t_gross + _gross; _t_ded := _t_ded + _ded; _t_net := _t_net + _net;
    _t_paye := _t_paye + _paye; _t_levy := _t_levy + _levy; _t_ee := _t_ee + _nssa_ee; _t_er := _t_er + _nssa_er;
    _n := _n + 1;
  END LOOP;

  UPDATE payroll_runs
     SET total_gross = _t_gross, total_deductions = _t_ded, total_net = _t_net, employee_count = _n,
         total_paye = _t_paye, total_aids_levy = _t_levy,
         total_nssa_employee = _t_ee, total_nssa_employer = _t_er, status = 'draft'
   WHERE id = _run.id;

  RETURN jsonb_build_object('run_id', _run.id, 'employees', _n, 'gross', _t_gross, 'net', _t_net,
                            'paye', _t_paye, 'aids_levy', _t_levy, 'nssa_employee', _t_ee, 'nssa_employer', _t_er);
END;
$$;

INSERT INTO schema_migrations (filename)
VALUES ('0109_hr_zim_statutory_payroll.sql')
ON CONFLICT DO NOTHING;

COMMIT;
