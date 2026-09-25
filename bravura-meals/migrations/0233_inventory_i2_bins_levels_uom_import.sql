-- 0233 — Inventory I2 (issue #59): bins with QR labels, stock levels per store, purchase units, Excel import.
--  • warehouse_bins: shelf / bin locations inside a store (code printed as a QR label).
--  • item_store_settings: bin, min, max, reorder level and reorder qty for an item IN A STORE (falls back to the item).
--  • items.purchase_uom_id + purchase_factor: "bought by the box of 50, issued each" — receiving a PO line whose
--    unit is the purchase unit puts qty × factor on the shelf at cost ÷ factor.
--  • _inv_reorder_core uses the store levels first, so Procurement's reorder → draft POs follows them.
--  • inv_import_items(rows, store): add/update items from a spreadsheet, set store levels + bins, post opening stock.

CREATE TABLE IF NOT EXISTS warehouse_bins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  code text NOT NULL,
  name text,
  is_archived boolean NOT NULL DEFAULT false,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (warehouse_id, code)
);
CREATE TABLE IF NOT EXISTS item_store_settings (
  item_id uuid NOT NULL REFERENCES items(id),
  warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  bin_id uuid REFERENCES warehouse_bins(id),
  min_qty numeric, max_qty numeric, reorder_level numeric, reorder_qty numeric,
  updated_by uuid DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, warehouse_id)
);
ALTER TABLE items ADD COLUMN IF NOT EXISTS purchase_uom_id uuid REFERENCES units_of_measure(id);
ALTER TABLE items ADD COLUMN IF NOT EXISTS purchase_factor numeric NOT NULL DEFAULT 1 CHECK (purchase_factor > 0);
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS bin_id uuid REFERENCES warehouse_bins(id);

ALTER TABLE warehouse_bins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bins_select ON warehouse_bins; DROP POLICY IF EXISTS bins_insert ON warehouse_bins; DROP POLICY IF EXISTS bins_update ON warehouse_bins;
CREATE POLICY bins_select ON warehouse_bins FOR SELECT TO authenticated USING (_inv_can('view', warehouse_id));
CREATE POLICY bins_insert ON warehouse_bins FOR INSERT TO authenticated WITH CHECK (_inv_can('edit', warehouse_id));
CREATE POLICY bins_update ON warehouse_bins FOR UPDATE TO authenticated USING (_inv_can('edit', warehouse_id));
ALTER TABLE item_store_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS iss_select ON item_store_settings; DROP POLICY IF EXISTS iss_insert ON item_store_settings; DROP POLICY IF EXISTS iss_update ON item_store_settings;
CREATE POLICY iss_select ON item_store_settings FOR SELECT TO authenticated USING (_inv_can('view', warehouse_id));
CREATE POLICY iss_insert ON item_store_settings FOR INSERT TO authenticated WITH CHECK (_inv_can('edit', warehouse_id));
CREATE POLICY iss_update ON item_store_settings FOR UPDATE TO authenticated USING (_inv_can('edit', warehouse_id));
GRANT SELECT, INSERT, UPDATE ON warehouse_bins, item_store_settings TO authenticated;

-- Receiving: convert purchase units to stock units.
CREATE OR REPLACE FUNCTION public.trg_grn_moves_stock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  _was boolean := TG_OP = 'UPDATE' AND OLD.status IN ('accepted','accepted_partial');
  _is  boolean := NEW.status IN ('accepted','accepted_partial');
  _po  purchase_orders%ROWTYPE; _l record; _qty numeric; _cost numeric; _f numeric; _wh uuid;
