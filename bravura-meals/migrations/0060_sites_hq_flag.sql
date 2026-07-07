-- ── 0060: Add site_type to sites ────────────────────────────────────────────
-- Classifies sites as head_office or operational. HQ (Harare) sees data
-- across all sites; operational sites see only their own.
-- Using site_type TEXT instead of is_hq BOOLEAN for extensibility
-- (regional offices, distribution centres, etc. in the future).

ALTER TABLE sites ADD COLUMN IF NOT EXISTS site_type TEXT NOT NULL DEFAULT 'operational'
  CHECK (site_type IN ('head_office', 'operational'));

UPDATE sites SET site_type = 'head_office'
WHERE lower(name) LIKE '%harare%';

-- Ensure at most one head_office
CREATE UNIQUE INDEX IF NOT EXISTS sites_single_hq
  ON sites (site_type) WHERE site_type = 'head_office';
