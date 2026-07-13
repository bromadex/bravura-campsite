BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 0108 — HR Phase 4: Payroll — salary grades, components, runs, slips
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.salary_grades (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  site_id       UUID NOT NULL REFERENCES public.sites(id),
  name          TEXT NOT NULL,
  code          TEXT,
  basic_salary  NUMERIC(15,2) NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.salary_components (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name            TEXT NOT NULL,
  code            TEXT UNIQUE,
  component_type  TEXT NOT NULL CHECK (component_type IN ('allowance','deduction')),
  is_percentage   BOOLEAN DEFAULT false,
  amount          NUMERIC(15,2),
  percentage      NUMERIC(5,2),
  is_taxable      BOOLEAN DEFAULT true,
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.employee_salary (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id      UUID NOT NULL REFERENCES public.employees(id),
  site_id          UUID NOT NULL REFERENCES public.sites(id),
  salary_grade_id  UUID REFERENCES public.salary_grades(id),
  basic_salary     NUMERIC(15,2) NOT NULL,
  effective_date   DATE NOT NULL,
  end_date         DATE,
  created_at       TIMESTAMPTZ DEFAULT now(),
  created_by       UUID REFERENCES public.profiles(id)
);

CREATE TABLE IF NOT EXISTS public.payroll_runs (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  site_id          UUID NOT NULL REFERENCES public.sites(id),
  period_month     INTEGER NOT NULL,
  period_year      INTEGER NOT NULL,
  status           TEXT DEFAULT 'draft',
  total_gross      NUMERIC(15,2),
  total_deductions NUMERIC(15,2),
  total_net        NUMERIC(15,2),
  employee_count   INTEGER,
  approved_by      UUID REFERENCES public.profiles(id),
  approved_at      TIMESTAMPTZ,
  paid_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT now(),
  created_by       UUID REFERENCES public.profiles(id),
  UNIQUE(site_id, period_month, period_year)
);

CREATE TABLE IF NOT EXISTS public.salary_slips (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  payroll_run_id    UUID NOT NULL REFERENCES public.payroll_runs(id),
  employee_id       UUID NOT NULL REFERENCES public.employees(id),
  site_id           UUID NOT NULL REFERENCES public.sites(id),
  basic_salary      NUMERIC(15,2),
  gross_salary      NUMERIC(15,2),
  total_deductions  NUMERIC(15,2),
  net_salary        NUMERIC(15,2),
  days_worked       INTEGER,
  days_absent       INTEGER,
  leave_days        INTEGER,
  components        JSONB,
  created_at        TIMESTAMPTZ DEFAULT now()
);

-- ── Performance Appraisals ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.appraisal_cycles (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  site_id      UUID NOT NULL REFERENCES public.sites(id),
  name         TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end   DATE NOT NULL,
  status       TEXT DEFAULT 'open',
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.appraisals (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cycle_id         UUID NOT NULL REFERENCES public.appraisal_cycles(id),
  employee_id      UUID NOT NULL REFERENCES public.employees(id),
  site_id          UUID NOT NULL REFERENCES public.sites(id),
  appraiser_id     UUID REFERENCES public.employees(id),
  self_score       NUMERIC(3,1),
  manager_score    NUMERIC(3,1),
  final_score      NUMERIC(3,1),
  rating           TEXT,
  self_comments    TEXT,
  manager_comments TEXT,
  status           TEXT DEFAULT 'pending',
  created_at       TIMESTAMPTZ DEFAULT now()
);

-- ── Disciplinary Cases ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.disciplinary_cases (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id    UUID NOT NULL REFERENCES public.employees(id),
  site_id        UUID NOT NULL REFERENCES public.sites(id),
  case_number    TEXT NOT NULL,
  incident_date  DATE NOT NULL,
  incident_type  TEXT,
  description    TEXT NOT NULL,
  outcome        TEXT,
  hearing_date   DATE,
  status         TEXT DEFAULT 'open',
  closed_at      TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT now(),
  created_by     UUID REFERENCES public.profiles(id)
);

-- ── Exit Management ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.exit_records (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id             UUID NOT NULL REFERENCES public.employees(id),
  site_id                 UUID NOT NULL REFERENCES public.sites(id),
  exit_type               TEXT NOT NULL,
  last_working_date       DATE NOT NULL,
  exit_interview_date     DATE,
  exit_interview_notes    TEXT,
  clearance_completed     BOOLEAN DEFAULT false,
  clearance_date          DATE,
  clearance_by            UUID REFERENCES public.profiles(id),
  final_payslip_generated BOOLEAN DEFAULT false,
  status                  TEXT DEFAULT 'in_progress',
  created_at              TIMESTAMPTZ DEFAULT now()
);

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE public.salary_grades        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salary_components    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_salary      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_runs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salary_slips         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appraisal_cycles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appraisals           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disciplinary_cases   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exit_records         ENABLE ROW LEVEL SECURITY;

-- salary_components: global lookup
DROP POLICY IF EXISTS salary_components_read  ON public.salary_components;
DROP POLICY IF EXISTS salary_components_write ON public.salary_components;
CREATE POLICY salary_components_read  ON public.salary_components FOR SELECT TO authenticated USING (true);
CREATE POLICY salary_components_write ON public.salary_components FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM user_roles ur
      JOIN role_permissions rp ON rp.role_id = ur.role_id
      JOIN permissions p ON p.id = rp.permission_id
     WHERE ur.user_id = auth.uid() AND p.code = 'hr.edit'));

-- site-scoped tables helper macro
DO $$ DECLARE tbl TEXT; BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'salary_grades','employee_salary','payroll_runs','salary_slips',
    'appraisal_cycles','appraisals','disciplinary_cases','exit_records'
  ]) LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_read', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_insert', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_update', tbl);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
       USING (public._has_hr_permission(''hr.view'', site_id))', tbl || '_read', tbl);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated
       WITH CHECK (public._has_hr_permission(''hr.edit'', site_id))', tbl || '_insert', tbl);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated
       USING (public._has_hr_permission(''hr.edit'', site_id))
       WITH CHECK (public._has_hr_permission(''hr.edit'', site_id))', tbl || '_update', tbl);
  END LOOP;
END $$;

-- ── Seed default salary components ───────────────────────────────────────────
INSERT INTO public.salary_components (name, code, component_type, is_percentage, percentage, is_taxable) VALUES
  ('Housing Allowance',   'HOUSING',    'allowance',  true,  25.00, true),
  ('Transport Allowance', 'TRANSPORT',  'allowance',  true,  15.00, true),
  ('PAYE',                'PAYE',       'deduction',  true,  25.00, true),
  ('NSSA',                'NSSA',       'deduction',  true,   4.50, false),
  ('Medical Aid',         'MEDICAL',    'deduction',  false, NULL,  false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.schema_migrations (filename)
VALUES ('0108_hr_payroll.sql') ON CONFLICT (filename) DO NOTHING;

COMMIT;
