-- ── 0076: site-scope camp_visitors ────────────────────────────────────────────
-- camp_visitors had no site_id, so every site saw every visitor. Adds the
-- column, backfills from the visitor's room assignment (room → block → site),
-- and defaults anything unresolvable to Kamativi (the only site with real
-- data at the time of this migration).

BEGIN;

ALTER TABLE public.camp_visitors
  ADD COLUMN IF NOT EXISTS site_id UUID REFERENCES sites(id);

-- Backfill through the visitor's most recent room assignment.
UPDATE public.camp_visitors v
SET site_id = b.site_id
FROM public.room_assignments ra
JOIN public.camp_rooms  r ON r.id = ra.room_id
JOIN public.camp_blocks b ON b.id = r.block_id
WHERE ra.visitor_id = v.id
  AND v.site_id IS NULL;

-- Anything left (visitors never assigned a room) goes to Kamativi.
UPDATE public.camp_visitors
SET site_id = (SELECT id FROM sites WHERE code = 'KAM')
WHERE site_id IS NULL;

CREATE INDEX IF NOT EXISTS camp_visitors_site ON public.camp_visitors(site_id);

COMMIT;
