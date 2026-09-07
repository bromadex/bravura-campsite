-- 0084: Add employee_id to profiles for linking user accounts to employee records
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS employee_id uuid REFERENCES employees(id);
CREATE UNIQUE INDEX IF NOT EXISTS profiles_employee_id_unique ON profiles(employee_id) WHERE employee_id IS NOT NULL;

INSERT INTO schema_migrations (filename) VALUES ('0084_profiles_employee_link.sql') ON CONFLICT DO NOTHING;