BEGIN
  IF _was AND NOT _is THEN
    RAISE EXCEPTION 'This GRN has already put stock on the shelf. Correct it with a stock adjustment or supplier return instead.';
  END IF;
  IF NOT _is OR _was OR NEW.po_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO _po FROM purchase_orders WHERE id = NEW.po_id;
  _wh := COALESCE(_po.warehouse_id, _inv_main_store(_po.site_id));
  FOR _l IN
    SELECT g.*, COALESCE(g.item_id, pl.item_id) AS stock_item, pl.unit_cost AS po_cost, pl.unit AS po_unit,
           i.purchase_factor, pu.abbreviation AS p_abbr, pu.name AS p_name
      FROM grn_lines g LEFT JOIN po_lines pl ON pl.id = g.po_line_id
      LEFT JOIN items i ON i.id = COALESCE(g.item_id, pl.item_id)
      LEFT JOIN units_of_measure pu ON pu.id = i.purchase_uom_id
     WHERE g.grn_id = NEW.id
  LOOP
    _qty := COALESCE(_l.quantity_received, 0) - COALESCE(_l.quantity_rejected, 0);
    CONTINUE WHEN _qty <= 0;
    _cost := COALESCE(NULLIF(_l.unit_price, 0), _l.po_cost, 0);
    -- Bought in the purchase unit (box, drum, pack…) → shelf quantity in the stock unit.
    _f := CASE WHEN COALESCE(_l.purchase_factor, 1) <> 1 AND _l.po_unit IS NOT NULL
                AND lower(trim(_l.po_unit)) IN (lower(_l.p_abbr), lower(_l.p_name)) THEN _l.purchase_factor ELSE 1 END;
    IF _l.stock_item IS NOT NULL AND _wh IS NOT NULL THEN
      INSERT INTO inventory_movements (item_id, warehouse_id, movement_type, quantity, unit_cost, value,
                                       voucher_type, voucher_no, source_module, source_reference_id, notes, created_by, bin_id)
      VALUES (_l.stock_item, _wh, 'grn', _qty * _f, _cost / _f, _qty * _cost,
              'GRN', NEW.grn_number, 'procurement', NEW.id,
              'Received against ' || COALESCE(_po.po_number, 'PO') || CASE WHEN _f <> 1 THEN ' (' || _qty || ' ' || _l.po_unit || ' × ' || _f || ')' ELSE '' END,
              COALESCE(NEW.received_by, auth.uid()),
              (SELECT bin_id FROM item_store_settings WHERE item_id = _l.stock_item AND warehouse_id = _wh));
    END IF;
    IF _l.po_line_id IS NOT NULL THEN
      UPDATE po_lines SET received_qty = received_qty + _qty WHERE id = _l.po_line_id;
    END IF;
  END LOOP;
  PERFORM _po_refresh_status(NEW.po_id);
  RETURN NEW;
END $function$;

