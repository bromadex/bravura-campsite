-- ── 0049: Add receiving_officer to fuel_deliveries ──────────────────────────
-- Captures the name of the person physically receiving fuel on site.

ALTER TABLE fuel_deliveries
  ADD COLUMN IF NOT EXISTS receiving_officer TEXT;

COMMENT ON COLUMN fuel_deliveries.receiving_officer IS
  'Name of the person who physically received the fuel delivery on site.';
