-- ── 0057: Drop level_in_capacity constraint ─────────────────────────────────
-- Tank level is now set exclusively by dip readings (the physical ground truth).
-- The calibration table can map to litres values exceeding the configured
-- capacity_litres, and dip measurements after a delivery may temporarily
-- exceed capacity (e.g. overfill, or capacity was set conservatively).
-- This constraint blocks those legitimate updates.

ALTER TABLE fuel_tanks DROP CONSTRAINT IF EXISTS level_in_capacity;
