-- 0087: Backfill fleet_asset_id on legacy bulk issuances.
-- The pre-0074 rpc_bulk_fuel_issuance wrote vehicle_id / equipment_id but
-- left fleet_asset_id NULL, so Issuance History showed those rows as
-- "Other / Unknown". The ids already point at fleet_assets rows — copy them.

UPDATE fuel_transactions ft
SET fleet_asset_id = ft.vehicle_id
WHERE ft.transaction_type = 'issuance'
  AND ft.fleet_asset_id IS NULL
  AND ft.vehicle_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM fleet_assets fa WHERE fa.id = ft.vehicle_id);

UPDATE fuel_transactions ft
SET fleet_asset_id = ft.equipment_id
WHERE ft.transaction_type = 'issuance'
  AND ft.fleet_asset_id IS NULL
  AND ft.equipment_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM fleet_assets fa WHERE fa.id = ft.equipment_id);

-- Legacy rows whose equipment_id points at the old fuel_equipment table:
-- map to fleet_assets by exact name where possible…
UPDATE fuel_transactions ft
SET fleet_asset_id = fa.id
FROM fuel_equipment fe
JOIN fleet_assets fa
  ON lower(fa.description) = lower(fe.name)
  OR lower(fa.asset_number) = lower(fe.name)
WHERE ft.transaction_type = 'issuance'
  AND ft.fleet_asset_id IS NULL
  AND ft.equipment_id = fe.id;

-- …and carry the name into asset_description for the rest so the UI
-- shows the recipient instead of "Unknown".
UPDATE fuel_transactions ft
SET asset_description = fe.name
FROM fuel_equipment fe
WHERE ft.transaction_type = 'issuance'
  AND ft.fleet_asset_id IS NULL
  AND ft.asset_description IS NULL
  AND ft.equipment_id = fe.id;

INSERT INTO schema_migrations (filename)
VALUES ('0087_bulk_issuance_backfill_fleet_asset.sql')
ON CONFLICT DO NOTHING;
