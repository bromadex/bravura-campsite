-- ── 0068: Re-sync fleet_assets from fuel_vehicles + fuel_equipment ───────────
-- Run this if Fleet Vehicles/Equipment pages show 0 assets.
-- Safe to run multiple times — ON CONFLICT DO NOTHING skips existing rows.
-- Also patches status 'active' → 'operational' and null asset_type_id.

BEGIN;

-- ── 1. Re-sync fuel_vehicles → fleet_assets (preserves UUID) ─────────────────
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
  v.id,
  v.site_id,
  COALESCE(v.asset_code, v.fleet_number, v.id::TEXT),
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
  COALESCE(v.description, v.fleet_number),
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
  CASE WHEN v.status = 'active' THEN 'operational' ELSE COALESCE(v.status, 'operational') END,
  v.is_archived,
  v.archived_at,
  v.created_at,
  v.created_by
FROM fuel_vehicles v
ON CONFLICT (id) DO UPDATE SET
  asset_type_id = EXCLUDED.asset_type_id,
  status = CASE
    WHEN fleet_assets.status = 'active' THEN 'operational'
    ELSE COALESCE(fleet_assets.status, 'operational')
  END;

-- ── 2. Re-sync fuel_equipment → fleet_assets ─────────────────────────────────
INSERT INTO fleet_assets (
  site_id, asset_number, asset_type_id,
  description, fleet_number,
  department_id,
  fuel_type_id, expected_consumption_lph,
  current_hours,
  purchase_date, purchase_cost,
  legacy_id, legacy_source, old_fuel_equipment_id,
  status, is_archived, created_at
)
SELECT
  e.site_id,
  COALESCE(e.asset_code, e.equipment_number, e.id::TEXT),
  (SELECT id FROM fleet_asset_types WHERE code = UPPER(COALESCE(
    CASE e.equipment_type
      WHEN 'Generator'  THEN 'GENERATOR'
      WHEN 'Compressor' THEN 'COMPRESSOR'
      WHEN 'Drill'      THEN 'DRILL'
      WHEN 'Pump'       THEN 'PUMP'
      ELSE NULL
    END,
    'EXCAVATOR'
  ))),
  COALESCE(e.name, e.equipment_number),
  e.equipment_number,
  e.department_id,
  e.fuel_type_id,
  e.expected_consumption_lph,
  COALESCE(e.hours, 0),
  e.acquisition_date,
  e.acquisition_cost,
  e.legacy_id,
  'fuel_equipment',
  e.id,
  CASE WHEN e.status = 'active' THEN 'operational' ELSE COALESCE(e.status, 'operational') END,
  e.is_archived,
  e.created_at
FROM fuel_equipment e
WHERE NOT EXISTS (
  SELECT 1 FROM fleet_assets fa WHERE fa.old_fuel_equipment_id = e.id
)
ON CONFLICT (site_id, asset_number) DO NOTHING;

-- ── 3. Patch any remaining null asset_type_id ─────────────────────────────────
UPDATE fleet_assets
SET asset_type_id = (SELECT id FROM fleet_asset_types WHERE code = 'VEHICLE')
WHERE asset_type_id IS NULL;

-- ── 4. Normalise status values ────────────────────────────────────────────────
UPDATE fleet_assets
SET status = 'operational'
WHERE status NOT IN ('operational','maintenance','grounded','awaiting_parts','decommissioned');

COMMIT;
