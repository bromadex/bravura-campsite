-- ── 0078: Harare becomes the head office ─────────────────────────────────────
-- Flips sites.site_type for Harare to 'head_office' and asserts every other
-- site is 'operational'. isHQ in SiteContext keys off this, which gates the
-- HQ-only surfaces (Procurement module today; consolidated cross-site
-- reporting and the AI layer later).

BEGIN;

-- Widen the check constraint to allow 'head_office' alongside 'operational_site'.
ALTER TABLE public.sites
  DROP CONSTRAINT IF EXISTS sites_site_type_check;

ALTER TABLE public.sites
  ADD CONSTRAINT sites_site_type_check
  CHECK (site_type IN ('operational_site', 'head_office'));

-- Ensure Harare is marked as head office (may already be set).
UPDATE public.sites SET site_type = 'head_office'
WHERE name = 'Harare' AND site_type IS DISTINCT FROM 'head_office';

INSERT INTO public.schema_migrations (filename)
VALUES ('0078_harare_head_office.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
