-- ══════════════════════════════════════════════════════════════════════════════
-- 0066 — Fleet Phase 10: Meter Readings, Drivers, Tyres, Accidents, Settings
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Meter Readings ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fleet_meter_readings (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id       UUID        NOT NULL REFERENCES sites(id),
  asset_id      UUID        NOT NULL REFERENCES fleet_assets(id),
  reading_type  TEXT        NOT NULL DEFAULT 'odometer',
    -- 'odometer' | 'hours'
  reading_value NUMERIC(12,2) NOT NULL,
  reading_date  DATE        NOT NULL DEFAULT CURRENT_DATE,
  reading_time  TIME,
  source        TEXT        NOT NULL DEFAULT 'manual',
    -- 'manual' | 'trip' | 'inspection' | 'maintenance' | 'fuel'
  is_flagged    BOOLEAN     NOT NULL DEFAULT false,
  flag_reason   TEXT,
  notes         TEXT,
  recorded_by   UUID        REFERENCES profiles(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fleet_meter_readings_asset ON fleet_meter_readings(asset_id, reading_date DESC);
CREATE INDEX IF NOT EXISTS fleet_meter_readings_site  ON fleet_meter_readings(site_id);

-- ── 2. Fleet Drivers (extends employees with fleet-specific data) ────────────

CREATE TABLE IF NOT EXISTS fleet_drivers (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id             UUID        NOT NULL REFERENCES sites(id),
  employee_id         UUID        NOT NULL REFERENCES employees(id),
  licence_number      TEXT,
  licence_class       TEXT,         -- 'C1' | 'C' | 'EC' | 'B' | 'A' etc.
  licence_expiry      DATE,
  pdp_number          TEXT,         -- Professional Driving Permit
  pdp_expiry          DATE,
  medical_cert_expiry DATE,
  endorsements        TEXT,         -- comma-separated: 'hazmat,tanker,passenger'
  restrictions        TEXT,
  is_active           BOOLEAN     NOT NULL DEFAULT true,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by          UUID        REFERENCES profiles(id),
  UNIQUE(site_id, employee_id)
);

CREATE INDEX IF NOT EXISTS fleet_drivers_site ON fleet_drivers(site_id);
CREATE INDEX IF NOT EXISTS fleet_drivers_employee ON fleet_drivers(employee_id);

-- ── 3. Fleet Tyres ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fleet_tyres (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id         UUID          NOT NULL REFERENCES sites(id),
  asset_id        UUID          REFERENCES fleet_assets(id),
  serial_number   TEXT,
  brand           TEXT,
  size            TEXT,           -- e.g. '265/70R17'
  position        TEXT,           -- 'FL' | 'FR' | 'RL' | 'RR' | 'spare' | 'inner_RL' etc.
  status          TEXT           NOT NULL DEFAULT 'fitted',
    -- 'fitted' | 'stock' | 'retreaded' | 'scrapped'
  tread_depth_mm  NUMERIC(5,2),
  min_tread_mm    NUMERIC(5,2)  DEFAULT 3.0,
  fitment_date    DATE,
  fitment_km      NUMERIC(12,2),
  removal_date    DATE,
  removal_km      NUMERIC(12,2),
  removal_reason  TEXT,
  purchase_cost   NUMERIC(10,2),
  retread_count   INTEGER       DEFAULT 0,
  notes           TEXT,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by      UUID          REFERENCES profiles(id)
);

CREATE INDEX IF NOT EXISTS fleet_tyres_site  ON fleet_tyres(site_id);
CREATE INDEX IF NOT EXISTS fleet_tyres_asset ON fleet_tyres(asset_id);

-- ── 4. Fleet Accidents ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fleet_accidents (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id           UUID          NOT NULL REFERENCES sites(id),
  asset_id          UUID          NOT NULL REFERENCES fleet_assets(id),
  driver_id         UUID          REFERENCES fleet_drivers(id),
  accident_date     DATE          NOT NULL DEFAULT CURRENT_DATE,
  accident_time     TIME,
  location          TEXT,
  description       TEXT          NOT NULL,
  severity          TEXT          NOT NULL DEFAULT 'minor',
    -- 'minor' | 'moderate' | 'major' | 'write_off'
  incident_type     TEXT,
    -- 'collision' | 'rollover' | 'mechanical' | 'environmental' | 'theft' | 'vandalism' | 'other'
  injuries          INTEGER       DEFAULT 0,
  fatalities        INTEGER       DEFAULT 0,
  police_case_no    TEXT,
  insurance_claim   TEXT,
  claim_amount      NUMERIC(15,2),
  repair_cost       NUMERIC(15,2),
  days_off_road     INTEGER,
  root_cause        TEXT,
  corrective_action TEXT,
  status            TEXT          NOT NULL DEFAULT 'reported',
    -- 'reported' | 'investigating' | 'resolved' | 'closed'
  photos_url        TEXT,
  notes             TEXT,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by        UUID          REFERENCES profiles(id)
);

CREATE INDEX IF NOT EXISTS fleet_accidents_site  ON fleet_accidents(site_id);
CREATE INDEX IF NOT EXISTS fleet_accidents_asset ON fleet_accidents(asset_id);

-- ── 5. Fleet Settings ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fleet_settings (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id                 UUID        NOT NULL REFERENCES sites(id) UNIQUE,
  pm_reminder_days        INTEGER     DEFAULT 14,
  inspection_frequency    TEXT        DEFAULT 'daily',
  odometer_regression_pct NUMERIC(5,2) DEFAULT 5.0,
  hours_regression_pct    NUMERIC(5,2) DEFAULT 5.0,
  fuel_variance_pct       NUMERIC(5,2) DEFAULT 15.0,
  min_tread_depth_mm      NUMERIC(5,2) DEFAULT 3.0,
  auto_ground_on_fail     BOOLEAN     DEFAULT true,
  auto_create_wo_on_fail  BOOLEAN     DEFAULT true,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE fleet_meter_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet_drivers        ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet_tyres          ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet_accidents      ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet_settings       ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'fleet_meter_readings', 'fleet_drivers', 'fleet_tyres',
    'fleet_accidents', 'fleet_settings'
  ]) LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', tbl || '_read',   tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', tbl || '_insert', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', tbl || '_update', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', tbl || '_delete', tbl);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO authenticated USING (true)',          tbl || '_read',   tbl);
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT TO authenticated WITH CHECK (true)',     tbl || '_insert', tbl);
    EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE TO authenticated USING (true)',          tbl || '_update', tbl);
    EXECUTE format('CREATE POLICY %I ON %I FOR DELETE TO authenticated USING (true)',          tbl || '_delete', tbl);
  END LOOP;
END $$;

COMMIT;
