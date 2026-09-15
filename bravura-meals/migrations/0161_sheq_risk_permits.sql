-- 0161 SHEQ Phase 2: Risk Management & Permit to Work
-- Risk register, risk assessments, PTW, LOTO isolations

BEGIN;

-- ── Risk matrix configuration ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sheq_risk_matrix (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id     uuid NOT NULL REFERENCES sites(id),
  likelihood  int NOT NULL CHECK (likelihood BETWEEN 1 AND 5),
  severity    int NOT NULL CHECK (severity BETWEEN 1 AND 5),
  risk_level  text NOT NULL CHECK (risk_level IN ('low','medium','high','critical')),
  color       text NOT NULL DEFAULT '#2E7D32',
  UNIQUE(site_id, likelihood, severity)
);
ALTER TABLE sheq_risk_matrix ENABLE ROW LEVEL SECURITY;
CREATE POLICY sheq_risk_matrix_policy ON sheq_risk_matrix
  USING (_has_permission('sheq.view', site_id));

-- ── Risk register ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sheq_risk_register (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id               uuid NOT NULL REFERENCES sites(id),
  risk_number           text NOT NULL,
  title                 text NOT NULL,
  description           text,
  hazard                text NOT NULL,
  consequence           text,
  existing_controls     text,
  likelihood            int CHECK (likelihood BETWEEN 1 AND 5),
  severity              int CHECK (severity BETWEEN 1 AND 5),
  inherent_risk         int GENERATED ALWAYS AS (likelihood * severity) STORED,
  risk_level            text,
  additional_controls   text,
  residual_likelihood   int CHECK (residual_likelihood BETWEEN 1 AND 5),
  residual_severity     int CHECK (residual_severity BETWEEN 1 AND 5),
  residual_risk         int GENERATED ALWAYS AS (residual_likelihood * residual_severity) STORED,
  residual_risk_level   text,
  project_id            uuid REFERENCES projects(id),
  department_id         uuid REFERENCES departments(id),
  owner_id              uuid REFERENCES profiles(id),
  review_date           date,
  status                text NOT NULL DEFAULT 'active' CHECK (status IN ('active','mitigated','closed','archived')),
  is_archived           boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE(site_id, risk_number)
);
ALTER TABLE sheq_risk_register ENABLE ROW LEVEL SECURITY;
CREATE POLICY sheq_risk_register_policy ON sheq_risk_register
  USING (_has_permission('sheq.view', site_id));

-- ── Risk assessments (JSA/JHA/Task) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sheq_risk_assessments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id           uuid NOT NULL REFERENCES sites(id),
  assessment_number text NOT NULL,
  assessment_type   text NOT NULL CHECK (assessment_type IN ('jsa','jha','task','environmental','project','activity')),
  title             text NOT NULL,
  description       text,
  project_id        uuid REFERENCES projects(id),
  department_id     uuid REFERENCES departments(id),
  location          text,
  assessed_by       uuid REFERENCES profiles(id),
  approved_by       uuid REFERENCES profiles(id),
  assessment_date   date NOT NULL DEFAULT CURRENT_DATE,
  review_date       date,
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_review','approved','expired','archived')),
  is_archived       boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE(site_id, assessment_number)
);
ALTER TABLE sheq_risk_assessments ENABLE ROW LEVEL SECURITY;
CREATE POLICY sheq_risk_assessments_policy ON sheq_risk_assessments
  USING (_has_permission('sheq.view', site_id));

-- ── Risk assessment steps/items ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sheq_risk_assessment_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id     uuid NOT NULL REFERENCES sheq_risk_assessments(id) ON DELETE CASCADE,
  step_order        int NOT NULL DEFAULT 1,
  activity          text NOT NULL,
  hazard            text,
  consequence       text,
  existing_controls text,
  likelihood        int CHECK (likelihood BETWEEN 1 AND 5),
  severity          int CHECK (severity BETWEEN 1 AND 5),
  risk_score        int GENERATED ALWAYS AS (likelihood * severity) STORED,
  additional_controls text,
  residual_likelihood int CHECK (residual_likelihood BETWEEN 1 AND 5),
  residual_severity   int CHECK (residual_severity BETWEEN 1 AND 5),
  residual_risk       int GENERATED ALWAYS AS (residual_likelihood * residual_severity) STORED,
  responsible       text
);
ALTER TABLE sheq_risk_assessment_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY sheq_risk_assessment_items_policy ON sheq_risk_assessment_items
  USING (EXISTS (
    SELECT 1 FROM sheq_risk_assessments a
    WHERE a.id = assessment_id AND _has_permission('sheq.view', a.site_id)
  ));

-- ── Permit types ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sheq_permit_types (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id     uuid NOT NULL REFERENCES sites(id),
  name        text NOT NULL,
  description text,
  requires_loto boolean NOT NULL DEFAULT false,
  checklist_items jsonb DEFAULT '[]',
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(site_id, name)
);
ALTER TABLE sheq_permit_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY sheq_permit_types_policy ON sheq_permit_types
  USING (_has_permission('sheq.view', site_id));

