-- Migration 0167: SHEQ Phase 7 — Cross-Module Integration
-- Adds fleet_asset_id to sheq_incidents, cost tracking columns,
-- and cross-module summary views

BEGIN;

-- ── Fleet → SHEQ link on incidents ──────────────────────────────────────────
ALTER TABLE sheq_incidents ADD COLUMN IF NOT EXISTS fleet_asset_id uuid REFERENCES fleet_assets(id);
CREATE INDEX IF NOT EXISTS idx_sheq_incidents_fleet ON sheq_incidents(fleet_asset_id) WHERE fleet_asset_id IS NOT NULL;

-- ── Cost tracking on incidents ──────────────────────────────────────────────
ALTER TABLE sheq_incidents ADD COLUMN IF NOT EXISTS estimated_cost numeric(12,2);
ALTER TABLE sheq_incidents ADD COLUMN IF NOT EXISTS actual_cost numeric(12,2);
ALTER TABLE sheq_incidents ADD COLUMN IF NOT EXISTS cost_category text CHECK (cost_category IN ('property_damage','medical','environmental','production_loss','legal','other'));
ALTER TABLE sheq_incidents ADD COLUMN IF NOT EXISTS insurance_claim boolean NOT NULL DEFAULT false;
ALTER TABLE sheq_incidents ADD COLUMN IF NOT EXISTS days_lost numeric(6,1) DEFAULT 0;

-- ── Contractor SHEQ score summary view ──────────────────────────────────────
CREATE OR REPLACE VIEW sheq_contractor_scores AS
SELECT
  cc.contractor_id,
  c.name AS contractor_name,
  cc.site_id,
  COUNT(*)::int AS total_assessments,
  COUNT(*) FILTER (WHERE cc.status = 'compliant')::int AS compliant_count,
  COUNT(*) FILTER (WHERE cc.status = 'non_compliant')::int AS non_compliant_count,
  COUNT(*) FILTER (WHERE cc.status = 'expired')::int AS expired_count,
  ROUND(100.0 * COUNT(*) FILTER (WHERE cc.status = 'compliant') / NULLIF(COUNT(*), 0), 1) AS compliance_pct,
  AVG(cc.score)::numeric(5,2) AS avg_score
FROM sheq_contractor_compliance cc
JOIN contractors c ON c.id = cc.contractor_id
WHERE cc.is_archived = false AND cc.contractor_id IS NOT NULL
GROUP BY cc.contractor_id, c.name, cc.site_id;

-- ── Fleet SHEQ incident summary view ────────────────────────────────────────
CREATE OR REPLACE VIEW sheq_fleet_incident_summary AS
SELECT
  fa.id AS fleet_asset_id,
  fa.asset_number,
  fa.description AS asset_description,
  si.site_id,
  COUNT(si.id)::int AS incident_count,
  COUNT(*) FILTER (WHERE si.severity = 'critical')::int AS critical_count,
  COUNT(*) FILTER (WHERE si.severity = 'major')::int AS major_count,
  COALESCE(SUM(si.actual_cost), 0)::numeric(12,2) AS total_cost,
  COALESCE(SUM(si.days_lost), 0)::numeric(8,1) AS total_days_lost,
  MAX(si.incident_date) AS last_incident_date
FROM sheq_incidents si
JOIN fleet_assets fa ON fa.id = si.fleet_asset_id
WHERE si.is_archived = false AND si.fleet_asset_id IS NOT NULL
GROUP BY fa.id, fa.asset_number, fa.description, si.site_id;

-- ── HR-SHEQ employee summary view ──────────────────────────────────────────
CREATE OR REPLACE VIEW sheq_employee_summary AS
SELECT
  e.id AS employee_id,
  e.name AS employee_name,
  e.employee_number,
  e.position_title,
  e.department_id,
  e.site_id,
  (SELECT COUNT(*) FROM sheq_training_matrix tm WHERE tm.employee_id = e.id AND tm.is_archived = false)::int AS training_count,
  (SELECT COUNT(*) FROM sheq_training_matrix tm WHERE tm.employee_id = e.id AND tm.status = 'expired' AND tm.is_archived = false)::int AS expired_training,
  (SELECT COUNT(*) FROM sheq_medical_fitness mf WHERE mf.employee_id = e.id AND mf.is_archived = false)::int AS medical_count,
  (SELECT mf.fitness_status FROM sheq_medical_fitness mf WHERE mf.employee_id = e.id AND mf.is_archived = false ORDER BY mf.exam_date DESC LIMIT 1) AS latest_fitness,
  (SELECT COUNT(*) FROM sheq_inductions ind WHERE ind.employee_id = e.id AND ind.is_archived = false)::int AS induction_count,
  (SELECT sp.risk_rating FROM sheq_employee_profiles sp WHERE sp.employee_id = e.id AND sp.is_archived = false LIMIT 1) AS risk_rating
FROM employees e
WHERE e.status = 'active';

-- ── Project SHEQ risk summary view ──────────────────────────────────────────
CREATE OR REPLACE VIEW sheq_project_risk_summary AS
SELECT
  p.id AS project_id,
  p.name AS project_name,
  rr.site_id,
  COUNT(rr.id)::int AS total_risks,
  COUNT(*) FILTER (WHERE rr.risk_level IN ('extreme','high'))::int AS high_risks,
  COUNT(*) FILTER (WHERE rr.status = 'open')::int AS open_risks,
  COUNT(DISTINCT si.id)::int AS incident_count,
  COALESCE(SUM(si.actual_cost), 0)::numeric(12,2) AS total_incident_cost
FROM projects p
LEFT JOIN sheq_risk_register rr ON rr.project_id = p.id AND rr.is_archived = false
LEFT JOIN sheq_incidents si ON si.project_id = p.id AND si.is_archived = false
GROUP BY p.id, p.name, rr.site_id;

INSERT INTO schema_migrations (filename) VALUES ('0167_sheq_phase7_cross_module.sql') ON CONFLICT DO NOTHING;

COMMIT;
