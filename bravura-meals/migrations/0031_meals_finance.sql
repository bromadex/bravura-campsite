-- ── Meals ↔ Finance integration ─────────────────────────────────────────────
-- Per-site chart-of-accounts mapping for the Meals Finance Export, mirroring
-- the fuel_finance_mapping pattern shipped in Fuel Phase 4.

CREATE TABLE IF NOT EXISTS meals_finance_mapping (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id       UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  mapping_type  TEXT NOT NULL CHECK (mapping_type IN ('meal_expense', 'accounts_payable')),
  account_code  TEXT NOT NULL,
  account_name  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (site_id, mapping_type)
);

CREATE INDEX IF NOT EXISTS meals_finance_mapping_site_idx
  ON meals_finance_mapping(site_id);

ALTER TABLE meals_finance_mapping ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS meals_finance_mapping_read ON meals_finance_mapping;
CREATE POLICY meals_finance_mapping_read ON meals_finance_mapping
  FOR SELECT USING (site_id IN (SELECT site_id FROM user_sites WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS meals_finance_mapping_write ON meals_finance_mapping;
CREATE POLICY meals_finance_mapping_write ON meals_finance_mapping
  FOR ALL USING (site_id IN (SELECT site_id FROM user_sites WHERE user_id = auth.uid()));

COMMENT ON TABLE meals_finance_mapping IS 'Per-site chart-of-accounts mapping used when exporting meal journal entries to Finance/Accounting.';
