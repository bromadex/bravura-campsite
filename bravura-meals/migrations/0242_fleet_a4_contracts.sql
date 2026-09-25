-- 0242 — Fleet A4 (#65): contracts + reliability by type.
--  (Service plans per type and the soonest-first due list driven by real km / hours / days already exist:
--   fleet_pm_plans.asset_type_id + fleet_pm_due. A1/A3 now feed real readings into them.)
--  • fleet_contracts: insurance, lease, service, warranty, tracking, other — per machine or fleet-wide, with
--    recurring cost (annualised), renewal date and reminder days. pg_cron fleet-contract-reminders 04:45 UTC →
--    fleet_contract_reminders() notifies fleet.edit holders once per contract per renewal date.
--  • fleet_reliability_by_type(site, from, to): MTBF / MTTR / availability per machine type from fleet_downtime_core.

CREATE TABLE IF NOT EXISTS fleet_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES sites(id),
  asset_id uuid REFERENCES fleet_assets(id),
  contract_type text NOT NULL CHECK (contract_type IN ('insurance','lease','service','warranty','tracking','other')),
  supplier_id uuid REFERENCES procurement_suppliers(id),
  provider_name text,
  reference text,
  description text,
  start_date date,
  end_date date,
  amount numeric NOT NULL DEFAULT 0 CHECK (amount >= 0),
  frequency text NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('once','monthly','quarterly','annually')),
  remind_days int NOT NULL DEFAULT 30 CHECK (remind_days >= 0),
  auto_renews boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended','cancelled')),
  reminded_for date,
  notes text,
  is_archived boolean NOT NULL DEFAULT false,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fleet_contracts_site_idx ON fleet_contracts (site_id, end_date);
ALTER TABLE fleet_contracts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fleet_contracts_read ON fleet_contracts;
CREATE POLICY fleet_contracts_read ON fleet_contracts FOR SELECT TO authenticated USING (_has_permission('fleet.view', site_id));
DROP POLICY IF EXISTS fleet_contracts_insert ON fleet_contracts;
CREATE POLICY fleet_contracts_insert ON fleet_contracts FOR INSERT TO authenticated WITH CHECK (_has_permission('fleet.create', site_id) OR _has_permission('fleet.edit', site_id));
DROP POLICY IF EXISTS fleet_contracts_update ON fleet_contracts;
CREATE POLICY fleet_contracts_update ON fleet_contracts FOR UPDATE TO authenticated USING (_has_permission('fleet.edit', site_id)) WITH CHECK (_has_permission('fleet.edit', site_id));

