-- 0269 (user, 14 Oct 2026: "fix all the outstanding")
-- 1) Hired-vehicle usage log: daily hours / km per hired vehicle. On approval it accrues like hired equipment
--    (gl event hired_plant_usage, Dr 6520 / Cr 2200) and can be matched to the contractor's bill (bill_accrual_links).
-- 2) Expected recurring bills: rent, hire, internet … a missing bill is flagged and finance.edit holders are told.

-- ── 1. vehicle usage ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vehicle_usage_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES sites(id),
  vehicle_id uuid NOT NULL REFERENCES hired_vehicles(id),
  usage_date date NOT NULL,
  hours_worked numeric CHECK (hours_worked IS NULL OR hours_worked BETWEEN 0 AND 24),
  km_start numeric, km_end numeric,
  km numeric GENERATED ALWAYS AS (CASE WHEN km_end IS NOT NULL AND km_start IS NOT NULL AND km_end >= km_start THEN km_end - km_start END) STORED,
  driver_name text, task_description text, notes text,
  logged_by uuid DEFAULT auth.uid(), approved boolean NOT NULL DEFAULT false, approved_by uuid, approved_at timestamptz,
  is_archived boolean NOT NULL DEFAULT false, archived_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (km_end IS NULL OR km_start IS NULL OR km_end >= km_start),
  UNIQUE (vehicle_id, usage_date)
);
ALTER TABLE vehicle_usage_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vul_select ON vehicle_usage_log;
DROP POLICY IF EXISTS vul_insert ON vehicle_usage_log;
DROP POLICY IF EXISTS vul_update ON vehicle_usage_log;
CREATE POLICY vul_select ON vehicle_usage_log FOR SELECT USING (_has_permission('contractors.view', site_id) OR _has_permission('finance.view', site_id));
CREATE POLICY vul_insert ON vehicle_usage_log FOR INSERT WITH CHECK (_has_permission('contractors.create', site_id) OR _has_permission('contractors.edit', site_id));
CREATE POLICY vul_update ON vehicle_usage_log FOR UPDATE USING (_has_permission('contractors.edit', site_id))
  WITH CHECK (_has_permission('contractors.edit', site_id));

CREATE OR REPLACE FUNCTION _vehicle_usage_amount(u vehicle_usage_log) RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN COALESCE(v.km_rate, 0) > 0 AND COALESCE(u.km, 0) > 0 THEN v.km_rate * u.km
              WHEN COALESCE(v.hourly_rate, 0) > 0 AND COALESCE(u.hours_worked, 0) > 0 THEN v.hourly_rate * u.hours_worked
              ELSE COALESCE(v.daily_rate, 0) END
  FROM hired_vehicles v WHERE v.id = u.vehicle_id
$$;

CREATE OR REPLACE FUNCTION trg_vehicle_usage_gl() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _v hired_vehicles%ROWTYPE;
BEGIN
  IF NEW.approved AND NOT NEW.is_archived AND (TG_OP = 'INSERT' OR NOT OLD.approved) THEN
    SELECT * INTO _v FROM hired_vehicles WHERE id = NEW.vehicle_id;
    PERFORM gl_auto_post(NEW.site_id, 'hired_plant_usage', 'vehicle_usage_log', NEW.id, NEW.usage_date, _vehicle_usage_amount(NEW),
      'Hired vehicle ' || COALESCE(_v.registration, _v.description, '') || ' ' || to_char(NEW.usage_date, 'DD Mon')
      || COALESCE(' (' || NEW.km || ' km)', COALESCE(' (' || NEW.hours_worked || ' h)', '')));
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_vehicle_usage_gl ON vehicle_usage_log;
CREATE TRIGGER trg_vehicle_usage_gl AFTER INSERT OR UPDATE ON vehicle_usage_log FOR EACH ROW EXECUTE FUNCTION trg_vehicle_usage_gl();

-- bills can be matched to vehicle usage too
ALTER TABLE bill_accrual_links DROP CONSTRAINT IF EXISTS bill_accrual_links_source_table_check;
ALTER TABLE bill_accrual_links ADD CONSTRAINT bill_accrual_links_source_table_check
  CHECK (source_table = ANY (ARRAY['casual_timesheets','equipment_usage_log','sheq_incidents','vehicle_usage_log']));

