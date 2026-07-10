-- ── 0075: let fuel_requests reference fleet_assets ───────────────────────────
-- fuel_requests still carried the original CHECK (vehicle_id OR equipment_id
-- NOT NULL) plus FKs into fuel_vehicles/fuel_equipment. The request form's
-- pickers are backed by fleet_assets now, so requests for assets created
-- after the fleet migration failed the FK, and writing only fleet_asset_id
-- would fail the CHECK. Relax both: the asset link may live in any of the
-- three columns, with fleet_asset_id as the going-forward one.

BEGIN;

-- Drop the original unnamed CHECK (auto-named by Postgres). Find it by its
-- definition rather than guessing the generated name.
DO $$
DECLARE
  v_conname TEXT;
BEGIN
  SELECT conname INTO v_conname
    FROM pg_constraint
   WHERE conrelid = 'public.fuel_requests'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%vehicle_id IS NOT NULL%equipment_id IS NOT NULL%';
  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.fuel_requests DROP CONSTRAINT %I', v_conname);
  END IF;
END $$;

ALTER TABLE public.fuel_requests
  ADD CONSTRAINT fuel_requests_asset_check
  CHECK (vehicle_id IS NOT NULL OR equipment_id IS NOT NULL OR fleet_asset_id IS NOT NULL);

COMMIT;
