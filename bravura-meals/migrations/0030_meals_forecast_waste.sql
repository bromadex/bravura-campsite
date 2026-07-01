-- ── Meals Phase 3 — headcount forecasts + waste tracking ────────────────────
-- Adds a prospective "meal taker tells the kitchen how many people to cook
-- for" surface, plus columns on daily_submissions so waste can be computed
-- as (prepared − served) at kitchen-confirmation time.

CREATE TABLE IF NOT EXISTS meal_forecasts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id        UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  forecast_date  DATE NOT NULL,
  contractor_id  UUID NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
  expected_b     INTEGER NOT NULL DEFAULT 0 CHECK (expected_b >= 0),
  expected_l     INTEGER NOT NULL DEFAULT 0 CHECK (expected_l >= 0),
  expected_s     INTEGER NOT NULL DEFAULT 0 CHECK (expected_s >= 0),
  notes          TEXT,
  submitted_by   UUID REFERENCES profiles(id) ON DELETE SET NULL,
  submitted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (site_id, forecast_date, contractor_id)
);

CREATE INDEX IF NOT EXISTS meal_forecasts_site_date_idx
  ON meal_forecasts(site_id, forecast_date DESC);

ALTER TABLE meal_forecasts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS meal_forecasts_read ON meal_forecasts;
CREATE POLICY meal_forecasts_read ON meal_forecasts
  FOR SELECT USING (site_id IN (SELECT site_id FROM user_sites WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS meal_forecasts_write ON meal_forecasts;
CREATE POLICY meal_forecasts_write ON meal_forecasts
  FOR ALL USING (site_id IN (SELECT site_id FROM user_sites WHERE user_id = auth.uid()));

COMMENT ON TABLE  meal_forecasts IS 'Forward-looking headcount notice — meal taker tells the kitchen how many people to cook for, per contractor per meal period.';
COMMENT ON COLUMN meal_forecasts.forecast_date IS 'Date the meal is planned for (may be today or a future day).';

-- ── Portions prepared on daily_submissions ───────────────────────────────────
-- kitchen_count_{b,l,s} is what the kitchen served (existing).
-- prepared_{b,l,s} is what the kitchen actually cooked. Waste = prepared − served.
ALTER TABLE daily_submissions
  ADD COLUMN IF NOT EXISTS prepared_b INTEGER,
  ADD COLUMN IF NOT EXISTS prepared_l INTEGER,
  ADD COLUMN IF NOT EXISTS prepared_s INTEGER;

COMMENT ON COLUMN daily_submissions.prepared_b IS 'Portions of breakfast the kitchen prepared. Waste_b = prepared_b − kitchen_count_b.';
COMMENT ON COLUMN daily_submissions.prepared_l IS 'Portions of lunch the kitchen prepared. Waste_l = prepared_l − kitchen_count_l.';
COMMENT ON COLUMN daily_submissions.prepared_s IS 'Portions of supper the kitchen prepared. Waste_s = prepared_s − kitchen_count_s.';

-- ── Auto-touch updated_at on forecast edit ───────────────────────────────────
CREATE OR REPLACE FUNCTION meal_forecasts_touch()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS meal_forecasts_touch_trg ON meal_forecasts;
CREATE TRIGGER meal_forecasts_touch_trg
  BEFORE UPDATE ON meal_forecasts
  FOR EACH ROW EXECUTE FUNCTION meal_forecasts_touch();
