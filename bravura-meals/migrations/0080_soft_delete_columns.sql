-- ══════════════════════════════════════════════════════════════════════════════
-- 0080 — Soft-delete columns: add is_archived + archived_at where missing
-- ══════════════════════════════════════════════════════════════════════════════
-- Several tables were using hard DELETE which destroys audit history.
-- This adds the is_archived/archived_at pattern so the app can archive
-- records instead of deleting them. Tables that already have these columns
-- (employees, fuel_tanks, fuel_pumps, fuel_dip_readings, tank_calibrations,
-- departments, designations) are untouched.

BEGIN;

ALTER TABLE public.camp_blocks       ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.camp_blocks       ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

ALTER TABLE public.camp_rooms        ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.camp_rooms        ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

ALTER TABLE public.contractors       ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.contractors       ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

ALTER TABLE public.meal_providers    ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.meal_providers    ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

ALTER TABLE public.fleet_compliance  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.fleet_compliance  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

ALTER TABLE public.fleet_drivers     ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.fleet_drivers     ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

ALTER TABLE public.camp_supply_txns  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.camp_supply_txns  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

INSERT INTO public.schema_migrations (filename)
VALUES ('0080_soft_delete_columns.sql') ON CONFLICT (filename) DO NOTHING;

COMMIT;
