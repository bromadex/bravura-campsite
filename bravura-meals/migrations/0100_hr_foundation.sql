-- ══════════════════════════════════════════════════════════════════════════════
-- 0100 — HR Phase 1 foundation
-- ══════════════════════════════════════════════════════════════════════════════
-- Departments (EXTENDS the existing global table — fuel/fleet already read it,
-- so it is altered, never recreated), designations, employment types,
-- emergency contacts, module settings, an automatic employee status-history
-- trail, new employee columns, hr.* permission seeds, and meals-pattern RLS
-- (permission + site checked server-side; no USING(true) anywhere).
-- First migration in Tafara's reserved 0100–0149 range.

BEGIN;

-- ── 1. departments: extend the existing table ────────────────────────────────
-- Existing rows are global (site_id NULL) and stay visible everywhere;
-- new HR-created departments are site-scoped.
ALTER TABLE public.departments ADD COLUMN IF NOT EXISTS site_id UUID REFERENCES sites(id);
ALTER TABLE public.departments ADD COLUMN IF NOT EXISTS code TEXT;
ALTER TABLE public.departments ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.departments ADD COLUMN IF NOT EXISTS parent_department_id UUID REFERENCES departments(id);
ALTER TABLE public.departments ADD COLUMN IF NOT EXISTS department_head_id UUID REFERENCES employees(id);
ALTER TABLE public.departments ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.departments ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE public.departments ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public.departments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public.departments ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES profiles(id);

CREATE UNIQUE INDEX IF NOT EXISTS departments_site_code
  ON public.departments (site_id, code) WHERE code IS NOT NULL;

