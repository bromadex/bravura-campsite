-- ── 0069: Add fleet_asset_id bridge column to fuel_requests ──────────────────
-- Mirrors what 0065 did for fuel_transactions. The application already
-- inserts fleet_asset_id when creating requests; this makes the column real
-- and adds the FK so PostgREST can resolve fleet_assets embeds.

BEGIN;

ALTER TABLE fuel_requests
  ADD COLUMN IF NOT EXISTS fleet_asset_id UUID REFERENCES fleet_assets(id);

-- Backfill from legacy vehicle_id / equipment_id (UUIDs are preserved in fleet_assets)
UPDATE fuel_requests fr
SET fleet_asset_id = fa.id
FROM fleet_assets fa
WHERE fr.fleet_asset_id IS NULL
  AND fa.id = COALESCE(fr.vehicle_id, fr.equipment_id);

CREATE INDEX IF NOT EXISTS fuel_requests_fleet_asset
  ON fuel_requests(fleet_asset_id) WHERE fleet_asset_id IS NOT NULL;

COMMIT;
