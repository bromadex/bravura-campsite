BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 0083 — Contract & Contractor Management (CL module)
--
-- Extends the existing `contractors` table with company details, adds contracts,
-- casual workers, contractor employees, timesheets, hired vehicles/equipment.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Enrich existing contractors table ─────────────────────────────────────
ALTER TABLE public.contractors ADD COLUMN IF NOT EXISTS site_id           UUID REFERENCES public.sites(id);
ALTER TABLE public.contractors ADD COLUMN IF NOT EXISTS registration_no   TEXT;
ALTER TABLE public.contractors ADD COLUMN IF NOT EXISTS tax_number        TEXT;
ALTER TABLE public.contractors ADD COLUMN IF NOT EXISTS vat_number        TEXT;
ALTER TABLE public.contractors ADD COLUMN IF NOT EXISTS contact_person    TEXT;
ALTER TABLE public.contractors ADD COLUMN IF NOT EXISTS phone             TEXT;
ALTER TABLE public.contractors ADD COLUMN IF NOT EXISTS email             TEXT;
ALTER TABLE public.contractors ADD COLUMN IF NOT EXISTS address           TEXT;
ALTER TABLE public.contractors ADD COLUMN IF NOT EXISTS contractor_type   TEXT DEFAULT 'service';
ALTER TABLE public.contractors ADD COLUMN IF NOT EXISTS services_offered  TEXT;
ALTER TABLE public.contractors ADD COLUMN IF NOT EXISTS bank_name         TEXT;
ALTER TABLE public.contractors ADD COLUMN IF NOT EXISTS bank_account      TEXT;
ALTER TABLE public.contractors ADD COLUMN IF NOT EXISTS bank_branch       TEXT;
ALTER TABLE public.contractors ADD COLUMN IF NOT EXISTS insurance_expiry  DATE;
ALTER TABLE public.contractors ADD COLUMN IF NOT EXISTS safety_rating     NUMERIC(3,1);
ALTER TABLE public.contractors ADD COLUMN IF NOT EXISTS notes             TEXT;

-- ── 2. Contracts ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.contractor_contracts (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  site_id           UUID NOT NULL REFERENCES public.sites(id),
  contractor_id     UUID NOT NULL REFERENCES public.contractors(id),
  contract_number   TEXT NOT NULL,
  description       TEXT,
  start_date        DATE NOT NULL,
  end_date          DATE,
  payment_method    TEXT NOT NULL DEFAULT 'monthly',
  agreed_rate       NUMERIC(15,2),
  contract_value    NUMERIC(15,2),
  spent_to_date     NUMERIC(15,2) DEFAULT 0,
  retention_pct     NUMERIC(5,2),
  status            TEXT DEFAULT 'active',
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT now(),
  created_by        UUID REFERENCES public.profiles(id),
  UNIQUE(site_id, contract_number)
);

-- ── 3. Casual Workers ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.casual_workers (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  site_id           UUID NOT NULL REFERENCES public.sites(id),
  contractor_id     UUID REFERENCES public.contractors(id),
  contract_id       UUID REFERENCES public.contractor_contracts(id),
  employee_number   TEXT,
  name              TEXT NOT NULL,
  national_id       TEXT,
  phone             TEXT,
  emergency_contact TEXT,
  trade             TEXT,
  skill_level       TEXT DEFAULT 'general',
  department_id     UUID REFERENCES public.departments(id),
  supervisor_id     UUID REFERENCES public.employees(id),
  rate_type         TEXT NOT NULL DEFAULT 'daily',
  rate              NUMERIC(12,2) NOT NULL DEFAULT 0,
  overtime_rate     NUMERIC(12,2),
  night_shift_rate  NUMERIC(12,2),
  weekend_rate      NUMERIC(12,2),
  bank_name         TEXT,
  bank_account      TEXT,
  status            TEXT DEFAULT 'available',
  photo_url         TEXT,
  medical_expiry    DATE,
  notes             TEXT,
  is_archived       BOOLEAN DEFAULT false,
  archived_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT now(),
  created_by        UUID REFERENCES public.profiles(id)
);

-- ── 4. Contractor Employees ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.contractor_employees (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  site_id           UUID NOT NULL REFERENCES public.sites(id),
  contractor_id     UUID NOT NULL REFERENCES public.contractors(id),
  contract_id       UUID REFERENCES public.contractor_contracts(id),
  name              TEXT NOT NULL,
  national_id       TEXT,
  phone             TEXT,
  role              TEXT,
  trade             TEXT,
  access_card       TEXT,
  induction_date    DATE,
  medical_expiry    DATE,
  ppe_issued        BOOLEAN DEFAULT false,
  accommodation_id  UUID,
  meals_authorised  BOOLEAN DEFAULT true,
  fuel_authorised   BOOLEAN DEFAULT false,
  status            TEXT DEFAULT 'active',
  notes             TEXT,
  is_archived       BOOLEAN DEFAULT false,
  archived_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT now()
);

