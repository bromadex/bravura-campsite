BEGIN;

ALTER TABLE contractor_employees
  ADD COLUMN IF NOT EXISTS employee_id UUID REFERENCES employees(id);

CREATE INDEX IF NOT EXISTS idx_contractor_employees_employee_id
  ON contractor_employees(employee_id);

INSERT INTO public.schema_migrations (filename)
VALUES ('0084_contractor_employees_hr_link.sql') ON CONFLICT (filename) DO NOTHING;

COMMIT;