-- Reorder: store levels first, then the item's; items with a level but no stock row yet are included.
CREATE OR REPLACE FUNCTION public._inv_reorder_core(p_site_id uuid)
RETURNS TABLE(item_id uuid, item_code text, description text, warehouse_id uuid, warehouse text, on_hand numeric, on_order numeric,
              reorder_level numeric, suggested_qty numeric, unit_cost numeric, preferred_supplier_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  RETURN QUERY
  WITH pairs AS (
    SELECT sb.item_id, sb.warehouse_id FROM stock_balances sb JOIN warehouses w ON w.id = sb.warehouse_id WHERE w.site_id = p_site_id
    UNION
    SELECT s.item_id, s.warehouse_id FROM item_store_settings s JOIN warehouses w ON w.id = s.warehouse_id WHERE w.site_id = p_site_id
  ), bal AS (
    SELECT i.id item_id, i.item_code, i.description, w.id wh, w.name wname, COALESCE(sb.on_hand_qty, 0) oh,
           COALESCE(s.reorder_level, s.min_qty, i.reorder_level) rl, COALESCE(s.reorder_qty, i.reorder_qty) rq, COALESCE(s.max_qty, i.max_stock) mx,
           COALESCE(NULLIF(i.last_purchase_price, 0), i.average_cost, i.standard_cost, 0) uc, i.preferred_supplier_id sup
      FROM pairs p JOIN items i ON i.id = p.item_id JOIN warehouses w ON w.id = p.warehouse_id
      LEFT JOIN stock_balances sb ON sb.item_id = p.item_id AND sb.warehouse_id = p.warehouse_id
      LEFT JOIN item_store_settings s ON s.item_id = p.item_id AND s.warehouse_id = p.warehouse_id
     WHERE w.is_active AND NOT COALESCE(i.is_archived, false)
  ), ord AS (
    SELECT b.item_id, b.wh,
           COALESCE((SELECT SUM(GREATEST(pl.quantity - COALESCE(pl.received_qty, 0), 0)) FROM po_lines pl JOIN purchase_orders po ON po.id = pl.po_id
                      WHERE pl.item_id = b.item_id AND COALESCE(po.warehouse_id, _inv_main_store(po.site_id)) = b.wh
                        AND po.status IN ('pending_approval','sent','partially_received')), 0)
         + COALESCE((SELECT SUM(rl.quantity) FROM requisition_lines rl JOIN purchase_requisitions pr ON pr.id = rl.requisition_id
                      WHERE rl.item_id = b.item_id AND pr.warehouse_id = b.wh AND pr.status IN ('draft','submitted','approved') AND NOT rl.is_archived), 0) q
      FROM bal b WHERE COALESCE(b.rl, 0) > 0
  )
  SELECT b.item_id, b.item_code, b.description, b.wh, b.wname, b.oh, o.q, b.rl,
         GREATEST(COALESCE(NULLIF(b.rq, 0), GREATEST(COALESCE(b.mx, 0), b.rl * 2) - b.oh - o.q), 1),
         b.uc, b.sup
    FROM bal b JOIN ord o ON o.item_id = b.item_id AND o.wh = b.wh
   WHERE b.oh + o.q <= b.rl
   ORDER BY b.description;
END;
$function$;

-- Spreadsheet import. Rows: { item_code, description, category, unit, purchase_unit, purchase_factor, part_number, barcode,
--   standard_cost, bin, min, max, reorder_level, reorder_qty, qty, unit_cost }. Existing codes are updated (blank cells keep
--   what is there); qty > 0 posts opening stock into the store at unit_cost (falls back to standard_cost).
CREATE OR REPLACE FUNCTION public.inv_import_items(p_rows jsonb, p_warehouse_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _wh warehouses%ROWTYPE; _r jsonb; _code text; _item uuid; _cat uuid; _uom uuid; _puom uuid; _bin uuid;
        _new int := 0; _upd int := 0; _open jsonb := '[]'; _res jsonb; _errors jsonb := '[]'; _n int := 0;
BEGIN
  SELECT * INTO _wh FROM warehouses WHERE id = p_warehouse_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Choose the store to import into'; END IF;
  IF NOT _has_permission('inventory.create', _wh.site_id) THEN RAISE EXCEPTION 'You cannot add stock items at %', _wh.name; END IF;
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN RAISE EXCEPTION 'The sheet has no rows'; END IF;
  IF jsonb_array_length(p_rows) > 5000 THEN RAISE EXCEPTION 'Import at most 5,000 rows at a time'; END IF;
  FOR _r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    _n := _n + 1;
    _code := upper(trim(COALESCE(_r->>'item_code', '')));
    IF _code = '' OR COALESCE(trim(_r->>'description'), '') = '' AND NOT EXISTS (SELECT 1 FROM items WHERE item_code = _code) THEN
      _errors := _errors || jsonb_build_object('row', _n, 'error', 'Needs an item code and a description');
      CONTINUE;
    END IF;
    _cat := NULL; _uom := NULL; _puom := NULL; _bin := NULL;
    IF NULLIF(trim(_r->>'category'), '') IS NOT NULL THEN
      SELECT id INTO _cat FROM item_categories WHERE lower(name) = lower(trim(_r->>'category')) LIMIT 1;
      IF _cat IS NULL THEN INSERT INTO item_categories (name) VALUES (trim(_r->>'category')) RETURNING id INTO _cat; END IF;
    END IF;
    IF NULLIF(trim(_r->>'unit'), '') IS NOT NULL THEN
      SELECT id INTO _uom FROM units_of_measure WHERE lower(abbreviation) = lower(trim(_r->>'unit')) OR lower(name) = lower(trim(_r->>'unit')) LIMIT 1;
      IF _uom IS NULL THEN INSERT INTO units_of_measure (name, abbreviation) VALUES (trim(_r->>'unit'), lower(trim(_r->>'unit'))) RETURNING id INTO _uom; END IF;
    END IF;
    IF NULLIF(trim(_r->>'purchase_unit'), '') IS NOT NULL THEN
      SELECT id INTO _puom FROM units_of_measure WHERE lower(abbreviation) = lower(trim(_r->>'purchase_unit')) OR lower(name) = lower(trim(_r->>'purchase_unit')) LIMIT 1;
      IF _puom IS NULL THEN INSERT INTO units_of_measure (name, abbreviation) VALUES (trim(_r->>'purchase_unit'), lower(trim(_r->>'purchase_unit'))) RETURNING id INTO _puom; END IF;
    END IF;
    SELECT id INTO _item FROM items WHERE item_code = _code;
    IF _item IS NULL THEN
      INSERT INTO items (item_code, description, category_id, uom_id, purchase_uom_id, purchase_factor, part_number, barcode, standard_cost, status)
      VALUES (_code, trim(_r->>'description'), _cat, _uom, _puom, COALESCE(NULLIF(_r->>'purchase_factor', '')::numeric, 1),
              NULLIF(trim(_r->>'part_number'), ''), NULLIF(trim(_r->>'barcode'), ''), NULLIF(_r->>'standard_cost', '')::numeric, 'active')
      RETURNING id INTO _item;
      _new := _new + 1;
    ELSE
      UPDATE items SET description = COALESCE(NULLIF(trim(_r->>'description'), ''), description),
             category_id = COALESCE(_cat, category_id), uom_id = COALESCE(_uom, uom_id), purchase_uom_id = COALESCE(_puom, purchase_uom_id),
             purchase_factor = COALESCE(NULLIF(_r->>'purchase_factor', '')::numeric, purchase_factor),
             part_number = COALESCE(NULLIF(trim(_r->>'part_number'), ''), part_number), barcode = COALESCE(NULLIF(trim(_r->>'barcode'), ''), barcode),
             standard_cost = COALESCE(NULLIF(_r->>'standard_cost', '')::numeric, standard_cost), is_archived = false, updated_at = now()
       WHERE id = _item;
      _upd := _upd + 1;
    END IF;
    IF NULLIF(trim(_r->>'bin'), '') IS NOT NULL THEN
      INSERT INTO warehouse_bins (warehouse_id, code) VALUES (_wh.id, upper(trim(_r->>'bin')))
        ON CONFLICT (warehouse_id, code) DO UPDATE SET is_archived = false RETURNING id INTO _bin;
    END IF;
    IF _bin IS NOT NULL OR COALESCE(_r->>'min', _r->>'max', _r->>'reorder_level', _r->>'reorder_qty', '') <> '' THEN
      INSERT INTO item_store_settings (item_id, warehouse_id, bin_id, min_qty, max_qty, reorder_level, reorder_qty)
      VALUES (_item, _wh.id, _bin, NULLIF(_r->>'min', '')::numeric, NULLIF(_r->>'max', '')::numeric,
              NULLIF(_r->>'reorder_level', '')::numeric, NULLIF(_r->>'reorder_qty', '')::numeric)
      ON CONFLICT (item_id, warehouse_id) DO UPDATE SET bin_id = COALESCE(EXCLUDED.bin_id, item_store_settings.bin_id),
        min_qty = COALESCE(EXCLUDED.min_qty, item_store_settings.min_qty), max_qty = COALESCE(EXCLUDED.max_qty, item_store_settings.max_qty),
        reorder_level = COALESCE(EXCLUDED.reorder_level, item_store_settings.reorder_level),
        reorder_qty = COALESCE(EXCLUDED.reorder_qty, item_store_settings.reorder_qty), updated_at = now(), updated_by = auth.uid();
    END IF;
    IF COALESCE(NULLIF(_r->>'qty', '')::numeric, 0) > 0 THEN
      _open := _open || jsonb_build_object('item_id', _item, 'qty', (_r->>'qty')::numeric,
                 'unit_cost', COALESCE(NULLIF(_r->>'unit_cost', '')::numeric, NULLIF(_r->>'standard_cost', '')::numeric));
    END IF;
  END LOOP;
  IF jsonb_array_length(_open) > 0 THEN
    _res := inv_receive_nopo(jsonb_build_object('warehouse_id', _wh.id, 'reason', 'opening', 'notes', 'Opening stock from item import', 'lines', _open));
  END IF;
  RETURN jsonb_build_object('added', _new, 'updated', _upd, 'opening_lines', jsonb_array_length(_open),
    'opening_value', COALESCE((_res->>'value')::numeric, 0), 'voucher', _res->>'voucher', 'errors', _errors);
END $$;
REVOKE ALL ON FUNCTION inv_import_items(jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION inv_import_items(jsonb, uuid) TO authenticated;

INSERT INTO schema_migrations (filename) VALUES ('0233_inventory_i2_bins_levels_uom_import.sql') ON CONFLICT DO NOTHING;