CREATE OR REPLACE FUNCTION public.fleet_contract_list(p_site_id uuid) RETURNS TABLE
  (id uuid, asset_id uuid, machine text, contract_type text, provider text, reference text, description text, start_date date, end_date date,
   amount numeric, frequency text, annual_cost numeric, remind_days int, auto_renews boolean, status text, days_left int, state text, notes text, supplier_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id, c.asset_id, COALESCE(fa.fleet_number, fa.asset_number, fa.registration, 'All machines'), c.contract_type,
         COALESCE(s.supplier_name, c.provider_name), c.reference, c.description, c.start_date, c.end_date, c.amount, c.frequency,
         c.amount * CASE c.frequency WHEN 'monthly' THEN 12 WHEN 'quarterly' THEN 4 WHEN 'annually' THEN 1 ELSE 0 END,
         c.remind_days, c.auto_renews, c.status, (c.end_date - CURRENT_DATE),
         CASE WHEN c.status <> 'active' THEN c.status
              WHEN c.end_date IS NULL THEN 'open-ended'
              WHEN c.end_date < CURRENT_DATE THEN 'expired'
              WHEN c.end_date - CURRENT_DATE <= c.remind_days THEN 'renew_soon' ELSE 'ok' END,
         c.notes, c.supplier_id
    FROM fleet_contracts c
    LEFT JOIN fleet_assets fa ON fa.id = c.asset_id
    LEFT JOIN procurement_suppliers s ON s.id = c.supplier_id
   WHERE c.site_id = p_site_id AND NOT c.is_archived AND _has_permission('fleet.view', p_site_id)
   ORDER BY (c.status = 'active') DESC, c.end_date NULLS LAST;
$$;

CREATE OR REPLACE FUNCTION public.fleet_contract_reminders() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _c RECORD; _n int := 0;
BEGIN
  FOR _c IN SELECT c.*, COALESCE(fa.fleet_number, fa.asset_number, fa.registration) AS machine, COALESCE(s.supplier_name, c.provider_name) AS provider
              FROM fleet_contracts c LEFT JOIN fleet_assets fa ON fa.id = c.asset_id LEFT JOIN procurement_suppliers s ON s.id = c.supplier_id
             WHERE c.status = 'active' AND NOT c.is_archived AND c.end_date IS NOT NULL
               AND c.end_date - CURRENT_DATE <= c.remind_days AND c.reminded_for IS DISTINCT FROM c.end_date LOOP
    PERFORM _notify_permission(_c.site_id, 'fleet.edit', 'fleet_contract',
      initcap(_c.contract_type) || ' ' || CASE WHEN _c.end_date < CURRENT_DATE THEN 'expired' ELSE 'renews soon' END,
      concat_ws(' · ', _c.provider, _c.reference, COALESCE(_c.machine, 'all machines')) || ' — ends ' || to_char(_c.end_date, 'DD Mon YYYY'),
      '/fleet/fleet_contracts', 'reminder');
    UPDATE fleet_contracts SET reminded_for = _c.end_date WHERE id = _c.id;
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END $$;
REVOKE EXECUTE ON FUNCTION public.fleet_contract_reminders() FROM PUBLIC, anon, authenticated;

DO $$ BEGIN
  PERFORM cron.unschedule('fleet-contract-reminders') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'fleet-contract-reminders');
  PERFORM cron.schedule('fleet-contract-reminders', '45 4 * * *', 'SELECT public.fleet_contract_reminders()');
EXCEPTION WHEN undefined_table OR invalid_schema_name THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.fleet_reliability_by_type(p_site_id uuid, p_from date, p_to date) RETURNS TABLE
  (machine_type text, machines bigint, failures numeric, hours_down numeric, mttr_hours numeric, mtbf_hours numeric, availability_pct numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _span numeric := GREATEST(EXTRACT(epoch FROM (p_to + 1)::timestamp - p_from::timestamp) / 3600, 1);
BEGIN
  IF NOT _has_permission('fleet.view', p_site_id) THEN RAISE EXCEPTION 'No access'; END IF;
  RETURN QUERY
  SELECT COALESCE(t.name, 'Other'), count(*), sum(d.failures)::numeric, round(sum(d.hours_down), 1),
         CASE WHEN sum(d.failures) > 0 THEN round(sum(d.hours_down) / sum(d.failures), 1) END,
         CASE WHEN sum(d.failures) > 0 THEN round((count(*) * _span - sum(d.hours_down)) / sum(d.failures), 1) END,
         round(100 * (1 - sum(d.hours_down) / (count(*) * _span)), 1)
    FROM fleet_downtime_core(p_site_id, p_from, p_to) d
    JOIN fleet_assets fa ON fa.id = d.asset_id
    LEFT JOIN fleet_asset_types t ON t.id = fa.asset_type_id
   GROUP BY 1 ORDER BY 7 NULLS LAST;
END $$;

GRANT EXECUTE ON FUNCTION public.fleet_contract_list(uuid), public.fleet_reliability_by_type(uuid, date, date) TO authenticated;

INSERT INTO schema_migrations (filename) VALUES ('0242_fleet_a4_contracts.sql') ON CONFLICT DO NOTHING;