-- ── 5. Casual Timesheets ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.casual_timesheets (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  site_id          UUID NOT NULL REFERENCES public.sites(id),
  casual_worker_id UUID NOT NULL REFERENCES public.casual_workers(id),
  contractor_id    UUID REFERENCES public.contractors(id),
  contract_id      UUID REFERENCES public.contractor_contracts(id),
  date             DATE NOT NULL,
  shift            TEXT,
  clock_in         TIME,
  clock_out        TIME,
  break_minutes    INTEGER DEFAULT 0,
  hours_worked     NUMERIC(5,2),
  overtime_hours   NUMERIC(5,2) DEFAULT 0,
  normal_cost      NUMERIC(12,2),
  overtime_cost    NUMERIC(12,2),
  total_cost       NUMERIC(12,2),
  supervisor_id    UUID REFERENCES public.employees(id),
  approved         BOOLEAN DEFAULT false,
  approved_by      UUID REFERENCES public.profiles(id),
  approved_at      TIMESTAMPTZ,
  notes            TEXT,
  created_at       TIMESTAMPTZ DEFAULT now(),
  created_by       UUID REFERENCES public.profiles(id),
  UNIQUE(casual_worker_id, date)
);

-- ── 6. Hired Vehicles ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.hired_vehicles (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  site_id           UUID NOT NULL REFERENCES public.sites(id),
  contractor_id     UUID NOT NULL REFERENCES public.contractors(id),
  contract_id       UUID REFERENCES public.contractor_contracts(id),
  fleet_asset_id    UUID REFERENCES public.fleet_assets(id),
  description       TEXT NOT NULL,
  registration      TEXT,
  vehicle_type      TEXT,
  daily_rate        NUMERIC(12,2),
  hourly_rate       NUMERIC(12,2),
  km_rate           NUMERIC(12,2),
  driver_included   BOOLEAN DEFAULT false,
  fuel_included     BOOLEAN DEFAULT false,
  assigned_operator UUID REFERENCES public.employees(id),
  status            TEXT DEFAULT 'active',
  start_date        DATE,
  end_date          DATE,
  notes             TEXT,
  is_archived       BOOLEAN DEFAULT false,
  archived_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT now()
);

-- ── 7. Hired Equipment ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.hired_equipment (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  site_id           UUID NOT NULL REFERENCES public.sites(id),
  contractor_id     UUID NOT NULL REFERENCES public.contractors(id),
  contract_id       UUID REFERENCES public.contractor_contracts(id),
  fleet_asset_id    UUID REFERENCES public.fleet_assets(id),
  description       TEXT NOT NULL,
  equipment_type    TEXT,
  serial_number     TEXT,
  daily_rate        NUMERIC(12,2),
  hourly_rate       NUMERIC(12,2),
  fuel_included     BOOLEAN DEFAULT false,
  operator_included BOOLEAN DEFAULT false,
  status            TEXT DEFAULT 'active',
  start_date        DATE,
  end_date          DATE,
  notes             TEXT,
  is_archived       BOOLEAN DEFAULT false,
  archived_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT now()
);

-- ── 8. RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE public.contractor_contracts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.casual_workers         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contractor_employees   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.casual_timesheets      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hired_vehicles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hired_equipment        ENABLE ROW LEVEL SECURITY;

-- Helper: reuse the _has_permission pattern for contractors module
DO $$ DECLARE tbl TEXT; BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'contractor_contracts','casual_workers','contractor_employees',
    'casual_timesheets','hired_vehicles','hired_equipment'
  ]) LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_read', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_insert', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_update', tbl);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
       USING (public._has_permission(''contractors.view'', site_id))', tbl || '_read', tbl);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated
       WITH CHECK (public._has_permission(''contractors.edit'', site_id))', tbl || '_insert', tbl);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated
       USING (public._has_permission(''contractors.edit'', site_id))
       WITH CHECK (public._has_permission(''contractors.edit'', site_id))', tbl || '_update', tbl);
  END LOOP;
END $$;

-- ── 9. Indexes ───────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_contracts_site       ON public.contractor_contracts(site_id);
CREATE INDEX IF NOT EXISTS idx_contracts_contractor ON public.contractor_contracts(contractor_id);
CREATE INDEX IF NOT EXISTS idx_casuals_site         ON public.casual_workers(site_id);
CREATE INDEX IF NOT EXISTS idx_casuals_contractor   ON public.casual_workers(contractor_id);
CREATE INDEX IF NOT EXISTS idx_timesheets_site      ON public.casual_timesheets(site_id);
CREATE INDEX IF NOT EXISTS idx_timesheets_date      ON public.casual_timesheets(date);
CREATE INDEX IF NOT EXISTS idx_timesheets_worker    ON public.casual_timesheets(casual_worker_id);
CREATE INDEX IF NOT EXISTS idx_hired_veh_site       ON public.hired_vehicles(site_id);
CREATE INDEX IF NOT EXISTS idx_hired_eq_site        ON public.hired_equipment(site_id);

INSERT INTO public.schema_migrations (filename)
VALUES ('0083_contract_contractor_management.sql') ON CONFLICT (filename) DO NOTHING;

COMMIT;
