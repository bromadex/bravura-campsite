-- 0162 SHEQ Phase 3: Inspections & Audits
-- Inspection templates, inspections, inspection items, audits, audit findings

BEGIN;

-- ── Inspection Templates ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sheq_inspection_templates (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id           uuid NOT NULL REFERENCES sites(id),
  template_code     text NOT NULL,
  name              text NOT NULL,
  description       text,
  category          text NOT NULL CHECK (category IN (
    'workplace','electrical','fire','scaffold','excavation','crane',
    'vehicle','housekeeping','environmental','ppe','chemical','confined_space',
    'working_at_height','general','other'
  )),
  frequency         text CHECK (frequency IN ('daily','weekly','monthly','quarterly','annually','ad_hoc')),
  is_active         boolean NOT NULL DEFAULT true,
  is_archived       boolean NOT NULL DEFAULT false,
  created_by        uuid REFERENCES profiles(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE(site_id, template_code)
);
ALTER TABLE sheq_inspection_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sheq_inspection_templates_policy ON sheq_inspection_templates;
CREATE POLICY sheq_inspection_templates_policy ON sheq_inspection_templates
  USING (_has_permission('sheq.view', site_id));

-- ── Template Items (checklist lines) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sheq_template_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id       uuid NOT NULL REFERENCES sheq_inspection_templates(id) ON DELETE CASCADE,
  sort_order        int NOT NULL DEFAULT 0,
  section           text,
  question          text NOT NULL,
  response_type     text NOT NULL DEFAULT 'yes_no' CHECK (response_type IN ('yes_no','ok_nok','rating','text','numeric')),
  is_critical       boolean NOT NULL DEFAULT false,
  guidance          text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE sheq_template_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sheq_template_items_policy ON sheq_template_items;
CREATE POLICY sheq_template_items_policy ON sheq_template_items
  USING (EXISTS (
    SELECT 1 FROM sheq_inspection_templates t
    WHERE t.id = template_id AND _has_permission('sheq.view', t.site_id)
  ));

-- ── Inspections ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sheq_inspections (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id           uuid NOT NULL REFERENCES sites(id),
  inspection_number text NOT NULL,
  template_id       uuid REFERENCES sheq_inspection_templates(id),
  title             text NOT NULL,
  inspection_date   date NOT NULL DEFAULT CURRENT_DATE,
  location          text,
  inspector_id      uuid REFERENCES profiles(id),
  department_id     uuid REFERENCES departments(id),
  project_id        uuid REFERENCES projects(id),
  score_pct         numeric(5,2),
  findings_count    int NOT NULL DEFAULT 0,
  critical_findings int NOT NULL DEFAULT 0,
  summary           text,
  status            text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','in_progress','completed','reviewed')),
  reviewed_by       uuid REFERENCES profiles(id),
  reviewed_at       timestamptz,
  is_archived       boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE(site_id, inspection_number)
);
ALTER TABLE sheq_inspections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sheq_inspections_policy ON sheq_inspections;
CREATE POLICY sheq_inspections_policy ON sheq_inspections
  USING (_has_permission('sheq.view', site_id));

-- ── Inspection Items (filled checklist) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS sheq_inspection_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id     uuid NOT NULL REFERENCES sheq_inspections(id) ON DELETE CASCADE,
  template_item_id  uuid REFERENCES sheq_template_items(id),
  sort_order        int NOT NULL DEFAULT 0,
  section           text,
  question          text NOT NULL,
  response_type     text NOT NULL DEFAULT 'yes_no',
  response          text,
  is_conforming     boolean,
  is_critical       boolean NOT NULL DEFAULT false,
  finding           text,
  capa_id           uuid REFERENCES sheq_capa(id),
  photo_url         text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE sheq_inspection_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sheq_inspection_items_policy ON sheq_inspection_items;
CREATE POLICY sheq_inspection_items_policy ON sheq_inspection_items
  USING (EXISTS (
    SELECT 1 FROM sheq_inspections i
    WHERE i.id = inspection_id AND _has_permission('sheq.view', i.site_id)
  ));

-- ── Audits ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sheq_audits (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id           uuid NOT NULL REFERENCES sites(id),
  audit_number      text NOT NULL,
  title             text NOT NULL,
  audit_type        text NOT NULL CHECK (audit_type IN (
    'internal','external','iso','regulatory','supplier','management_review','other'
  )),
  standard          text,
  scope             text,
  audit_date        date NOT NULL DEFAULT CURRENT_DATE,
  end_date          date,
  lead_auditor_id   uuid REFERENCES profiles(id),
  department_id     uuid REFERENCES departments(id),
  project_id        uuid REFERENCES projects(id),
  findings_count    int NOT NULL DEFAULT 0,
  ncr_major         int NOT NULL DEFAULT 0,
  ncr_minor         int NOT NULL DEFAULT 0,
  observations_count int NOT NULL DEFAULT 0,
  summary           text,
  status            text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','in_progress','completed','closed')),
  is_archived       boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE(site_id, audit_number)
);
ALTER TABLE sheq_audits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sheq_audits_policy ON sheq_audits;
CREATE POLICY sheq_audits_policy ON sheq_audits
  USING (_has_permission('sheq.view', site_id));

-- ── Audit Findings ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sheq_audit_findings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id          uuid NOT NULL REFERENCES sheq_audits(id) ON DELETE CASCADE,
  site_id           uuid NOT NULL REFERENCES sites(id),
  finding_number    text NOT NULL,
  clause            text,
  finding_type      text NOT NULL CHECK (finding_type IN ('ncr_major','ncr_minor','observation','opportunity','positive')),
  description       text NOT NULL,
  evidence          text,
  root_cause        text,
  corrective_action text,
  responsible_id    uuid REFERENCES profiles(id),
  due_date          date,
  capa_id           uuid REFERENCES sheq_capa(id),
  status            text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','closed','verified')),
  closed_at         timestamptz,
  closed_by         uuid REFERENCES profiles(id),
  is_archived       boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE(site_id, finding_number)
);
ALTER TABLE sheq_audit_findings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sheq_audit_findings_policy ON sheq_audit_findings;
CREATE POLICY sheq_audit_findings_policy ON sheq_audit_findings
  USING (_has_permission('sheq.view', site_id));

INSERT INTO schema_migrations (filename) VALUES ('0162_sheq_inspections_audits.sql') ON CONFLICT DO NOTHING;

COMMIT;
