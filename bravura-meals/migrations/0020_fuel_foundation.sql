-- ══════════════════════════════════════════════════════════════════════════════
-- Fuel Module Foundation — Phase 1
-- Replaces the earlier fuel_management.sql prototype.
--
-- Apply via Supabase Dashboard › SQL Editor.
-- Run the whole script in one go.
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. Drop prototype tables (safe — prototype had no production data) ─────────
DROP TABLE IF EXISTS fuel_issues        CASCADE;
DROP TABLE IF EXISTS fuel_receipts      CASCADE;
DROP TABLE IF EXISTS fuel_dip_readings  CASCADE;
DROP TABLE IF EXISTS fuel_tanks         CASCADE;


-- ── 2. Fuel Types (lookup) ────────────────────────────────────────────────────
-- Seeded with Diesel only for now.
-- Adding more fuel types in future requires only INSERT rows here —
-- no schema changes needed anywhere else.

CREATE TABLE IF NOT EXISTS fuel_types (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL,
  code       TEXT        NOT NULL UNIQUE,
  colour     TEXT,                          -- hex colour for badges / charts
  density    NUMERIC(6,4),                  -- kg/litre, for future mass conversions
  is_active  BOOLEAN     NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO fuel_types (name, code, colour) VALUES
  ('Diesel', 'DIESEL', '#FF8C00')
ON CONFLICT (code) DO NOTHING;


-- ── 3. Fuel Tanks ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fuel_tanks (
  id                       UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id                  UUID           NOT NULL REFERENCES sites(id),
  name                     TEXT           NOT NULL,
  code                     TEXT           NOT NULL,          -- short identifier e.g. T-001
  tank_type                TEXT           NOT NULL DEFAULT 'above_ground',
    -- 'underground' | 'above_ground' | 'bowser' | 'mobile'
  fuel_type_id             UUID           NOT NULL REFERENCES fuel_types(id),
  capacity_litres          NUMERIC(12,3)  NOT NULL,
  current_level_litres     NUMERIC(12,3)  NOT NULL DEFAULT 0,
  min_threshold_litres     NUMERIC(12,3)  NOT NULL DEFAULT 0,
  min_threshold_percent    NUMERIC(5,2)   NOT NULL DEFAULT 20,
  location_description     TEXT,
  gps_lat                  NUMERIC(10,7),
  gps_lng                  NUMERIC(10,7),
  atg_device_id            TEXT,          -- future IoT integration hook
  last_dip_date            DATE,
  last_dip_reading         NUMERIC(12,3),
  status                   TEXT           NOT NULL DEFAULT 'active',
    -- 'active' | 'maintenance' | 'decommissioned'
  is_archived              BOOLEAN        NOT NULL DEFAULT false,
  archived_at              TIMESTAMPTZ,
  created_at               TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ    NOT NULL DEFAULT now(),
  created_by               UUID           REFERENCES profiles(id),
  UNIQUE(site_id, code),
  CONSTRAINT positive_level     CHECK (current_level_litres >= 0),
  CONSTRAINT level_in_capacity  CHECK (current_level_litres <= capacity_litres)
);


-- ── 4. Fuel Pumps ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fuel_pumps (
  id                     UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id                UUID          NOT NULL REFERENCES sites(id),
  tank_id                UUID          NOT NULL REFERENCES fuel_tanks(id),
  name                   TEXT          NOT NULL,
  code                   TEXT,
  current_meter_reading  NUMERIC(12,3) NOT NULL DEFAULT 0,
  status                 TEXT          NOT NULL DEFAULT 'active',
    -- 'active' | 'maintenance' | 'decommissioned'
  is_archived            BOOLEAN       NOT NULL DEFAULT false,
  created_at             TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE(site_id, code)
);


-- ── 5. Fuel Vehicles ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fuel_vehicles (
  id                         UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id                    UUID          NOT NULL REFERENCES sites(id),
  fleet_number               TEXT          NOT NULL,
  registration               TEXT,
  make                       TEXT,
  model                      TEXT,
  year                       INTEGER,
  department_id              UUID,          -- FK to departments (HR module)
  fuel_type_id               UUID          NOT NULL REFERENCES fuel_types(id),
  tank_capacity_litres       NUMERIC(8,3),
  expected_consumption_lpkm  NUMERIC(6,3), -- litres per km
  status                     TEXT          NOT NULL DEFAULT 'active',
    -- 'active' | 'maintenance' | 'decommissioned'
  future_fleet_id            UUID,         -- link to Fleet module when built
  is_archived                BOOLEAN       NOT NULL DEFAULT false,
  archived_at                TIMESTAMPTZ,
  created_at                 TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by                 UUID          REFERENCES profiles(id),
  UNIQUE(site_id, fleet_number)
);


-- ── 6. Fuel Equipment ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fuel_equipment (
  id                        UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id                   UUID          NOT NULL REFERENCES sites(id),
  equipment_number          TEXT          NOT NULL,
  name                      TEXT          NOT NULL,
  equipment_type            TEXT,
    -- 'Generator' | 'Compressor' | 'Drill' | 'Pump' | 'Other'
  department_id             UUID,
  fuel_type_id              UUID          NOT NULL REFERENCES fuel_types(id),
  expected_consumption_lph  NUMERIC(6,3), -- litres per hour
  status                    TEXT          NOT NULL DEFAULT 'active',
  is_archived               BOOLEAN       NOT NULL DEFAULT false,
  created_at                TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE(site_id, equipment_number)
);


-- ── 7. Fuel Operators ─────────────────────────────────────────────────────────
-- Operators MUST be active employees (FK to employees.id).
-- Never create a separate operator registry outside HR data.

CREATE TABLE IF NOT EXISTS fuel_operators (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id         UUID        NOT NULL REFERENCES sites(id),
  employee_id     UUID        NOT NULL REFERENCES employees(id),
  licence_number  TEXT,
  licence_expiry  DATE,
  is_active       BOOLEAN     NOT NULL DEFAULT true,
  activated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deactivated_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID        REFERENCES profiles(id),
  UNIQUE(site_id, employee_id)
);


-- ── 8. Fuel Transactions ──────────────────────────────────────────────────────
-- IMMUTABLE after creation — never UPDATE or DELETE rows.
-- For corrections: INSERT a new row with transaction_type = 'adjustment'.

CREATE TABLE IF NOT EXISTS fuel_transactions (
  id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id                 UUID          NOT NULL REFERENCES sites(id),
  transaction_number      TEXT          NOT NULL,
  transaction_date        DATE          NOT NULL DEFAULT CURRENT_DATE,
  tank_id                 UUID          NOT NULL REFERENCES fuel_tanks(id),
  pump_id                 UUID          REFERENCES fuel_pumps(id),
  transaction_type        TEXT          NOT NULL,
    -- 'issuance' | 'delivery' | 'adjustment' | 'dip_correction'
  vehicle_id              UUID          REFERENCES fuel_vehicles(id),
  equipment_id            UUID          REFERENCES fuel_equipment(id),
  asset_description       TEXT,         -- free text when no vehicle/equipment FK
  operator_id             UUID          REFERENCES fuel_operators(id),
  litres                  NUMERIC(12,3) NOT NULL,
  meter_start             NUMERIC(12,3),
  meter_end               NUMERIC(12,3),
  tank_level_before       NUMERIC(12,3),
  tank_level_after        NUMERIC(12,3),
  unit_price              NUMERIC(10,4),
  total_cost              NUMERIC(15,2),
  supplier                TEXT,         -- for deliveries
  docket_number           TEXT,
  fuel_request_id         UUID,         -- FK to fuel_requests (Phase 2)
  original_transaction_id UUID,         -- for adjustments, references the corrected row
  approved_by             UUID          REFERENCES profiles(id),
  approved_at             TIMESTAMPTZ,
  notes                   TEXT,
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by              UUID          REFERENCES profiles(id),
  UNIQUE(site_id, transaction_number)
);


-- ── 9. Dip Readings (separate from transactions — observations, not corrections)

CREATE TABLE IF NOT EXISTS fuel_dip_readings (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id          UUID          NOT NULL REFERENCES sites(id),
  tank_id          UUID          NOT NULL REFERENCES fuel_tanks(id),
  reading_date     DATE          NOT NULL,
  reading_litres   NUMERIC(12,3) NOT NULL CHECK (reading_litres >= 0),
  recorded_by      UUID          REFERENCES profiles(id),
  recorded_by_name TEXT,
  notes            TEXT,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now()
);


-- ── 10. Triggers ──────────────────────────────────────────────────────────────

-- 10a. Update fuel_tanks.current_level_litres after each transaction INSERT.
--      Tank level changes ONLY via this trigger — never by application code directly.

CREATE OR REPLACE FUNCTION fuel_update_tank_level()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.transaction_type = 'issuance' THEN
    UPDATE fuel_tanks
    SET current_level_litres = current_level_litres - NEW.litres,
        updated_at           = now()
    WHERE id = NEW.tank_id;

  ELSIF NEW.transaction_type = 'delivery' THEN
    UPDATE fuel_tanks
    SET current_level_litres = current_level_litres + NEW.litres,
        updated_at           = now()
    WHERE id = NEW.tank_id;

  ELSIF NEW.transaction_type IN ('adjustment', 'dip_correction') THEN
    -- litres can be negative for downward corrections
    UPDATE fuel_tanks
    SET current_level_litres = current_level_litres + NEW.litres,
        updated_at           = now()
    WHERE id = NEW.tank_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fuel_update_tank_level ON fuel_transactions;
CREATE TRIGGER trg_fuel_update_tank_level
AFTER INSERT ON fuel_transactions
FOR EACH ROW EXECUTE FUNCTION fuel_update_tank_level();


-- 10b. Update dip reading snapshot on fuel_tanks when a dip reading is recorded.

CREATE OR REPLACE FUNCTION fuel_update_last_dip()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE fuel_tanks
  SET last_dip_date    = NEW.reading_date,
      last_dip_reading = NEW.reading_litres,
      updated_at       = now()
  WHERE id = NEW.tank_id
    AND (last_dip_date IS NULL OR NEW.reading_date >= last_dip_date);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fuel_update_last_dip ON fuel_dip_readings;
CREATE TRIGGER trg_fuel_update_last_dip
AFTER INSERT ON fuel_dip_readings
FOR EACH ROW EXECUTE FUNCTION fuel_update_last_dip();


-- 10c. Auto-set updated_at on fuel_tanks and fuel_pumps.

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tanks_updated_at ON fuel_tanks;
CREATE TRIGGER trg_tanks_updated_at
BEFORE UPDATE ON fuel_tanks
FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ── 11. Row-Level Security ────────────────────────────────────────────────────
-- Users see only rows that belong to a site they are a member of.
-- The helper uses the profiles table which stores site_id.

ALTER TABLE fuel_types        ENABLE ROW LEVEL SECURITY;
ALTER TABLE fuel_tanks        ENABLE ROW LEVEL SECURITY;
ALTER TABLE fuel_pumps        ENABLE ROW LEVEL SECURITY;
ALTER TABLE fuel_vehicles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE fuel_equipment    ENABLE ROW LEVEL SECURITY;
ALTER TABLE fuel_operators    ENABLE ROW LEVEL SECURITY;
ALTER TABLE fuel_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE fuel_dip_readings ENABLE ROW LEVEL SECURITY;

-- fuel_types is global (no site_id) — all authenticated users may read
CREATE POLICY "fuel_types: auth read"
  ON fuel_types FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "fuel_types: auth write"
  ON fuel_types FOR ALL
  USING (auth.role() = 'authenticated');

-- Site-scoped helper: true when the requesting user has access to the row's site.
-- A user_roles row with site_id = NULL means the role grants access to ALL sites
-- (Group Admin / System Admin behaviour — matches SiteContext logic).
CREATE OR REPLACE FUNCTION user_in_site(row_site_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = auth.uid()
      AND (site_id = row_site_id OR site_id IS NULL)
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'fuel_tanks','fuel_pumps','fuel_vehicles','fuel_equipment',
    'fuel_operators','fuel_transactions','fuel_dip_readings'
  ]
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS "site_read" ON %I;
       DROP POLICY IF EXISTS "site_write" ON %I;
       CREATE POLICY "site_read"  ON %I FOR SELECT USING (user_in_site(site_id));
       CREATE POLICY "site_write" ON %I FOR ALL    USING (user_in_site(site_id));',
      tbl, tbl, tbl, tbl
    );
  END LOOP;
END$$;


-- ── 12. Permissions ───────────────────────────────────────────────────────────

INSERT INTO permissions (code, module, action, description) VALUES
  ('fuel.view',   'fuel', 'View',   'View fuel dashboard, tank levels, ledger and reports'),
  ('fuel.create', 'fuel', 'Create', 'Record fuel issuances, deliveries, and dip readings'),
  ('fuel.edit',   'fuel', 'Edit',   'Add, edit, and archive fuel tanks'),
  ('fuel.approve','fuel', 'Approve','Run fuel reconciliation and post adjustments')
ON CONFLICT (code) DO UPDATE SET
  module      = EXCLUDED.module,
  action      = EXCLUDED.action,
  description = EXCLUDED.description;

-- Remove old prototype permission codes that no longer exist
DELETE FROM permissions WHERE module = 'fuel' AND code NOT IN (
  'fuel.view', 'fuel.create', 'fuel.edit', 'fuel.approve'
);

-- Grant all fuel permissions to System Admin and Group Admin
INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id
  FROM   roles r
  CROSS JOIN permissions p
  WHERE  r.name IN ('System Admin', 'Group Admin')
    AND  p.code LIKE 'fuel.%'
ON CONFLICT DO NOTHING;