-- ── 2. designations ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.designations (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id       UUID        NOT NULL REFERENCES sites(id),
  name          TEXT        NOT NULL,
  code          TEXT,
  department_id UUID        REFERENCES departments(id),
  grade         TEXT,
  description   TEXT,
  is_archived   BOOLEAN     NOT NULL DEFAULT false,
  archived_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID        REFERENCES profiles(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS designations_site_code
  ON public.designations (site_id, code) WHERE code IS NOT NULL;
CREATE INDEX IF NOT EXISTS designations_site ON public.designations(site_id);

-- ── 3. employment_types (global lookup) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.employment_types (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  code        TEXT        UNIQUE,
  description TEXT,
  is_archived BOOLEAN     NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.employment_types (name, code) VALUES
  ('Permanent',  'PERM'),
  ('Contract',   'CONTRACT'),
  ('Casual',     'CASUAL'),
  ('Fixed-Term', 'FIXED')
ON CONFLICT (code) DO NOTHING;

-- ── 4. employee_status_history ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.employee_status_history (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id    UUID        NOT NULL REFERENCES employees(id),
  site_id        UUID        NOT NULL REFERENCES sites(id),
  old_status     TEXT,
  new_status     TEXT        NOT NULL,
  reason         TEXT,
  effective_date DATE        NOT NULL DEFAULT CURRENT_DATE,
  changed_by     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS emp_status_hist_emp  ON public.employee_status_history(employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS emp_status_hist_site ON public.employee_status_history(site_id, created_at DESC);

-- Trigger-written so EVERY status change is captured no matter which code
-- path performs it (same philosophy as meal_submission_events in 0077).
-- The UI passes reason via a session-scoped setting before the update.
CREATE OR REPLACE FUNCTION public.log_employee_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.employee_status_history
    (employee_id, site_id, old_status, new_status, reason, effective_date, changed_by)
  VALUES (
    NEW.id,
    NEW.site_id,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.status ELSE NULL END,
    NEW.status,
    NULLIF(current_setting('app.status_change_reason', true), ''),
    COALESCE(NULLIF(current_setting('app.status_change_effective', true), '')::DATE, CURRENT_DATE),
    auth.uid()
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_employee_status ON public.employees;
CREATE TRIGGER trg_log_employee_status
  AFTER INSERT OR UPDATE OF status ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.log_employee_status_change();

-- RPC the UI calls to change status with a reason (sets the session vars the
-- trigger reads, re-checks permission server-side, applies end_date on
-- termination).
CREATE OR REPLACE FUNCTION public.change_employee_status(
  p_employee_id    UUID,
  p_new_status     TEXT,
  p_reason         TEXT,
  p_effective_date DATE DEFAULT CURRENT_DATE,
  p_end_date       DATE DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_site UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT site_id INTO v_site FROM public.employees WHERE id = p_employee_id;
  IF v_site IS NULL THEN RAISE EXCEPTION 'Employee not found'; END IF;
  IF NOT public._has_hr_permission(
       CASE WHEN p_new_status = 'terminated' THEN 'hr.terminate' ELSE 'hr.edit' END, v_site) THEN
    RAISE EXCEPTION 'You do not have permission to change employee status on this site';
  END IF;
  IF p_new_status NOT IN ('active','on_leave','long_leave','temporary_assignment','transferred','terminated') THEN
    RAISE EXCEPTION 'Invalid status %', p_new_status;
  END IF;
  IF COALESCE(TRIM(p_reason), '') = '' THEN
    RAISE EXCEPTION 'A reason is required';
  END IF;

  PERFORM set_config('app.status_change_reason', p_reason, true);
  PERFORM set_config('app.status_change_effective', p_effective_date::TEXT, true);

  UPDATE public.employees
     SET status   = p_new_status,
         end_date = CASE WHEN p_new_status = 'terminated'
                         THEN COALESCE(p_end_date, p_effective_date)
                         ELSE end_date END
   WHERE id = p_employee_id;
END;
$$;
REVOKE ALL ON FUNCTION public.change_employee_status(UUID, TEXT, TEXT, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.change_employee_status(UUID, TEXT, TEXT, DATE, DATE) TO authenticated;

-- ── 5. emergency_contacts ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.emergency_contacts (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id  UUID        NOT NULL REFERENCES employees(id),
  site_id      UUID        NOT NULL REFERENCES sites(id),
  name         TEXT        NOT NULL,
  relationship TEXT        NOT NULL,
  phone        TEXT        NOT NULL,
  email        TEXT,
  is_primary   BOOLEAN     NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS emergency_contacts_emp ON public.emergency_contacts(employee_id);

-- ── 6. module_settings (generic per-site key/value, first consumer: HR) ──────
CREATE TABLE IF NOT EXISTS public.module_settings (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id    UUID        NOT NULL REFERENCES sites(id),
  module     TEXT        NOT NULL,
  key        TEXT        NOT NULL,
  value      JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID        REFERENCES profiles(id),
  UNIQUE (site_id, module, key)
);

-- ── 7. employees: new columns (ADD ONLY — four modules read this table) ──────
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS department_id      UUID REFERENCES departments(id);
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS designation_id     UUID REFERENCES designations(id);
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS employment_type_id UUID REFERENCES employment_types(id);
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS manager_id         UUID REFERENCES employees(id);
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS employee_number    TEXT;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS date_of_birth      DATE;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS national_id        TEXT;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS passport_number    TEXT;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS phone              TEXT;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS email              TEXT;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS start_date         DATE;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS end_date           DATE;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS has_system_account BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS is_archived        BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS archived_at        TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS employees_site_number
  ON public.employees (site_id, employee_number) WHERE employee_number IS NOT NULL;

-- ── 8. hr.* permission seeds + grants ─────────────────────────────────────────
DO $$
DECLARE
  perm TEXT;
BEGIN
  FOREACH perm IN ARRAY ARRAY[
    'hr.view', 'hr.create', 'hr.edit', 'hr.terminate',
    'hr.export', 'hr.accounts', 'hr.settings'
  ] LOOP
    INSERT INTO permissions (code, module, action)
    SELECT perm, 'hr', split_part(perm, '.', 2)
    WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = perm);
  END LOOP;

  UPDATE permissions SET module = 'hr', description = 'View HR data (employees, departments, designations)' WHERE code = 'hr.view';
  UPDATE permissions SET module = 'hr', description = 'Create employees and HR records'                     WHERE code = 'hr.create';
  UPDATE permissions SET module = 'hr', description = 'Edit employees, change status, manage HR lookups'    WHERE code = 'hr.edit';
  UPDATE permissions SET module = 'hr', description = 'Terminate employees'                                  WHERE code = 'hr.terminate';
  UPDATE permissions SET module = 'hr', description = 'Export HR reports (CSV)'                              WHERE code = 'hr.export';
  UPDATE permissions SET module = 'hr', description = 'Create system accounts for employees'                 WHERE code = 'hr.accounts';
  UPDATE permissions SET module = 'hr', description = 'Edit HR module settings'                              WHERE code = 'hr.settings';

  -- Grants mirror existing access: whoever can view/edit employees today
  -- gets the equivalent hr.* codes; the sensitive ones (terminate, accounts,
  -- settings) go only to roles that hold employees.edit.
  INSERT INTO role_permissions (role_id, permission_id)
  SELECT rp.role_id, p_new.id
    FROM role_permissions rp
    JOIN permissions p_old ON p_old.id = rp.permission_id AND p_old.code = 'employees.view'
    JOIN permissions p_new ON p_new.code = 'hr.view'
  ON CONFLICT DO NOTHING;

  INSERT INTO role_permissions (role_id, permission_id)
  SELECT rp.role_id, p_new.id
    FROM role_permissions rp
    JOIN permissions p_old ON p_old.id = rp.permission_id AND p_old.code = 'employees.edit'
    JOIN permissions p_new ON p_new.code IN
      ('hr.create','hr.edit','hr.terminate','hr.export','hr.accounts','hr.settings')
  ON CONFLICT DO NOTHING;
END $$;

-- ── 9. RLS — meals-pattern helper: permission AND site, checked in the DB ────
CREATE OR REPLACE FUNCTION public._has_hr_permission(p_code TEXT, p_site_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM user_roles ur
      JOIN role_permissions rp ON rp.role_id = ur.role_id
      JOIN permissions p       ON p.id = rp.permission_id
     WHERE ur.user_id = auth.uid()
       AND p.code = p_code
       AND (ur.site_id IS NULL OR ur.site_id = p_site_id)
  );
$$;

ALTER TABLE public.designations            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employment_types        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emergency_contacts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.module_settings         ENABLE ROW LEVEL SECURITY;

-- designations: site-scoped read with hr.view; writes need hr.edit
DROP POLICY IF EXISTS designations_read   ON public.designations;
DROP POLICY IF EXISTS designations_insert ON public.designations;
DROP POLICY IF EXISTS designations_update ON public.designations;
CREATE POLICY designations_read   ON public.designations FOR SELECT TO authenticated
  USING (public._has_hr_permission('hr.view', site_id));
CREATE POLICY designations_insert ON public.designations FOR INSERT TO authenticated
  WITH CHECK (public._has_hr_permission('hr.edit', site_id));
CREATE POLICY designations_update ON public.designations FOR UPDATE TO authenticated
  USING (public._has_hr_permission('hr.edit', site_id));

-- employment_types: global lookup — readable by all signed-in users; writes
-- need hr.settings on any site
DROP POLICY IF EXISTS employment_types_read  ON public.employment_types;
DROP POLICY IF EXISTS employment_types_write ON public.employment_types;
CREATE POLICY employment_types_read  ON public.employment_types FOR SELECT TO authenticated USING (true);
CREATE POLICY employment_types_write ON public.employment_types FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM user_roles ur
      JOIN role_permissions rp ON rp.role_id = ur.role_id
      JOIN permissions p ON p.id = rp.permission_id
     WHERE ur.user_id = auth.uid() AND p.code = 'hr.settings'));

-- employee_status_history: read with hr.view for the site; written ONLY by
-- the SECURITY DEFINER trigger — no client insert/update/delete policies.
DROP POLICY IF EXISTS emp_status_hist_read ON public.employee_status_history;
CREATE POLICY emp_status_hist_read ON public.employee_status_history FOR SELECT TO authenticated
  USING (public._has_hr_permission('hr.view', site_id));

-- emergency_contacts: personal data — hr.view to read, hr.edit to write
DROP POLICY IF EXISTS emergency_contacts_read   ON public.emergency_contacts;
DROP POLICY IF EXISTS emergency_contacts_insert ON public.emergency_contacts;
DROP POLICY IF EXISTS emergency_contacts_update ON public.emergency_contacts;
DROP POLICY IF EXISTS emergency_contacts_delete ON public.emergency_contacts;
CREATE POLICY emergency_contacts_read   ON public.emergency_contacts FOR SELECT TO authenticated
  USING (public._has_hr_permission('hr.view', site_id));
CREATE POLICY emergency_contacts_insert ON public.emergency_contacts FOR INSERT TO authenticated
  WITH CHECK (public._has_hr_permission('hr.edit', site_id));
CREATE POLICY emergency_contacts_update ON public.emergency_contacts FOR UPDATE TO authenticated
  USING (public._has_hr_permission('hr.edit', site_id));
CREATE POLICY emergency_contacts_delete ON public.emergency_contacts FOR DELETE TO authenticated
  USING (public._has_hr_permission('hr.edit', site_id));

-- module_settings: readable by signed-in users of the site; writes gated on
-- <module>.settings permission (hr.settings for module='hr')
DROP POLICY IF EXISTS module_settings_read  ON public.module_settings;
DROP POLICY IF EXISTS module_settings_write ON public.module_settings;
CREATE POLICY module_settings_read  ON public.module_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY module_settings_write ON public.module_settings FOR ALL TO authenticated
  USING (public._has_hr_permission(module || '.settings', site_id))
  WITH CHECK (public._has_hr_permission(module || '.settings', site_id));

-- updated_at maintenance
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS trg_touch_departments  ON public.departments;
CREATE TRIGGER trg_touch_departments  BEFORE UPDATE ON public.departments  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS trg_touch_designations ON public.designations;
CREATE TRIGGER trg_touch_designations BEFORE UPDATE ON public.designations FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.schema_migrations (filename)
VALUES ('0100_hr_foundation.sql') ON CONFLICT (filename) DO NOTHING;

COMMIT;
