-- Migration 0165: SHEQ Phase 6 — Compliance, Documents & Contractors
-- Tables: sheq_legal_register, sheq_document_control, sheq_contractor_compliance,
--         sheq_emergency_plans, sheq_emergency_drills, sheq_management_reviews

BEGIN;

-- ── Legal Register ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sheq_legal_register (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id         uuid NOT NULL REFERENCES sites(id),
  reference_number text,
  title           text NOT NULL,
  legislation_type text NOT NULL CHECK (legislation_type IN ('act','regulation','standard','guideline','code_of_practice','bylaw','other')),
  jurisdiction    text,
  issuing_body    text,
  effective_date  date,
  review_date     date,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','under_review','superseded','repealed')),
  compliance_status text NOT NULL DEFAULT 'compliant' CHECK (compliance_status IN ('compliant','partially_compliant','non_compliant','not_assessed')),
  applicable_areas text,
  requirements_summary text,
  responsible_id  uuid REFERENCES employees(id),
  notes           text,
  attachment_url  text,
  created_by      uuid REFERENCES profiles(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  is_archived     boolean NOT NULL DEFAULT false
);

-- ── Document Control ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sheq_document_control (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id         uuid NOT NULL REFERENCES sites(id),
  document_number text,
  title           text NOT NULL,
  document_type   text NOT NULL CHECK (document_type IN ('policy','procedure','work_instruction','form','template','register','plan','report','other')),
  category        text,
  version         text NOT NULL DEFAULT '1.0',
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','under_review','approved','obsolete','superseded')),
  author_id       uuid REFERENCES employees(id),
  reviewer_id     uuid REFERENCES employees(id),
  approver_id     uuid REFERENCES employees(id),
  issue_date      date,
  review_date     date,
  expiry_date     date,
  department_id   uuid REFERENCES departments(id),
  description     text,
  attachment_url  text,
  created_by      uuid REFERENCES profiles(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  is_archived     boolean NOT NULL DEFAULT false
);

-- ── Contractor SHEQ Compliance ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sheq_contractor_compliance (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id           uuid NOT NULL REFERENCES sites(id),
  contractor_name   text NOT NULL,
  contractor_id     uuid REFERENCES contractors(id),
  compliance_type   text NOT NULL CHECK (compliance_type IN ('induction','safety_file','medical_certs','insurance','risk_assessment','method_statement','ppe_compliance','other')),
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('compliant','non_compliant','pending','expired')),
  assessment_date   date,
  expiry_date       date,
  assessed_by       uuid REFERENCES employees(id),
  score             numeric(5,2),
  findings          text,
  corrective_actions text,
  attachment_url    text,
  created_by        uuid REFERENCES profiles(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  is_archived       boolean NOT NULL DEFAULT false
);

-- ── Emergency Plans ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sheq_emergency_plans (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id         uuid NOT NULL REFERENCES sites(id),
  plan_number     text,
  title           text NOT NULL,
  plan_type       text NOT NULL CHECK (plan_type IN ('fire','chemical_spill','medical','natural_disaster','evacuation','security','explosion','general')),
  version         text NOT NULL DEFAULT '1.0',
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','active','under_review','obsolete')),
  effective_date  date,
  review_date     date,
  approved_by     uuid REFERENCES employees(id),
  coordinator_id  uuid REFERENCES employees(id),
  assembly_points text,
  emergency_contacts text,
  procedures      text,
  resources_required text,
  department_id   uuid REFERENCES departments(id),
  attachment_url  text,
  created_by      uuid REFERENCES profiles(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  is_archived     boolean NOT NULL DEFAULT false
);

-- ── Emergency Drills ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sheq_emergency_drills (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id         uuid NOT NULL REFERENCES sites(id),
  drill_number    text,
  plan_id         uuid REFERENCES sheq_emergency_plans(id),
  drill_type      text NOT NULL CHECK (drill_type IN ('fire','evacuation','chemical_spill','medical','security','full_scale','tabletop')),
  drill_date      date NOT NULL,
  start_time      time,
  end_time        time,
  conducted_by    uuid REFERENCES employees(id),
  participants_count int,
  evacuation_time_minutes numeric(5,1),
  scenario_description text,
  observations    text,
  improvements_identified text,
  overall_rating  text CHECK (overall_rating IN ('excellent','good','satisfactory','needs_improvement','poor')),
  status          text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','completed','cancelled')),
  next_drill_date date,
  attachment_url  text,
  created_by      uuid REFERENCES profiles(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  is_archived     boolean NOT NULL DEFAULT false
);

-- ── Management Review ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sheq_management_reviews (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id         uuid NOT NULL REFERENCES sites(id),
  review_number   text,
  title           text NOT NULL,
  review_date     date NOT NULL,
  review_type     text NOT NULL CHECK (review_type IN ('quarterly','semi_annual','annual','special')),
  chairperson_id  uuid REFERENCES employees(id),
  attendees       text,
  status          text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','in_progress','completed','cancelled')),
  agenda          text,
  minutes         text,
  sheq_performance_summary text,
  incident_statistics text,
  audit_findings_summary text,
  risk_assessment_review text,
  training_summary text,
  compliance_status_review text,
  actions_from_previous text,
  new_actions     text,
  decisions       text,
  next_review_date date,
  attachment_url  text,
  created_by      uuid REFERENCES profiles(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  is_archived     boolean NOT NULL DEFAULT false
);

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE sheq_legal_register          ENABLE ROW LEVEL SECURITY;
ALTER TABLE sheq_document_control        ENABLE ROW LEVEL SECURITY;
ALTER TABLE sheq_contractor_compliance   ENABLE ROW LEVEL SECURITY;
ALTER TABLE sheq_emergency_plans         ENABLE ROW LEVEL SECURITY;
ALTER TABLE sheq_emergency_drills        ENABLE ROW LEVEL SECURITY;
ALTER TABLE sheq_management_reviews      ENABLE ROW LEVEL SECURITY;

-- Legal register
DROP POLICY IF EXISTS sheq_legal_register_select ON sheq_legal_register;
CREATE POLICY sheq_legal_register_select ON sheq_legal_register FOR SELECT USING (_has_permission('sheq.view', site_id));
DROP POLICY IF EXISTS sheq_legal_register_insert ON sheq_legal_register;
CREATE POLICY sheq_legal_register_insert ON sheq_legal_register FOR INSERT WITH CHECK (_has_permission('sheq.create', site_id));
DROP POLICY IF EXISTS sheq_legal_register_update ON sheq_legal_register;
CREATE POLICY sheq_legal_register_update ON sheq_legal_register FOR UPDATE USING (_has_permission('sheq.edit', site_id));
DROP POLICY IF EXISTS sheq_legal_register_delete ON sheq_legal_register;
CREATE POLICY sheq_legal_register_delete ON sheq_legal_register FOR DELETE USING (_has_permission('sheq.delete', site_id));

-- Document control
DROP POLICY IF EXISTS sheq_document_control_select ON sheq_document_control;
CREATE POLICY sheq_document_control_select ON sheq_document_control FOR SELECT USING (_has_permission('sheq.view', site_id));
DROP POLICY IF EXISTS sheq_document_control_insert ON sheq_document_control;
CREATE POLICY sheq_document_control_insert ON sheq_document_control FOR INSERT WITH CHECK (_has_permission('sheq.create', site_id));
DROP POLICY IF EXISTS sheq_document_control_update ON sheq_document_control;
CREATE POLICY sheq_document_control_update ON sheq_document_control FOR UPDATE USING (_has_permission('sheq.edit', site_id));
DROP POLICY IF EXISTS sheq_document_control_delete ON sheq_document_control;
CREATE POLICY sheq_document_control_delete ON sheq_document_control FOR DELETE USING (_has_permission('sheq.delete', site_id));

-- Contractor compliance
DROP POLICY IF EXISTS sheq_contractor_compliance_select ON sheq_contractor_compliance;
CREATE POLICY sheq_contractor_compliance_select ON sheq_contractor_compliance FOR SELECT USING (_has_permission('sheq.view', site_id));
DROP POLICY IF EXISTS sheq_contractor_compliance_insert ON sheq_contractor_compliance;
CREATE POLICY sheq_contractor_compliance_insert ON sheq_contractor_compliance FOR INSERT WITH CHECK (_has_permission('sheq.create', site_id));
DROP POLICY IF EXISTS sheq_contractor_compliance_update ON sheq_contractor_compliance;
CREATE POLICY sheq_contractor_compliance_update ON sheq_contractor_compliance FOR UPDATE USING (_has_permission('sheq.edit', site_id));
DROP POLICY IF EXISTS sheq_contractor_compliance_delete ON sheq_contractor_compliance;
CREATE POLICY sheq_contractor_compliance_delete ON sheq_contractor_compliance FOR DELETE USING (_has_permission('sheq.delete', site_id));

-- Emergency plans
DROP POLICY IF EXISTS sheq_emergency_plans_select ON sheq_emergency_plans;
CREATE POLICY sheq_emergency_plans_select ON sheq_emergency_plans FOR SELECT USING (_has_permission('sheq.view', site_id));
DROP POLICY IF EXISTS sheq_emergency_plans_insert ON sheq_emergency_plans;
CREATE POLICY sheq_emergency_plans_insert ON sheq_emergency_plans FOR INSERT WITH CHECK (_has_permission('sheq.create', site_id));
DROP POLICY IF EXISTS sheq_emergency_plans_update ON sheq_emergency_plans;
CREATE POLICY sheq_emergency_plans_update ON sheq_emergency_plans FOR UPDATE USING (_has_permission('sheq.edit', site_id));
DROP POLICY IF EXISTS sheq_emergency_plans_delete ON sheq_emergency_plans;
CREATE POLICY sheq_emergency_plans_delete ON sheq_emergency_plans FOR DELETE USING (_has_permission('sheq.delete', site_id));

-- Emergency drills
DROP POLICY IF EXISTS sheq_emergency_drills_select ON sheq_emergency_drills;
CREATE POLICY sheq_emergency_drills_select ON sheq_emergency_drills FOR SELECT USING (_has_permission('sheq.view', site_id));
DROP POLICY IF EXISTS sheq_emergency_drills_insert ON sheq_emergency_drills;
CREATE POLICY sheq_emergency_drills_insert ON sheq_emergency_drills FOR INSERT WITH CHECK (_has_permission('sheq.create', site_id));
DROP POLICY IF EXISTS sheq_emergency_drills_update ON sheq_emergency_drills;
CREATE POLICY sheq_emergency_drills_update ON sheq_emergency_drills FOR UPDATE USING (_has_permission('sheq.edit', site_id));
DROP POLICY IF EXISTS sheq_emergency_drills_delete ON sheq_emergency_drills;
CREATE POLICY sheq_emergency_drills_delete ON sheq_emergency_drills FOR DELETE USING (_has_permission('sheq.delete', site_id));

-- Management reviews
DROP POLICY IF EXISTS sheq_management_reviews_select ON sheq_management_reviews;
CREATE POLICY sheq_management_reviews_select ON sheq_management_reviews FOR SELECT USING (_has_permission('sheq.view', site_id));
DROP POLICY IF EXISTS sheq_management_reviews_insert ON sheq_management_reviews;
CREATE POLICY sheq_management_reviews_insert ON sheq_management_reviews FOR INSERT WITH CHECK (_has_permission('sheq.create', site_id));
DROP POLICY IF EXISTS sheq_management_reviews_update ON sheq_management_reviews;
CREATE POLICY sheq_management_reviews_update ON sheq_management_reviews FOR UPDATE USING (_has_permission('sheq.edit', site_id));
DROP POLICY IF EXISTS sheq_management_reviews_delete ON sheq_management_reviews;
CREATE POLICY sheq_management_reviews_delete ON sheq_management_reviews FOR DELETE USING (_has_permission('sheq.delete', site_id));

-- ── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_sheq_legal_register_site        ON sheq_legal_register(site_id);
CREATE INDEX IF NOT EXISTS idx_sheq_document_control_site      ON sheq_document_control(site_id);
CREATE INDEX IF NOT EXISTS idx_sheq_contractor_compliance_site ON sheq_contractor_compliance(site_id);
CREATE INDEX IF NOT EXISTS idx_sheq_emergency_plans_site       ON sheq_emergency_plans(site_id);
CREATE INDEX IF NOT EXISTS idx_sheq_emergency_drills_site      ON sheq_emergency_drills(site_id);
CREATE INDEX IF NOT EXISTS idx_sheq_emergency_drills_plan      ON sheq_emergency_drills(plan_id);
CREATE INDEX IF NOT EXISTS idx_sheq_management_reviews_site    ON sheq_management_reviews(site_id);

INSERT INTO schema_migrations (filename) VALUES ('0165_sheq_phase6_compliance_docs.sql') ON CONFLICT DO NOTHING;

COMMIT;
