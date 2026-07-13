BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 0106 — HR Phase 3: Attendance & Shift Management
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Shifts ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.shifts (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  site_id         UUID NOT NULL REFERENCES public.sites(id),
  name            TEXT NOT NULL,
  code            TEXT,
  start_time      TIME NOT NULL,
  end_time        TIME NOT NULL,
  duration_hours  NUMERIC(4,2),
  is_night_shift  BOOLEAN DEFAULT false,
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- ── 2. Shift Assignments ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.shift_assignments (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id  UUID NOT NULL REFERENCES public.employees(id),
  site_id      UUID NOT NULL REFERENCES public.sites(id),
  shift_id     UUID NOT NULL REFERENCES public.shifts(id),
  start_date   DATE NOT NULL,
  end_date     DATE,
  created_at   TIMESTAMPTZ DEFAULT now(),
  created_by   UUID REFERENCES public.profiles(id)
);

-- ── 3. Attendance Logs ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.attendance_logs (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id     UUID NOT NULL REFERENCES public.employees(id),
  site_id         UUID NOT NULL REFERENCES public.sites(id),
  date            DATE NOT NULL,
  clock_in        TIMESTAMPTZ,
  clock_out       TIMESTAMPTZ,
  hours_worked    NUMERIC(5,2),
  is_absent       BOOLEAN DEFAULT false,
  is_late         BOOLEAN DEFAULT false,
  overtime_hours  NUMERIC(5,2) DEFAULT 0,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  created_by      UUID REFERENCES public.profiles(id),
  UNIQUE(employee_id, date)
);

-- ── 4. RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE public.shifts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_assignments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_logs    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shifts_read   ON public.shifts;
DROP POLICY IF EXISTS shifts_insert ON public.shifts;
DROP POLICY IF EXISTS shifts_update ON public.shifts;
CREATE POLICY shifts_read   ON public.shifts   FOR SELECT TO authenticated
  USING (public._has_hr_permission('hr.view', site_id));
CREATE POLICY shifts_insert ON public.shifts   FOR INSERT TO authenticated
  WITH CHECK (public._has_hr_permission('hr.edit', site_id));
CREATE POLICY shifts_update ON public.shifts   FOR UPDATE TO authenticated
  USING (public._has_hr_permission('hr.edit', site_id));

DROP POLICY IF EXISTS shift_assignments_read   ON public.shift_assignments;
DROP POLICY IF EXISTS shift_assignments_insert ON public.shift_assignments;
DROP POLICY IF EXISTS shift_assignments_update ON public.shift_assignments;
CREATE POLICY shift_assignments_read   ON public.shift_assignments FOR SELECT TO authenticated
  USING (public._has_hr_permission('hr.view', site_id));
CREATE POLICY shift_assignments_insert ON public.shift_assignments FOR INSERT TO authenticated
  WITH CHECK (public._has_hr_permission('hr.edit', site_id));
CREATE POLICY shift_assignments_update ON public.shift_assignments FOR UPDATE TO authenticated
  USING (public._has_hr_permission('hr.edit', site_id));

DROP POLICY IF EXISTS attendance_logs_read   ON public.attendance_logs;
DROP POLICY IF EXISTS attendance_logs_insert ON public.attendance_logs;
DROP POLICY IF EXISTS attendance_logs_update ON public.attendance_logs;
CREATE POLICY attendance_logs_read   ON public.attendance_logs FOR SELECT TO authenticated
  USING (public._has_hr_permission('hr.view', site_id));
CREATE POLICY attendance_logs_insert ON public.attendance_logs FOR INSERT TO authenticated
  WITH CHECK (public._has_hr_permission('hr.edit', site_id));
CREATE POLICY attendance_logs_update ON public.attendance_logs FOR UPDATE TO authenticated
  USING (public._has_hr_permission('hr.edit', site_id));

-- ── 5. Seed default shift ────────────────────────────────────────────────────
-- Each site gets a default day shift seeded on first use from the UI

INSERT INTO public.schema_migrations (filename)
VALUES ('0106_hr_attendance.sql') ON CONFLICT (filename) DO NOTHING;

COMMIT;
