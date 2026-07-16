-- 0093 — Add location and kVA rating columns for generators on fleet_assets
BEGIN;

ALTER TABLE fleet_assets ADD COLUMN IF NOT EXISTS location text;
ALTER TABLE fleet_assets ADD COLUMN IF NOT EXISTS kva_rating numeric;

INSERT INTO schema_migrations (filename) VALUES ('0093_generator_location_rating.sql')
ON CONFLICT DO NOTHING;

COMMIT;
