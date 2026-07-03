-- ── 0054: Add dip mm columns to fuel_deliveries ─────────────────────────────
-- The existing dip_before / dip_after columns store litres. These new columns
-- store the raw dipstick measurement in mm, matching the dip readings pattern.
-- The UI enters mm and auto-calculates litres from the calibration table.
-- Also adds 'cancelled' to the status CHECK if not already present.

ALTER TABLE fuel_deliveries
  ADD COLUMN IF NOT EXISTS dip_before_mm NUMERIC(8,1),
  ADD COLUMN IF NOT EXISTS dip_after_mm  NUMERIC(8,1);

-- Widen status CHECK to include 'cancelled' (soft delete)
ALTER TABLE fuel_deliveries DROP CONSTRAINT IF EXISTS fuel_deliveries_status_check;
ALTER TABLE fuel_deliveries ADD CONSTRAINT fuel_deliveries_status_check
  CHECK (status IN ('pending', 'confirmed', 'queried', 'cancelled'));
