-- 0160 SHEQ Module Phase 1: Foundation & Core Safety
-- Incidents, hazard reports, CAPA, safety observations, settings

BEGIN;

-- ── Incident categories (configurable) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS sheq_incident_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id     uuid NOT NULL REFERENCES sites(id),
  name        text NOT NULL,
  description text,
  severity_default text CHECK (severity_default IN ('low','medium','high','critical')),
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(site_id, name)
);
ALTER TABLE sheq_incident_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY sheq_incident_categories_policy ON sheq_incident_categories
  USING (_has_permission('sheq.view', site_id));

-- ── Incidents ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sheq_incidents (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id            uuid NOT NULL REFERENCES sites(id),
  incident_number    text NOT NULL,
  incident_date      date NOT NULL,
  incident_time      time,
  location           text,
  project_id         uuid REFERENCES projects(id),
  department_id      uuid REFERENCES departments(id),
  category_id        uuid REFERENCES sheq_incident_categories(id),
  incident_type      text NOT NULL CHECK (incident_type IN (
    'fatality','lost_time_injury','medical_treatment','first_aid',
    'near_miss','property_damage','environmental','vehicle_traffic',
    'equipment_failure','fire','security','unsafe_act','unsafe_condition'
  )),
  severity           text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  potential_severity text CHECK (potential_severity IN ('low','medium','high','critical')),
  status             text NOT NULL DEFAULT 'reported' CHECK (status IN (
    'reported','under_investigation','root_cause_identified','corrective_action','verification','closed'
  )),
  description        text NOT NULL,
  immediate_actions  text,
  root_cause         text,
  root_cause_method  text CHECK (root_cause_method IN ('five_why','fishbone','other')),
  root_cause_classification text,
  five_why_1         text,
  five_why_2         text,
  five_why_3         text,
  five_why_4         text,
  five_why_5         text,
  fishbone_people    text,
  fishbone_process   text,
  fishbone_equipment text,
  fishbone_materials text,
  fishbone_environment text,
  fishbone_management text,
  people_involved    text,
  witnesses          text,
  investigation_team text,
  reported_by        uuid REFERENCES profiles(id),
  investigated_by    uuid REFERENCES profiles(id),
  closed_by          uuid REFERENCES profiles(id),
  closed_at          timestamptz,
  is_anonymous       boolean NOT NULL DEFAULT false,
  is_archived        boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE(site_id, incident_number)
);
ALTER TABLE sheq_incidents ENABLE ROW LEVEL SECURITY;
CREATE POLICY sheq_incidents_policy ON sheq_incidents
  USING (_has_permission('sheq.view', site_id));

-- ── Hazard / Near-miss reports ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sheq_hazard_reports (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id         uuid NOT NULL REFERENCES sites(id),
  report_number   text NOT NULL,
  report_date     date NOT NULL DEFAULT CURRENT_DATE,
  location        text,
  category        text NOT NULL CHECK (category IN (
    'electrical','mechanical','working_at_height','lifting','excavation',
    'fire','chemical','vehicle','housekeeping','ppe','environmental',
    'structural','other'
  )),
  description     text NOT NULL,
  photo_url       text,
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','closed')),
  priority        text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
  reported_by     uuid REFERENCES profiles(id),
  assigned_to     uuid REFERENCES profiles(id),
  resolved_by     uuid REFERENCES profiles(id),
  resolved_at     timestamptz,
  resolution_notes text,
  is_anonymous    boolean NOT NULL DEFAULT false,
  is_archived     boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(site_id, report_number)
);
ALTER TABLE sheq_hazard_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY sheq_hazard_reports_policy ON sheq_hazard_reports
  USING (_has_permission('sheq.view', site_id));

-- ── CAPA (Corrective & Preventive Actions) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS sheq_capa (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id         uuid NOT NULL REFERENCES sites(id),
  capa_number     text NOT NULL,
  source_type     text NOT NULL CHECK (source_type IN (
    'incident','inspection','audit','near_miss','hazard','environmental',
    'management_review','contractor_assessment','observation','other'
  )),
  source_id       uuid,
  source_ref      text,
  action_type     text NOT NULL DEFAULT 'corrective' CHECK (action_type IN ('corrective','preventive')),
  description     text NOT NULL,
  priority        text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','verification','closed','overdue')),
  owner_id        uuid REFERENCES profiles(id),
  assigned_to     uuid REFERENCES profiles(id),
  due_date        date,
  completed_date  date,
  evidence_notes  text,
  verification_by uuid REFERENCES profiles(id),
  verification_date date,
  verification_notes text,
  is_archived     boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(site_id, capa_number)
);
ALTER TABLE sheq_capa ENABLE ROW LEVEL SECURITY;
CREATE POLICY sheq_capa_policy ON sheq_capa
  USING (_has_permission('sheq.view', site_id));

