-- ── Extend fuel_vehicles + fuel_equipment for legacy Bravura fleet import ────
-- Adds columns to hold the extra fields carried by the old ERP's `fleet`
-- and `earth_movers` tables so the Kamativi asset list can be brought
-- across without dropping data (odometers, licence expiries, weights,
-- trackers, cost centres, acquisition). The `legacy_id` column preserves
-- the old row id so historical fuel_log rows can later be joined back
-- to the imported asset by that key.

BEGIN;

ALTER TABLE fuel_vehicles
  ADD COLUMN IF NOT EXISTS legacy_id             TEXT,
  ADD COLUMN IF NOT EXISTS asset_code            TEXT,
  ADD COLUMN IF NOT EXISTS description           TEXT,
  ADD COLUMN IF NOT EXISTS vehicle_type          TEXT,
  ADD COLUMN IF NOT EXISTS assigned_driver_id    TEXT,
  ADD COLUMN IF NOT EXISTS assigned_driver_name  TEXT,
  ADD COLUMN IF NOT EXISTS odometer_km           NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS last_service_date     DATE,
  ADD COLUMN IF NOT EXISTS service_interval_km   INTEGER,
  ADD COLUMN IF NOT EXISTS service_interval_days INTEGER,
  ADD COLUMN IF NOT EXISTS assigned_project      TEXT,
  ADD COLUMN IF NOT EXISTS tare_weight           NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS gross_vehicle_mass    NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS licence_expiry        DATE,
  ADD COLUMN IF NOT EXISTS insurance_expiry      DATE,
  ADD COLUMN IF NOT EXISTS roadworthy_expiry     DATE,
  ADD COLUMN IF NOT EXISTS tracker_id            TEXT,
  ADD COLUMN IF NOT EXISTS department_name       TEXT,
  ADD COLUMN IF NOT EXISTS cost_center           TEXT,
  ADD COLUMN IF NOT EXISTS acquisition_cost      NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS acquisition_date      DATE,
  ADD COLUMN IF NOT EXISTS salvage_value         NUMERIC(15,2);

CREATE UNIQUE INDEX IF NOT EXISTS fuel_vehicles_legacy_id_uniq
  ON fuel_vehicles(legacy_id) WHERE legacy_id IS NOT NULL;

ALTER TABLE fuel_equipment
  ADD COLUMN IF NOT EXISTS legacy_id              TEXT,
  ADD COLUMN IF NOT EXISTS asset_code             TEXT,
  ADD COLUMN IF NOT EXISTS description            TEXT,
  ADD COLUMN IF NOT EXISTS registration           TEXT,
  ADD COLUMN IF NOT EXISTS hour_meter             NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS last_service_date      DATE,
  ADD COLUMN IF NOT EXISTS service_interval_hours INTEGER,
  ADD COLUMN IF NOT EXISTS operator_name          TEXT,
  ADD COLUMN IF NOT EXISTS assigned_project       TEXT,
  ADD COLUMN IF NOT EXISTS acquisition_cost       NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS acquisition_date       DATE;

CREATE UNIQUE INDEX IF NOT EXISTS fuel_equipment_legacy_id_uniq
  ON fuel_equipment(legacy_id) WHERE legacy_id IS NOT NULL;

COMMIT;
