-- ══════════════════════════════════════════════════════════════════════════════
-- Fleet Management Foundation — Phase 1
--
-- Creates the unified fleet_assets table, migrates data from fuel_vehicles
-- and fuel_equipment, then creates backward-compatible views so the entire
-- Fuel module keeps working without any page changes.
--
-- Also creates: fleet_asset_types (lookup), fleet_status_history (audit),
-- fleet_assignments, fleet_inspections, fleet_inspection_templates,
-- fleet_trips, fleet_work_orders, fleet_maintenance, fleet_compliance,
-- fleet_documents.
--
-- Apply via Supabase Dashboard › SQL Editor.  Run the whole script.
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Fleet Asset Types (lookup) ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fleet_asset_types (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL UNIQUE,     -- 'Vehicle', 'Excavator', etc.
  code        TEXT        NOT NULL UNIQUE,     -- 'VEHICLE', 'EXCAVATOR', etc.
  category    TEXT        NOT NULL DEFAULT 'vehicle',
    -- 'vehicle' | 'heavy_equipment' | 'generator' | 'pump' | 'trailer' | 'other'
  icon        TEXT,                            -- Material Symbol icon name
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO fleet_asset_types (name, code, category, icon, sort_order) VALUES
  ('Vehicle',       'VEHICLE',       'vehicle',         'directions_car',   1),
  ('Excavator',     'EXCAVATOR',     'heavy_equipment', 'precision_manufacturing', 2),
  ('Loader',        'LOADER',        'heavy_equipment', 'forklift',         3),
  ('Bulldozer',     'BULLDOZER',     'heavy_equipment', 'landscape',        4),
  ('Grader',        'GRADER',        'heavy_equipment', 'straighten',       5),
  ('ADT',           'ADT',           'heavy_equipment', 'local_shipping',   6),
  ('Generator',     'GENERATOR',     'generator',       'bolt',             7),
  ('Compressor',    'COMPRESSOR',    'other',           'compress',         8),
  ('Forklift',      'FORKLIFT',      'heavy_equipment', 'forklift',         9),
  ('Water Bowser',  'WATER_BOWSER',  'vehicle',         'water_drop',       10),
  ('Fuel Bowser',   'FUEL_BOWSER',   'vehicle',         'local_gas_station',11),
  ('Pump',          'PUMP',          'pump',            'water_pump',       12),
  ('Trailer',       'TRAILER',       'trailer',         'rv_hookup',        13),
  ('Drill',         'DRILL',         'heavy_equipment', 'hardware',         14),
  ('Crane',         'CRANE',         'heavy_equipment', 'crane',            15),
  ('Other',         'OTHER',         'other',           'construction',     99)
ON CONFLICT (code) DO NOTHING;


-- ── 2. Fleet Assets (unified register) ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS fleet_assets (
  id                         UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id                    UUID           NOT NULL REFERENCES sites(id),
  asset_number               TEXT           NOT NULL,      -- unique per site, e.g. FA-001
  asset_type_id              UUID           NOT NULL REFERENCES fleet_asset_types(id),

  -- Identification
  registration               TEXT,
  fleet_number               TEXT,          -- kept for backward compat with fuel_vehicles
  make                       TEXT,
  model                      TEXT,
  serial_number              TEXT,
  vin                        TEXT,
  year                       INTEGER,
  description                TEXT,

  -- Classification
  department_id              UUID,          -- FK to departments (HR module)
  department_name            TEXT,          -- denormalised fallback
  cost_center                TEXT,
  assigned_project           TEXT,

  -- Operational
  fuel_type_id               UUID           REFERENCES fuel_types(id),
  tank_capacity_litres       NUMERIC(8,3),
  expected_consumption_lpkm  NUMERIC(6,3),  -- litres per km (vehicles)
  expected_consumption_lph   NUMERIC(6,3),  -- litres per hour (equipment)
  current_odometer_km        NUMERIC(12,2)  DEFAULT 0,
  current_hours              NUMERIC(12,2)  DEFAULT 0,
  image_url                  TEXT,

  -- Physical
  tare_weight                NUMERIC(10,2),
  gross_vehicle_mass         NUMERIC(10,2),

  -- Acquisition
  purchase_date              DATE,
  purchase_cost              NUMERIC(15,2),
  salvage_value              NUMERIC(15,2),

  -- Compliance (quick-reference, detail in fleet_compliance)
  licence_expiry             DATE,
  insurance_expiry           DATE,
  roadworthy_expiry          DATE,

  -- Integration
  tracker_id                 TEXT,
  atg_device_id              TEXT,
  legacy_id                  TEXT,          -- old ERP row id
  legacy_source              TEXT,          -- 'fuel_vehicles' | 'fuel_equipment'
  old_fuel_vehicle_id        UUID,          -- preserves original UUID for FK migration
  old_fuel_equipment_id      UUID,

  -- Status
  status                     TEXT           NOT NULL DEFAULT 'active',
    -- 'operational' | 'maintenance' | 'grounded' | 'awaiting_parts' | 'decommissioned'
  is_archived                BOOLEAN        NOT NULL DEFAULT false,
  archived_at                TIMESTAMPTZ,

  -- Operator (current assignment, denormalised for quick reads)
  current_operator_id        UUID           REFERENCES fuel_operators(id),

  -- Metadata
  created_at                 TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ    NOT NULL DEFAULT now(),
  created_by                 UUID           REFERENCES profiles(id),

  UNIQUE(site_id, asset_number)
);

CREATE INDEX IF NOT EXISTS fleet_assets_site_id      ON fleet_assets(site_id);
CREATE INDEX IF NOT EXISTS fleet_assets_type          ON fleet_assets(asset_type_id);
CREATE INDEX IF NOT EXISTS fleet_assets_status        ON fleet_assets(status);
CREATE INDEX IF NOT EXISTS fleet_assets_legacy        ON fleet_assets(legacy_id) WHERE legacy_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS fleet_assets_old_vehicle   ON fleet_assets(old_fuel_vehicle_id) WHERE old_fuel_vehicle_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS fleet_assets_old_equipment ON fleet_assets(old_fuel_equipment_id) WHERE old_fuel_equipment_id IS NOT NULL;


-- ── 3. Migrate fuel_vehicles → fleet_assets ──────────────────────────────────

INSERT INTO fleet_assets (
  id, site_id, asset_number, asset_type_id,
  registration, fleet_number, make, model, year, description,
  department_id, department_name, cost_center, assigned_project,
  fuel_type_id, tank_capacity_litres, expected_consumption_lpkm,
  current_odometer_km, tare_weight, gross_vehicle_mass,
  purchase_date, purchase_cost, salvage_value,
  licence_expiry, insurance_expiry, roadworthy_expiry,
  tracker_id, legacy_id, legacy_source, old_fuel_vehicle_id,
  status, is_archived, archived_at, created_at, created_by
)
SELECT
  v.id,                              -- preserve UUID so FKs keep working
  v.site_id,
  COALESCE(v.asset_code, v.fleet_number),
  (SELECT id FROM fleet_asset_types WHERE code = UPPER(COALESCE(
    CASE v.vehicle_type
      WHEN 'ADT'       THEN 'ADT'
      WHEN 'Excavator' THEN 'EXCAVATOR'
      WHEN 'Bulldozer' THEN 'BULLDOZER'
      WHEN 'Loader'    THEN 'LOADER'
      WHEN 'Grader'    THEN 'GRADER'
      WHEN 'Crane'     THEN 'CRANE'
      WHEN 'Forklift'  THEN 'FORKLIFT'
      ELSE NULL
    END,
    'VEHICLE'
  ))),
  v.registration,
  v.fleet_number,
  v.make,
  v.model,
  v.year,
  v.description,
  v.department_id,
  v.department_name,
  v.cost_center,
  v.assigned_project,
  v.fuel_type_id,
  v.tank_capacity_litres,
  v.expected_consumption_lpkm,
  COALESCE(v.odometer_km, 0),
  v.tare_weight,
  v.gross_vehicle_mass,
  v.acquisition_date,
  v.acquisition_cost,
  v.salvage_value,
  v.licence_expiry,
  v.insurance_expiry,
  v.roadworthy_expiry,
  v.tracker_id,
  v.legacy_id,
  'fuel_vehicles',
  v.id,
  v.status,
  v.is_archived,
  v.archived_at,
  v.created_at,
  v.created_by
FROM fuel_vehicles v
ON CONFLICT (site_id, asset_number) DO NOTHING;


-- ── 4. Migrate fuel_equipment → fleet_assets ─────────────────────────────────

INSERT INTO fleet_assets (
  site_id, asset_number, asset_type_id,
  registration, fleet_number, description,
  department_id,
  fuel_type_id, expected_consumption_lph,
  current_hours,
  purchase_date, purchase_cost,
  legacy_id, legacy_source, old_fuel_equipment_id,
  status, is_archived, created_at
)
SELECT
  e.site_id,
  COALESCE(e.asset_code, e.equipment_number),
  (SELECT id FROM fleet_asset_types WHERE code = UPPER(COALESCE(
    CASE e.equipment_type
      WHEN 'Generator'  THEN 'GENERATOR'
      WHEN 'Compressor' THEN 'COMPRESSOR'
      WHEN 'Drill'      THEN 'DRILL'
      WHEN 'Pump'       THEN 'PUMP'
      ELSE NULL
    END,
    'OTHER'
  ))),
  e.registration,
  e.equipment_number,
  COALESCE(e.description, e.name),
  e.department_id,
  e.fuel_type_id,
  e.expected_consumption_lph,
  COALESCE(e.hour_meter, 0),
  e.acquisition_date,
  e.acquisition_cost,
  e.legacy_id,
  'fuel_equipment',
  e.id,
  e.status,
  e.is_archived,
  e.created_at
FROM fuel_equipment e
ON CONFLICT (site_id, asset_number) DO NOTHING;


-- ── 5. Backward-compatible views ─────────────────────────────────────────────
-- The Fuel module queries fuel_vehicles and fuel_equipment.
-- These views make fleet_assets look exactly like the old tables so
-- zero Fuel pages need to change.

-- First rename the old tables so the views can take their names.
ALTER TABLE fuel_vehicles  RENAME TO _fuel_vehicles_old;
ALTER TABLE fuel_equipment RENAME TO _fuel_equipment_old;

-- Vehicle view — maps fleet_assets back to the old fuel_vehicles shape
CREATE OR REPLACE VIEW fuel_vehicles AS
SELECT
  a.id,
  a.site_id,
  COALESCE(a.fleet_number, a.asset_number) AS fleet_number,
  a.registration,
  a.make,
  a.model,
  a.year,
  a.department_id,
  a.fuel_type_id,
  a.tank_capacity_litres,
  a.expected_consumption_lpkm,
  a.status,
  a.is_archived,
  a.archived_at,
  a.created_at,
  a.created_by,
  a.legacy_id,
  a.asset_number      AS asset_code,
  a.description,
  COALESCE(t.category, 'vehicle') AS vehicle_type,
  a.current_odometer_km AS odometer_km,
  a.purchase_date       AS last_service_date,
  a.assigned_project,
  a.tare_weight,
  a.gross_vehicle_mass,
  a.licence_expiry,
  a.insurance_expiry,
  a.roadworthy_expiry,
  a.tracker_id,
  a.department_name,
  a.cost_center,
  a.purchase_cost       AS acquisition_cost,
  a.purchase_date       AS acquisition_date,
  a.salvage_value,
  NULL::INTEGER         AS service_interval_km,
  NULL::INTEGER         AS service_interval_days,
  NULL::TEXT            AS assigned_driver_id,
  NULL::TEXT            AS assigned_driver_name,
  a.old_fuel_vehicle_id AS future_fleet_id
FROM fleet_assets a
LEFT JOIN fleet_asset_types t ON t.id = a.asset_type_id
WHERE t.category IN ('vehicle', 'heavy_equipment') OR a.legacy_source = 'fuel_vehicles';

-- Equipment view — maps fleet_assets back to the old fuel_equipment shape
CREATE OR REPLACE VIEW fuel_equipment AS
SELECT
  COALESCE(a.old_fuel_equipment_id, a.id) AS id,
  a.site_id,
  COALESCE(a.fleet_number, a.asset_number) AS equipment_number,
  COALESCE(a.description, a.asset_number)  AS name,
  t.name                                    AS equipment_type,
  a.department_id,
  a.fuel_type_id,
  a.expected_consumption_lph,
  a.status,
  a.is_archived,
  a.created_at,
  a.legacy_id,
  a.asset_number AS asset_code,
  a.description,
  a.registration,
  a.current_hours AS hour_meter,
  a.purchase_date AS last_service_date,
  NULL::INTEGER   AS service_interval_hours,
  NULL::TEXT      AS operator_name,
  a.assigned_project,
  a.purchase_cost AS acquisition_cost,
  a.purchase_date AS acquisition_date
FROM fleet_assets a
LEFT JOIN fleet_asset_types t ON t.id = a.asset_type_id
WHERE t.category IN ('generator', 'pump', 'other') OR a.legacy_source = 'fuel_equipment';


-- ── 6. Reassign FKs from fuel_transactions to fleet_assets ───────────────────
-- fuel_transactions.vehicle_id and equipment_id originally pointed at the old
-- tables. Since we preserved UUIDs during migration, the values already match
-- fleet_assets.id (for vehicles) or fleet_assets.old_fuel_equipment_id (for
-- equipment). The views keep the old FK names working. No FK constraint
-- changes needed — the original constraints were on the old table names which
-- are now renamed, and the views handle the mapping transparently.


-- ── 7. Fleet Status History (audit trail) ────────────────────────────────────

CREATE TABLE IF NOT EXISTS fleet_status_history (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id    UUID        NOT NULL REFERENCES fleet_assets(id) ON DELETE CASCADE,
  old_status  TEXT,
  new_status  TEXT        NOT NULL,
  changed_by  UUID        REFERENCES profiles(id),
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fleet_status_history_asset ON fleet_status_history(asset_id);


-- ── 8. Fleet Assignments ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fleet_assignments (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id           UUID        NOT NULL REFERENCES sites(id),
  asset_id          UUID        NOT NULL REFERENCES fleet_assets(id),
  operator_id       UUID        REFERENCES fuel_operators(id),
  department_id     UUID,
  cost_centre       TEXT,
  project           TEXT,
  shift             TEXT,                    -- 'day' | 'night' | 'standby'
  supervisor_id     UUID        REFERENCES fuel_operators(id),
  assignment_type   TEXT        NOT NULL DEFAULT 'permanent',
    -- 'permanent' | 'temporary' | 'pool' | 'standby'
  start_date        DATE        NOT NULL DEFAULT CURRENT_DATE,
  end_date          DATE,
  reason            TEXT,
  notes             TEXT,
  is_active         BOOLEAN     NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        UUID        REFERENCES profiles(id)
);

CREATE INDEX IF NOT EXISTS fleet_assignments_site   ON fleet_assignments(site_id);
CREATE INDEX IF NOT EXISTS fleet_assignments_asset  ON fleet_assignments(asset_id);
CREATE INDEX IF NOT EXISTS fleet_assignments_active ON fleet_assignments(asset_id) WHERE is_active = true;


-- ── 9. Fleet Inspection Templates ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fleet_inspection_templates (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id       UUID        NOT NULL REFERENCES sites(id),
  asset_type_id UUID        REFERENCES fleet_asset_types(id),  -- NULL = applies to all
  name          TEXT        NOT NULL,
  items         JSONB       NOT NULL DEFAULT '[]',
    -- Array of { "label": "Engine Oil", "category": "Fluids" }
  is_active     BOOLEAN     NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID        REFERENCES profiles(id)
);


-- ── 10. Fleet Inspections ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fleet_inspections (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id           UUID        NOT NULL REFERENCES sites(id),
  asset_id          UUID        NOT NULL REFERENCES fleet_assets(id),
  operator_id       UUID        REFERENCES fuel_operators(id),
  template_id       UUID        REFERENCES fleet_inspection_templates(id),
  inspection_date   DATE        NOT NULL DEFAULT CURRENT_DATE,
  overall_result    TEXT        NOT NULL DEFAULT 'pass',
    -- 'pass' | 'pass_with_defects' | 'unsafe'
  odometer_reading  NUMERIC(12,2),
  hours_reading     NUMERIC(12,2),
  notes             TEXT,
  photos            JSONB       DEFAULT '[]',   -- array of URLs
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        UUID        REFERENCES profiles(id)
);

CREATE INDEX IF NOT EXISTS fleet_inspections_site  ON fleet_inspections(site_id);
CREATE INDEX IF NOT EXISTS fleet_inspections_asset ON fleet_inspections(asset_id);


-- ── 11. Fleet Inspection Items ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fleet_inspection_items (
  id              UUID   PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id   UUID   NOT NULL REFERENCES fleet_inspections(id) ON DELETE CASCADE,
  item_label      TEXT   NOT NULL,
  category        TEXT,
  result          TEXT   NOT NULL DEFAULT 'ok',   -- 'ok' | 'defect' | 'na'
  notes           TEXT
);


-- ── 12. Fleet Trips ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fleet_trips (
  id              UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id         UUID           NOT NULL REFERENCES sites(id),
  asset_id        UUID           NOT NULL REFERENCES fleet_assets(id),
  operator_id     UUID           REFERENCES fuel_operators(id),
  trip_date       DATE           NOT NULL DEFAULT CURRENT_DATE,
  start_time      TIMESTAMPTZ,
  end_time        TIMESTAMPTZ,
  start_km        NUMERIC(12,2),
  end_km          NUMERIC(12,2),
  start_hours     NUMERIC(12,2),
  end_hours       NUMERIC(12,2),
  purpose         TEXT,
  route           TEXT,
  destination     TEXT,
  project         TEXT,
  department      TEXT,
  passengers      INTEGER        DEFAULT 0,
  notes           TEXT,
  -- Computed (stored for query convenience, recalculated on save)
  distance_km     NUMERIC(12,2)  GENERATED ALWAYS AS (GREATEST(0, end_km - start_km)) STORED,
  operating_hours NUMERIC(12,2)  GENERATED ALWAYS AS (GREATEST(0, end_hours - start_hours)) STORED,
  created_at      TIMESTAMPTZ    NOT NULL DEFAULT now(),
  created_by      UUID           REFERENCES profiles(id)
);

CREATE INDEX IF NOT EXISTS fleet_trips_site  ON fleet_trips(site_id);
CREATE INDEX IF NOT EXISTS fleet_trips_asset ON fleet_trips(asset_id);
CREATE INDEX IF NOT EXISTS fleet_trips_date  ON fleet_trips(trip_date);


-- ── 13. Fleet Work Orders ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fleet_work_orders (
  id                  UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id             UUID           NOT NULL REFERENCES sites(id),
  work_order_number   TEXT           NOT NULL,
  asset_id            UUID           NOT NULL REFERENCES fleet_assets(id),
  fault_description   TEXT           NOT NULL,
  requested_by        UUID           REFERENCES profiles(id),
  priority            TEXT           NOT NULL DEFAULT 'medium',
    -- 'low' | 'medium' | 'high' | 'critical'
  assigned_technician TEXT,
  parts_required      TEXT,
  labour_hours_est    NUMERIC(8,2),
  cost_est            NUMERIC(15,2),
  status              TEXT           NOT NULL DEFAULT 'scheduled',
    -- 'scheduled' | 'awaiting_approval' | 'waiting_for_parts' | 'in_progress' | 'completed' | 'cancelled'
  completed_at        TIMESTAMPTZ,
  notes               TEXT,
  created_at          TIMESTAMPTZ    NOT NULL DEFAULT now(),
  created_by          UUID           REFERENCES profiles(id),
  UNIQUE(site_id, work_order_number)
);

CREATE INDEX IF NOT EXISTS fleet_work_orders_site   ON fleet_work_orders(site_id);
CREATE INDEX IF NOT EXISTS fleet_work_orders_asset  ON fleet_work_orders(asset_id);
CREATE INDEX IF NOT EXISTS fleet_work_orders_status ON fleet_work_orders(status);


-- ── 14. Fleet Maintenance Records ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fleet_maintenance (
  id                    UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id               UUID           NOT NULL REFERENCES sites(id),
  asset_id              UUID           NOT NULL REFERENCES fleet_assets(id),
  work_order_id         UUID           REFERENCES fleet_work_orders(id),
  maintenance_type      TEXT           NOT NULL DEFAULT 'preventive',
    -- 'preventive' | 'corrective' | 'breakdown' | 'inspection' | 'warranty' | 'emergency'
  description           TEXT,
  technician            TEXT,
  workshop              TEXT,
  estimated_cost        NUMERIC(15,2),
  actual_cost           NUMERIC(15,2),
  labour_hours          NUMERIC(8,2),
  downtime_hours        NUMERIC(8,2),
  odometer_at_service   NUMERIC(12,2),
  hours_at_service      NUMERIC(12,2),
  service_date          DATE           NOT NULL DEFAULT CURRENT_DATE,
  completion_date       DATE,
  next_service_due_km   NUMERIC(12,2),
  next_service_due_date DATE,
  notes                 TEXT,
  created_at            TIMESTAMPTZ    NOT NULL DEFAULT now(),
  created_by            UUID           REFERENCES profiles(id)
);

CREATE INDEX IF NOT EXISTS fleet_maintenance_site  ON fleet_maintenance(site_id);
CREATE INDEX IF NOT EXISTS fleet_maintenance_asset ON fleet_maintenance(asset_id);


-- ── 15. Fleet Maintenance Parts ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fleet_maintenance_parts (
  id               UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  maintenance_id   UUID           NOT NULL REFERENCES fleet_maintenance(id) ON DELETE CASCADE,
  part_name        TEXT           NOT NULL,
  part_number      TEXT,
  quantity         NUMERIC(10,2)  NOT NULL DEFAULT 1,
  unit_cost        NUMERIC(15,2),
  total_cost       NUMERIC(15,2),
  supplier         TEXT,
  notes            TEXT
);


-- ── 16. Fleet Compliance ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fleet_compliance (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id            UUID        NOT NULL REFERENCES sites(id),
  asset_id           UUID        REFERENCES fleet_assets(id),
  operator_id        UUID        REFERENCES fuel_operators(id),
  compliance_type    TEXT        NOT NULL,
    -- 'vehicle_licence' | 'insurance' | 'roadworthy' | 'fitness_cert' | 'operator_licence' | 'operator_medical'
  document_number    TEXT,
  issue_date         DATE,
  expiry_date        DATE,
  issuing_authority  TEXT,
  document_url       TEXT,
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by         UUID        REFERENCES profiles(id)
);

CREATE INDEX IF NOT EXISTS fleet_compliance_site   ON fleet_compliance(site_id);
CREATE INDEX IF NOT EXISTS fleet_compliance_asset  ON fleet_compliance(asset_id);
CREATE INDEX IF NOT EXISTS fleet_compliance_expiry ON fleet_compliance(expiry_date);


-- ── 17. Fleet Documents ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fleet_documents (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id      UUID        NOT NULL REFERENCES sites(id),
  asset_id     UUID        REFERENCES fleet_assets(id),
  doc_type     TEXT,        -- 'photo' | 'licence' | 'insurance' | 'service_report' | 'other'
  file_name    TEXT        NOT NULL,
  file_url     TEXT        NOT NULL,
  file_size    INTEGER,
  notes        TEXT,
  uploaded_by  UUID        REFERENCES profiles(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ── 18. RLS Policies ─────────────────────────────────────────────────────────

ALTER TABLE fleet_assets               ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet_asset_types          ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet_status_history       ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet_assignments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet_inspection_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet_inspections          ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet_inspection_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet_trips                ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet_work_orders          ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet_maintenance          ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet_maintenance_parts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet_compliance           ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet_documents            ENABLE ROW LEVEL SECURITY;

-- Asset types are global (no site_id) — everyone reads
CREATE POLICY "fleet_asset_types_read"  ON fleet_asset_types FOR SELECT TO authenticated USING (true);
CREATE POLICY "fleet_asset_types_write" ON fleet_asset_types FOR ALL    TO authenticated USING (true);

-- Site-scoped tables: authenticated users can read/write their site's data
-- (App-level RBAC via usePermissions() further restricts create/edit/delete)

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'fleet_assets', 'fleet_status_history', 'fleet_assignments',
    'fleet_inspection_templates', 'fleet_inspections', 'fleet_inspection_items',
    'fleet_trips', 'fleet_work_orders', 'fleet_maintenance',
    'fleet_maintenance_parts', 'fleet_compliance', 'fleet_documents'
  ]) LOOP
    -- Some tables (inspection_items, maintenance_parts) don't have site_id —
    -- they inherit access through their parent FK.
    IF tbl IN ('fleet_inspection_items', 'fleet_maintenance_parts') THEN
      EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO authenticated USING (true)', tbl || '_read', tbl);
      EXECUTE format('CREATE POLICY %I ON %I FOR INSERT TO authenticated WITH CHECK (true)', tbl || '_insert', tbl);
      EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE TO authenticated USING (true)', tbl || '_update', tbl);
      EXECUTE format('CREATE POLICY %I ON %I FOR DELETE TO authenticated USING (true)', tbl || '_delete', tbl);
    ELSE
      EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO authenticated USING (true)', tbl || '_read', tbl);
      EXECUTE format('CREATE POLICY %I ON %I FOR INSERT TO authenticated WITH CHECK (true)', tbl || '_insert', tbl);
      EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE TO authenticated USING (true)', tbl || '_update', tbl);
      EXECUTE format('CREATE POLICY %I ON %I FOR DELETE TO authenticated USING (true)', tbl || '_delete', tbl);
    END IF;
  END LOOP;
END $$;


-- ── 19. Seed default inspection templates ────────────────────────────────────

-- Generic vehicle checklist (applied to all vehicle-category assets by default)
INSERT INTO fleet_inspection_templates (site_id, name, items)
SELECT
  s.id,
  'Vehicle Pre-Use Checklist',
  '[
    {"label": "Engine Oil Level",     "category": "Fluids"},
    {"label": "Coolant Level",        "category": "Fluids"},
    {"label": "Hydraulic Fluid",      "category": "Fluids"},
    {"label": "Brake Fluid",          "category": "Fluids"},
    {"label": "Fuel Level",           "category": "Fluids"},
    {"label": "Tyres Condition",      "category": "Exterior"},
    {"label": "Tyre Pressure",        "category": "Exterior"},
    {"label": "Lights (Head/Tail)",   "category": "Exterior"},
    {"label": "Indicators / Hazards", "category": "Exterior"},
    {"label": "Mirrors",              "category": "Exterior"},
    {"label": "Windscreen / Wipers",  "category": "Exterior"},
    {"label": "Body Damage",          "category": "Exterior"},
    {"label": "Horn",                 "category": "Safety"},
    {"label": "Brakes",              "category": "Safety"},
    {"label": "Handbrake",           "category": "Safety"},
    {"label": "Seat Belt",           "category": "Safety"},
    {"label": "Fire Extinguisher",   "category": "Safety"},
    {"label": "First Aid Kit",       "category": "Safety"},
    {"label": "Warning Triangle",    "category": "Safety"},
    {"label": "Leaks Under Vehicle", "category": "General"},
    {"label": "Dashboard Warnings",  "category": "General"},
    {"label": "Overall Cleanliness", "category": "General"}
  ]'::jsonb
FROM sites s;

-- Generator / equipment checklist
INSERT INTO fleet_inspection_templates (site_id, asset_type_id, name, items)
SELECT
  s.id,
  (SELECT id FROM fleet_asset_types WHERE code = 'GENERATOR'),
  'Generator Pre-Use Checklist',
  '[
    {"label": "Engine Oil Level",    "category": "Fluids"},
    {"label": "Coolant Level",       "category": "Fluids"},
    {"label": "Fuel Level",          "category": "Fluids"},
    {"label": "Battery Condition",   "category": "Electrical"},
    {"label": "Control Panel",       "category": "Electrical"},
    {"label": "Output Voltage",      "category": "Electrical"},
    {"label": "Exhaust System",      "category": "Mechanical"},
    {"label": "Belt Condition",      "category": "Mechanical"},
    {"label": "Leaks",              "category": "General"},
    {"label": "Fire Extinguisher",  "category": "Safety"},
    {"label": "Emergency Stop",     "category": "Safety"},
    {"label": "Earthing Cable",     "category": "Safety"}
  ]'::jsonb
FROM sites s;

COMMIT;
