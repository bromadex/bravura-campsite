-- 0154: Create tables referenced by app but missing from rebuilt DB
-- flags, audit_log, area_code_photos, camp_supply_items, employee_movements,
-- stock_transfers, meal_forecasts, meal_submission_events, meals_finance_mapping, config

BEGIN;

-- ── flags ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.flags (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id    UUID NOT NULL REFERENCES daily_submissions(id) ON DELETE CASCADE,
  date             DATE NOT NULL,
  raised_by        UUID REFERENCES profiles(id) ON DELETE SET NULL,
  reason           TEXT CHECK (reason IN ('count_mismatch','missing_allocation','quality_issue','other')),
  message          TEXT,
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  raised_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_by      UUID REFERENCES profiles(id) ON DELETE SET NULL,
  resolved_at      TIMESTAMPTZ,
  resolution_note  TEXT,
  system_count_b   INTEGER,
  system_count_l   INTEGER,
  system_count_s   INTEGER,
  kitchen_count_b  INTEGER,
  kitchen_count_l  INTEGER,
  kitchen_count_s  INTEGER
);
CREATE INDEX IF NOT EXISTS flags_submission_idx ON flags(submission_id);
CREATE INDEX IF NOT EXISTS flags_status_idx ON flags(status);
ALTER TABLE flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY flags_read ON flags FOR SELECT TO authenticated USING (true);
CREATE POLICY flags_write ON flags FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── audit_log ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  table_name  TEXT NOT NULL,
  action      TEXT NOT NULL,
  record_id   TEXT,
  user_id     UUID REFERENCES profiles(id) ON DELETE SET NULL,
  old_value   JSONB,
  new_value   JSONB,
  site_id     UUID REFERENCES sites(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS audit_log_created_idx ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_site_idx ON audit_log(site_id);
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_log_read ON audit_log FOR SELECT TO authenticated USING (true);

-- ── area_code_photos ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.area_code_photos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  area_code_id  UUID NOT NULL REFERENCES area_codes(id) ON DELETE CASCADE,
  file_url      TEXT NOT NULL,
  file_name     TEXT,
  file_size     BIGINT,
  caption       TEXT,
  uploaded_by   UUID REFERENCES profiles(id) ON DELETE SET NULL,
  taken_date    DATE,
  is_archived   BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS area_code_photos_area_idx ON area_code_photos(area_code_id);
ALTER TABLE area_code_photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY area_code_photos_read ON area_code_photos FOR SELECT TO authenticated USING (true);
CREATE POLICY area_code_photos_write ON area_code_photos FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── camp_supply_items ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.camp_supply_items (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  unit       TEXT,
  site_id    UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS camp_supply_items_site_idx ON camp_supply_items(site_id);
ALTER TABLE camp_supply_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY camp_supply_items_read ON camp_supply_items FOR SELECT TO authenticated USING (true);
CREATE POLICY camp_supply_items_write ON camp_supply_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── employee_movements ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.employee_movements (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id          UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  movement_type        TEXT NOT NULL,
  leave_category       TEXT,
  from_site_id         UUID REFERENCES sites(id) ON DELETE SET NULL,
  to_site_id           UUID REFERENCES sites(id) ON DELETE SET NULL,
  effective_date       DATE NOT NULL,
  expected_return_date DATE,
  reason               TEXT,
  created_by           UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS employee_movements_emp_idx ON employee_movements(employee_id);
ALTER TABLE employee_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY employee_movements_read ON employee_movements FOR SELECT TO authenticated USING (true);
CREATE POLICY employee_movements_write ON employee_movements FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── stock_transfers ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.stock_transfers (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_name            TEXT NOT NULL,
  from_site_id         UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  to_site_id           UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  quantity             NUMERIC NOT NULL,
  status               TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_transit','completed','cancelled')),
  requested_by         UUID REFERENCES profiles(id) ON DELETE SET NULL,
  approved_by          UUID REFERENCES profiles(id) ON DELETE SET NULL,
  transfer_out_txn_id  UUID REFERENCES camp_supply_txns(id) ON DELETE SET NULL,
  transfer_in_txn_id   UUID REFERENCES camp_supply_txns(id) ON DELETE SET NULL,
  completed_at         TIMESTAMPTZ,
  site_id              UUID REFERENCES sites(id) ON DELETE CASCADE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stock_transfers_site_idx ON stock_transfers(site_id);
ALTER TABLE stock_transfers ENABLE ROW LEVEL SECURITY;
CREATE POLICY stock_transfers_read ON stock_transfers FOR SELECT TO authenticated USING (true);
CREATE POLICY stock_transfers_write ON stock_transfers FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── meal_forecasts ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.meal_forecasts (
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
CREATE INDEX IF NOT EXISTS meal_forecasts_site_date_idx ON meal_forecasts(site_id, forecast_date DESC);
ALTER TABLE meal_forecasts ENABLE ROW LEVEL SECURITY;
CREATE POLICY meal_forecasts_read ON meal_forecasts FOR SELECT TO authenticated
  USING (site_id IN (SELECT site_id FROM user_sites WHERE user_id = auth.uid()));
CREATE POLICY meal_forecasts_write ON meal_forecasts FOR ALL TO authenticated
  USING (site_id IN (SELECT site_id FROM user_sites WHERE user_id = auth.uid()));

-- ── meals_finance_mapping ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.meals_finance_mapping (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id       UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  mapping_type  TEXT NOT NULL CHECK (mapping_type IN ('meal_expense','accounts_payable')),
  account_code  TEXT NOT NULL,
  account_name  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (site_id, mapping_type)
);
CREATE INDEX IF NOT EXISTS meals_finance_mapping_site_idx ON meals_finance_mapping(site_id);
ALTER TABLE meals_finance_mapping ENABLE ROW LEVEL SECURITY;
CREATE POLICY meals_finance_mapping_read ON meals_finance_mapping FOR SELECT TO authenticated
  USING (site_id IN (SELECT site_id FROM user_sites WHERE user_id = auth.uid()));
CREATE POLICY meals_finance_mapping_write ON meals_finance_mapping FOR ALL TO authenticated
  USING (site_id IN (SELECT site_id FROM user_sites WHERE user_id = auth.uid()));

-- ── meal_submission_events ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.meal_submission_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES daily_submissions(id),
  site_id       UUID NOT NULL REFERENCES sites(id),
  event_type    TEXT NOT NULL,
  from_status   TEXT,
  to_status     TEXT NOT NULL,
  actor         UUID,
  counts        JSONB,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS meal_submission_events_sub ON meal_submission_events(submission_id, created_at);
ALTER TABLE meal_submission_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY meal_submission_events_read ON meal_submission_events FOR SELECT TO authenticated USING (true);

-- Re-create the trigger that populates meal_submission_events
CREATE OR REPLACE FUNCTION public.log_meal_submission_event()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_counts JSONB; v_note TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  SELECT jsonb_build_object(
    'b', COALESCE(SUM(CASE WHEN had_breakfast THEN 1 ELSE 0 END), 0),
    'l', COALESCE(SUM(CASE WHEN had_lunch     THEN 1 ELSE 0 END), 0),
    's', COALESCE(SUM(CASE WHEN had_supper    THEN 1 ELSE 0 END), 0)
  ) INTO v_counts FROM public.meal_logs WHERE submission_id = NEW.id;
  v_note := COALESCE(NEW.previous_counts->>'note', NEW.previous_counts->>'reason');
  INSERT INTO public.meal_submission_events
    (submission_id, site_id, event_type, from_status, to_status, actor, counts, note)
  VALUES (
    NEW.id, NEW.site_id,
    CASE
      WHEN TG_OP = 'INSERT' THEN 'created'
      WHEN NEW.status = 'draft' AND NEW.previous_counts->>'reason' = 'reopened_via_flag' THEN 'reopened_via_flag'
      WHEN NEW.status = 'draft'     THEN 'returned_to_draft'
      WHEN NEW.status = 'submitted' THEN 'submitted'
      WHEN NEW.status = 'approved'  THEN 'approved'
      WHEN NEW.status = 'queried'   THEN 'queried'
      ELSE NEW.status
    END,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.status ELSE NULL END,
    NEW.status, auth.uid(), v_counts, v_note
  );
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_log_meal_submission_event ON public.daily_submissions;
CREATE TRIGGER trg_log_meal_submission_event
  AFTER INSERT OR UPDATE OF status ON public.daily_submissions
  FOR EACH ROW EXECUTE FUNCTION public.log_meal_submission_event();

-- ── config ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.config (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key        TEXT NOT NULL UNIQUE,
  value      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE config ENABLE ROW LEVEL SECURITY;
CREATE POLICY config_read ON config FOR SELECT TO authenticated USING (true);
CREATE POLICY config_write ON config FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── Self-record ──────────────────────────────────────────────────────────────
INSERT INTO schema_migrations (filename) VALUES ('0154_missing_tables.sql') ON CONFLICT DO NOTHING;

COMMIT;
