-- ── 0068: Patch fleet_assets missing asset_type_id ───────────────────────────
-- Run this if Fleet Vehicles page shows 0 assets despite having fuel_vehicles data.
-- Safe to run multiple times (UPDATE ... WHERE IS NULL only touches null rows).

BEGIN;

-- Patch rows that came from fuel_vehicles but have no asset_type_id
UPDATE fleet_assets
SET asset_type_id = (SELECT id FROM fleet_asset_types WHERE code = 'VEHICLE')
WHERE asset_type_id IS NULL
  AND legacy_source = 'fuel_vehicles';

-- Patch rows that came from fuel_equipment but have no asset_type_id
UPDATE fleet_assets
SET asset_type_id = (SELECT id FROM fleet_asset_types WHERE code = 'EXCAVATOR')
WHERE asset_type_id IS NULL
  AND legacy_source = 'fuel_equipment';

-- Patch any remaining rows with no asset_type_id → default to VEHICLE
UPDATE fleet_assets
SET asset_type_id = (SELECT id FROM fleet_asset_types WHERE code = 'VEHICLE')
WHERE asset_type_id IS NULL;

-- Also ensure status values are fleet-compatible (fuel used 'active', fleet uses 'operational')
UPDATE fleet_assets
SET status = 'operational'
WHERE status = 'active';

COMMIT;
