-- ── Flow meter columns on fuel_pumps ──────────────────────────────────────────
-- Adds IoT hook columns so ATG/flow-meter device IDs can be stored against
-- each pump. The flow-meter-ingest Edge Function uses flow_meter_id to look
-- up the correct pump and compute litres dispensed since the last reading.

ALTER TABLE fuel_pumps
  ADD COLUMN IF NOT EXISTS flow_meter_id              TEXT,
  ADD COLUMN IF NOT EXISTS last_flow_meter_reading    NUMERIC(12,3),
  ADD COLUMN IF NOT EXISTS last_flow_meter_read_at    TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS fuel_pumps_flow_meter_id_unique
  ON fuel_pumps(flow_meter_id)
  WHERE flow_meter_id IS NOT NULL;

COMMENT ON COLUMN fuel_pumps.flow_meter_id           IS 'External device identifier for the flow meter attached to this pump';
COMMENT ON COLUMN fuel_pumps.last_flow_meter_reading  IS 'Last cumulative litres reading received from the flow meter device';
COMMENT ON COLUMN fuel_pumps.last_flow_meter_read_at  IS 'Timestamp of the last flow meter reading received';