-- ── Permits to Work ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sheq_permits (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id          uuid NOT NULL REFERENCES sites(id),
  permit_number    text NOT NULL,
  permit_type_id   uuid NOT NULL REFERENCES sheq_permit_types(id),
  title            text NOT NULL,
  description      text,
  location         text,
  project_id       uuid REFERENCES projects(id),
  work_description text,
  start_date       date NOT NULL,
  end_date         date NOT NULL,
  start_time       time,
  end_time         time,
  status           text NOT NULL DEFAULT 'requested' CHECK (status IN (
    'requested','supervisor_approved','sheq_approved','area_approved',
    'active','suspended','extended','closed','rejected','expired'
  )),
  requested_by     uuid REFERENCES profiles(id),
  supervisor_id    uuid REFERENCES profiles(id),
  sheq_officer_id  uuid REFERENCES profiles(id),
  area_authority_id uuid REFERENCES profiles(id),
  supervisor_approved_at  timestamptz,
  sheq_approved_at        timestamptz,
  area_approved_at        timestamptz,
  closed_at        timestamptz,
  closed_by        uuid REFERENCES profiles(id),
  closure_notes    text,
  suspension_reason text,
  checklist_responses jsonb DEFAULT '{}',
  hazards_identified text,
  ppe_required     text,
  emergency_procedures text,
  is_archived      boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE(site_id, permit_number)
);
ALTER TABLE sheq_permits ENABLE ROW LEVEL SECURITY;
CREATE POLICY sheq_permits_policy ON sheq_permits
  USING (_has_permission('sheq.view', site_id));

-- ── LOTO Isolations ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sheq_loto_isolations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id           uuid NOT NULL REFERENCES sites(id),
  isolation_number  text NOT NULL,
  permit_id         uuid REFERENCES sheq_permits(id),
  equipment_name    text NOT NULL,
  equipment_id_tag  text,
  energy_source     text NOT NULL CHECK (energy_source IN (
    'electrical','mechanical','hydraulic','pneumatic','chemical',
    'thermal','gravitational','stored_energy','other'
  )),
  isolation_point   text NOT NULL,
  isolation_method  text,
  lock_number       text,
  tag_number        text,
  applied_by        uuid REFERENCES profiles(id),
  applied_at        timestamptz NOT NULL DEFAULT now(),
  verified_by       uuid REFERENCES profiles(id),
  verified_at       timestamptz,
  restored_by       uuid REFERENCES profiles(id),
  restored_at       timestamptz,
  status            text NOT NULL DEFAULT 'applied' CHECK (status IN ('applied','verified','restored')),
  notes             text,
  is_archived       boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE(site_id, isolation_number)
);
ALTER TABLE sheq_loto_isolations ENABLE ROW LEVEL SECURITY;
CREATE POLICY sheq_loto_isolations_policy ON sheq_loto_isolations
  USING (_has_permission('sheq.view', site_id));

-- ── Default permit types ─────────────────────────────────────────────────────
INSERT INTO sheq_permit_types (site_id, name, description, requires_loto) VALUES
  ('fe3f29ed-e1d4-44a2-b409-9a15a98eba97', 'Hot Work',             'Welding, cutting, grinding, brazing', true),
  ('fe3f29ed-e1d4-44a2-b409-9a15a98eba97', 'Confined Space',       'Entry into tanks, vessels, pits, manholes', true),
  ('fe3f29ed-e1d4-44a2-b409-9a15a98eba97', 'Working at Height',    'Work above 1.8m, scaffolding, ladders', false),
  ('fe3f29ed-e1d4-44a2-b409-9a15a98eba97', 'Excavation',           'Trenching, digging, ground disturbance', false),
  ('fe3f29ed-e1d4-44a2-b409-9a15a98eba97', 'Electrical Work',      'Electrical installation, maintenance, testing', true),
  ('fe3f29ed-e1d4-44a2-b409-9a15a98eba97', 'Energized Electrical', 'Live electrical work', true),
  ('fe3f29ed-e1d4-44a2-b409-9a15a98eba97', 'Lifting',              'Crane operations, rigging, heavy lifts', false),
  ('fe3f29ed-e1d4-44a2-b409-9a15a98eba97', 'Line Breaking',        'Breaking into piping, process lines', true),
  ('fe3f29ed-e1d4-44a2-b409-9a15a98eba97', 'Radiography',          'X-ray, NDT in restricted zones', false),
  ('fe3f29ed-e1d4-44a2-b409-9a15a98eba97', 'Chemical Work',        'Handling hazardous chemicals', false),
  ('fe3f29ed-e1d4-44a2-b409-9a15a98eba97', 'General Work Permit',  'General permit for controlled areas', false)
ON CONFLICT (site_id, name) DO NOTHING;

-- ── Default risk matrix (5×5) ────────────────────────────────────────────────
INSERT INTO sheq_risk_matrix (site_id, likelihood, severity, risk_level, color)
SELECT 'fe3f29ed-e1d4-44a2-b409-9a15a98eba97', l, s,
  CASE
    WHEN l * s <= 4  THEN 'low'
    WHEN l * s <= 9  THEN 'medium'
    WHEN l * s <= 16 THEN 'high'
    ELSE 'critical'
  END,
  CASE
    WHEN l * s <= 4  THEN '#2E7D32'
    WHEN l * s <= 9  THEN '#F59E0B'
    WHEN l * s <= 16 THEN '#E65100'
    ELSE '#D32F2F'
  END
FROM generate_series(1,5) l, generate_series(1,5) s
ON CONFLICT (site_id, likelihood, severity) DO NOTHING;

INSERT INTO schema_migrations (filename) VALUES ('0161_sheq_risk_permits.sql') ON CONFLICT DO NOTHING;

COMMIT;
