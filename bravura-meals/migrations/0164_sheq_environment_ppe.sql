-- 0164 SHEQ Phase 5: Environment & PPE
-- Environmental register, waste management, spill management, environmental monitoring,
-- PPE register & issues, resource consumption

BEGIN;

-- ── Environmental Register ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sheq_environmental_aspects (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id           uuid NOT NULL REFERENCES sites(id),
  aspect_number     text NOT NULL,
  title             text NOT NULL,
  description       text,
  activity          text NOT NULL,
  aspect            text NOT NULL,
  impact            text NOT NULL,
  category          text NOT NULL CHECK (category IN (
    'air_emissions','water_discharge','waste','noise','land_contamination',
    'resource_use','biodiversity','chemical_storage','energy','other'
  )),
  legal_requirement text,
  control_measures  text,
  likelihood        int CHECK (likelihood BETWEEN 1 AND 5),
  severity          int CHECK (severity BETWEEN 1 AND 5),
  risk_score        int GENERATED ALWAYS AS (likelihood * severity) STORED,
  risk_level        text,
  residual_likelihood int CHECK (residual_likelihood BETWEEN 1 AND 5),
  residual_severity   int CHECK (residual_severity BETWEEN 1 AND 5),
  residual_risk       int GENERATED ALWAYS AS (residual_likelihood * residual_severity) STORED,
  residual_risk_level text,
  project_id        uuid REFERENCES projects(id),
  department_id     uuid REFERENCES departments(id),
  responsible_id    uuid REFERENCES profiles(id),
  review_date       date,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active','controlled','closed','archived')),
  is_archived       boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE(site_id, aspect_number)
);
ALTER TABLE sheq_environmental_aspects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sheq_environmental_aspects_policy ON sheq_environmental_aspects;
CREATE POLICY sheq_environmental_aspects_policy ON sheq_environmental_aspects
  USING (_has_permission('sheq.view', site_id));

-- ── Waste Management ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sheq_waste_records (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id           uuid NOT NULL REFERENCES sites(id),
  record_number     text NOT NULL,
  waste_date        date NOT NULL DEFAULT CURRENT_DATE,
  waste_type        text NOT NULL CHECK (waste_type IN (
    'general','hazardous','recyclable','organic','medical','electronic',
    'construction','chemical','oil_contaminated','other'
  )),
  waste_class       text NOT NULL DEFAULT 'non_hazardous' CHECK (waste_class IN ('hazardous','non_hazardous')),
  description       text NOT NULL,
  source_location   text,
  quantity          numeric(12,3),
  unit              text DEFAULT 'kg' CHECK (unit IN ('kg','tonnes','litres','m3','drums','bags','units')),
  disposal_method   text CHECK (disposal_method IN (
    'landfill','incineration','recycling','composting','treatment',
    'licensed_contractor','on_site_storage','reuse','other'
  )),
  disposal_contractor text,
  manifest_number   text,
  storage_location  text,
  collected_by      uuid REFERENCES profiles(id),
  verified_by       uuid REFERENCES profiles(id),
  disposal_date     date,
  disposal_notes    text,
  cost              numeric(12,2),
  status            text NOT NULL DEFAULT 'stored' CHECK (status IN ('stored','collected','disposed','verified')),
  is_archived       boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE(site_id, record_number)
);
ALTER TABLE sheq_waste_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sheq_waste_records_policy ON sheq_waste_records;
CREATE POLICY sheq_waste_records_policy ON sheq_waste_records
  USING (_has_permission('sheq.view', site_id));

