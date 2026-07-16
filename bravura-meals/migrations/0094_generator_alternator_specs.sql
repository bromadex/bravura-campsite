-- 0094 — Generator alternator & engine spec fields on fleet_assets
BEGIN;

ALTER TABLE fleet_assets ADD COLUMN IF NOT EXISTS engine_type text;
ALTER TABLE fleet_assets ADD COLUMN IF NOT EXISTS engine_serial text;
ALTER TABLE fleet_assets ADD COLUMN IF NOT EXISTS alternator_make text;
ALTER TABLE fleet_assets ADD COLUMN IF NOT EXISTS alternator_model text;
ALTER TABLE fleet_assets ADD COLUMN IF NOT EXISTS alternator_serial text;
ALTER TABLE fleet_assets ADD COLUMN IF NOT EXISTS voltage numeric;
ALTER TABLE fleet_assets ADD COLUMN IF NOT EXISTS phase integer;
ALTER TABLE fleet_assets ADD COLUMN IF NOT EXISTS frequency numeric;
ALTER TABLE fleet_assets ADD COLUMN IF NOT EXISTS rated_amps numeric;
ALTER TABLE fleet_assets ADD COLUMN IF NOT EXISTS power_factor numeric;
ALTER TABLE fleet_assets ADD COLUMN IF NOT EXISTS rpm numeric;
ALTER TABLE fleet_assets ADD COLUMN IF NOT EXISTS avr_type text;
ALTER TABLE fleet_assets ADD COLUMN IF NOT EXISTS cooling_method text;
ALTER TABLE fleet_assets ADD COLUMN IF NOT EXISTS notes text;

INSERT INTO schema_migrations (filename) VALUES ('0094_generator_alternator_specs.sql')
ON CONFLICT DO NOTHING;

COMMIT;
