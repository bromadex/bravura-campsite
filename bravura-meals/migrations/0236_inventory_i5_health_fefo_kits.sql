-- 0236 — Inventory I5 (issue #59): stock health reports, first-expiry-first-out, return condition, kits.
--  • FEFO: an outgoing move without a batch takes the batch that expires first; if that batch is too small the rest
--    goes on a second line from the next batch (and so on). Stock with no batch is used last.
--  • Returns carry a condition: good (back on the shelf), damaged or scrap (comes back, then written off as a loss —
--    the department is credited and the loss shows in shrinkage).
--  • Kits: an item marked as a kit is a list of components; issuing a kit issues its components.
--  • inv_report(kind, sites, from, to): ageing, dead, abc, shrinkage, usage, counts — the Stock health screen (IN23).

-- ── Kits ──────────────────────────────────────────────────────────────────────
ALTER TABLE items ADD COLUMN IF NOT EXISTS is_kit boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS item_kit_components (
  kit_item_id uuid NOT NULL REFERENCES items(id),
  component_item_id uuid NOT NULL REFERENCES items(id),
  qty numeric NOT NULL CHECK (qty > 0),
  is_archived boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kit_item_id, component_item_id),
  CHECK (kit_item_id <> component_item_id)
);
ALTER TABLE item_kit_components ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kit_select ON item_kit_components; DROP POLICY IF EXISTS kit_insert ON item_kit_components; DROP POLICY IF EXISTS kit_update ON item_kit_components;
CREATE POLICY kit_select ON item_kit_components FOR SELECT TO authenticated USING (_inv_any('view'));
CREATE POLICY kit_insert ON item_kit_components FOR INSERT TO authenticated WITH CHECK (_inv_any('edit'));
CREATE POLICY kit_update ON item_kit_components FOR UPDATE TO authenticated USING (_inv_any('edit'));
GRANT SELECT, INSERT, UPDATE ON item_kit_components TO authenticated;

-- Kits never hold stock themselves.
CREATE OR REPLACE FUNCTION public.trg_inv_no_kit_stock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM items WHERE id = NEW.item_id AND is_kit) THEN
    RAISE EXCEPTION 'A kit has no stock of its own — move its components instead';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_inv_0_no_kit ON inventory_movements;
CREATE TRIGGER trg_inv_0_no_kit BEFORE INSERT ON inventory_movements FOR EACH ROW EXECUTE FUNCTION trg_inv_no_kit_stock();

-- Expand kit lines into component lines: [{item_id, qty, ...}] → same shape.
CREATE OR REPLACE FUNCTION public._inv_expand_kits(p_lines jsonb) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(x), '[]') FROM (
    SELECT l - 'item_id' - 'qty' || jsonb_build_object('item_id', c.component_item_id, 'qty', (l->>'qty')::numeric * c.qty,
             'notes', concat_ws(' — ', NULLIF(l->>'notes', ''), 'kit ' || k.item_code)) x
      FROM jsonb_array_elements(COALESCE(p_lines, '[]')) l
      JOIN items k ON k.id = (l->>'item_id')::uuid AND k.is_kit
      JOIN item_kit_components c ON c.kit_item_id = k.id AND NOT c.is_archived
    UNION ALL
    SELECT l FROM jsonb_array_elements(COALESCE(p_lines, '[]')) l
     WHERE NOT EXISTS (SELECT 1 FROM items k WHERE k.id = (l->>'item_id')::uuid AND k.is_kit)
  ) q;
$$;

DO $$ DECLARE d text; BEGIN
  d := pg_get_functiondef('inv_issue(jsonb)'::regprocedure);
  IF position('_inv_expand_kits' in d) = 0 THEN
    d := replace(d, 'FOR _l IN SELECT * FROM jsonb_array_elements(COALESCE(p->''lines'', ''[]'')) LOOP',
                    'FOR _l IN SELECT * FROM jsonb_array_elements(_inv_expand_kits(p->''lines'')) LOOP');
    EXECUTE d;
  END IF;
  d := pg_get_functiondef('inv_dispatch(jsonb)'::regprocedure);
  IF position('_inv_expand_kits' in d) = 0 THEN
    d := replace(d, 'FOR _l IN SELECT * FROM jsonb_array_elements(COALESCE(p->''lines'', ''[]'')) LOOP',
                    'FOR _l IN SELECT * FROM jsonb_array_elements(_inv_expand_kits(p->''lines'')) LOOP');
    EXECUTE d;
  END IF;