-- ── Spill Management ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sheq_spill_incidents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id           uuid NOT NULL REFERENCES sites(id),
  spill_number      text NOT NULL,
  spill_date        date NOT NULL DEFAULT CURRENT_DATE,
  spill_time        time,
  location          text NOT NULL,
  substance         text NOT NULL,
  substance_type    text NOT NULL CHECK (substance_type IN (
    'fuel','oil','chemical','sewage','process_water','hazardous_material','other'
  )),
  estimated_volume  numeric(12,3),
  volume_unit       text DEFAULT 'litres' CHECK (volume_unit IN ('litres','m3','kg','gallons')),
  cause             text,
  containment_actions text,
  cleanup_actions   text,
  environmental_impact text,
  reportable        boolean NOT NULL DEFAULT false,
  authority_notified boolean NOT NULL DEFAULT false,
  authority_ref     text,
  incident_id       uuid REFERENCES sheq_incidents(id),
  reported_by       uuid REFERENCES profiles(id),
  response_lead     uuid REFERENCES profiles(id),
  cleanup_completed_at timestamptz,
  cleanup_verified_by uuid REFERENCES profiles(id),
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active','contained','cleanup','remediation','closed')),
  is_archived       boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE(site_id, spill_number)
);
ALTER TABLE sheq_spill_incidents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sheq_spill_incidents_policy ON sheq_spill_incidents;
CREATE POLICY sheq_spill_incidents_policy ON sheq_spill_incidents
  USING (_has_permission('sheq.view', site_id));

-- ── Environmental Monitoring ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sheq_env_monitoring (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id           uuid NOT NULL REFERENCES sites(id),
  reading_number    text NOT NULL,
  monitoring_date   date NOT NULL DEFAULT CURRENT_DATE,
  monitoring_time   time,
  parameter         text NOT NULL CHECK (parameter IN (
    'dust_pm10','dust_pm2_5','noise_db','water_ph','water_tss','water_cod',
    'water_bod','air_so2','air_nox','air_co','vibration','temperature',
    'humidity','wind_speed','radiation','other'
  )),
  location          text NOT NULL,
  station_id        text,
  value             numeric(12,4) NOT NULL,
  unit              text NOT NULL,
  limit_value       numeric(12,4),
  limit_source      text,
  is_exceedance     boolean NOT NULL DEFAULT false,
  exceedance_action text,
  instrument        text,
  calibration_date  date,
  recorded_by       uuid REFERENCES profiles(id),
  verified_by       uuid REFERENCES profiles(id),
  notes             text,
  is_archived       boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE(site_id, reading_number)
);
ALTER TABLE sheq_env_monitoring ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sheq_env_monitoring_policy ON sheq_env_monitoring;
CREATE POLICY sheq_env_monitoring_policy ON sheq_env_monitoring
  USING (_has_permission('sheq.view', site_id));

-- ── PPE Register ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sheq_ppe_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id           uuid NOT NULL REFERENCES sites(id),
  ppe_code          text NOT NULL,
  name              text NOT NULL,
  category          text NOT NULL CHECK (category IN (
    'head','eye','ear','respiratory','hand','foot','body','fall_protection',
    'high_visibility','welding','chemical','electrical','other'
  )),
  description       text,
  standard          text,
  supplier          text,
  unit_cost         numeric(10,2),
  reorder_level     int DEFAULT 0,
  current_stock     int NOT NULL DEFAULT 0,
  shelf_life_months int,
  is_active         boolean NOT NULL DEFAULT true,
  is_archived       boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE(site_id, ppe_code)
);
ALTER TABLE sheq_ppe_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sheq_ppe_items_policy ON sheq_ppe_items;
CREATE POLICY sheq_ppe_items_policy ON sheq_ppe_items
  USING (_has_permission('sheq.view', site_id));

-- ── PPE Issues (who received what PPE) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS sheq_ppe_issues (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id           uuid NOT NULL REFERENCES sites(id),
  issue_number      text NOT NULL,
  issue_date        date NOT NULL DEFAULT CURRENT_DATE,
  ppe_item_id       uuid NOT NULL REFERENCES sheq_ppe_items(id),
  issued_to         uuid NOT NULL REFERENCES profiles(id),
  issued_by         uuid REFERENCES profiles(id),
  quantity          int NOT NULL DEFAULT 1 CHECK (quantity > 0),
  size              text,
  condition_on_issue text DEFAULT 'new' CHECK (condition_on_issue IN ('new','good','fair')),
  expiry_date       date,
  returned_date     date,
  return_condition  text CHECK (return_condition IN ('good','fair','damaged','destroyed')),
  returned_to       uuid REFERENCES profiles(id),
  notes             text,
  is_archived       boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE(site_id, issue_number)
);
ALTER TABLE sheq_ppe_issues ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sheq_ppe_issues_policy ON sheq_ppe_issues;
CREATE POLICY sheq_ppe_issues_policy ON sheq_ppe_issues
  USING (_has_permission('sheq.view', site_id));

