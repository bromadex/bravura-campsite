-- ══════════════════════════════════════════════════════════════════════════════
-- 0081 — Add site_id to beds + room_assignments
-- ══════════════════════════════════════════════════════════════════════════════
-- These tables were scoped to a site only via .in() cascades through rooms
-- and blocks. Adding a direct site_id FK enables simple .eq('site_id', ?)
-- queries, avoids ambiguous empty-array .in() behaviour, and enables future
-- RLS policies.

BEGIN;

-- ── beds ────────────────────────────────────────────────────────────────────
ALTER TABLE public.beds ADD COLUMN IF NOT EXISTS site_id UUID REFERENCES sites(id);

UPDATE public.beds b
   SET site_id = cb.site_id
  FROM camp_rooms cr
  JOIN camp_blocks cb ON cb.id = cr.block_id
 WHERE cr.id = b.room_id
   AND b.site_id IS NULL;

CREATE INDEX IF NOT EXISTS beds_site ON public.beds(site_id);

-- ── room_assignments ────────────────────────────────────────────────────────
ALTER TABLE public.room_assignments ADD COLUMN IF NOT EXISTS site_id UUID REFERENCES sites(id);

UPDATE public.room_assignments ra
   SET site_id = cb.site_id
  FROM camp_rooms cr
  JOIN camp_blocks cb ON cb.id = cr.block_id
 WHERE cr.id = ra.room_id
   AND ra.site_id IS NULL;

CREATE INDEX IF NOT EXISTS room_assignments_site ON public.room_assignments(site_id);

INSERT INTO public.schema_migrations (filename)
VALUES ('0081_beds_assignments_site_id.sql') ON CONFLICT (filename) DO NOTHING;

COMMIT;
