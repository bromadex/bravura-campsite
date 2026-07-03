-- ── 0052: Add dip start/end columns to fuel_dip_readings ─────────────────────
-- Previously each reading stored a single dip_mm + level_litres, and the UI
-- derived "dip start / dip end" by pairing consecutive readings per tank.
-- This migration adds explicit start/end columns so operators can record
-- both measurements in a single entry.
-- Existing data is migrated: old dip_mm → dip_end_mm, level_litres → level_end_litres.

ALTER TABLE fuel_dip_readings
  ADD COLUMN IF NOT EXISTS dip_start_mm       NUMERIC(8,1),
  ADD COLUMN IF NOT EXISTS dip_end_mm         NUMERIC(8,1),
  ADD COLUMN IF NOT EXISTS level_start_litres NUMERIC(12,3),
  ADD COLUMN IF NOT EXISTS level_end_litres   NUMERIC(12,3);

-- Migrate existing data: single dip → end measurement
UPDATE fuel_dip_readings
SET dip_end_mm       = dip_mm,
    level_end_litres = level_litres
WHERE dip_end_mm IS NULL
  AND (dip_mm IS NOT NULL OR level_litres IS NOT NULL);
