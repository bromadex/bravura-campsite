-- 0089: fuel_deliveries soft-delete columns.
-- FuelContext.deleteDelivery() archives via is_archived/archived_at, but
-- fuel_deliveries never received those columns in the 0080 sweep — deletes
-- failed with "Could not find the 'archived_at' column of 'fuel_deliveries'".

ALTER TABLE fuel_deliveries ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE fuel_deliveries ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_fuel_deliveries_is_archived
  ON fuel_deliveries (site_id, is_archived);

INSERT INTO schema_migrations (filename)
VALUES ('0089_fuel_deliveries_soft_delete.sql')
ON CONFLICT DO NOTHING;
