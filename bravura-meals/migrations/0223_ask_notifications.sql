-- 0223 — Ask Bravura: read the asker's own notifications (read-only; never marks them read).
CREATE OR REPLACE FUNCTION public.ai_notifications(p_unread_only boolean DEFAULT true, p_search text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH n AS (SELECT * FROM notifications WHERE user_id = auth.uid() AND NOT COALESCE(is_archived, false)
               AND (NOT p_unread_only OR NOT is_read)
               AND (p_search IS NULL OR p_search = '' OR title ILIKE '%' || p_search || '%' OR message ILIKE '%' || p_search || '%' OR category ILIKE p_search))
  SELECT jsonb_build_object(
    'unread_total', (SELECT count(*) FROM notifications WHERE user_id = auth.uid() AND NOT is_read AND NOT COALESCE(is_archived, false)),
    'by_category', COALESCE((SELECT jsonb_object_agg(COALESCE(category, 'general'), c) FROM (SELECT category, count(*) c FROM n GROUP BY category) q), '{}'),
    'items', COALESCE((SELECT jsonb_agg(x) FROM (SELECT jsonb_build_object('title', n.title, 'message', left(n.message, 160), 'category', n.category,
        'when', to_char(n.created_at AT TIME ZONE 'Africa/Harare', 'YYYY-MM-DD HH24:MI'), 'read', n.is_read, 'site', s.name) x
        FROM n LEFT JOIN sites s ON s.id = n.site_id ORDER BY n.created_at DESC LIMIT 25) q), '[]'));
$$;
REVOKE ALL ON FUNCTION ai_notifications(boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION ai_notifications(boolean, text) TO authenticated;
INSERT INTO schema_migrations (filename) VALUES ('0223_ask_notifications.sql') ON CONFLICT DO NOTHING;
