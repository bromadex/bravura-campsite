-- 0177_meal_prices_usd_columns.sql
-- Live meal_prices drifted from the app: columns were breakfast/lunch/supper and
-- there was no notes column, so the Pricing page could not save and Billing,
-- Dashboard, Daily Report and contractor costs could not read prices.
-- Align the table with the app (*_usd) and repoint the DB functions that read it.
BEGIN;

ALTER TABLE meal_prices RENAME COLUMN breakfast TO breakfast_usd;
ALTER TABLE meal_prices RENAME COLUMN lunch     TO lunch_usd;
ALTER TABLE meal_prices RENAME COLUMN supper    TO supper_usd;
ALTER TABLE meal_prices ADD COLUMN IF NOT EXISTS notes TEXT;

-- Cost-summary RPCs select the old names; alias the new columns back so their
-- bodies (mp.breakfast etc.) keep working unchanged.
DO $$
DECLARE
  _fn  TEXT;
  _def TEXT;
BEGIN
  FOREACH _fn IN ARRAY ARRAY['rpc_contractor_cost_summary','rpc_workforce_cost_summary'] LOOP
    SELECT pg_get_functiondef(p.oid) INTO _def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = _fn;
    IF _def IS NULL THEN CONTINUE; END IF;
    _def := replace(_def,
      'SELECT breakfast, lunch, supper FROM meal_prices',
      'SELECT breakfast_usd AS breakfast, lunch_usd AS lunch, supper_usd AS supper FROM meal_prices');
    EXECUTE _def;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION gl_meal_submission_value(p_submission_id UUID)
RETURNS NUMERIC LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _sub  daily_submissions%ROWTYPE;
  _p    meal_prices%ROWTYPE;
  _b NUMERIC; _l NUMERIC; _s NUMERIC;
  _cb INT; _cl INT; _cs INT;
  _dow INT;
BEGIN
  SELECT * INTO _sub FROM daily_submissions WHERE id = p_submission_id;
  IF NOT FOUND THEN RETURN 0; END IF;
  _dow := EXTRACT(DOW FROM _sub.date)::INT;

  SELECT * INTO _p FROM meal_prices
   WHERE site_id = _sub.site_id AND effective_date <= _sub.date
   ORDER BY effective_date DESC LIMIT 1;
  _b := COALESCE(_p.breakfast_usd, 0); _l := COALESCE(_p.lunch_usd, 0); _s := COALESCE(_p.supper_usd, 0);

  SELECT COALESCE((SELECT price_usd FROM meal_price_overrides o WHERE o.site_id = _sub.site_id AND o.is_active
           AND o.day_of_week = _dow AND o.meal_type = 'breakfast' AND o.effective_date <= _sub.date
           ORDER BY o.effective_date DESC LIMIT 1), _b) INTO _b;
  SELECT COALESCE((SELECT price_usd FROM meal_price_overrides o WHERE o.site_id = _sub.site_id AND o.is_active
           AND o.day_of_week = _dow AND o.meal_type = 'lunch' AND o.effective_date <= _sub.date
           ORDER BY o.effective_date DESC LIMIT 1), _l) INTO _l;
  SELECT COALESCE((SELECT price_usd FROM meal_price_overrides o WHERE o.site_id = _sub.site_id AND o.is_active
           AND o.day_of_week = _dow AND o.meal_type = 'supper' AND o.effective_date <= _sub.date
           ORDER BY o.effective_date DESC LIMIT 1), _s) INTO _s;

  SELECT COUNT(*) FILTER (WHERE had_breakfast), COUNT(*) FILTER (WHERE had_lunch), COUNT(*) FILTER (WHERE had_supper)
    INTO _cb, _cl, _cs
    FROM meal_logs WHERE submission_id = p_submission_id;

  RETURN _cb * _b + _cl * _l + _cs * _s;
END;
$$;

INSERT INTO schema_migrations (filename)
VALUES ('0177_meal_prices_usd_columns.sql')
ON CONFLICT DO NOTHING;

COMMIT;
