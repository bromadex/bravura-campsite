-- 0247 Fuel F1 part 2 (#69): fuel runs on the Stores engine.
-- Each tank is a store (warehouses.type 'fuel_store'), each fuel type is a stock item (litres).
-- Every fuel transaction is mirrored into inventory_movements (source_module 'fuel'), so Stores
-- shows fuel stock and value per tank with a moving-average cost. Fuel screens stay the only way
-- to move fuel: Stores RPCs are blocked on fuel stores. One GL path: fuel keeps fuel_issue /
-- fuel_delivery (fuel accounts); Stores GL skips source_module 'fuel' so nothing posts twice.
-- Issues are now priced at the tank's moving average (same figure the Stores movement carries).

ALTER TABLE fuel_types ADD COLUMN IF NOT EXISTS item_id uuid REFERENCES items(id);
ALTER TABLE fuel_tanks ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES warehouses(id);

-- item per fuel type
CREATE OR REPLACE FUNCTION _fuel_item(p_type uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _t fuel_types%ROWTYPE; _id uuid;
BEGIN
  SELECT * INTO _t FROM fuel_types WHERE id = p_type;
  IF _t.id IS NULL THEN RETURN NULL; END IF;
  IF _t.item_id IS NOT NULL THEN RETURN _t.item_id; END IF;
  SELECT id INTO _id FROM items WHERE item_code = 'FUEL-' || upper(COALESCE(_t.code, _t.name));
  IF _id IS NULL THEN
    INSERT INTO items (item_code, description, uom_id, status)
    VALUES ('FUEL-' || upper(COALESCE(_t.code, _t.name)), _t.name || ' (fuel)',
            (SELECT id FROM units_of_measure WHERE abbreviation = 'L' LIMIT 1), 'active')
    RETURNING id INTO _id;
  END IF;
  UPDATE fuel_types SET item_id = _id WHERE id = p_type;
  RETURN _id;
END $$;

-- store per tank
CREATE OR REPLACE FUNCTION _fuel_tank_store(p_tank uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _k fuel_tanks%ROWTYPE; _id uuid; _code text;
BEGIN
  SELECT * INTO _k FROM fuel_tanks WHERE id = p_tank;
  IF _k.id IS NULL THEN RETURN NULL; END IF;
  IF _k.warehouse_id IS NOT NULL THEN RETURN _k.warehouse_id; END IF;
  SELECT upper(left(name, 3)) || '-FT-' || upper(regexp_replace(_k.name, '[^A-Za-z0-9]+', '', 'g')) INTO _code FROM sites WHERE id = _k.site_id;
  INSERT INTO warehouses (code, name, site_id, type, is_active, allow_negative)
  VALUES (_code, 'Fuel: ' || _k.name, _k.site_id, 'fuel_store', NOT COALESCE(_k.is_archived, false), true)
  RETURNING id INTO _id;
  UPDATE fuel_tanks SET warehouse_id = _id WHERE id = p_tank;
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION trg_fuel_tank_store() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.warehouse_id IS NULL THEN PERFORM _fuel_tank_store(NEW.id); END IF;
  IF NEW.fuel_type_id IS NOT NULL THEN PERFORM _fuel_item(NEW.fuel_type_id); END IF;
  IF TG_OP = 'UPDATE' AND NEW.warehouse_id IS NOT NULL AND NEW.is_archived IS DISTINCT FROM OLD.is_archived THEN
    UPDATE warehouses SET is_active = NOT COALESCE(NEW.is_archived, false) WHERE id = NEW.warehouse_id;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_fuel_tank_store ON fuel_tanks;
CREATE TRIGGER trg_fuel_tank_store AFTER INSERT OR UPDATE OF warehouse_id, fuel_type_id, is_archived ON fuel_tanks
  FOR EACH ROW EXECUTE FUNCTION trg_fuel_tank_store();

-- Stores screens cannot move fuel
CREATE OR REPLACE FUNCTION trg_inv_fuel_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.source_module IS DISTINCT FROM 'fuel'
     AND EXISTS (SELECT 1 FROM warehouses WHERE id = NEW.warehouse_id AND type = 'fuel_store') THEN
    RAISE EXCEPTION 'Fuel tanks are moved from the Fuel screens (issues, deliveries, transfers)';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_inv_00_fuel_guard ON inventory_movements;
CREATE TRIGGER trg_inv_00_fuel_guard BEFORE INSERT ON inventory_movements FOR EACH ROW EXECUTE FUNCTION trg_inv_fuel_guard();

-- Stores GL skips fuel (fuel posts its own fuel_issue / fuel_delivery)
CREATE OR REPLACE FUNCTION public.trg_inv_movement_gl()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _site uuid; _other uuid; _amt numeric; _ev text; _dept text; _item text;
BEGIN
  IF NEW.source_module = 'fuel' THEN RETURN NEW; END IF;
  SELECT site_id INTO _site FROM warehouses WHERE id = NEW.warehouse_id;
  IF _site IS NULL THEN RETURN NEW; END IF;
  _amt := abs(COALESCE(NULLIF(NEW.value, 0), NEW.quantity * NEW.unit_cost, 0));
  SELECT COALESCE(item_code || ' ', '') || COALESCE(description, '') INTO _item FROM items WHERE id = NEW.item_id;
  IF NEW.movement_type = 'issue' THEN
    SELECT name INTO _dept FROM departments WHERE id = NEW.department_id;
    _ev := CASE WHEN _dept ~* '(camp|catering|kitchen|accommodation|housekeeping)' THEN 'stock_issue_camp' ELSE 'stock_issue' END;
  ELSIF NEW.movement_type = 'return' THEN _ev := 'stock_return';
  ELSIF NEW.movement_type IN ('adjustment','stock_take') THEN _ev := CASE WHEN NEW.quantity < 0 THEN 'stock_loss' ELSE 'stock_gain' END;
  ELSIF NEW.movement_type = 'opening' THEN _ev := 'stock_opening';
  ELSIF NEW.movement_type IN ('transfer_out','transfer_in') THEN
    SELECT site_id INTO _other FROM warehouses WHERE id = NEW.counter_warehouse_id;
    IF _other IS NULL OR _other = _site THEN RETURN NEW; END IF;
    _ev := CASE WHEN NEW.movement_type = 'transfer_out' THEN 'stock_transfer_out' ELSE 'stock_transfer_in' END;
  ELSE RETURN NEW;
  END IF;
  PERFORM gl_auto_post(_site, _ev, 'inventory_movements', NEW.id, NEW.created_at::date, _amt,
    initcap(replace(NEW.movement_type, '_', ' ')) || ' ' || COALESCE(NEW.voucher_no, '') || ' — ' || COALESCE(_item, 'stock item')
    || COALESCE(' to ' || _dept, ''));
  RETURN NEW;
END $function$;

-- one Stores movement for a change in a tank
CREATE OR REPLACE FUNCTION _fuel_post_move(t fuel_transactions, p_tank uuid, p_qty numeric, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _wh uuid; _item uuid; _mt text;
BEGIN
  IF p_tank IS NULL OR COALESCE(p_qty, 0) = 0 THEN RETURN; END IF;
  _wh := _fuel_tank_store(p_tank);
  _item := _fuel_item((SELECT fuel_type_id FROM fuel_tanks WHERE id = p_tank));
  IF _wh IS NULL OR _item IS NULL THEN RETURN; END IF;
  _mt := CASE
    WHEN t.transaction_type = 'issuance'     THEN CASE WHEN p_qty < 0 THEN 'issue' ELSE 'return' END
    WHEN t.transaction_type = 'delivery'     THEN CASE WHEN p_qty > 0 THEN 'grn' ELSE 'adjustment' END
    WHEN t.transaction_type = 'transfer_out' THEN CASE WHEN p_qty < 0 THEN 'transfer_out' ELSE 'transfer_in' END
    WHEN t.transaction_type = 'transfer_in'  THEN CASE WHEN p_qty > 0 THEN 'transfer_in' ELSE 'transfer_out' END
    ELSE 'adjustment' END;
  INSERT INTO inventory_movements (item_id, warehouse_id, movement_type, quantity, unit_cost, voucher_type, voucher_no,
    source_module, source_reference_id, cost_centre_id, project_id, notes, reason, created_by, created_at)
  VALUES (_item, _wh, _mt, p_qty,
    CASE WHEN t.transaction_type = 'delivery' AND p_qty > 0 THEN COALESCE(t.unit_price, 0) ELSE 0 END,
    'fuel_' || t.transaction_type, t.transaction_number, 'fuel', t.id, t.cost_centre_id, t.project_id,
    left(COALESCE(t.asset_description, t.notes, ''), 200), p_reason, COALESCE(auth.uid(), t.created_by),
    CASE WHEN p_reason IS NULL THEN COALESCE(t.transaction_date::timestamptz + (t.created_at::time)::interval, now()) ELSE now() END);
END $$;

CREATE OR REPLACE FUNCTION trg_fuel_to_stores() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _new numeric; _old numeric := 0;
BEGIN
  _new := _fuel_txn_level_effect(NEW.transaction_type, NEW.litres, NEW.is_deleted);
  IF TG_OP = 'INSERT' THEN
    PERFORM _fuel_post_move(NEW, NEW.tank_id, _new, NULL);
    RETURN NULL;
  END IF;
  _old := _fuel_txn_level_effect(OLD.transaction_type, OLD.litres, OLD.is_deleted);
  IF OLD.tank_id IS DISTINCT FROM NEW.tank_id THEN
    PERFORM _fuel_post_move(NEW, OLD.tank_id, -_old, 'Moved to another tank');
    PERFORM _fuel_post_move(NEW, NEW.tank_id, _new, 'Moved from another tank');
  ELSIF _new <> _old THEN
    PERFORM _fuel_post_move(NEW, NEW.tank_id, _new - _old,
      CASE WHEN COALESCE(NEW.is_deleted, false) THEN 'Cancelled: ' || COALESCE(NEW.edit_reason, 'no reason given')
           ELSE 'Edited: ' || COALESCE(NEW.edit_reason, 'litres changed') END);
  END IF;
  RETURN NULL;
END $$;

-- issue price = the tank's moving average (falls back to last delivery price)
CREATE OR REPLACE FUNCTION public.trg_fuel_price_and_meter()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _cat text;
BEGIN
  IF NEW.transaction_type <> 'issuance' THEN RETURN NEW; END IF;
  IF COALESCE(NEW.unit_price, 0) <= 0 AND NEW.tank_id IS NOT NULL THEN
    SELECT round(b.valuation_rate, 4) INTO NEW.unit_price
      FROM fuel_tanks k JOIN fuel_types ft ON ft.id = k.fuel_type_id
      JOIN stock_balances b ON b.warehouse_id = k.warehouse_id AND b.item_id = ft.item_id
     WHERE k.id = NEW.tank_id AND COALESCE(b.valuation_rate, 0) > 0;
  END IF;
  IF COALESCE(NEW.unit_price, 0) <= 0 THEN
    SELECT d.unit_price INTO NEW.unit_price FROM fuel_transactions d
     WHERE d.site_id = NEW.site_id AND d.transaction_type = 'delivery' AND NOT COALESCE(d.is_deleted, false) AND COALESCE(d.unit_price, 0) > 0
       AND (NEW.tank_id IS NULL OR d.tank_id = NEW.tank_id) AND d.transaction_date <= COALESCE(NEW.transaction_date, current_date)
     ORDER BY d.transaction_date DESC, d.created_at DESC LIMIT 1;
  END IF;
  IF COALESCE(NEW.unit_price, 0) > 0 AND (TG_OP = 'INSERT' OR COALESCE(NEW.total_cost, 0) = 0
       OR NEW.litres IS DISTINCT FROM OLD.litres OR NEW.unit_price IS DISTINCT FROM OLD.unit_price) THEN
    NEW.total_cost := round(COALESCE(NEW.litres, 0) * NEW.unit_price, 2);
  END IF;
  IF TG_OP = 'INSERT' AND NEW.fleet_asset_id IS NOT NULL AND NOT COALESCE(NEW.is_deleted, false)
     AND COALESCE(NEW.transaction_date, current_date) >= _fleet_setting_date(NEW.site_id)
     AND NEW.odometer_km IS NULL AND NEW.hours_reading IS NULL THEN
    IF NEW.meter_broken THEN
      IF COALESCE(trim(NEW.meter_note), '') = '' THEN RAISE EXCEPTION 'Say what is wrong with the meter'; END IF;
    ELSE
      SELECT t.category INTO _cat FROM fleet_assets a LEFT JOIN fleet_asset_types t ON t.id = a.asset_type_id WHERE a.id = NEW.fleet_asset_id;
      RAISE EXCEPTION 'Enter the % reading (required from %), or tick "Meter broken"',
        CASE WHEN _cat = 'vehicle' THEN 'odometer (km)' ELSE 'hour meter' END, to_char(_fleet_setting_date(NEW.site_id), 'DD Mon YYYY');
    END IF;
  END IF;
  RETURN NEW;
END $function$;

-- cut-over: stores + items, then ONE opening balance per tank = today's dip-based book level at the last
-- delivery price. (Replaying history was tried and rejected: the tank went negative where deliveries were
-- never recorded, which wrecks a moving average. History stays in fuel_transactions.)
DO $$
DECLARE r record; _book numeric; _price numeric;
BEGIN
  PERFORM _fuel_tank_store(id) FROM fuel_tanks;
  PERFORM _fuel_item(id) FROM fuel_types;
  FOR r IN SELECT k.id, k.site_id, k.warehouse_id, ft.item_id FROM fuel_tanks k JOIN fuel_types ft ON ft.id = k.fuel_type_id LOOP
    _book := (_fuel_tank_book(r.id) ->> 'book')::numeric;
    SELECT d.unit_price INTO _price FROM fuel_transactions d
     WHERE d.site_id = r.site_id AND d.transaction_type = 'delivery' AND NOT COALESCE(d.is_deleted, false) AND COALESCE(d.unit_price, 0) > 0
     ORDER BY (d.tank_id = r.id) DESC, d.transaction_date DESC, d.created_at DESC LIMIT 1;
    IF COALESCE(_book, 0) > 0 THEN
      INSERT INTO inventory_movements (item_id, warehouse_id, movement_type, quantity, unit_cost, voucher_type, source_module, reason, notes)
      VALUES (r.item_id, r.warehouse_id, 'opening', _book, COALESCE(_price, 0), 'fuel_opening', 'fuel',
              'Fuel cut-over to Stores', 'Tank level from the latest dip and moves since, 26 Sep 2026');
    END IF;
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS trg_fuel_to_stores ON fuel_transactions;
CREATE TRIGGER trg_fuel_to_stores AFTER INSERT OR UPDATE OF litres, is_deleted, tank_id, transaction_type ON fuel_transactions
  FOR EACH ROW EXECUTE FUNCTION trg_fuel_to_stores();

INSERT INTO schema_migrations (filename) VALUES ('0247_fuel_f1_stores_engine.sql') ON CONFLICT DO NOTHING;

-- tank strip: stock value and litre cost from the Stores balance
DROP FUNCTION IF EXISTS fuel_tank_position(uuid);
CREATE FUNCTION public.fuel_tank_position(p_site_id uuid)
 RETURNS TABLE(tank_id uuid, tank text, fuel_type text, capacity numeric, method text, last_dip_date date, last_dip numeric, book_level numeric,
   pct_full numeric, use_per_day numeric, days_cover numeric, gap_30d numeric, issued_30d numeric, tolerance numeric,
   store_code text, store_litres numeric, cost_per_litre numeric, stock_value numeric)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT _user_has_fuel_perm(p_site_id, ARRAY['fuel.view','fuel.create','fuel.edit']) THEN RAISE EXCEPTION 'No access'; END IF;
  RETURN QUERY
  SELECT t.id, t.name, ft.name, t.capacity_litres, t.level_tracking_method, (b->>'last_dip_date')::date, (b->>'last_dip')::numeric,
         round((b->>'book')::numeric), round(100 * (b->>'book')::numeric / NULLIF(t.capacity_litres, 0), 0),
         round(u.l / 30.0, 0), round((b->>'book')::numeric / NULLIF(u.l / 30.0, 0), 1),
         (SELECT round(sum(variance_litres)) FROM fuel_dip_readings d WHERE d.tank_id = t.id AND NOT d.is_archived AND d.reading_date > CURRENT_DATE - 30),
         round(u.l), t.dip_tolerance_litres,
         w.code, sb.on_hand_qty, round(sb.valuation_rate, 4), round(sb.stock_value, 2)
    FROM fuel_tanks t
    LEFT JOIN fuel_types ft ON ft.id = t.fuel_type_id
    LEFT JOIN warehouses w ON w.id = t.warehouse_id
    LEFT JOIN stock_balances sb ON sb.warehouse_id = t.warehouse_id AND sb.item_id = ft.item_id
    CROSS JOIN LATERAL (SELECT _fuel_tank_book(t.id) b) bb
    CROSS JOIN LATERAL (SELECT COALESCE(sum(litres), 0) l FROM fuel_transactions x WHERE x.tank_id = t.id AND x.transaction_type = 'issuance'
                         AND NOT COALESCE(x.is_deleted, false) AND x.transaction_date > CURRENT_DATE - 30) u
   WHERE t.site_id = p_site_id AND NOT COALESCE(t.is_archived, false)
   ORDER BY t.name;
END $function$;