-- ── Safety observations ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sheq_observations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id         uuid NOT NULL REFERENCES sites(id),
  observation_date date NOT NULL DEFAULT CURRENT_DATE,
  observer_id     uuid REFERENCES profiles(id),
  observation_type text NOT NULL CHECK (observation_type IN ('positive','unsafe_act','unsafe_condition')),
  location        text,
  department_id   uuid REFERENCES departments(id),
  description     text NOT NULL,
  action_taken    text,
  worker_name     text,
  is_archived     boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE sheq_observations ENABLE ROW LEVEL SECURITY;
CREATE POLICY sheq_observations_policy ON sheq_observations
  USING (_has_permission('sheq.view', site_id));

-- ── SHEQ settings (key-value per site) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS sheq_settings (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id    uuid NOT NULL REFERENCES sites(id),
  key        text NOT NULL,
  value      text,
  UNIQUE(site_id, key)
);
ALTER TABLE sheq_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY sheq_settings_policy ON sheq_settings
  USING (_has_permission('sheq.view', site_id));

-- ── Sequence helper for incident/hazard/CAPA numbering ───────────────────────
CREATE OR REPLACE FUNCTION sheq_next_number(p_site_id uuid, p_prefix text, p_table text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_count int;
  v_next text;
BEGIN
  EXECUTE format(
    'SELECT count(*) + 1 FROM %I WHERE site_id = $1',
    p_table
  ) INTO v_count USING p_site_id;
  v_next := p_prefix || '-' || lpad(v_count::text, 5, '0');
  RETURN v_next;
END;
$$;

-- ── Permissions ──────────────────────────────────────────────────────────────
INSERT INTO permissions (code, module, action, description) VALUES
  ('sheq.view',    'SHEQ', 'View',    'View SHEQ module'),
  ('sheq.create',  'SHEQ', 'Create',  'Create SHEQ records'),
  ('sheq.edit',    'SHEQ', 'Edit',    'Edit SHEQ records'),
  ('sheq.delete',  'SHEQ', 'Delete',  'Archive SHEQ records'),
  ('sheq.approve', 'SHEQ', 'Approve', 'Approve/close SHEQ actions')
ON CONFLICT (module, action) DO NOTHING;

-- ── Grant to System Administrator ────────────────────────────────────────────
INSERT INTO role_permissions (role_id, permission_id)
SELECT '85928d6a-e1f8-45e4-95c0-b467b6baeef8', p.id
FROM permissions p
WHERE p.module = 'SHEQ'
ON CONFLICT DO NOTHING;

-- ── Default incident categories ──────────────────────────────────────────────
INSERT INTO sheq_incident_categories (site_id, name, description, severity_default) VALUES
  ('fe3f29ed-e1d4-44a2-b409-9a15a98eba97', 'Electrical',         'Electrical hazard or incident',     'high'),
  ('fe3f29ed-e1d4-44a2-b409-9a15a98eba97', 'Mechanical',         'Mechanical failure or hazard',      'medium'),
  ('fe3f29ed-e1d4-44a2-b409-9a15a98eba97', 'Working at Height',  'Falls or height-related',           'critical'),
  ('fe3f29ed-e1d4-44a2-b409-9a15a98eba97', 'Lifting',            'Crane/lifting equipment incidents', 'high'),
  ('fe3f29ed-e1d4-44a2-b409-9a15a98eba97', 'Fire',               'Fire or explosion',                 'critical'),
  ('fe3f29ed-e1d4-44a2-b409-9a15a98eba97', 'Chemical',           'Chemical exposure or spill',         'high'),
  ('fe3f29ed-e1d4-44a2-b409-9a15a98eba97', 'Vehicle/Traffic',    'Vehicle or traffic incident',       'high'),
  ('fe3f29ed-e1d4-44a2-b409-9a15a98eba97', 'Housekeeping',       'Slip, trip, fall hazards',          'low'),
  ('fe3f29ed-e1d4-44a2-b409-9a15a98eba97', 'PPE',                'PPE non-compliance or failure',     'medium'),
  ('fe3f29ed-e1d4-44a2-b409-9a15a98eba97', 'Environmental',      'Environmental incident',            'medium'),
  ('fe3f29ed-e1d4-44a2-b409-9a15a98eba97', 'Structural',         'Structural failure or risk',        'high'),
  ('fe3f29ed-e1d4-44a2-b409-9a15a98eba97', 'Excavation',         'Excavation/trenching hazard',       'critical')
ON CONFLICT (site_id, name) DO NOTHING;

INSERT INTO schema_migrations (filename) VALUES ('0160_sheq_foundation.sql') ON CONFLICT DO NOTHING;

COMMIT;
