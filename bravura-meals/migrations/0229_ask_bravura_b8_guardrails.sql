-- 0229 — Ask Bravura B8 guardrails (issue #58): usage caps per person and per site, an on/off switch,
-- figure checks logged with every answer, and the admin overview (AD — Ask Bravura admin page).

CREATE TABLE IF NOT EXISTS public.ai_settings (
  site_id uuid PRIMARY KEY REFERENCES sites(id),
  enabled boolean NOT NULL DEFAULT true,
  daily_per_user int NOT NULL DEFAULT 60 CHECK (daily_per_user BETWEEN 0 AND 1000),
  daily_per_site int NOT NULL DEFAULT 500 CHECK (daily_per_site BETWEEN 0 AND 20000),
  updated_by uuid DEFAULT auth.uid(), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE ai_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ais_select ON ai_settings;
CREATE POLICY ais_select ON ai_settings FOR SELECT TO authenticated USING (_has_permission('users.view', site_id));
GRANT SELECT ON ai_settings TO authenticated;

ALTER TABLE ai_questions ADD COLUMN IF NOT EXISTS unverified jsonb;       -- figures in the answer not found in any source
ALTER TABLE ai_questions ADD COLUMN IF NOT EXISTS via text DEFAULT 'text'; -- text | voice | file

-- Called by the edge function (as the person) before answering.
CREATE OR REPLACE FUNCTION public.ai_usage_check(p_site uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _s ai_settings%ROWTYPE; _mine int; _site int;
BEGIN
  SELECT * INTO _s FROM ai_settings WHERE site_id = p_site;
  IF NOT FOUND THEN _s.enabled := true; _s.daily_per_user := 60; _s.daily_per_site := 500; END IF;
  IF NOT _s.enabled THEN RETURN jsonb_build_object('allowed', false, 'reason', 'Ask Bravura is switched off for this site'); END IF;
  SELECT count(*) INTO _mine FROM ai_questions WHERE user_id = auth.uid() AND created_at > now() - interval '24 hours';
  IF _mine >= _s.daily_per_user THEN RETURN jsonb_build_object('allowed', false, 'reason', 'You''ve reached today''s limit of ' || _s.daily_per_user || ' questions'); END IF;
  IF p_site IS NOT NULL THEN
    SELECT count(*) INTO _site FROM ai_questions WHERE site_id = p_site AND created_at > now() - interval '24 hours';
    IF _site >= _s.daily_per_site THEN RETURN jsonb_build_object('allowed', false, 'reason', 'This site has reached today''s limit of ' || _s.daily_per_site || ' questions'); END IF;
  END IF;
  RETURN jsonb_build_object('allowed', true, 'left_for_you', _s.daily_per_user - _mine);
END $$;
GRANT EXECUTE ON FUNCTION ai_usage_check(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.ai_settings_save(p_site uuid, p_enabled boolean, p_per_user int, p_per_site int)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT _has_permission('users.edit', p_site) THEN RAISE EXCEPTION 'You cannot change Ask Bravura settings for this site'; END IF;
  INSERT INTO ai_settings (site_id, enabled, daily_per_user, daily_per_site, updated_by, updated_at)
  VALUES (p_site, p_enabled, p_per_user, p_per_site, auth.uid(), now())
  ON CONFLICT (site_id) DO UPDATE SET enabled = EXCLUDED.enabled, daily_per_user = EXCLUDED.daily_per_user,
    daily_per_site = EXCLUDED.daily_per_site, updated_by = auth.uid(), updated_at = now();
END $$;
REVOKE ALL ON FUNCTION ai_settings_save(uuid, boolean, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION ai_settings_save(uuid, boolean, int, int) TO authenticated;

-- Admin overview for the sites the person can administer (users.view).
CREATE OR REPLACE FUNCTION public.ai_admin_overview(p_days int DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _s uuid[] := _ai_sites_for('users.view', NULL); _from timestamptz := now() - make_interval(days => GREATEST(1, LEAST(p_days, 365)));
BEGIN
  IF _s IS NULL THEN RAISE EXCEPTION 'No access'; END IF;
  RETURN (WITH q AS (SELECT * FROM ai_questions WHERE (site_id = ANY(_s) OR site_id IS NULL) AND created_at >= _from)
    SELECT jsonb_build_object(
      'days', p_days,
      'totals', (SELECT jsonb_build_object('questions', count(*), 'people', count(DISTINCT user_id), 'errors', count(*) FILTER (WHERE error IS NOT NULL),
          'helpful', count(*) FILTER (WHERE rating > 0), 'not_helpful', count(*) FILTER (WHERE rating < 0),
          'unchecked_figures', count(*) FILTER (WHERE jsonb_array_length(COALESCE(unverified, '[]')) > 0),
          'voice', count(*) FILTER (WHERE via = 'voice'), 'with_files', count(*) FILTER (WHERE tools::text LIKE '%"file"%'), 'tokens', COALESCE(sum(tokens), 0)) FROM q),
      'by_site', COALESCE((SELECT jsonb_agg(jsonb_build_object('site', COALESCE(s.name, '(none)'), 'questions', n) ORDER BY n DESC) FROM
          (SELECT site_id, count(*) n FROM q GROUP BY site_id) x LEFT JOIN sites s ON s.id = x.site_id), '[]'),
      'by_person', COALESCE((SELECT jsonb_agg(jsonb_build_object('person', COALESCE(p.full_name, p.username, '?'), 'questions', n, 'last', last) ORDER BY n DESC) FROM
          (SELECT user_id, count(*) n, max(created_at) last FROM q GROUP BY user_id ORDER BY count(*) DESC LIMIT 15) x LEFT JOIN profiles p ON p.id = x.user_id), '[]'),
      'tools', COALESCE((SELECT jsonb_agg(jsonb_build_object('tool', t, 'uses', n) ORDER BY n DESC) FROM
          (SELECT e->>'name' t, count(*) n FROM q, jsonb_array_elements(COALESCE(q.tools, '[]')) e GROUP BY 1) x), '[]'),
      'needs_review', COALESCE((SELECT jsonb_agg(x ORDER BY (x->>'at') DESC) FROM (SELECT jsonb_build_object('at', q.created_at, 'person', COALESCE(p.full_name, p.username),
          'question', left(q.question, 200), 'answer', left(q.answer, 300), 'why',
          CASE WHEN q.error IS NOT NULL THEN 'error: ' || left(q.error, 120) WHEN q.rating < 0 THEN 'marked not helpful'
               WHEN jsonb_array_length(COALESCE(q.unverified, '[]')) > 0 THEN 'unchecked figures: ' || (SELECT string_agg(v, ', ') FROM jsonb_array_elements_text(q.unverified) v)
               ELSE 'could not answer' END) x
          FROM q LEFT JOIN profiles p ON p.id = q.user_id
         WHERE q.error IS NOT NULL OR q.rating < 0 OR jsonb_array_length(COALESCE(q.unverified, '[]')) > 0
            OR q.answer ILIKE '%couldn''t%' OR q.answer ILIKE '%can''t see%' OR q.answer ILIKE '%don''t have%'
         ORDER BY q.created_at DESC LIMIT 40) z), '[]'),
      'actions', COALESCE((SELECT jsonb_agg(x ORDER BY (x->>'at') DESC) FROM (SELECT jsonb_build_object('at', a.created_at, 'person', COALESCE(p.full_name, p.username),
          'kind', a.kind, 'summary', a.summary, 'status', a.status, 'error', a.error, 'done_at', a.done_at) x
          FROM ai_actions a LEFT JOIN profiles p ON p.id = a.user_id WHERE (a.site_id = ANY(_s) OR a.site_id IS NULL) AND a.created_at >= _from
         ORDER BY a.created_at DESC LIMIT 60) z), '[]'),
      'action_totals', (SELECT jsonb_object_agg(status, n) FROM (SELECT status, count(*) n FROM ai_actions WHERE (site_id = ANY(_s) OR site_id IS NULL) AND created_at >= _from GROUP BY status) x),
      'settings', COALESCE((SELECT jsonb_agg(jsonb_build_object('site_id', s.id, 'site', s.name, 'enabled', COALESCE(a.enabled, true),
          'daily_per_user', COALESCE(a.daily_per_user, 60), 'daily_per_site', COALESCE(a.daily_per_site, 500),
          'can_edit', _has_permission('users.edit', s.id)) ORDER BY s.name) FROM sites s LEFT JOIN ai_settings a ON a.site_id = s.id WHERE s.id = ANY(_s)), '[]')));
END $$;
REVOKE ALL ON FUNCTION ai_admin_overview(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION ai_admin_overview(int) TO authenticated;

INSERT INTO schema_migrations (filename) VALUES ('0229_ask_bravura_b8_guardrails.sql') ON CONFLICT DO NOTHING;
