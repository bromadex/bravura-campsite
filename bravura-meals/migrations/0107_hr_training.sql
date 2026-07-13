BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 0107 — HR Phase 3: Training Programs & Skills Matrix
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Skills ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.skills (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT NOT NULL,
  category    TEXT,
  description TEXT,
  is_active   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ── 2. Employee Skills ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.employee_skills (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id       UUID NOT NULL REFERENCES public.employees(id),
  skill_id          UUID NOT NULL REFERENCES public.skills(id),
  proficiency_level TEXT,
  acquired_date     DATE,
  expiry_date       DATE,
  certified_by      TEXT,
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT now(),
  UNIQUE(employee_id, skill_id)
);

-- ── 3. Training Programs ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.training_programs (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  site_id          UUID NOT NULL REFERENCES public.sites(id),
  title            TEXT NOT NULL,
  description      TEXT,
  trainer          TEXT,
  start_date       DATE,
  end_date         DATE,
  max_participants INTEGER,
  status           TEXT DEFAULT 'planned',
  created_at       TIMESTAMPTZ DEFAULT now()
);

-- ── 4. Training Enrollments ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.training_enrollments (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  training_program_id  UUID NOT NULL REFERENCES public.training_programs(id),
  employee_id          UUID NOT NULL REFERENCES public.employees(id),
  site_id              UUID NOT NULL REFERENCES public.sites(id),
  status               TEXT DEFAULT 'enrolled',
  completion_date      DATE,
  score                NUMERIC(5,2),
  certificate_path     TEXT,
  notes                TEXT,
  created_at           TIMESTAMPTZ DEFAULT now(),
  UNIQUE(training_program_id, employee_id)
);

-- ── 5. RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE public.skills               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_skills      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_programs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_enrollments ENABLE ROW LEVEL SECURITY;

-- skills: global lookup, readable by all authenticated
DROP POLICY IF EXISTS skills_read  ON public.skills;
DROP POLICY IF EXISTS skills_write ON public.skills;
CREATE POLICY skills_read  ON public.skills FOR SELECT TO authenticated USING (true);
CREATE POLICY skills_write ON public.skills FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM user_roles ur
      JOIN role_permissions rp ON rp.role_id = ur.role_id
      JOIN permissions p ON p.id = rp.permission_id
     WHERE ur.user_id = auth.uid() AND p.code = 'hr.edit'));

-- employee_skills: readable by hr.view holders (join through employees for site)
DROP POLICY IF EXISTS employee_skills_read   ON public.employee_skills;
DROP POLICY IF EXISTS employee_skills_insert ON public.employee_skills;
DROP POLICY IF EXISTS employee_skills_update ON public.employee_skills;
DROP POLICY IF EXISTS employee_skills_delete ON public.employee_skills;
CREATE POLICY employee_skills_read ON public.employee_skills FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM employees e
     WHERE e.id = employee_id
       AND public._has_hr_permission('hr.view', e.site_id)));
CREATE POLICY employee_skills_insert ON public.employee_skills FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM employees e
     WHERE e.id = employee_id
       AND public._has_hr_permission('hr.edit', e.site_id)));
CREATE POLICY employee_skills_update ON public.employee_skills FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM employees e
     WHERE e.id = employee_id
       AND public._has_hr_permission('hr.edit', e.site_id)));
CREATE POLICY employee_skills_delete ON public.employee_skills FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM employees e
     WHERE e.id = employee_id
       AND public._has_hr_permission('hr.edit', e.site_id)));

-- training_programs: site-scoped
DROP POLICY IF EXISTS training_programs_read   ON public.training_programs;
DROP POLICY IF EXISTS training_programs_insert ON public.training_programs;
DROP POLICY IF EXISTS training_programs_update ON public.training_programs;
CREATE POLICY training_programs_read   ON public.training_programs FOR SELECT TO authenticated
  USING (public._has_hr_permission('hr.view', site_id));
CREATE POLICY training_programs_insert ON public.training_programs FOR INSERT TO authenticated
  WITH CHECK (public._has_hr_permission('hr.edit', site_id));
CREATE POLICY training_programs_update ON public.training_programs FOR UPDATE TO authenticated
  USING (public._has_hr_permission('hr.edit', site_id));

-- training_enrollments: site-scoped
DROP POLICY IF EXISTS training_enrollments_read   ON public.training_enrollments;
DROP POLICY IF EXISTS training_enrollments_insert ON public.training_enrollments;
DROP POLICY IF EXISTS training_enrollments_update ON public.training_enrollments;
CREATE POLICY training_enrollments_read   ON public.training_enrollments FOR SELECT TO authenticated
  USING (public._has_hr_permission('hr.view', site_id));
CREATE POLICY training_enrollments_insert ON public.training_enrollments FOR INSERT TO authenticated
  WITH CHECK (public._has_hr_permission('hr.edit', site_id));
CREATE POLICY training_enrollments_update ON public.training_enrollments FOR UPDATE TO authenticated
  USING (public._has_hr_permission('hr.edit', site_id));

-- ── 6. Seed common skills for mining operations ──────────────────────────────
INSERT INTO public.skills (name, category) VALUES
  ('First Aid',              'Safety'),
  ('Fire Fighting',          'Safety'),
  ('Working at Heights',     'Safety'),
  ('Confined Space Entry',   'Safety'),
  ('Blasting',               'Mining'),
  ('Drilling',               'Mining'),
  ('Excavator Operation',    'Equipment'),
  ('Loader Operation',       'Equipment'),
  ('Dump Truck Operation',   'Equipment'),
  ('Forklift Operation',     'Equipment'),
  ('Welding',                'Technical'),
  ('Electrical',             'Technical'),
  ('Mechanical Fitting',     'Technical'),
  ('Plumbing',               'Technical'),
  ('Supervisory Management', 'Management')
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename)
VALUES ('0107_hr_training.sql') ON CONFLICT (filename) DO NOTHING;

COMMIT;
