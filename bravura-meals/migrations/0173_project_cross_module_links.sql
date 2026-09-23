-- Migration: 0173_project_cross_module_links
-- Add project_id nullable FK to fuel_transactions, fleet_maintenance,
-- contractor_contracts, and ds_documents for cross-module project linking.

-- ── fuel_transactions ───────────────────────────────────────────────────────
ALTER TABLE fuel_transactions
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id);
CREATE INDEX IF NOT EXISTS idx_fuel_txn_project ON fuel_transactions(project_id);

-- ── fleet_maintenance ───────────────────────────────────────────────────────
ALTER TABLE fleet_maintenance
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id);
CREATE INDEX IF NOT EXISTS idx_fleet_maint_project ON fleet_maintenance(project_id);

-- ── contractor_contracts ────────────────────────────────────────────────────
ALTER TABLE contractor_contracts
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id);
CREATE INDEX IF NOT EXISTS idx_contractor_contracts_project ON contractor_contracts(project_id);

-- ── ds_documents ────────────────────────────────────────────────────────────
ALTER TABLE ds_documents
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id);
CREATE INDEX IF NOT EXISTS idx_ds_documents_project ON ds_documents(project_id);

-- ── ds_folders — link folders to a project for auto-created project folders ─
ALTER TABLE ds_folders
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id);
CREATE INDEX IF NOT EXISTS idx_ds_folders_project ON ds_folders(project_id);

-- ── Self-record ─────────────────────────────────────────────────────────────
INSERT INTO schema_migrations (filename)
VALUES ('0173_project_cross_module_links.sql')
ON CONFLICT DO NOTHING;
