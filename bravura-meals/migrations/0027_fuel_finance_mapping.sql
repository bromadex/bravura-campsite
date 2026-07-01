-- ── Fuel ↔ Finance module integration ────────────────────────────────────────
-- Adds the account-code mapping table used by the Finance Export page, plus
-- three toggles on fuel_settings that gate the Fleet, Finance, and
-- Procurement integration hooks introduced in Fuel Phase 4.

CREATE TABLE IF NOT EXISTS fuel_finance_mapping (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id       UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  mapping_type  TEXT NOT NULL CHECK (mapping_type IN ('fuel_stock', 'fuel_expense', 'accounts_payable')),
  account_code  TEXT NOT NULL,
  account_name  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (site_id, mapping_type)
);

CREATE INDEX IF NOT EXISTS fuel_finance_mapping_site_idx
  ON fuel_finance_mapping(site_id);

ALTER TABLE fuel_finance_mapping ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fuel_finance_mapping_read ON fuel_finance_mapping;
CREATE POLICY fuel_finance_mapping_read ON fuel_finance_mapping
  FOR SELECT USING (site_id IN (SELECT site_id FROM user_sites WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS fuel_finance_mapping_write ON fuel_finance_mapping;
CREATE POLICY fuel_finance_mapping_write ON fuel_finance_mapping
  FOR ALL USING (site_id IN (SELECT site_id FROM user_sites WHERE user_id = auth.uid()));

COMMENT ON TABLE fuel_finance_mapping IS 'Per-site chart-of-accounts mapping used when exporting fuel journal entries to Finance/Accounting.';

-- ── fuel_settings integration toggles ────────────────────────────────────────
ALTER TABLE fuel_settings
  ADD COLUMN IF NOT EXISTS fleet_integration_enabled  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_create_requisition    BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN fuel_settings.fleet_integration_enabled IS 'When ON, VehicleConsumption pulls maintenance status from the Fleet module. Placeholder until Fleet is built.';
COMMENT ON COLUMN fuel_settings.auto_create_requisition   IS 'When ON, low-tank alerts trigger the fuel-procurement-hook to create a purchase requisition.';
