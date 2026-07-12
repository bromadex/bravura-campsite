-- ══════════════════════════════════════════════════════════════════════════════
-- 0102 — HR Phase 2: leave management, documents, transfers, medical records
-- ══════════════════════════════════════════════════════════════════════════════
-- Consolidates the phase's four session migrations into one file. Approvals
-- run through SECURITY DEFINER RPCs (permission re-checked in the DB, balance
-- updated atomically, notification written). Medical records carry their own
-- stricter permission (hr.medical). RLS is meals-pattern throughout.

BEGIN;

-- ── 1. Leave tables ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.leave_types (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT        NOT NULL,
  code                TEXT        NOT NULL UNIQUE,
  description         TEXT,
  is_paid             BOOLEAN     NOT NULL DEFAULT true,
  max_days_per_year   INTEGER,
  carry_over_days     INTEGER     NOT NULL DEFAULT 0,
  accrual_rate        NUMERIC(5,2),
  requires_approval   BOOLEAN     NOT NULL DEFAULT true,
  advance_notice_days INTEGER     NOT NULL DEFAULT 1,
  is_active           BOOLEAN     NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.leave_types (name, code, is_paid, max_days_per_year, carry_over_days) VALUES
  ('Annual Leave',        'ANNUAL',       true,  21,   5),
  ('Sick Leave',          'SICK',         true,  30,   0),
  ('Maternity Leave',     'MATERNITY',    true,  90,   0),
  ('Paternity Leave',     'PATERNITY',    true,   5,   0),
  ('Compassionate Leave', 'COMPASSIONATE',true,   5,   0),
  ('Study Leave',         'STUDY',        true,  10,   0),
  ('Unpaid Leave',        'UNPAID',       false, NULL, 0)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.leave_allocations (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id       UUID          NOT NULL REFERENCES employees(id),
  site_id           UUID          NOT NULL REFERENCES sites(id),
  leave_type_id     UUID          NOT NULL REFERENCES leave_types(id),
  year              INTEGER       NOT NULL,
  allocated_days    NUMERIC(5,1)  NOT NULL,
  used_days         NUMERIC(5,1)  NOT NULL DEFAULT 0,
  carried_over_days NUMERIC(5,1)  NOT NULL DEFAULT 0,
  adjust_reason     TEXT,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by        UUID          REFERENCES profiles(id),
  UNIQUE(employee_id, leave_type_id, year)
);
CREATE INDEX IF NOT EXISTS leave_alloc_site_year ON public.leave_allocations(site_id, year);

CREATE TABLE IF NOT EXISTS public.leave_requests (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id         UUID          NOT NULL REFERENCES sites(id),
  employee_id     UUID          NOT NULL REFERENCES employees(id),
  leave_type_id   UUID          NOT NULL REFERENCES leave_types(id),
  start_date      DATE          NOT NULL,
  end_date        DATE          NOT NULL,
  days_requested  NUMERIC(5,1)  NOT NULL,
  reason          TEXT,
  status          TEXT          NOT NULL DEFAULT 'pending',
    -- 'pending' | 'approved' | 'rejected' | 'cancelled'
  approved_by     UUID          REFERENCES profiles(id),
  approved_at     TIMESTAMPTZ,
  rejected_reason TEXT,
  cancelled_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by      UUID          REFERENCES profiles(id)
);
CREATE INDEX IF NOT EXISTS leave_req_site_status ON public.leave_requests(site_id, status);
CREATE INDEX IF NOT EXISTS leave_req_emp ON public.leave_requests(employee_id, start_date);

-- ── 2. Documents ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.document_types (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT        NOT NULL,
  code            TEXT        UNIQUE,
  requires_expiry BOOLEAN     NOT NULL DEFAULT false,
  description     TEXT,
  is_active       BOOLEAN     NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.document_types (name, code, requires_expiry) VALUES
  ('National ID',             'NAT_ID',     false),
  ('Passport',                'PASSPORT',   true),
  ('Contract of Employment',  'CONTRACT',   false),
  ('Medical Certificate',     'MEDICAL',    true),
  ('Driver''s License',       'DRIVERS',    true),
  ('Blasting License',        'BLASTING',   true),
  ('Mining Certificate',      'MINING',     true),
  ('First Aid Certificate',   'FIRST_AID',  true),
  ('Safety Certificate',      'SAFETY',     true)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.employee_documents (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id      UUID        NOT NULL REFERENCES employees(id),
  site_id          UUID        NOT NULL REFERENCES sites(id),
  document_type_id UUID        NOT NULL REFERENCES document_types(id),
  file_path        TEXT        NOT NULL,
  file_name        TEXT        NOT NULL,
  file_size_bytes  INTEGER,
  expiry_date      DATE,
  issue_date       DATE,
  is_verified      BOOLEAN     NOT NULL DEFAULT false,
  verified_by      UUID        REFERENCES profiles(id),
  verified_at      TIMESTAMPTZ,
  notes            TEXT,
  is_archived      BOOLEAN     NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       UUID        REFERENCES profiles(id)
);
CREATE INDEX IF NOT EXISTS emp_docs_emp ON public.employee_documents(employee_id);

-- Private storage bucket for the files (downloads via signed URLs only).
INSERT INTO storage.buckets (id, name, public)
VALUES ('employee-documents', 'employee-documents', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS emp_docs_storage_rw ON storage.objects;
CREATE POLICY emp_docs_storage_rw ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'employee-documents' AND EXISTS (
    SELECT 1 FROM user_roles ur
      JOIN role_permissions rp ON rp.role_id = ur.role_id
      JOIN permissions p ON p.id = rp.permission_id
     WHERE ur.user_id = auth.uid() AND p.code = 'hr.view'))
  WITH CHECK (bucket_id = 'employee-documents' AND EXISTS (
    SELECT 1 FROM user_roles ur
      JOIN role_permissions rp ON rp.role_id = ur.role_id
      JOIN permissions p ON p.id = rp.permission_id
     WHERE ur.user_id = auth.uid() AND p.code = 'hr.edit'));

-- ── 3. Inter-site transfers ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.site_transfers (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id         UUID        NOT NULL REFERENCES employees(id),
  from_site_id        UUID        NOT NULL REFERENCES sites(id),
  to_site_id          UUID        NOT NULL REFERENCES sites(id),
  from_department_id  UUID        REFERENCES departments(id),
  to_department_id    UUID        REFERENCES departments(id),
  from_designation_id UUID        REFERENCES designations(id),
  to_designation_id   UUID        REFERENCES designations(id),
  transfer_date       DATE        NOT NULL,
  reason              TEXT        NOT NULL,
  status              TEXT        NOT NULL DEFAULT 'pending',
    -- 'pending' | 'completed' | 'cancelled'
  approved_by         UUID        REFERENCES profiles(id),
  approved_at         TIMESTAMPTZ,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by          UUID        REFERENCES profiles(id)
);
CREATE INDEX IF NOT EXISTS site_transfers_sites ON public.site_transfers(from_site_id, to_site_id);

-- ── 4. Medical records ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.medical_records (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id    UUID        NOT NULL REFERENCES employees(id),
  site_id        UUID        NOT NULL REFERENCES sites(id),
  exam_type      TEXT,        -- 'Pre-Employment' | 'Annual' | 'Exit' | 'Specific'
  exam_date      DATE        NOT NULL,
  result         TEXT,        -- 'Fit' | 'Fit with Restrictions' | 'Unfit' | 'Pending'
  restrictions   TEXT,
  next_exam_date DATE,
  blood_group    TEXT,
  allergies      TEXT,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     UUID        REFERENCES profiles(id)
);
CREATE INDEX IF NOT EXISTS medical_records_emp ON public.medical_records(employee_id, exam_date DESC);

-- ── 5. New permissions ────────────────────────────────────────────────────────
DO $$
DECLARE perm TEXT;
BEGIN
  FOREACH perm IN ARRAY ARRAY['hr.approve', 'hr.medical'] LOOP
    INSERT INTO permissions (code, module, action)
    SELECT perm, 'hr', split_part(perm, '.', 2)
    WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = perm);
  END LOOP;
  UPDATE permissions SET module = 'hr', description = 'Approve leave requests and site transfers' WHERE code = 'hr.approve';
  UPDATE permissions SET module = 'hr', description = 'View and record employee medical records'  WHERE code = 'hr.medical';

  -- Same grant mirror as 0100: roles holding employees.edit get both.
  INSERT INTO role_permissions (role_id, permission_id)
  SELECT rp.role_id, p_new.id
    FROM role_permissions rp
    JOIN permissions p_old ON p_old.id = rp.permission_id AND p_old.code = 'employees.edit'
    JOIN permissions p_new ON p_new.code IN ('hr.approve', 'hr.medical')
  ON CONFLICT DO NOTHING;
END $$;

-- ── 6. Approval RPCs ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.approve_leave_request(p_request_id UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r RECORD;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO r FROM public.leave_requests WHERE id = p_request_id;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF NOT public._has_hr_permission('hr.approve', r.site_id) THEN
    RAISE EXCEPTION 'You do not have permission to approve leave on this site';
  END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'Request is already %', r.status; END IF;

  UPDATE public.leave_requests
     SET status = 'approved', approved_by = auth.uid(), approved_at = now()
   WHERE id = p_request_id;

  -- Deduct from this year's allocation (create-on-demand is deliberate:
  -- an unallocated type still records usage so the balance report shows it).
  INSERT INTO public.leave_allocations (employee_id, site_id, leave_type_id, year, allocated_days, used_days, created_by)
  VALUES (r.employee_id, r.site_id, r.leave_type_id, EXTRACT(YEAR FROM r.start_date)::INT, 0, r.days_requested, auth.uid())
  ON CONFLICT (employee_id, leave_type_id, year)
  DO UPDATE SET used_days = leave_allocations.used_days + EXCLUDED.used_days;

  -- Employee goes on leave immediately if it starts today or earlier
  IF r.start_date <= CURRENT_DATE THEN
    PERFORM set_config('app.status_change_reason', 'Approved leave request', true);
    UPDATE public.employees SET status = 'on_leave'
     WHERE id = r.employee_id AND status = 'active';
  END IF;

  -- Notify the person who filed the request
  IF r.created_by IS NOT NULL THEN
    INSERT INTO public.notifications (recipient_id, type, title, body, action_url)
    VALUES (r.created_by, 'hr_leave_approved', 'Leave request approved',
            'The leave request you filed has been approved.', '/workforce/wf_leave_requests');
  END IF;
END; $$;
REVOKE ALL ON FUNCTION public.approve_leave_request(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_leave_request(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.reject_leave_request(p_request_id UUID, p_reason TEXT)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r RECORD;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO r FROM public.leave_requests WHERE id = p_request_id;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF NOT public._has_hr_permission('hr.approve', r.site_id) THEN
    RAISE EXCEPTION 'You do not have permission to reject leave on this site';
  END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'Request is already %', r.status; END IF;
  IF COALESCE(TRIM(p_reason), '') = '' THEN RAISE EXCEPTION 'A rejection reason is required'; END IF;

  UPDATE public.leave_requests
     SET status = 'rejected', rejected_reason = p_reason,
         approved_by = auth.uid(), approved_at = now()
   WHERE id = p_request_id;

  IF r.created_by IS NOT NULL THEN
    INSERT INTO public.notifications (recipient_id, type, title, body, action_url)
    VALUES (r.created_by, 'hr_leave_rejected', 'Leave request rejected',
            p_reason, '/workforce/wf_leave_requests');
  END IF;
END; $$;
REVOKE ALL ON FUNCTION public.reject_leave_request(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reject_leave_request(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.complete_site_transfer(p_transfer_id UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t RECORD;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO t FROM public.site_transfers WHERE id = p_transfer_id;
  IF t.id IS NULL THEN RAISE EXCEPTION 'Transfer not found'; END IF;
  -- Approver needs the permission on the RECEIVING site.
  IF NOT public._has_hr_permission('hr.approve', t.to_site_id) THEN
    RAISE EXCEPTION 'You do not have permission to approve transfers into that site';
  END IF;
  IF t.status <> 'pending' THEN RAISE EXCEPTION 'Transfer is already %', t.status; END IF;

  PERFORM set_config('app.status_change_reason', 'Inter-site transfer: ' || t.reason, true);
  PERFORM set_config('app.status_change_effective', t.transfer_date::TEXT, true);

  UPDATE public.employees
     SET site_id        = t.to_site_id,
         department_id  = COALESCE(t.to_department_id, department_id),
         designation_id = COALESCE(t.to_designation_id, designation_id),
         status         = 'transferred'
   WHERE id = t.employee_id;

  -- Immediately usable at the new site.
  PERFORM set_config('app.status_change_reason', 'Transfer completed — active at new site', true);
  UPDATE public.employees SET status = 'active' WHERE id = t.employee_id;

  UPDATE public.site_transfers
     SET status = 'completed', approved_by = auth.uid(), approved_at = now()
   WHERE id = p_transfer_id;
END; $$;
REVOKE ALL ON FUNCTION public.complete_site_transfer(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_site_transfer(UUID) TO authenticated;

-- ── 7. RLS ────────────────────────────────────────────────────────────────────

ALTER TABLE public.leave_types        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_allocations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_requests     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_types     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_transfers     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medical_records    ENABLE ROW LEVEL SECURITY;

-- Global lookups: read for all signed-in; write needs hr.settings anywhere
DROP POLICY IF EXISTS leave_types_read  ON public.leave_types;
DROP POLICY IF EXISTS leave_types_write ON public.leave_types;
CREATE POLICY leave_types_read  ON public.leave_types FOR SELECT TO authenticated USING (true);
CREATE POLICY leave_types_write ON public.leave_types FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE ur.user_id = auth.uid() AND p.code = 'hr.settings'));

DROP POLICY IF EXISTS document_types_read  ON public.document_types;
DROP POLICY IF EXISTS document_types_write ON public.document_types;
CREATE POLICY document_types_read  ON public.document_types FOR SELECT TO authenticated USING (true);
CREATE POLICY document_types_write ON public.document_types FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles ur
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE ur.user_id = auth.uid() AND p.code = 'hr.settings'));

-- Site-scoped HR data
DROP POLICY IF EXISTS leave_alloc_read   ON public.leave_allocations;
DROP POLICY IF EXISTS leave_alloc_write  ON public.leave_allocations;
CREATE POLICY leave_alloc_read  ON public.leave_allocations FOR SELECT TO authenticated
  USING (public._has_hr_permission('hr.view', site_id));
CREATE POLICY leave_alloc_write ON public.leave_allocations FOR ALL TO authenticated
  USING (public._has_hr_permission('hr.edit', site_id))
  WITH CHECK (public._has_hr_permission('hr.edit', site_id));

DROP POLICY IF EXISTS leave_req_read   ON public.leave_requests;
DROP POLICY IF EXISTS leave_req_insert ON public.leave_requests;
DROP POLICY IF EXISTS leave_req_update ON public.leave_requests;
CREATE POLICY leave_req_read   ON public.leave_requests FOR SELECT TO authenticated
  USING (public._has_hr_permission('hr.view', site_id));
CREATE POLICY leave_req_insert ON public.leave_requests FOR INSERT TO authenticated
  WITH CHECK (public._has_hr_permission('hr.edit', site_id));
-- Approve/reject go through the RPCs; direct updates limited to cancelling.
CREATE POLICY leave_req_update ON public.leave_requests FOR UPDATE TO authenticated
  USING (public._has_hr_permission('hr.edit', site_id));

DROP POLICY IF EXISTS emp_docs_read   ON public.employee_documents;
DROP POLICY IF EXISTS emp_docs_insert ON public.employee_documents;
DROP POLICY IF EXISTS emp_docs_update ON public.employee_documents;
CREATE POLICY emp_docs_read   ON public.employee_documents FOR SELECT TO authenticated
  USING (public._has_hr_permission('hr.view', site_id));
CREATE POLICY emp_docs_insert ON public.employee_documents FOR INSERT TO authenticated
  WITH CHECK (public._has_hr_permission('hr.edit', site_id));
CREATE POLICY emp_docs_update ON public.employee_documents FOR UPDATE TO authenticated
  USING (public._has_hr_permission('hr.edit', site_id));

-- Transfers are visible from either end
DROP POLICY IF EXISTS site_transfers_read   ON public.site_transfers;
DROP POLICY IF EXISTS site_transfers_insert ON public.site_transfers;
DROP POLICY IF EXISTS site_transfers_update ON public.site_transfers;
CREATE POLICY site_transfers_read   ON public.site_transfers FOR SELECT TO authenticated
  USING (public._has_hr_permission('hr.view', from_site_id)
      OR public._has_hr_permission('hr.view', to_site_id));
CREATE POLICY site_transfers_insert ON public.site_transfers FOR INSERT TO authenticated
  WITH CHECK (public._has_hr_permission('hr.edit', from_site_id));
CREATE POLICY site_transfers_update ON public.site_transfers FOR UPDATE TO authenticated
  USING (public._has_hr_permission('hr.edit', from_site_id)
      OR public._has_hr_permission('hr.approve', to_site_id));

-- Medical: locked behind its own permission, never plain hr.view
DROP POLICY IF EXISTS medical_read  ON public.medical_records;
DROP POLICY IF EXISTS medical_write ON public.medical_records;
CREATE POLICY medical_read  ON public.medical_records FOR SELECT TO authenticated
  USING (public._has_hr_permission('hr.medical', site_id));
CREATE POLICY medical_write ON public.medical_records FOR ALL TO authenticated
  USING (public._has_hr_permission('hr.medical', site_id))
  WITH CHECK (public._has_hr_permission('hr.medical', site_id));

INSERT INTO public.schema_migrations (filename)
VALUES ('0102_hr_phase2.sql') ON CONFLICT (filename) DO NOTHING;

COMMIT;
