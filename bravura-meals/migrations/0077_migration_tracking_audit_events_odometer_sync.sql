-- ══════════════════════════════════════════════════════════════════════════════
-- 0077 — Migration tracking, meals audit events, odometer reconciliation
-- ══════════════════════════════════════════════════════════════════════════════
-- 1. schema_migrations: records which migration files have been applied so
--    code and database can never silently disagree again. All files up to
--    and including 0076 are backfilled as applied (confirmed run by hand).
--    CONVENTION GOING FORWARD: every new migration file ends with
--      INSERT INTO schema_migrations (filename) VALUES ('NNNN_name.sql');
--    and starts by asserting its predecessor exists.
-- 2. meal_submission_events: immutable audit trail for daily_submissions.
--    A trigger records EVERY status transition (submit, approve, return,
--    query, flag-reopen) with actor, counts snapshot and note — previous_
--    counts remains as a compatibility cache but no longer loses history.
-- 3. Odometer reconciliation: a trigger on fuel_transactions pushes each
--    captured odometer_km into fleet_meter_readings (source 'fuel') and
--    advances fleet_assets.current_odometer_km, so the fuel-fill stream,
--    the meter-readings page, and the asset's headline km stay in sync.
--    Regressions (reading below the asset's current km) are stored but
--    flagged, mirroring the meter-readings page's own behaviour.

BEGIN;

-- ── 1. Migration tracking ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.schema_migrations (
  filename   TEXT        PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;
-- Readable so the app/tools can check drift; never writable from the client.
CREATE POLICY schema_migrations_read ON public.schema_migrations
  FOR SELECT TO authenticated USING (true);

INSERT INTO public.schema_migrations (filename) VALUES
  ('0020_fuel_foundation.sql'),
  ('0022_fuel_requests.sql'),
  ('0023_fuel_deliveries.sql'),
  ('0024_fuel_bowsers_reconciliation.sql'),
  ('0025_notifications.sql'),
  ('0026_flow_meter.sql'),
  ('0027_fuel_finance_mapping.sql'),
  ('0028_procurement_stub.sql'),
  ('0029_feedback.sql'),
  ('0030_meals_forecast_waste.sql'),
  ('0031_meals_finance.sql'),
  ('0032_meals_approval_snapshot.sql'),
  ('0033_initial_user_accounts.sql'),
  ('0034_super_admin_clement.sql'),
  ('0035_mark_password_reset_done.sql'),
  ('0036_return_submission_for_corrections.sql'),
  ('0037_meals_notifications_trigger.sql'),
  ('0038_fuel_issuance_acknowledgement.sql'),
  ('0039_meal_officer_submission_rpcs.sql'),
  ('0040_meals_rls_policies.sql'),
  ('0041_kamativi_main_tank_zufta10.sql'),
  ('0042_selous_main_tank_dip_chart.sql'),
  ('0043_extend_fleet_schemas.sql'),
  ('0044_import_kamativi_fleet.sql'),
  ('0045_import_kamativi_fuel_deliveries_and_dips.sql'),
  ('0046_import_kamativi_fuel_log.sql'),
  ('0047_fuel_rls_global_roles.sql'),
  ('0048_fuel_bulk_issuance.sql'),
  ('0049_fuel_deliveries_receiving_officer.sql'),
  ('0050_fuel_editable_transactions.sql'),
  ('0051_fix_dip_trigger_column_name.sql'),
  ('0052_dip_start_end_columns.sql'),
  ('0053_fix_calibration_rls.sql'),
  ('0054_delivery_dip_mm_columns.sql'),
  ('0055_fuel_delete_with_audit.sql'),
  ('0056_tank_level_from_dips_only.sql'),
  ('0057_drop_level_in_capacity_constraint.sql'),
  ('0058_procurement_suppliers.sql'),
  ('0059_procurement_permissions.sql'),
  ('0060_sites_hq_flag.sql'),
  ('0061_fuel_transaction_soft_delete.sql'),
  ('0062_fuel_tank_transfers.sql'),
  ('0063_fleet_foundation.sql'),
  ('0064_fix_fuel_views.sql'),
  ('0065_fleet_fuel_bridge.sql'),
  ('0066_fleet_phase10.sql'),
  ('0067_fleet_contractor_equipment.sql'),
  ('0068_fix_fleet_asset_types.sql'),
  ('0069_fuel_requests_fleet_bridge.sql'),
  ('0070_meal_price_overrides.sql'),
  ('0071_reopen_meal_submission_for_flag.sql'),
  ('0072_handle_new_user.sql'),
  ('0073_fuel_transaction_odometer.sql'),
  ('0074_bulk_issuance_fleet_asset_and_queried_reopen.sql'),
  ('0075_fuel_requests_fleet_asset_check.sql'),
  ('0076_camp_visitors_site_id.sql')
ON CONFLICT (filename) DO NOTHING;

-- ── 2. Immutable meals audit events ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.meal_submission_events (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID        NOT NULL REFERENCES daily_submissions(id),
  site_id       UUID        NOT NULL REFERENCES sites(id),
  event_type    TEXT        NOT NULL,   -- status transition, e.g. 'submitted', 'approved', 'returned_to_draft', 'queried'
  from_status   TEXT,
  to_status     TEXT        NOT NULL,
  actor         UUID,                   -- auth.uid() at the time of the change
  counts        JSONB,                  -- {b,l,s} snapshot at the moment of transition
  note          TEXT,                   -- reviewer note / reopen reason when available
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS meal_submission_events_sub
  ON public.meal_submission_events (submission_id, created_at);

ALTER TABLE public.meal_submission_events ENABLE ROW LEVEL SECURITY;
-- Read-only from the client; rows are written exclusively by the trigger
-- below (SECURITY DEFINER context). No INSERT/UPDATE/DELETE policies exist,
-- so the trail is immutable from the API.
CREATE POLICY meal_submission_events_read ON public.meal_submission_events
  FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.log_meal_submission_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_counts JSONB;
  v_note   TEXT;
BEGIN
  -- Only log actual status transitions (covers every path: RPCs, direct
  -- updates from Approvals, future code — anything that flips status).
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  SELECT jsonb_build_object(
    'b', COALESCE(SUM(CASE WHEN had_breakfast THEN 1 ELSE 0 END), 0),
    'l', COALESCE(SUM(CASE WHEN had_lunch     THEN 1 ELSE 0 END), 0),
    's', COALESCE(SUM(CASE WHEN had_supper    THEN 1 ELSE 0 END), 0)
  ) INTO v_counts
    FROM public.meal_logs WHERE submission_id = NEW.id;

  -- Pick up the note/reason the transition stashed in previous_counts, if any.
  v_note := COALESCE(NEW.previous_counts->>'note', NEW.previous_counts->>'reason');

  INSERT INTO public.meal_submission_events
    (submission_id, site_id, event_type, from_status, to_status, actor, counts, note)
  VALUES (
    NEW.id,
    NEW.site_id,
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
    NEW.status,
    auth.uid(),
    v_counts,
    v_note
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_meal_submission_event ON public.daily_submissions;
CREATE TRIGGER trg_log_meal_submission_event
  AFTER INSERT OR UPDATE OF status ON public.daily_submissions
  FOR EACH ROW EXECUTE FUNCTION public.log_meal_submission_event();

-- ── 3. Odometer reconciliation trigger ───────────────────────────────────────
-- Every fuel issuance carrying an odometer reading feeds the meter-readings
-- stream and advances the asset's headline km. Readings BELOW the asset's
-- current km are recorded but flagged (typo / cluster swap), and do NOT
-- move current_odometer_km backwards.

CREATE OR REPLACE FUNCTION public.sync_odometer_from_fuel_txn()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current NUMERIC(12,2);
BEGIN
  IF NEW.odometer_km IS NULL OR NEW.fleet_asset_id IS NULL
     OR NEW.transaction_type <> 'issuance' THEN
    RETURN NEW;
  END IF;

  SELECT current_odometer_km INTO v_current
    FROM public.fleet_assets WHERE id = NEW.fleet_asset_id;

  INSERT INTO public.fleet_meter_readings
    (site_id, asset_id, reading_type, reading_value, reading_date,
     source, is_flagged, flag_reason, recorded_by)
  VALUES (
    NEW.site_id,
    NEW.fleet_asset_id,
    'odometer',
    NEW.odometer_km,
    NEW.transaction_date,
    'fuel',
    (v_current IS NOT NULL AND NEW.odometer_km < v_current),
    CASE WHEN v_current IS NOT NULL AND NEW.odometer_km < v_current
         THEN format('Below current odometer (%s km) at fuel issuance', v_current)
         ELSE NULL END,
    NEW.created_by
  );

  IF v_current IS NULL OR NEW.odometer_km > v_current THEN
    UPDATE public.fleet_assets
       SET current_odometer_km = NEW.odometer_km
     WHERE id = NEW.fleet_asset_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_odometer_fuel ON public.fuel_transactions;
CREATE TRIGGER trg_sync_odometer_fuel
  AFTER INSERT ON public.fuel_transactions
  FOR EACH ROW EXECUTE FUNCTION public.sync_odometer_from_fuel_txn();

-- ── Record this migration ─────────────────────────────────────────────────────
INSERT INTO public.schema_migrations (filename)
VALUES ('0077_migration_tracking_audit_events_odometer_sync.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
