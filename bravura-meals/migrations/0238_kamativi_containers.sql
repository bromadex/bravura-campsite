-- 0238 — Kamativi stores are three containers (user, 25 Sep 2026). The empty "Kamativi Main Store" becomes Container 1
-- (still the main store: POs received without a store land here); Containers 2 and 3 are added.
UPDATE warehouses SET name = 'Container 1', code = 'KAM-C1'
 WHERE id = '78f5d70e-68ff-48fe-b4c5-2b001429b439' AND name = 'Kamativi Main Store';
INSERT INTO warehouses (code, name, site_id, type, is_active)
SELECT v.code, v.name, s.id, 'other', true FROM sites s CROSS JOIN (VALUES ('KAM-C2', 'Container 2'), ('KAM-C3', 'Container 3')) v(code, name)
 WHERE s.name = 'Kamativi' AND NOT EXISTS (SELECT 1 FROM warehouses w WHERE w.site_id = s.id AND w.name = v.name);
INSERT INTO schema_migrations (filename) VALUES ('0238_kamativi_containers.sql') ON CONFLICT DO NOTHING;
