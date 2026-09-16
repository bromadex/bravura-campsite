-- Migration 0163: SHEQ Phase 4 — Training, Competency & Medical
-- Tables: sheq_training_matrix, sheq_medical_fitness, sheq_toolbox_talks,
--         sheq_toolbox_attendees, sheq_employee_sheq_profiles, sheq_inductions

BEGIN;

-- ── Training & Competency Matrix ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sheq_training_matrix (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id       uuid NOT NULL REFERENCES sites(id),
  employee_id   uuid NOT NULL REFERENCES employees(id),
  training_type text NOT NULL,
  course_name   text NOT NULL,
  provider      text,
  certificate_number text,
  date_completed date,
  expiry_date   date,
  status        text NOT NULL DEFAULT 'valid' CHECK (status IN ('valid','expiring','expired','pending')),
  competency_level text CHECK (competency_level IN ('basic','intermediate','advanced','expert')),
  notes         text,
  attachment_url text,
  created_by    uuid REFERENCES profiles(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  is_archived   boolean NOT NULL DEFAULT false
);

-- ── Medical Fitness Register ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sheq_medical_fitness (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id         uuid NOT NULL REFERENCES sites(id),
  employee_id     uuid NOT NULL REFERENCES employees(id),
  exam_type       text NOT NULL CHECK (exam_type IN ('pre_employment','periodic','return_to_work','exit','special')),
  exam_date       date NOT NULL,
  expiry_date     date,
  provider        text,
  doctor_name     text,
  fitness_status  text NOT NULL DEFAULT 'fit' CHECK (fitness_status IN ('fit','fit_with_restrictions','temporarily_unfit','permanently_unfit','pending')),
  restrictions    text,
  follow_up_date  date,
  notes           text,
  attachment_url  text,
  created_by      uuid REFERENCES profiles(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  is_archived     boolean NOT NULL DEFAULT false
);

-- ── Toolbox Talks ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sheq_toolbox_talks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id         uuid NOT NULL REFERENCES sites(id),
  talk_number     text,
  title           text NOT NULL,
  topic_category  text,
  conducted_by    uuid NOT NULL REFERENCES employees(id),
  talk_date       date NOT NULL,
  duration_minutes int,
  location        text,
  description     text,
  key_points      text,
  department_id   uuid REFERENCES departments(id),
  attachment_url  text,
  created_by      uuid REFERENCES profiles(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  is_archived     boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS sheq_toolbox_attendees (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  talk_id       uuid NOT NULL REFERENCES sheq_toolbox_talks(id) ON DELETE CASCADE,
  employee_id   uuid NOT NULL REFERENCES employees(id),
  attended      boolean NOT NULL DEFAULT true,
  signature_url text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ── Employee SHEQ Profile ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sheq_employee_profiles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id         uuid NOT NULL REFERENCES sites(id),
  employee_id     uuid NOT NULL REFERENCES employees(id),
  blood_type      text,
  allergies       text,
  chronic_conditions text,
  emergency_contact_name  text,
  emergency_contact_phone text,
  next_of_kin     text,
  shoe_size       text,
  overall_size    text,
  helmet_size     text,
  glove_size      text,
  safety_induction_date date,
  last_medical_date     date,
  last_training_date    date,
  risk_rating     text CHECK (risk_rating IN ('low','medium','high')),
  notes           text,
  created_by      uuid REFERENCES profiles(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  is_archived     boolean NOT NULL DEFAULT false,
  UNIQUE(site_id, employee_id)
);

-- ── Induction Register ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sheq_inductions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id         uuid NOT NULL REFERENCES sites(id),
  employee_id     uuid NOT NULL REFERENCES employees(id),
  induction_type  text NOT NULL CHECK (induction_type IN ('site','department','job_specific','visitor','contractor','refresher')),
  induction_date  date NOT NULL,
  expiry_date     date,
  conducted_by    uuid REFERENCES employees(id),
  status          text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','pending','expired','failed')),
  score           numeric(5,2),
  pass_mark       numeric(5,2),
  topics_covered  text,
  notes           text,
  attachment_url  text,
  department_id   uuid REFERENCES departments(id),
  created_by      uuid REFERENCES profiles(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  is_archived     boolean NOT NULL DEFAULT false
);

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE sheq_training_matrix   ENABLE ROW LEVEL SECURITY;
ALTER TABLE sheq_medical_fitness   ENABLE ROW LEVEL SECURITY;
ALTER TABLE sheq_toolbox_talks     ENABLE ROW LEVEL SECURITY;
ALTER TABLE sheq_toolbox_attendees ENABLE ROW LEVEL SECURITY;
ALTER TABLE sheq_employee_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE sheq_inductions        ENABLE ROW LEVEL SECURITY;

-- Training matrix
DROP POLICY IF EXISTS sheq_training_matrix_select ON sheq_training_matrix;
CREATE POLICY sheq_training_matrix_select ON sheq_training_matrix FOR SELECT USING (_has_permission('sheq.view', site_id));
DROP POLICY IF EXISTS sheq_training_matrix_insert ON sheq_training_matrix;
CREATE POLICY sheq_training_matrix_insert ON sheq_training_matrix FOR INSERT WITH CHECK (_has_permission('sheq.create', site_id));
DROP POLICY IF EXISTS sheq_training_matrix_update ON sheq_training_matrix;
CREATE POLICY sheq_training_matrix_update ON sheq_training_matrix FOR UPDATE USING (_has_permission('sheq.edit', site_id));
DROP POLICY IF EXISTS sheq_training_matrix_delete ON sheq_training_matrix;
CREATE POLICY sheq_training_matrix_delete ON sheq_training_matrix FOR DELETE USING (_has_permission('sheq.delete', site_id));

-- Medical fitness
DROP POLICY IF EXISTS sheq_medical_fitness_select ON sheq_medical_fitness;
CREATE POLICY sheq_medical_fitness_select ON sheq_medical_fitness FOR SELECT USING (_has_permission('sheq.view', site_id));
DROP POLICY IF EXISTS sheq_medical_fitness_insert ON sheq_medical_fitness;
CREATE POLICY sheq_medical_fitness_insert ON sheq_medical_fitness FOR INSERT WITH CHECK (_has_permission('sheq.create', site_id));
DROP POLICY IF EXISTS sheq_medical_fitness_update ON sheq_medical_fitness;
CREATE POLICY sheq_medical_fitness_update ON sheq_medical_fitness FOR UPDATE USING (_has_permission('sheq.edit', site_id));
DROP POLICY IF EXISTS sheq_medical_fitness_delete ON sheq_medical_fitness;
CREATE POLICY sheq_medical_fitness_delete ON sheq_medical_fitness FOR DELETE USING (_has_permission('sheq.delete', site_id));

-- Toolbox talks
DROP POLICY IF EXISTS sheq_toolbox_talks_select ON sheq_toolbox_talks;
CREATE POLICY sheq_toolbox_talks_select ON sheq_toolbox_talks FOR SELECT USING (_has_permission('sheq.view', site_id));
DROP POLICY IF EXISTS sheq_toolbox_talks_insert ON sheq_toolbox_talks;
CREATE POLICY sheq_toolbox_talks_insert ON sheq_toolbox_talks FOR INSERT WITH CHECK (_has_permission('sheq.create', site_id));
DROP POLICY IF EXISTS sheq_toolbox_talks_update ON sheq_toolbox_talks;
CREATE POLICY sheq_toolbox_talks_update ON sheq_toolbox_talks FOR UPDATE USING (_has_permission('sheq.edit', site_id));
DROP POLICY IF EXISTS sheq_toolbox_talks_delete ON sheq_toolbox_talks;
CREATE POLICY sheq_toolbox_talks_delete ON sheq_toolbox_talks FOR DELETE USING (_has_permission('sheq.delete', site_id));

-- Toolbox attendees (via talk join)
DROP POLICY IF EXISTS sheq_toolbox_attendees_select ON sheq_toolbox_attendees;
CREATE POLICY sheq_toolbox_attendees_select ON sheq_toolbox_attendees FOR SELECT
  USING (EXISTS (SELECT 1 FROM sheq_toolbox_talks t WHERE t.id = talk_id AND _has_permission('sheq.view', t.site_id)));
DROP POLICY IF EXISTS sheq_toolbox_attendees_insert ON sheq_toolbox_attendees;
CREATE POLICY sheq_toolbox_attendees_insert ON sheq_toolbox_attendees FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM sheq_toolbox_talks t WHERE t.id = talk_id AND _has_permission('sheq.create', t.site_id)));
DROP POLICY IF EXISTS sheq_toolbox_attendees_update ON sheq_toolbox_attendees;
CREATE POLICY sheq_toolbox_attendees_update ON sheq_toolbox_attendees FOR UPDATE
  USING (EXISTS (SELECT 1 FROM sheq_toolbox_talks t WHERE t.id = talk_id AND _has_permission('sheq.edit', t.site_id)));
DROP POLICY IF EXISTS sheq_toolbox_attendees_delete ON sheq_toolbox_attendees;
CREATE POLICY sheq_toolbox_attendees_delete ON sheq_toolbox_attendees FOR DELETE
  USING (EXISTS (SELECT 1 FROM sheq_toolbox_talks t WHERE t.id = talk_id AND _has_permission('sheq.delete', t.site_id)));

-- Employee SHEQ profiles
DROP POLICY IF EXISTS sheq_employee_profiles_select ON sheq_employee_profiles;
CREATE POLICY sheq_employee_profiles_select ON sheq_employee_profiles FOR SELECT USING (_has_permission('sheq.view', site_id));
DROP POLICY IF EXISTS sheq_employee_profiles_insert ON sheq_employee_profiles;
CREATE POLICY sheq_employee_profiles_insert ON sheq_employee_profiles FOR INSERT WITH CHECK (_has_permission('sheq.create', site_id));
DROP POLICY IF EXISTS sheq_employee_profiles_update ON sheq_employee_profiles;
CREATE POLICY sheq_employee_profiles_update ON sheq_employee_profiles FOR UPDATE USING (_has_permission('sheq.edit', site_id));
DROP POLICY IF EXISTS sheq_employee_profiles_delete ON sheq_employee_profiles;
CREATE POLICY sheq_employee_profiles_delete ON sheq_employee_profiles FOR DELETE USING (_has_permission('sheq.delete', site_id));

-- Inductions
DROP POLICY IF EXISTS sheq_inductions_select ON sheq_inductions;
CREATE POLICY sheq_inductions_select ON sheq_inductions FOR SELECT USING (_has_permission('sheq.view', site_id));
DROP POLICY IF EXISTS sheq_inductions_insert ON sheq_inductions;
CREATE POLICY sheq_inductions_insert ON sheq_inductions FOR INSERT WITH CHECK (_has_permission('sheq.create', site_id));
DROP POLICY IF EXISTS sheq_inductions_update ON sheq_inductions;
CREATE POLICY sheq_inductions_update ON sheq_inductions FOR UPDATE USING (_has_permission('sheq.edit', site_id));
DROP POLICY IF EXISTS sheq_inductions_delete ON sheq_inductions;
CREATE POLICY sheq_inductions_delete ON sheq_inductions FOR DELETE USING (_has_permission('sheq.delete', site_id));

-- ── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_sheq_training_matrix_site   ON sheq_training_matrix(site_id);
CREATE INDEX IF NOT EXISTS idx_sheq_training_matrix_emp    ON sheq_training_matrix(employee_id);
CREATE INDEX IF NOT EXISTS idx_sheq_medical_fitness_site   ON sheq_medical_fitness(site_id);
CREATE INDEX IF NOT EXISTS idx_sheq_medical_fitness_emp    ON sheq_medical_fitness(employee_id);
CREATE INDEX IF NOT EXISTS idx_sheq_toolbox_talks_site     ON sheq_toolbox_talks(site_id);
CREATE INDEX IF NOT EXISTS idx_sheq_toolbox_attendees_talk ON sheq_toolbox_attendees(talk_id);
CREATE INDEX IF NOT EXISTS idx_sheq_employee_profiles_site ON sheq_employee_profiles(site_id);
CREATE INDEX IF NOT EXISTS idx_sheq_employee_profiles_emp  ON sheq_employee_profiles(employee_id);
CREATE INDEX IF NOT EXISTS idx_sheq_inductions_site        ON sheq_inductions(site_id);
CREATE INDEX IF NOT EXISTS idx_sheq_inductions_emp         ON sheq_inductions(employee_id);

INSERT INTO schema_migrations (filename) VALUES ('0163_sheq_phase4_training_medical.sql') ON CONFLICT DO NOTHING;

COMMIT;
