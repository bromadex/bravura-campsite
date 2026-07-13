BEGIN;

ALTER TABLE public.fuel_dip_readings
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.fuel_dip_readings
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

INSERT INTO public.schema_migrations (filename)
VALUES ('0082_dip_readings_soft_delete.sql') ON CONFLICT (filename) DO NOTHING;

COMMIT;