END $$;

-- ── FEFO ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_inventory_movement_batch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE _b inventory_batches%ROWTYPE; _rest inventory_movements%ROWTYPE;
BEGIN
  IF NULLIF(TRIM(NEW.batch_no), '') IS NULL THEN
    -- First expiry, first out: an outgoing move with no batch uses the batch that expires first.
    IF NEW.quantity < 0 AND NEW.movement_type IN ('issue','transfer_out','adjustment','stock_take') THEN
      SELECT * INTO _b FROM inventory_batches WHERE item_id = NEW.item_id AND warehouse_id = NEW.warehouse_id AND qty_remaining > 0 AND NOT is_archived
       ORDER BY expiry_date NULLS LAST, first_received, batch_no LIMIT 1 FOR UPDATE;
      IF FOUND THEN
        IF _b.qty_remaining < -NEW.quantity THEN
          -- This batch is too small: take all of it here (empty it first), and the rest on a new line (which picks the next batch).
          UPDATE inventory_batches SET qty_remaining = 0 WHERE id = _b.id;
          _rest := NEW;
          _rest.id := gen_random_uuid();
          _rest.quantity := NEW.quantity + _b.qty_remaining;
          _rest.batch_no := NULL; _rest.batch_id := NULL; _rest.value := NULL; _rest.unit_cost := NEW.unit_cost;
          PERFORM set_config('inv.split_child', '1', true);
          INSERT INTO inventory_movements SELECT (_rest).*;
          PERFORM set_config('inv.split_child', '', true);
          NEW.quantity := -_b.qty_remaining;
        ELSE
          UPDATE inventory_batches SET qty_remaining = qty_remaining + NEW.quantity WHERE id = _b.id;
        END IF;
        NEW.batch_no := _b.batch_no; NEW.batch_id := _b.id; NEW.expiry_date := _b.expiry_date;
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  NEW.batch_no := TRIM(NEW.batch_no);
  IF NEW.quantity > 0 THEN
    INSERT INTO inventory_batches (item_id, warehouse_id, batch_no, expiry_date, qty_received, qty_remaining)
    VALUES (NEW.item_id, NEW.warehouse_id, NEW.batch_no, NEW.expiry_date, NEW.quantity, NEW.quantity)
    ON CONFLICT (item_id, warehouse_id, batch_no) DO UPDATE
      SET qty_received = inventory_batches.qty_received + EXCLUDED.qty_received,
          qty_remaining = inventory_batches.qty_remaining + EXCLUDED.qty_remaining,
          expiry_date = COALESCE(EXCLUDED.expiry_date, inventory_batches.expiry_date)
    RETURNING * INTO _b;
  ELSE
    SELECT * INTO _b FROM inventory_batches WHERE item_id = NEW.item_id AND warehouse_id = NEW.warehouse_id AND batch_no = NEW.batch_no FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Batch % not found for this item in this warehouse', NEW.batch_no; END IF;
    IF _b.qty_remaining + NEW.quantity < 0 THEN RAISE EXCEPTION 'Only % left in batch %', _b.qty_remaining, NEW.batch_no; END IF;
    UPDATE inventory_batches SET qty_remaining = qty_remaining + NEW.quantity WHERE id = _b.id;
  END IF;
  NEW.batch_id := _b.id;
  NEW.expiry_date := COALESCE(NEW.expiry_date, _b.expiry_date);
  RETURN NEW;
END;
$function$;