DO $$ DECLARE d text; BEGIN
  d := pg_get_functiondef('ap_unbilled_accruals(uuid,uuid)'::regprocedure);
  IF position('LEFT JOIN contractors ce ON ce.id = he.contractor_id' IN d) = 0 THEN RAISE EXCEPTION 'ap_unbilled_accruals anchor missing'; END IF;
  d := replace(d, 'LEFT JOIN contractors ce ON ce.id = he.contractor_id',
    'LEFT JOIN contractors ce ON ce.id = he.contractor_id
      LEFT JOIN vehicle_usage_log vu ON l.source_table = ''vehicle_usage_log'' AND vu.id = l.source_id
      LEFT JOIN hired_vehicles hv ON hv.id = vu.vehicle_id
      LEFT JOIN contractors cv ON cv.id = hv.contractor_id');
  d := replace(d, '''party'', COALESCE(ct.name, ce.name)', '''party'', COALESCE(ct.name, ce.name, cv.name)');
  d := replace(d, 'WHEN ''hired_plant_usage'' THEN ''Hired plant''',
    'WHEN ''hired_plant_usage'' THEN CASE WHEN l.source_table = ''vehicle_usage_log'' THEN ''Hired vehicle'' ELSE ''Hired plant'' END');
  EXECUTE d;
END $$;

-- ── 2. expected recurring bills ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expected_bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES sites(id),
  supplier_id uuid NOT NULL REFERENCES procurement_suppliers(id),
  description text NOT NULL,
  frequency text NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('weekly','monthly','quarterly','yearly')),
  expected_amount numeric(14,2),
  grace_days int NOT NULL DEFAULT 7,
  starts_on date NOT NULL DEFAULT date_trunc('month', current_date)::date,
  is_active boolean NOT NULL DEFAULT true, is_archived boolean NOT NULL DEFAULT false,
  last_alerted_for date,
  created_by uuid DEFAULT auth.uid(), created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE expected_bills ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS eb_select ON expected_bills;
DROP POLICY IF EXISTS eb_write ON expected_bills;
DROP POLICY IF EXISTS eb_update ON expected_bills;
CREATE POLICY eb_select ON expected_bills FOR SELECT USING (_has_permission('finance.view', site_id));
CREATE POLICY eb_write ON expected_bills FOR INSERT WITH CHECK (_has_permission('finance.edit', site_id) OR _has_permission('finance.create', site_id));
CREATE POLICY eb_update ON expected_bills FOR UPDATE USING (_has_permission('finance.edit', site_id)) WITH CHECK (_has_permission('finance.edit', site_id));

CREATE OR REPLACE FUNCTION _eb_step(f text) RETURNS interval LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE f WHEN 'weekly' THEN interval '7 days' WHEN 'quarterly' THEN interval '3 months' WHEN 'yearly' THEN interval '1 year' ELSE interval '1 month' END
$$;

-- each expected bill: the period now due, the last bill from that supplier, and whether it is missing
CREATE OR REPLACE FUNCTION expected_bills_status(p_site uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'missing')::boolean DESC, x->>'supplier'), '[]') FROM (
    SELECT jsonb_build_object('id', e.id, 'supplier_id', e.supplier_id, 'supplier', s.supplier_name, 'description', e.description,
      'frequency', e.frequency, 'expected_amount', e.expected_amount, 'grace_days', e.grace_days, 'is_active', e.is_active,
      'period_start', p.ps, 'due_by', (p.ps + e.grace_days)::date,
      'last_bill_date', lb.d, 'last_bill_no', lb.no, 'last_bill_amount', lb.amt,
      'missing', e.is_active AND current_date > p.ps + e.grace_days AND (lb.d IS NULL OR lb.d < p.ps)) x
    FROM expected_bills e
    JOIN procurement_suppliers s ON s.id = e.supplier_id
    CROSS JOIN LATERAL (SELECT max(g)::date ps FROM generate_series(e.starts_on::timestamp, current_date::timestamp, _eb_step(e.frequency)) g) p
    LEFT JOIN LATERAL (SELECT i.invoice_date d, i.invoice_number no, i.total_amount amt FROM purchase_invoices i
                        WHERE i.supplier_id = e.supplier_id AND i.site_id = e.site_id AND i.status NOT IN ('cancelled','rejected')
                        ORDER BY i.invoice_date DESC NULLS LAST LIMIT 1) lb ON true
    WHERE e.site_id = p_site AND NOT e.is_archived AND (_has_permission('finance.view', p_site) OR auth.uid() IS NULL)) q
$$;

CREATE OR REPLACE FUNCTION expected_bills_notify() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; x jsonb; _n int := 0;
BEGIN
  FOR r IN SELECT DISTINCT site_id FROM expected_bills WHERE is_active AND NOT is_archived LOOP
    FOR x IN SELECT * FROM jsonb_array_elements(expected_bills_status(r.site_id)) LOOP
      IF (x->>'missing')::boolean AND NOT EXISTS (SELECT 1 FROM expected_bills e WHERE e.id = (x->>'id')::uuid
             AND e.last_alerted_for = (x->>'period_start')::date) THEN
        PERFORM _notify_permission(r.site_id, 'finance.edit', 'expected_bill_missing',
          'Bill not received: ' || (x->>'supplier'),
          (x->>'description') || ' for the period from ' || to_char((x->>'period_start')::date, 'DD Mon YYYY') || ' has not been recorded.',
          '/finance/fi_pay_suppliers', 'reminder');
        UPDATE expected_bills SET last_alerted_for = (x->>'period_start')::date WHERE id = (x->>'id')::uuid;
        _n := _n + 1;
      END IF;
    END LOOP;
  END LOOP;
  RETURN _n;
END $$;

DO $$ BEGIN
  PERFORM cron.unschedule('expected-bills') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expected-bills');
  PERFORM cron.schedule('expected-bills', '35 5 * * *', 'SELECT expected_bills_notify()');
END $$;

INSERT INTO schema_migrations (filename) VALUES ('0269_vehicle_usage_expected_bills.sql') ON CONFLICT DO NOTHING;