-- ── Resource Consumption ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sheq_resource_consumption (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id           uuid NOT NULL REFERENCES sites(id),
  record_number     text NOT NULL,
  reading_date      date NOT NULL DEFAULT CURRENT_DATE,
  resource_type     text NOT NULL CHECK (resource_type IN (
    'electricity','water','diesel','petrol','lpg','coal','natural_gas',
    'compressed_air','steam','other'
  )),
  meter_id          text,
  location          text,
  previous_reading  numeric(14,2),
  current_reading   numeric(14,2),
  consumption       numeric(14,2) NOT NULL,
  unit              text NOT NULL CHECK (unit IN ('kWh','MWh','litres','m3','kg','tonnes','GJ')),
  cost              numeric(12,2),
  target            numeric(14,2),
  notes             text,
  recorded_by       uuid REFERENCES profiles(id),
  is_archived       boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE(site_id, record_number)
);
ALTER TABLE sheq_resource_consumption ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sheq_resource_consumption_policy ON sheq_resource_consumption;
CREATE POLICY sheq_resource_consumption_policy ON sheq_resource_consumption
  USING (_has_permission('sheq.view', site_id));

-- ── Full INSERT/UPDATE/DELETE policies ──────────────────────────────────────
-- sheq_environmental_aspects
DROP POLICY IF EXISTS sheq_environmental_aspects_insert ON sheq_environmental_aspects;
CREATE POLICY sheq_environmental_aspects_insert ON sheq_environmental_aspects FOR INSERT WITH CHECK (_has_permission('sheq.create', site_id));
DROP POLICY IF EXISTS sheq_environmental_aspects_update ON sheq_environmental_aspects;
CREATE POLICY sheq_environmental_aspects_update ON sheq_environmental_aspects FOR UPDATE USING (_has_permission('sheq.edit', site_id));
DROP POLICY IF EXISTS sheq_environmental_aspects_delete ON sheq_environmental_aspects;
CREATE POLICY sheq_environmental_aspects_delete ON sheq_environmental_aspects FOR DELETE USING (_has_permission('sheq.delete', site_id));

-- sheq_waste_records
DROP POLICY IF EXISTS sheq_waste_records_insert ON sheq_waste_records;
CREATE POLICY sheq_waste_records_insert ON sheq_waste_records FOR INSERT WITH CHECK (_has_permission('sheq.create', site_id));
DROP POLICY IF EXISTS sheq_waste_records_update ON sheq_waste_records;
CREATE POLICY sheq_waste_records_update ON sheq_waste_records FOR UPDATE USING (_has_permission('sheq.edit', site_id));
DROP POLICY IF EXISTS sheq_waste_records_delete ON sheq_waste_records;
CREATE POLICY sheq_waste_records_delete ON sheq_waste_records FOR DELETE USING (_has_permission('sheq.delete', site_id));

-- sheq_spill_incidents
DROP POLICY IF EXISTS sheq_spill_incidents_insert ON sheq_spill_incidents;
CREATE POLICY sheq_spill_incidents_insert ON sheq_spill_incidents FOR INSERT WITH CHECK (_has_permission('sheq.create', site_id));
DROP POLICY IF EXISTS sheq_spill_incidents_update ON sheq_spill_incidents;
CREATE POLICY sheq_spill_incidents_update ON sheq_spill_incidents FOR UPDATE USING (_has_permission('sheq.edit', site_id));
DROP POLICY IF EXISTS sheq_spill_incidents_delete ON sheq_spill_incidents;
CREATE POLICY sheq_spill_incidents_delete ON sheq_spill_incidents FOR DELETE USING (_has_permission('sheq.delete', site_id));