-- The split-off line must not use up the reservation a second time.
DO $$ DECLARE d text; BEGIN
  d := pg_get_functiondef('trg_inv_reservation_guard()'::regprocedure);
  IF position('inv.split_child' in d) = 0 THEN
    d := replace(d, 'IF NEW.movement_type NOT IN (''issue'',''transfer_out'') OR NEW.quantity >= 0 THEN RETURN NEW; END IF;',
      'IF NEW.movement_type NOT IN (''issue'',''transfer_out'') OR NEW.quantity >= 0 OR current_setting(''inv.split_child'', true) = ''1'' THEN RETURN NEW; END IF;');
    EXECUTE d;
  END IF;
END $$;

-- ── Return condition ──────────────────────────────────────────────────────────
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS condition text CHECK (condition IN ('good','damaged','scrap'));
CREATE OR REPLACE FUNCTION public.inv_return(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _wh warehouses%ROWTYPE; _no text; _l jsonb; _n int := 0; _val numeric := 0; _lost numeric := 0; _mv inventory_movements%ROWTYPE; _cond text;
BEGIN
  SELECT * INTO _wh FROM warehouses WHERE id = (p->>'warehouse_id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Choose the store to return into'; END IF;
  IF NOT _has_permission('inventory.create', _wh.site_id) THEN RAISE EXCEPTION 'You cannot take returns into %', _wh.name; END IF;
  _no := doc_next_number(_wh.site_id, 'RET');
  FOR _l IN SELECT * FROM jsonb_array_elements(_inv_expand_kits(p->'lines')) LOOP
    CONTINUE WHEN COALESCE((_l->>'qty')::numeric, 0) <= 0;
    _cond := COALESCE(NULLIF(_l->>'condition', ''), NULLIF(p->>'condition', ''), 'good');
    IF _cond NOT IN ('good','damaged','scrap') THEN RAISE EXCEPTION 'Condition must be good, damaged or scrap'; END IF;
    INSERT INTO inventory_movements (item_id, warehouse_id, movement_type, quantity, voucher_type, voucher_no, source_module, source_reference_id,
      issued_to_employee_id, issued_to_contractor_id, department_id, cost_centre_id, project_id, batch_no, reason, notes, created_by, condition)
    VALUES ((_l->>'item_id')::uuid, _wh.id, 'return', (_l->>'qty')::numeric, 'RETURN', _no, COALESCE(NULLIF(p->>'source', ''), 'inventory'), NULLIF(p->>'work_order_id', '')::uuid,
      NULLIF(p->>'employee_id', '')::uuid, NULLIF(p->>'contractor_id', '')::uuid, NULLIF(p->>'department_id', '')::uuid,
      NULLIF(p->>'cost_centre_id', '')::uuid, NULLIF(p->>'project_id', '')::uuid, NULLIF(trim(_l->>'batch_no'), ''),
      NULLIF(p->>'reason', ''), NULLIF(p->>'notes', ''), auth.uid(), _cond)
    RETURNING * INTO _mv;
    _n := _n + 1; _val := _val + abs(_mv.value);
    IF _cond <> 'good' THEN
      -- Came back unusable: credit the department (above), then write it off here as a loss.
      INSERT INTO inventory_movements (item_id, warehouse_id, movement_type, quantity, voucher_type, voucher_no, source_module, batch_no, reason, notes, created_by, condition)
      VALUES (_mv.item_id, _wh.id, 'adjustment', -_mv.quantity, 'RETURN', _no, 'inventory', _mv.batch_no, 'returned ' || _cond,
              'Returned ' || _cond || ' on ' || _no, auth.uid(), _cond);
      _lost := _lost + abs(_mv.value);
    END IF;
  END LOOP;
  IF _n = 0 THEN RAISE EXCEPTION 'Enter a quantity on at least one line'; END IF;
  RETURN jsonb_build_object('voucher', _no, 'lines', _n, 'value', round(_val, 2), 'written_off', round(_lost, 2));
END $$;

-- ── Stock health reports ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.inv_report(p_kind text, p_site_ids uuid[], p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _s uuid[]; _from date := COALESCE(p_from, current_date - 90); _to date := COALESCE(p_to, current_date); _rows jsonb;
BEGIN
  SELECT array_agg(x) INTO _s FROM unnest(p_site_ids) x WHERE _has_permission('inventory.view', x) OR _has_permission('procurement.view', x);
  IF _s IS NULL THEN RETURN jsonb_build_object('error', 'No stores access at these sites'); END IF;

  IF p_kind = 'ageing' THEN
    -- Age = days since this store last took the item in.
    SELECT COALESCE(jsonb_agg(x ORDER BY x.age_days DESC NULLS FIRST), '[]') INTO _rows FROM (
      SELECT i.item_code, i.description, w.name store, s.name site, b.on_hand_qty on_hand, round(b.stock_value, 2) value, lr.last_in,
             (current_date - lr.last_in::date) age_days,
             CASE WHEN lr.last_in IS NULL THEN 'unknown' WHEN current_date - lr.last_in::date <= 90 THEN '0–90 days'
                  WHEN current_date - lr.last_in::date <= 180 THEN '91–180 days' WHEN current_date - lr.last_in::date <= 365 THEN '181–365 days'
                  ELSE 'over a year' END bucket
        FROM stock_balances b JOIN items i ON i.id = b.item_id JOIN warehouses w ON w.id = b.warehouse_id JOIN sites s ON s.id = w.site_id
        LEFT JOIN LATERAL (SELECT max(m.created_at) last_in FROM inventory_movements m WHERE m.item_id = b.item_id AND m.warehouse_id = b.warehouse_id
                             AND m.quantity > 0 AND m.movement_type IN ('grn','opening','transfer_in','adjustment','return')) lr ON true
       WHERE w.site_id = ANY (_s) AND b.on_hand_qty > 0) x;

  ELSIF p_kind = 'dead' THEN
    -- Holding stock but nothing has gone out since the "from" date.
    SELECT COALESCE(jsonb_agg(x ORDER BY x.value DESC), '[]') INTO _rows FROM (
      SELECT i.item_code, i.description, w.name store, s.name site, b.on_hand_qty on_hand, round(b.stock_value, 2) value, lo.last_out,
             (current_date - COALESCE(lo.last_out, li.first_in)::date) idle_days
        FROM stock_balances b JOIN items i ON i.id = b.item_id JOIN warehouses w ON w.id = b.warehouse_id JOIN sites s ON s.id = w.site_id
        LEFT JOIN LATERAL (SELECT max(created_at) last_out FROM inventory_movements m WHERE m.item_id = b.item_id AND m.warehouse_id = b.warehouse_id AND m.quantity < 0) lo ON true
        LEFT JOIN LATERAL (SELECT min(created_at) first_in FROM inventory_movements m WHERE m.item_id = b.item_id AND m.warehouse_id = b.warehouse_id AND m.quantity > 0) li ON true
       WHERE w.site_id = ANY (_s) AND b.on_hand_qty > 0 AND COALESCE(lo.last_out, li.first_in, now()) < _from) x;

  ELSIF p_kind = 'abc' THEN
    SELECT COALESCE(jsonb_agg(x ORDER BY x.used_value DESC), '[]') INTO _rows FROM (
      SELECT item_code, description, used_qty, used_value, round(100 * share, 1) share_pct, round(100 * cum, 1) cum_pct,
             CASE WHEN cum - share < 0.7 THEN 'A' WHEN cum - share < 0.9 THEN 'B' ELSE 'C' END abc, on_hand_value FROM (
        SELECT i.item_code, i.description, u.q used_qty, round(u.v, 2) used_value,
               u.v / NULLIF(sum(u.v) OVER (), 0) share, sum(u.v) OVER (ORDER BY u.v DESC, i.id) / NULLIF(sum(u.v) OVER (), 0) cum,
               (SELECT round(COALESCE(sum(b.stock_value), 0), 2) FROM stock_balances b JOIN warehouses w ON w.id = b.warehouse_id WHERE b.item_id = i.id AND w.site_id = ANY (_s)) on_hand_value
          FROM (SELECT item_id, -sum(quantity) q, -sum(value) v FROM inventory_movements
                 WHERE site_id = ANY (_s) AND movement_type IN ('issue','return') AND created_at::date BETWEEN _from AND _to GROUP BY 1 HAVING -sum(value) > 0) u
          JOIN items i ON i.id = u.item_id) c) x;

  ELSIF p_kind = 'shrinkage' THEN
    -- Losses and gains that are not issues: counts, adjustments, short deliveries between stores, damaged returns.
    SELECT COALESCE(jsonb_agg(x ORDER BY x.date DESC), '[]') INTO _rows FROM (
      SELECT m.created_at::date date, w.name store, i.item_code, i.description, m.quantity qty, round(m.value, 2) value,
             COALESCE(m.reason, CASE m.movement_type WHEN 'stock_take' THEN 'count' ELSE 'adjustment' END) reason, m.voucher_no, pr.full_name by_whom
        FROM inventory_movements m JOIN items i ON i.id = m.item_id JOIN warehouses w ON w.id = m.warehouse_id LEFT JOIN profiles pr ON pr.id = m.created_by
       WHERE m.site_id = ANY (_s) AND m.movement_type IN ('adjustment','stock_take') AND m.created_at::date BETWEEN _from AND _to
         AND COALESCE(m.reason, '') NOT IN ('opening','donation','found','other')) x;

  ELSIF p_kind = 'usage' THEN
    SELECT COALESCE(jsonb_agg(x ORDER BY x.value DESC), '[]') INTO _rows FROM (
      SELECT COALESCE(d.name, CASE WHEN m.source_module = 'fleet' THEN 'Fleet work orders' END, e.name, 'Not stated') used_by,
             COALESCE(wo.work_order_number, '') work_order, COALESCE(cc.name, '') cost_centre, i.item_code, i.description,
             -sum(m.quantity) qty, round(-sum(m.value), 2) value
        FROM inventory_movements m JOIN items i ON i.id = m.item_id
        LEFT JOIN departments d ON d.id = m.department_id LEFT JOIN employees e ON e.id = m.issued_to_employee_id
        LEFT JOIN fleet_work_orders wo ON wo.id = m.source_reference_id LEFT JOIN cost_centres cc ON cc.id = m.cost_centre_id
       WHERE m.site_id = ANY (_s) AND m.movement_type IN ('issue','return') AND m.created_at::date BETWEEN _from AND _to
       GROUP BY 1, 2, 3, 4, 5 HAVING -sum(m.value) <> 0) x;

  ELSIF p_kind = 'counts' THEN
    SELECT COALESCE(jsonb_agg(x ORDER BY x.completed DESC), '[]') INTO _rows FROM (
      SELECT t.reference, w.name store, t.completed_at::date completed, t.counted_value, t.variance_value,
             CASE WHEN t.counted_value > 0 THEN round(100 * (1 - abs(COALESCE(t.variance_value, 0)) / t.counted_value), 1) END accuracy_pct,
             (SELECT count(*) FROM stock_take_lines l WHERE l.stock_take_id = t.id AND COALESCE(l.variance, 0) <> 0) lines_off
        FROM stock_takes t JOIN warehouses w ON w.id = t.warehouse_id
       WHERE w.site_id = ANY (_s) AND t.status = 'completed' AND t.completed_at::date BETWEEN _from AND _to) x;
  ELSE
    RETURN jsonb_build_object('error', 'Unknown report');
  END IF;
  RETURN jsonb_build_object('kind', p_kind, 'from', _from, 'to', _to, 'rows', _rows);
END $$;

REVOKE ALL ON FUNCTION inv_report(text, uuid[], date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION inv_report(text, uuid[], date, date) TO authenticated;

INSERT INTO schema_migrations (filename) VALUES ('0236_inventory_i5_health_fefo_kits.sql') ON CONFLICT DO NOTHING;
