-- ── 0073: capture vehicle odometer at each fuel issuance ────────────────────
-- The existing meter_start/meter_end columns record the PUMP meter in litres.
-- Distance-vs-fuel monitoring needs the vehicle's odometer at each fill.
-- Nullable for backfill safety; the client enforces it for vehicle issuances.

ALTER TABLE public.fuel_transactions
  ADD COLUMN IF NOT EXISTS odometer_km NUMERIC(12, 2);

COMMENT ON COLUMN public.fuel_transactions.odometer_km IS
  'Vehicle odometer reading captured at the time of issuance. Populated for issuances to fleet_assets whose category is a vehicle; used by the Vehicle Consumption analytics to derive distance travelled per fill (this reading minus the previous fill''s reading for the same asset).';

CREATE INDEX IF NOT EXISTS fuel_tx_asset_date_odo
  ON public.fuel_transactions (fleet_asset_id, transaction_date)
  WHERE odometer_km IS NOT NULL;
