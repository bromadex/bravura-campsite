-- 0180_set_my_preferences.sql
-- Users save their own preferences through this function, which can only touch
-- profiles.preferences (the row-level "own update" policy would allow any column).
BEGIN;

CREATE OR REPLACE FUNCTION set_my_preferences(p_prefs JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _out JSONB;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF jsonb_typeof(p_prefs) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Preferences must be an object'; END IF;
  UPDATE profiles SET preferences = COALESCE(preferences, '{}'::jsonb) || p_prefs
   WHERE id = auth.uid() RETURNING preferences INTO _out;
  RETURN _out;
END;
$$;
REVOKE ALL ON FUNCTION set_my_preferences(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_my_preferences(JSONB) TO authenticated;

INSERT INTO schema_migrations (filename) VALUES ('0180_set_my_preferences.sql') ON CONFLICT DO NOTHING;

COMMIT;
