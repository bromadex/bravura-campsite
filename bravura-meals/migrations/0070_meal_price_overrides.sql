-- ── 0070: Special day pricing (day-of-week + meal-type overrides) ────────────
-- Allows setting a different price for a specific weekday × meal_type
-- combination, e.g. Saturday supper. Falls back to meal_prices when no
-- override exists.

BEGIN;

CREATE TABLE IF NOT EXISTS meal_price_overrides (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id        UUID        NOT NULL REFERENCES sites(id),
  effective_date DATE        NOT NULL DEFAULT CURRENT_DATE,
  day_of_week    SMALLINT    NOT NULL,            -- 0=Sunday, 1=Monday ... 6=Saturday
  meal_type      TEXT        NOT NULL,            -- 'breakfast' | 'lunch' | 'supper'
  price_usd      NUMERIC(10,2) NOT NULL CHECK (price_usd >= 0),
  label          TEXT,                            -- e.g. 'Saturday Braai Supper'
  notes          TEXT,
  set_by         UUID        REFERENCES profiles(id),
  is_active      BOOLEAN     NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT meal_price_overrides_day_check CHECK (day_of_week BETWEEN 0 AND 6),
  CONSTRAINT meal_price_overrides_meal_check CHECK (meal_type IN ('breakfast','lunch','supper'))
);

CREATE INDEX IF NOT EXISTS meal_price_overrides_lookup
  ON meal_price_overrides(site_id, day_of_week, meal_type, effective_date DESC)
  WHERE is_active = true;

ALTER TABLE meal_price_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY meal_price_overrides_read
  ON meal_price_overrides FOR SELECT TO authenticated USING (true);
CREATE POLICY meal_price_overrides_insert
  ON meal_price_overrides FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY meal_price_overrides_update
  ON meal_price_overrides FOR UPDATE TO authenticated USING (true);
CREATE POLICY meal_price_overrides_delete
  ON meal_price_overrides FOR DELETE TO authenticated USING (true);

COMMIT;
