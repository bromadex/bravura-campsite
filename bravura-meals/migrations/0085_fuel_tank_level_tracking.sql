BEGIN;

ALTER TABLE fuel_tanks
  ADD COLUMN IF NOT EXISTS level_tracking_method TEXT NOT NULL DEFAULT 'dipstick';

ALTER TABLE fuel_tanks
  DROP CONSTRAINT IF EXISTS fuel_tanks_level_tracking_method_check;

ALTER TABLE fuel_tanks
  ADD CONSTRAINT fuel_tanks_level_tracking_method_check
  CHECK (level_tracking_method IN ('dipstick', 'issuance'));

INSERT INTO public.schema_migrations (filename)
VALUES ('0085_fuel_tank_level_tracking.sql') ON CONFLICT (filename) DO NOTHING;

COMMIT;
