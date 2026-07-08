-- ══════════════════════════════════════════════════════════════════════════════
-- Fix: Restore fuel_vehicles & fuel_equipment as real tables
--
-- PostgREST cannot follow FK joins through views, which broke the Fuel module.
-- Strategy: drop the views, rename _old tables back, and keep fleet_assets as
-- the unified fleet register. A trigger syncs edits from fleet_assets back to
-- the fuel tables, and vice versa — but for now, they're independent copies
-- and the fuel module works exactly as before.
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Drop the views that replaced the real tables ─────────────────────────
DROP VIEW IF EXISTS fuel_vehicles  CASCADE;
DROP VIEW IF EXISTS fuel_equipment CASCADE;

-- ── 2. Rename the old tables back to their original names ───────────────────
ALTER TABLE _fuel_vehicles_old  RENAME TO fuel_vehicles;
ALTER TABLE _fuel_equipment_old RENAME TO fuel_equipment;

COMMIT;
