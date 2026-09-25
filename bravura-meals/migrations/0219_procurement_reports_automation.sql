-- 0219 procurement_reports_automation — Procurement rewrite P7 (#57).
--   • POs carry the fleet work order they're for (from the request), so outside repairs and parts show
--     against the vehicle.
--   • Stores shortages → draft POs, grouped by preferred / price-list supplier (always reviewed by a person).
--   • Paper trail for a PO: requests → PO → receipts → bills → payment runs → tracking.
--   • proc_report(kind, sites, from, to): the ERPNext-style procurement reports.

ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS work_order_id uuid REFERENCES fleet_work_orders(id);
CREATE INDEX IF NOT EXISTS purchase_orders_wo ON purchase_orders (work_order_id) WHERE work_order_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.trg_po_line_work_order() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.requisition_line_id IS NOT NULL THEN
    UPDATE purchase_orders po SET work_order_id = r.work_order_id, project_id = COALESCE(po.project_id, r.project_id)
      FROM requisition_lines rl JOIN purchase_requisitions r ON r.id = rl.requisition_id
     WHERE rl.id = NEW.requisition_line_id AND po.id = NEW.po_id AND po.work_order_id IS NULL AND r.work_order_id IS NOT NULL
       AND po.status IN ('draft','rfq','rfq_sent');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_po_line_work_order ON po_lines;
CREATE TRIGGER trg_po_line_work_order AFTER INSERT ON po_lines FOR EACH ROW EXECUTE FUNCTION trg_po_line_work_order();

-- Work order ↔ PO for editable orders (the header lock covers ordered ones).
CREATE OR REPLACE FUNCTION public.proc_po_set_work_order(p_po uuid, p_wo uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _po purchase_orders%ROWTYPE;
BEGIN
  SELECT * INTO _po FROM purchase_orders WHERE id = p_po;
  IF NOT _proc_can('edit', _po.site_id) AND NOT _proc_can('create', _po.site_id) THEN RAISE EXCEPTION 'No access'; END IF;
  IF p_wo IS NOT NULL AND NOT EXISTS (SELECT 1 FROM fleet_work_orders WHERE id = p_wo AND site_id = _po.site_id) THEN RAISE EXCEPTION 'Work order is at another site'; END IF;
  UPDATE purchase_orders SET work_order_id = p_wo, updated_at = now() WHERE id = p_po;
END $$;

-- Stores shortages → draft POs. One draft per supplier (preferred supplier, else the cheapest valid
-- price-list supplier); items with no known supplier go on one draft with no supplier yet.
CREATE OR REPLACE FUNCTION public.proc_po_from_reorder(p_site uuid, p_item_ids uuid[] DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r record; _po uuid; _ids uuid[] := '{}'; _sup uuid; _cur uuid := '00000000-0000-0000-0000-000000000000'; _n int := 0;
BEGIN
  IF NOT _proc_can('create', p_site) THEN RAISE EXCEPTION 'You cannot raise purchase orders for this site'; END IF;
  FOR _r IN
    SELECT s.*, COALESCE(s.preferred_supplier_id,
             (SELECT sp.supplier_id FROM supplier_prices sp WHERE sp.item_id = s.item_id AND NOT sp.is_archived
                 AND CURRENT_DATE BETWEEN COALESCE(sp.valid_from, CURRENT_DATE) AND COALESCE(sp.valid_to, CURRENT_DATE)
               ORDER BY sp.price LIMIT 1)) AS sup
      FROM inv_reorder_suggestions(p_site) s
     WHERE s.suggested_qty > 0 AND (p_item_ids IS NULL OR s.item_id = ANY(p_item_ids))
       AND NOT EXISTS (SELECT 1 FROM po_lines pl JOIN purchase_orders po ON po.id = pl.po_id
                        WHERE pl.item_id = s.item_id AND po.site_id = p_site AND NOT pl.is_archived AND po.status IN ('draft','rfq','rfq_sent'))
     ORDER BY sup NULLS LAST
  LOOP
    _sup := _r.sup;
    IF COALESCE(_sup, '00000000-0000-0000-0000-000000000001') IS DISTINCT FROM _cur THEN
      INSERT INTO purchase_orders (po_number, site_id, supplier_id, warehouse_id, status, total_amount, created_by, notes)
      VALUES ('', p_site, _sup, _r.warehouse_id, 'draft', 0, auth.uid(), 'Raised from stores reorder levels')
      RETURNING id INTO _po;
      _ids := _ids || _po;
      _cur := COALESCE(_sup, '00000000-0000-0000-0000-000000000001');
    END IF;
    INSERT INTO po_lines (po_id, item_id, quantity, unit_cost)
    VALUES (_po, _r.item_id, _r.suggested_qty, COALESCE(_po_last_price(_r.item_id, _sup), _r.unit_cost, 0));
    _n := _n + 1;
  END LOOP;
  IF _n = 0 THEN RAISE EXCEPTION 'Nothing is below its reorder level (or it is already on a draft order)'; END IF;
  FOREACH _po IN ARRAY _ids LOOP PERFORM _po_recalc(_po); END LOOP;
  RETURN jsonb_build_object('po_ids', _ids, 'lines', _n);
END $$;

-- Everything connected to one PO.
CREATE OR REPLACE FUNCTION public.proc_po_trail(p_po uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _po purchase_orders%ROWTYPE;
BEGIN
  SELECT * INTO _po FROM purchase_orders WHERE id = p_po;
  IF NOT FOUND OR NOT _proc_can('view', _po.site_id) THEN RAISE EXCEPTION 'No access'; END IF;
  RETURN jsonb_build_object(
    'requests', COALESCE((SELECT jsonb_agg(DISTINCT jsonb_build_object('no', r.requisition_no, 'title', r.title, 'status', r.status, 'by', p.full_name))
        FROM po_lines pl JOIN requisition_lines rl ON rl.id = pl.requisition_line_id JOIN purchase_requisitions r ON r.id = rl.requisition_id
        LEFT JOIN profiles p ON p.id = r.requested_by WHERE pl.po_id = p_po), '[]'::jsonb),
    'work_order', (SELECT jsonb_build_object('no', w.work_order_number, 'fault', w.fault_description, 'asset', fa.fleet_number)
        FROM fleet_work_orders w LEFT JOIN fleet_assets fa ON fa.id = w.asset_id WHERE w.id = _po.work_order_id),
    'receipts', COALESCE((SELECT jsonb_agg(jsonb_build_object('no', g.grn_number, 'date', g.received_date, 'status', g.status, 'ref', g.delivery_note_ref) ORDER BY g.received_date)
        FROM goods_received_notes g WHERE g.po_id = p_po), '[]'::jsonb),
    'bills', COALESCE((SELECT jsonb_agg(jsonb_build_object('no', i.invoice_number, 'date', i.invoice_date, 'status', i.status, 'amount', i.total_amount,
          'match', i.match_status, 'run', r.run_number, 'paid_at', i.paid_at) ORDER BY i.invoice_date)
        FROM purchase_invoices i LEFT JOIN ap_payment_runs r ON r.id = i.payment_run_id WHERE i.po_id = p_po), '[]'::jsonb),
    'events', COALESCE((SELECT jsonb_agg(jsonb_build_object('type', e.event_type, 'notes', e.notes, 'at', e.created_at) ORDER BY e.created_at)
        FROM po_tracking_events e WHERE e.po_id = p_po), '[]'::jsonb));
END $$;

-- Procurement reports. Returns {columns:[...], rows:[[...]]} so one screen can show and export any of them.
CREATE OR REPLACE FUNCTION public.proc_report(p_kind text, p_site_ids uuid[], p_from date, p_to date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _s uuid[];
BEGIN
  SELECT array_agg(x) INTO _s FROM unnest(p_site_ids) x WHERE _proc_can('view', x);
  IF _s IS NULL THEN RAISE EXCEPTION 'No access'; END IF;
  IF p_kind = 'not_ordered' THEN
    RETURN jsonb_build_object('columns', jsonb_build_array('Request','Site','What','Qty wanted','Qty ordered','Needed by','Status','Asked by'),
      'rows', COALESCE((SELECT jsonb_agg(jsonb_build_array(r.requisition_no, s.name, COALESCE(i.description, l.description), l.quantity, l.ordered_qty, r.needed_by, r.status, p.full_name) ORDER BY r.needed_by NULLS LAST)
        FROM requisition_lines l JOIN purchase_requisitions r ON r.id = l.requisition_id JOIN sites s ON s.id = r.site_id LEFT JOIN items i ON i.id = l.item_id LEFT JOIN profiles p ON p.id = r.requested_by
       WHERE r.site_id = ANY(_s) AND NOT l.is_archived AND r.status IN ('submitted','approved') AND r.request_type = 'buy' AND l.ordered_qty < l.quantity
         AND r.created_at::date BETWEEN p_from AND p_to), '[]'::jsonb));
  ELSIF p_kind = 'not_received' THEN
    RETURN jsonb_build_object('columns', jsonb_build_array('PO','Site','Supplier','What','Ordered','Received','Due','Days late','Confirmed'),
      'rows', COALESCE((SELECT jsonb_agg(jsonb_build_array(po.po_number, s.name, ps.supplier_name, COALESCE(i.description, pl.description), pl.quantity, pl.received_qty,
            COALESCE(pl.promised_date, po.expected_date), GREATEST(CURRENT_DATE - COALESCE(pl.promised_date, po.expected_date), 0), po.acknowledged_at IS NOT NULL) ORDER BY COALESCE(pl.promised_date, po.expected_date) NULLS LAST)
        FROM po_lines pl JOIN purchase_orders po ON po.id = pl.po_id JOIN sites s ON s.id = po.site_id LEFT JOIN procurement_suppliers ps ON ps.id = po.supplier_id LEFT JOIN items i ON i.id = pl.item_id
       WHERE po.site_id = ANY(_s) AND NOT pl.is_archived AND po.status IN ('sent','partially_received') AND pl.received_qty < pl.quantity
         AND COALESCE(po.order_date, po.created_at::date) BETWEEN p_from AND p_to), '[]'::jsonb));
  ELSIF p_kind = 'tracker' THEN
    RETURN jsonb_build_object('columns', jsonb_build_array('Request','PO','Site','Supplier','PO status','Ordered $','Received','Billed $','Paid $','Days request→order'),
      'rows', COALESCE((SELECT jsonb_agg(jsonb_build_array(
            (SELECT string_agg(DISTINCT r.requisition_no, ', ') FROM po_lines pl JOIN requisition_lines rl ON rl.id = pl.requisition_line_id JOIN purchase_requisitions r ON r.id = rl.requisition_id WHERE pl.po_id = po.id),
            po.po_number, s.name, ps.supplier_name, po.status, po.total_amount,
            (SELECT CASE WHEN sum(quantity) > 0 THEN round(sum(received_qty) / sum(quantity) * 100) || '%' END FROM po_lines WHERE po_id = po.id AND NOT is_archived),
            (SELECT COALESCE(sum(total_amount), 0) FROM purchase_invoices WHERE po_id = po.id AND status NOT IN ('cancelled','rejected','draft')),
            (SELECT COALESCE(sum(total_amount), 0) FROM purchase_invoices WHERE po_id = po.id AND status = 'paid'),
            (SELECT COALESCE(po.order_date, po.created_at::date) - min(r.created_at::date) FROM po_lines pl JOIN requisition_lines rl ON rl.id = pl.requisition_line_id JOIN purchase_requisitions r ON r.id = rl.requisition_id WHERE pl.po_id = po.id))
          ORDER BY po.created_at DESC)
        FROM purchase_orders po JOIN sites s ON s.id = po.site_id LEFT JOIN procurement_suppliers ps ON ps.id = po.supplier_id
       WHERE po.site_id = ANY(_s) AND po.status NOT IN ('rfq','rfq_sent','cancelled') AND COALESCE(po.order_date, po.created_at::date) BETWEEN p_from AND p_to), '[]'::jsonb));
  ELSIF p_kind = 'item_history' THEN
    RETURN jsonb_build_object('columns', jsonb_build_array('Item','Times bought','Qty','Spend $','Lowest price','Highest price','Last price','Last supplier','Last bought'),
      'rows', COALESCE((SELECT jsonb_agg(x ORDER BY (x->>3)::numeric DESC) FROM (
          SELECT jsonb_build_array(COALESCE(i.item_code || ' ' || i.description, pl.description), count(*), sum(pl.quantity), round(sum(pl.quantity * pl.unit_cost), 2),
            min(pl.unit_cost), max(pl.unit_cost),
            (array_agg(pl.unit_cost ORDER BY COALESCE(po.order_date, po.created_at::date) DESC))[1],
            (array_agg(ps.supplier_name ORDER BY COALESCE(po.order_date, po.created_at::date) DESC))[1],
            max(COALESCE(po.order_date, po.created_at::date))) x
            FROM po_lines pl JOIN purchase_orders po ON po.id = pl.po_id LEFT JOIN items i ON i.id = pl.item_id LEFT JOIN procurement_suppliers ps ON ps.id = po.supplier_id
           WHERE po.site_id = ANY(_s) AND NOT pl.is_archived AND po.status IN ('sent','partially_received','received') AND COALESCE(po.order_date, po.created_at::date) BETWEEN p_from AND p_to
           GROUP BY COALESCE(i.item_code || ' ' || i.description, pl.description)) q), '[]'::jsonb));
  ELSIF p_kind IN ('by_supplier','by_site','by_category') THEN
    RETURN jsonb_build_object('columns', jsonb_build_array(CASE p_kind WHEN 'by_supplier' THEN 'Supplier' WHEN 'by_site' THEN 'Site' ELSE 'Category' END, 'Orders', 'Ordered $', 'Received $', 'Share'),
      'rows', COALESCE((SELECT jsonb_agg(jsonb_build_array(k, n, v, rv, round(v / NULLIF(tot, 0) * 100, 1) || '%') ORDER BY v DESC) FROM (
          SELECT k, n, v, rv, sum(v) OVER () tot FROM (
          SELECT CASE p_kind WHEN 'by_supplier' THEN COALESCE(ps.supplier_name, '(none)') WHEN 'by_site' THEN s.name ELSE COALESCE(c.name, CASE WHEN pl.item_id IS NULL THEN 'Services' ELSE '(no category)' END) END k,
                 count(DISTINCT po.id) n, round(sum(pl.quantity * pl.unit_cost), 2) v, round(sum(pl.received_qty * pl.unit_cost), 2) rv
            FROM po_lines pl JOIN purchase_orders po ON po.id = pl.po_id JOIN sites s ON s.id = po.site_id LEFT JOIN procurement_suppliers ps ON ps.id = po.supplier_id
            LEFT JOIN items i ON i.id = pl.item_id LEFT JOIN item_categories c ON c.id = i.category_id
           WHERE po.site_id = ANY(_s) AND NOT pl.is_archived AND po.status IN ('sent','partially_received','received') AND COALESCE(po.order_date, po.created_at::date) BETWEEN p_from AND p_to
           GROUP BY 1) a) q), '[]'::jsonb));
  ELSIF p_kind = 'on_time' THEN
    RETURN jsonb_build_object('columns', jsonb_build_array('Supplier','Deliveries','On time','On-time %','Avg days late','Confirmed orders %'),
      'rows', COALESCE((SELECT jsonb_agg(jsonb_build_array(name, n, ok, round(ok::numeric / NULLIF(n, 0) * 100) || '%', late, round(ack::numeric / NULLIF(o, 0) * 100) || '%') ORDER BY n DESC) FROM (
          SELECT ps.supplier_name name,
                 count(*) FILTER (WHERE g.first IS NOT NULL AND po.expected_date IS NOT NULL) n,
                 count(*) FILTER (WHERE g.first <= po.expected_date) ok,
                 round(avg(GREATEST(g.first - po.expected_date, 0)) FILTER (WHERE g.first IS NOT NULL AND po.expected_date IS NOT NULL), 1) late,
                 count(*) FILTER (WHERE po.acknowledged_at IS NOT NULL) ack, count(*) o
            FROM purchase_orders po JOIN procurement_suppliers ps ON ps.id = po.supplier_id
            LEFT JOIN LATERAL (SELECT min(received_date) first FROM goods_received_notes WHERE po_id = po.id AND status IN ('accepted','accepted_partial')) g ON true
           WHERE po.site_id = ANY(_s) AND po.status IN ('sent','partially_received','received') AND COALESCE(po.order_date, po.created_at::date) BETWEEN p_from AND p_to
           GROUP BY ps.supplier_name) q), '[]'::jsonb));
  END IF;
  RAISE EXCEPTION 'Unknown report';
END $$;

REVOKE ALL ON FUNCTION proc_po_set_work_order(uuid, uuid), proc_po_from_reorder(uuid, uuid[]), proc_po_trail(uuid), proc_report(text, uuid[], date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION proc_po_set_work_order(uuid, uuid), proc_po_from_reorder(uuid, uuid[]), proc_po_trail(uuid), proc_report(text, uuid[], date, date) TO authenticated;

INSERT INTO schema_migrations (filename) VALUES ('0219_procurement_reports_automation.sql') ON CONFLICT DO NOTHING;
