-- 0211 cross_module_postings — Finance integration (issue #49).
-- Costs recorded in other modules now reach the ledger automatically, via gl_auto_post:
--   • Stores: issues (Dr expense / Cr stock), returns (reverse), count and adjustment gains/losses.
--     Issues to a camp / catering / kitchen department go to 6420 camp supplies; the rest to 6310.
--     Parts issued against a fleet work order carry that vehicle's cost centre / project.
--   • Contractors: approved casual timesheets (6510) and approved hired-equipment usage logs
--     (hours × hourly rate, else daily rate) (6520), both against 2200 Other accruals until the
--     contractor's bill clears the accrual.
--   • SHEQ: a closed incident with an actual cost posts it to 6951 Safety & medical (accrued).
-- Fleet maintenance is NOT posted from fleet_maintenance.actual_cost: its parts already post via
-- stores issues and outside workshops via supplier bills, so posting it would double count.

ALTER TABLE gl_posting_rules DROP CONSTRAINT IF EXISTS gl_posting_rules_event_code_check;
ALTER TABLE gl_posting_rules ADD CONSTRAINT gl_posting_rules_event_code_check CHECK (event_code = ANY (ARRAY[
  'fuel_issue','fuel_delivery','grn_accepted','invoice_approved','invoice_paid','payroll_net','payroll_deductions',
  'payroll_paye','payroll_nssa','payroll_nssa_employer','payroll_paid','payroll_loan_recovery','meals_approved','imtt',
  'expense_approved','advance_settled','expense_paid','expense_paid_cash','advance_paid','advance_paid_cash',
  'petty_cash_topup','petty_cash_expense','petty_cash_short','petty_cash_over','staff_loan_paid','asset_capitalised',
  'asset_depreciation','asset_disposal_accum','asset_disposal_loss','asset_disposal_proceeds','landed_cost',
  'stock_issue','stock_issue_camp','stock_return','stock_loss','stock_gain',
  'contractor_labour','hired_plant_usage','sheq_incident_cost']));

CREATE OR REPLACE FUNCTION public.finance_rule_template()
 RETURNS TABLE(event_code text, debit_code text, credit_code text) LANGUAGE sql IMMUTABLE AS $$
  SELECT * FROM (VALUES
  ('fuel_delivery','1310','2100'), ('fuel_issue','6110','1310'),
  ('grn_accepted','1320','2150'), ('landed_cost','1320','2160'),
  ('invoice_approved','2150','2100'), ('invoice_paid','2100','1110'),
  ('payroll_net','6210','2310'), ('payroll_paye','6210','2320'), ('payroll_nssa','6210','2330'),
  ('payroll_nssa_employer','6220','2330'), ('payroll_deductions','6210','2340'),
  ('payroll_loan_recovery','6210','1210'), ('staff_loan_paid','1210','1110'), ('payroll_paid','2310','1110'),
  ('meals_approved','6410','2410'),
  ('expense_approved','6240','2400'), ('advance_settled','2400','1210'), ('expense_paid','2400','1110'),
  ('expense_paid_cash','2400','1150'), ('advance_paid','1210','1110'), ('advance_paid_cash','1210','1150'),
  ('petty_cash_topup','1150','1110'), ('petty_cash_expense','6860','1150'),
  ('petty_cash_short','6870','1150'), ('petty_cash_over','1150','6870'),
  ('asset_capitalised','1610','1650'), ('asset_depreciation','6910','1690'),
  ('asset_disposal_accum','1690','1610'), ('asset_disposal_loss','6920','1610'),
  ('asset_disposal_proceeds','1110','6920'), ('imtt','6810','1110'),
  ('stock_issue','6310','1320'), ('stock_issue_camp','6420','1320'), ('stock_return','1320','6310'),
  ('stock_loss','6870','1320'), ('stock_gain','1320','6870'),
  ('contractor_labour','6510','2200'), ('hired_plant_usage','6520','2200'),
  ('sheq_incident_cost','6951','2200')
  ) AS t(event_code, debit_code, credit_code);
$$;

-- Dimensions: stores movements inherit the work order's / its vehicle's cost centre and project.
CREATE OR REPLACE FUNCTION public._gl_source_dims(p_table text, p_id uuid, OUT cost_centre_id uuid, OUT project_id uuid)
 RETURNS record LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _r JSONB; _x JSONB;
BEGIN
  IF p_table IS NULL OR p_id IS NULL OR to_regclass('public.' || p_table) IS NULL THEN RETURN; END IF;
  BEGIN
    EXECUTE format('SELECT to_jsonb(t) FROM %I t WHERE t.id = $1', p_table) INTO _r USING p_id;
  EXCEPTION WHEN OTHERS THEN RETURN;
  END;
  IF _r IS NULL THEN RETURN; END IF;
  cost_centre_id := NULLIF(_r->>'cost_centre_id', '')::uuid;
  project_id     := NULLIF(_r->>'project_id', '')::uuid;
  IF p_table = 'inventory_movements' AND _r->>'source_reference_id' IS NOT NULL THEN
    SELECT to_jsonb(w) INTO _x FROM fleet_work_orders w WHERE w.id = (_r->>'source_reference_id')::uuid;
    IF _x IS NOT NULL AND (_x->>'cost_centre_id' IS NULL OR _x->>'project_id' IS NULL) AND _x->>'asset_id' IS NOT NULL THEN
      SELECT jsonb_build_object('cost_centre_id', COALESCE(_x->>'cost_centre_id', f.cost_centre_id::text),
                                'project_id', COALESCE(_x->>'project_id', f.project_id::text))
        INTO _x FROM fleet_assets f WHERE f.id = (_x->>'asset_id')::uuid;
    END IF;
    IF _x IS NULL THEN
      SELECT to_jsonb(p) INTO _x FROM projects p WHERE p.id = (_r->>'source_reference_id')::uuid;
      IF _x IS NOT NULL THEN _x := jsonb_build_object('project_id', _x->>'id', 'cost_centre_id', _x->>'cost_centre_id'); END IF;
    END IF;
  ELSIF p_table = 'asset_depreciation' THEN
    SELECT to_jsonb(a) INTO _x FROM fixed_assets a WHERE a.id = (_r->>'asset_id')::uuid;
  ELSIF _r ? 'po_id' AND _r->>'po_id' IS NOT NULL THEN
    SELECT to_jsonb(p) INTO _x FROM purchase_orders p WHERE p.id = (_r->>'po_id')::uuid;
  ELSIF p_table = 'fleet_work_orders' AND _r->>'asset_id' IS NOT NULL THEN
    SELECT to_jsonb(f) INTO _x FROM fleet_assets f WHERE f.id = (_r->>'asset_id')::uuid;
  ELSIF _r ? 'fleet_asset_id' AND _r->>'fleet_asset_id' IS NOT NULL THEN
    SELECT to_jsonb(f) INTO _x FROM fleet_assets f WHERE f.id = (_r->>'fleet_asset_id')::uuid;
  END IF;
  IF _x IS NOT NULL THEN
    cost_centre_id := COALESCE(cost_centre_id, NULLIF(_x->>'cost_centre_id', '')::uuid);
    project_id     := COALESCE(project_id, NULLIF(_x->>'project_id', '')::uuid);
  END IF;
END;
$function$;

-- Stores movements → ledger
CREATE OR REPLACE FUNCTION public.trg_inv_movement_gl() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _site uuid; _amt numeric; _ev text; _dept text; _item text;
BEGIN
  IF NEW.movement_type NOT IN ('issue','return','adjustment','stock_take') THEN RETURN NEW; END IF;
  SELECT site_id INTO _site FROM warehouses WHERE id = NEW.warehouse_id;
  IF _site IS NULL THEN RETURN NEW; END IF;
  _amt := abs(COALESCE(NULLIF(NEW.value, 0), NEW.quantity * NEW.unit_cost, 0));
  SELECT COALESCE(item_code || ' ', '') || COALESCE(description, '') INTO _item FROM items WHERE id = NEW.item_id;
  IF NEW.movement_type = 'issue' THEN
    SELECT name INTO _dept FROM departments WHERE id = NEW.department_id;
    _ev := CASE WHEN _dept ~* '(camp|catering|kitchen|accommodation|housekeeping)' THEN 'stock_issue_camp' ELSE 'stock_issue' END;
  ELSIF NEW.movement_type = 'return' THEN _ev := 'stock_return';
  ELSE _ev := CASE WHEN NEW.quantity < 0 THEN 'stock_loss' ELSE 'stock_gain' END;
  END IF;
  PERFORM gl_auto_post(_site, _ev, 'inventory_movements', NEW.id, NEW.created_at::date, _amt,
    initcap(replace(NEW.movement_type, '_', ' ')) || ' ' || COALESCE(NEW.voucher_no, '') || ' — ' || COALESCE(_item, 'stock item')
    || COALESCE(' to ' || _dept, ''));
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_inv_movement_gl ON inventory_movements;
CREATE TRIGGER trg_inv_movement_gl AFTER INSERT ON inventory_movements FOR EACH ROW EXECUTE FUNCTION trg_inv_movement_gl();

-- Casual / contractor timesheets → ledger when approved
CREATE OR REPLACE FUNCTION public.trg_casual_timesheet_gl() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _who text;
BEGIN
  IF NEW.approved IS TRUE AND (TG_OP = 'INSERT' OR OLD.approved IS DISTINCT FROM TRUE) THEN
    SELECT c.name INTO _who FROM contractors c WHERE c.id = NEW.contractor_id;
    PERFORM gl_auto_post(NEW.site_id, 'contractor_labour', 'casual_timesheets', NEW.id, NEW.date, NEW.total_cost,
      'Contract labour ' || to_char(NEW.date, 'DD Mon') || COALESCE(' — ' || _who, ''));
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_casual_timesheet_gl ON casual_timesheets;
CREATE TRIGGER trg_casual_timesheet_gl AFTER INSERT OR UPDATE OF approved ON casual_timesheets FOR EACH ROW EXECUTE FUNCTION trg_casual_timesheet_gl();

-- Hired equipment usage → ledger when approved
CREATE OR REPLACE FUNCTION public.trg_equipment_usage_gl() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _e hired_equipment%ROWTYPE; _amt numeric;
BEGIN
  IF NEW.approved IS TRUE AND NOT COALESCE(NEW.is_archived, false) AND (TG_OP = 'INSERT' OR OLD.approved IS DISTINCT FROM TRUE) THEN
    SELECT * INTO _e FROM hired_equipment WHERE id = NEW.equipment_id;
    _amt := CASE WHEN COALESCE(_e.hourly_rate, 0) > 0 AND COALESCE(NEW.hours_worked, 0) > 0 THEN _e.hourly_rate * NEW.hours_worked
                 ELSE COALESCE(_e.daily_rate, 0) END;
    PERFORM gl_auto_post(NEW.site_id, 'hired_plant_usage', 'equipment_usage_log', NEW.id, NEW.usage_date, _amt,
      'Hired plant ' || COALESCE(_e.description, '') || ' ' || to_char(NEW.usage_date, 'DD Mon') || COALESCE(' (' || NEW.hours_worked || ' h)', ''));
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_equipment_usage_gl ON equipment_usage_log;
CREATE TRIGGER trg_equipment_usage_gl AFTER INSERT OR UPDATE OF approved ON equipment_usage_log FOR EACH ROW EXECUTE FUNCTION trg_equipment_usage_gl();

-- SHEQ incident actual cost → ledger when the incident is closed
CREATE OR REPLACE FUNCTION public.trg_sheq_incident_gl() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF lower(NEW.status) = 'closed' AND COALESCE(NEW.actual_cost, 0) > 0 AND NOT COALESCE(NEW.is_archived, false)
     AND (TG_OP = 'INSERT' OR lower(COALESCE(OLD.status, '')) <> 'closed' OR OLD.actual_cost IS DISTINCT FROM NEW.actual_cost) THEN
    PERFORM gl_auto_post(NEW.site_id, 'sheq_incident_cost', 'sheq_incidents', NEW.id, COALESCE(NEW.closed_at::date, NEW.incident_date),
      NEW.actual_cost, 'Incident cost ' || COALESCE(NEW.incident_number, '') || COALESCE(' — ' || NEW.cost_category, ''));
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_sheq_incident_gl ON sheq_incidents;
CREATE TRIGGER trg_sheq_incident_gl AFTER INSERT OR UPDATE OF status, actual_cost ON sheq_incidents FOR EACH ROW EXECUTE FUNCTION trg_sheq_incident_gl();

-- Give every site that already has its chart of accounts the new rules.
INSERT INTO gl_posting_rules (site_id, event_code, debit_account_id, credit_account_id, is_active, is_archived)
SELECT s.site_id, m.event_code, d.id, c.id, true, false
  FROM finance_setup s CROSS JOIN finance_rule_template() m
  JOIN accounts d ON d.site_id = s.site_id AND d.code = m.debit_code AND NOT d.is_archived
  JOIN accounts c ON c.site_id = s.site_id AND c.code = m.credit_code AND NOT c.is_archived
 WHERE NOT EXISTS (SELECT 1 FROM gl_posting_rules g WHERE g.site_id = s.site_id AND g.event_code = m.event_code AND NOT g.is_archived);

INSERT INTO schema_migrations (filename) VALUES ('0211_cross_module_postings.sql') ON CONFLICT DO NOTHING;