-- sheq_env_monitoring
DROP POLICY IF EXISTS sheq_env_monitoring_insert ON sheq_env_monitoring;
CREATE POLICY sheq_env_monitoring_insert ON sheq_env_monitoring FOR INSERT WITH CHECK (_has_permission('sheq.create', site_id));
DROP POLICY IF EXISTS sheq_env_monitoring_update ON sheq_env_monitoring;
CREATE POLICY sheq_env_monitoring_update ON sheq_env_monitoring FOR UPDATE USING (_has_permission('sheq.edit', site_id));
DROP POLICY IF EXISTS sheq_env_monitoring_delete ON sheq_env_monitoring;
CREATE POLICY sheq_env_monitoring_delete ON sheq_env_monitoring FOR DELETE USING (_has_permission('sheq.delete', site_id));

-- sheq_ppe_items
DROP POLICY IF EXISTS sheq_ppe_items_insert ON sheq_ppe_items;
CREATE POLICY sheq_ppe_items_insert ON sheq_ppe_items FOR INSERT WITH CHECK (_has_permission('sheq.create', site_id));
DROP POLICY IF EXISTS sheq_ppe_items_update ON sheq_ppe_items;
CREATE POLICY sheq_ppe_items_update ON sheq_ppe_items FOR UPDATE USING (_has_permission('sheq.edit', site_id));
DROP POLICY IF EXISTS sheq_ppe_items_delete ON sheq_ppe_items;
CREATE POLICY sheq_ppe_items_delete ON sheq_ppe_items FOR DELETE USING (_has_permission('sheq.delete', site_id));

-- sheq_ppe_issues
DROP POLICY IF EXISTS sheq_ppe_issues_insert ON sheq_ppe_issues;
CREATE POLICY sheq_ppe_issues_insert ON sheq_ppe_issues FOR INSERT WITH CHECK (_has_permission('sheq.create', site_id));
DROP POLICY IF EXISTS sheq_ppe_issues_update ON sheq_ppe_issues;
CREATE POLICY sheq_ppe_issues_update ON sheq_ppe_issues FOR UPDATE USING (_has_permission('sheq.edit', site_id));
DROP POLICY IF EXISTS sheq_ppe_issues_delete ON sheq_ppe_issues;
CREATE POLICY sheq_ppe_issues_delete ON sheq_ppe_issues FOR DELETE USING (_has_permission('sheq.delete', site_id));

-- sheq_resource_consumption
DROP POLICY IF EXISTS sheq_resource_consumption_insert ON sheq_resource_consumption;
CREATE POLICY sheq_resource_consumption_insert ON sheq_resource_consumption FOR INSERT WITH CHECK (_has_permission('sheq.create', site_id));
DROP POLICY IF EXISTS sheq_resource_consumption_update ON sheq_resource_consumption;
CREATE POLICY sheq_resource_consumption_update ON sheq_resource_consumption FOR UPDATE USING (_has_permission('sheq.edit', site_id));
DROP POLICY IF EXISTS sheq_resource_consumption_delete ON sheq_resource_consumption;
CREATE POLICY sheq_resource_consumption_delete ON sheq_resource_consumption FOR DELETE USING (_has_permission('sheq.delete', site_id));

-- ── Indexes ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_sheq_environmental_aspects_site ON sheq_environmental_aspects(site_id);
CREATE INDEX IF NOT EXISTS idx_sheq_waste_records_site ON sheq_waste_records(site_id);
CREATE INDEX IF NOT EXISTS idx_sheq_spill_incidents_site ON sheq_spill_incidents(site_id);
CREATE INDEX IF NOT EXISTS idx_sheq_env_monitoring_site ON sheq_env_monitoring(site_id);
CREATE INDEX IF NOT EXISTS idx_sheq_ppe_items_site ON sheq_ppe_items(site_id);
CREATE INDEX IF NOT EXISTS idx_sheq_ppe_issues_site ON sheq_ppe_issues(site_id);
CREATE INDEX IF NOT EXISTS idx_sheq_ppe_issues_item ON sheq_ppe_issues(ppe_item_id);
CREATE INDEX IF NOT EXISTS idx_sheq_resource_consumption_site ON sheq_resource_consumption(site_id);

INSERT INTO schema_migrations (filename) VALUES ('0164_sheq_environment_ppe.sql') ON CONFLICT DO NOTHING;

COMMIT;
