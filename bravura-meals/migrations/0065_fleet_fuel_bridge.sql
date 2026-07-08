-- ══════════════════════════════════════════════════════════════════════════════
-- 0065 — Fleet ↔ Fuel Bridge
--
-- Adds fleet_asset_id to fuel_transactions so Fleet can query fuel history
-- directly without joining through old_fuel_vehicle_id / old_fuel_equipment_id.
-- Backfills from fleet_assets using the preserved legacy FK columns.
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1. Add column
ALTER TABLE fuel_transactions
  ADD COLUMN IF NOT EXISTS fleet_asset_id UUID REFERENCES fleet_assets(id);

CREATE INDEX IF NOT EXISTS fuel_transactions_fleet_asset
  ON fuel_transactions(fleet_asset_id) WHERE fleet_asset_id IS NOT NULL;

-- 2. Backfill from vehicles
UPDATE fuel_transactions t
SET fleet_asset_id = fa.id
FROM fleet_assets fa
WHERE t.vehicle_id IS NOT NULL
  AND fa.old_fuel_vehicle_id = t.vehicle_id
  AND t.fleet_asset_id IS NULL;

-- 3. Backfill from equipment
UPDATE fuel_transactions t
SET fleet_asset_id = fa.id
FROM fleet_assets fa
WHERE t.equipment_id IS NOT NULL
  AND fa.old_fuel_equipment_id = t.equipment_id
  AND t.fleet_asset_id IS NULL;

COMMIT;
