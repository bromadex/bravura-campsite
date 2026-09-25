-- 0216 receiving_suppliers_agreements — Procurement rewrite P4 (#54) + P5 (#55).
-- P4: supplier confirmation link (no login: token, 30 days), promised delivery dates per line, daily
--     reminders / late / not-acknowledged notifications (pg_cron), "Not acknowledged" on Procurement Home.
-- P5: supplier hold (all / bills / payments, enforced server-side), supplier price list (used first when
--     pricing POs), supplier scorecard (on-time rate, lead time, rejects, spend), agreements: blanket orders
--     (agreed prices + quantities for a period, drawn down by POs) and purchase templates (standard lists).

-- ── P4: acknowledgement ─────────────────────────────────────────────────────────
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS ack_by_name text;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS ack_note text;
ALTER TABLE po_lines ADD COLUMN IF NOT EXISTS promised_date date;
ALTER TABLE procurement_suppliers ADD COLUMN IF NOT EXISTS reminder_days int NOT NULL DEFAULT 2;

CREATE TABLE IF NOT EXISTS po_ack_links (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id           uuid NOT NULL REFERENCES purchase_orders(id),
  token           text NOT NULL UNIQUE,
  created_by      uuid REFERENCES profiles(id) DEFAULT auth.uid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL DEFAULT now() + interval '30 days',
  opened_at       timestamptz,
  acknowledged_at timestamptz,
  revoked         boolean NOT NULL DEFAULT false
);
ALTER TABLE po_ack_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pal_select ON po_ack_links;
CREATE POLICY pal_select ON po_ack_links FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM purchase_orders po WHERE po.id = po_id AND _proc_can('view', po.site_id)));

-- Everyone holding a permission at a site (for notifications).
CREATE OR REPLACE FUNCTION public._users_with_permission(p_code text, p_site uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT ur.user_id FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id
   WHERE p.code = p_code AND COALESCE(ur.is_active, true) AND (ur.site_id IS NULL OR ur.site_id = p_site);
$$;

CREATE OR REPLACE FUNCTION public._proc_notify(p_site uuid, p_type text, p_title text, p_message text, p_link text) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n int;
BEGIN
  INSERT INTO notifications (site_id, user_id, type, title, message, link, category)
  SELECT p_site, u, p_type, p_title, p_message, p_link, 'reminder'
    FROM (SELECT _users_with_permission('procurement.edit', p_site) u) x
   WHERE NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = x.u AND n.type = p_type AND n.link = p_link AND n.title = p_title
                       AND n.created_at::date = CURRENT_DATE);
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END $$;

CREATE OR REPLACE FUNCTION public.proc_po_ack_link(p_po uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _po purchase_orders%ROWTYPE; _t text;
BEGIN
  SELECT * INTO _po FROM purchase_orders WHERE id = p_po;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF NOT _proc_can('create', _po.site_id) AND NOT _proc_can('edit', _po.site_id) THEN RAISE EXCEPTION 'No access'; END IF;
  IF _po.status NOT IN ('sent','partially_received') THEN RAISE EXCEPTION 'Only an ordered PO can be sent for the supplier to confirm'; END IF;
  UPDATE po_ack_links SET revoked = true WHERE po_id = p_po AND NOT revoked;
  _t := encode(extensions.gen_random_bytes(24), 'hex');
  INSERT INTO po_ack_links (po_id, token) VALUES (p_po, _t);
  INSERT INTO po_tracking_events (po_id, event_type, notes, created_by) VALUES (p_po, 'sent_to_supplier', 'Confirmation link created', auth.uid());
  RETURN _t;
END $$;

-- Supplier side (no login). Only what the supplier needs to see: their order, lines and dates.
CREATE OR REPLACE FUNCTION public.proc_po_ack_get(p_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _l po_ack_links%ROWTYPE; _po purchase_orders%ROWTYPE;
BEGIN
  SELECT * INTO _l FROM po_ack_links WHERE token = p_token;
  IF NOT FOUND OR _l.revoked OR _l.expires_at < now() THEN RETURN jsonb_build_object('error', 'This link has expired or been replaced. Ask Bravura for a new one.'); END IF;
  SELECT * INTO _po FROM purchase_orders WHERE id = _l.po_id;
  IF _po.status = 'cancelled' THEN RETURN jsonb_build_object('error', 'This order has been cancelled.'); END IF;
  UPDATE po_ack_links SET opened_at = COALESCE(opened_at, now()) WHERE id = _l.id;
  RETURN jsonb_build_object(
    'po_number', _po.po_number, 'order_date', _po.order_date, 'expected_date', _po.expected_date, 'notes', _po.notes,
    'site', (SELECT name FROM sites WHERE id = _po.site_id), 'delivery_address', _po.delivery_address,
    'supplier', (SELECT supplier_name FROM procurement_suppliers WHERE id = _po.supplier_id),
    'total', _po.total_amount, 'acknowledged_at', _po.acknowledged_at, 'ack_by_name', _po.ack_by_name,
    'lines', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', l.id, 'what', COALESCE(i.item_code || ' — ' || i.description, l.description),
              'quantity', l.quantity, 'unit', l.unit, 'unit_cost', l.unit_cost, 'promised_date', l.promised_date) ORDER BY l.created_at)
             FROM po_lines l LEFT JOIN items i ON i.id = l.item_id WHERE l.po_id = _po.id AND NOT l.is_archived), '[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.proc_po_ack_submit(p_token text, p_name text, p_note text, p_dates jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _l po_ack_links%ROWTYPE; _po purchase_orders%ROWTYPE; _d jsonb; _max date;
BEGIN
  SELECT * INTO _l FROM po_ack_links WHERE token = p_token FOR UPDATE;
  IF NOT FOUND OR _l.revoked OR _l.expires_at < now() THEN RAISE EXCEPTION 'This link has expired or been replaced'; END IF;
  IF NULLIF(trim(p_name), '') IS NULL THEN RAISE EXCEPTION 'Please give your name'; END IF;
  SELECT * INTO _po FROM purchase_orders WHERE id = _l.po_id FOR UPDATE;
  IF _po.status NOT IN ('sent','partially_received') THEN RAISE EXCEPTION 'This order can no longer be confirmed'; END IF;
  FOR _d IN SELECT * FROM jsonb_array_elements(COALESCE(p_dates, '[]'::jsonb)) LOOP
    IF NULLIF(_d->>'date','') IS NOT NULL THEN
      UPDATE po_lines SET promised_date = (_d->>'date')::date WHERE id = (_d->>'line_id')::uuid AND po_id = _po.id;
    END IF;
  END LOOP;
  SELECT max(promised_date) INTO _max FROM po_lines WHERE po_id = _po.id AND NOT is_archived;
  UPDATE purchase_orders SET acknowledged_at = now(), ack_by_name = left(trim(p_name), 120), ack_note = left(NULLIF(trim(p_note), ''), 2000),
         expected_date = COALESCE(_max, expected_date), delivery_status = CASE WHEN delivery_status = 'pending' THEN 'ordered' ELSE delivery_status END,
         updated_at = now()
   WHERE id = _po.id;
  UPDATE po_ack_links SET acknowledged_at = now() WHERE id = _l.id;
  INSERT INTO po_tracking_events (po_id, event_type, notes) VALUES (_po.id, 'confirmed',
    'Supplier confirmed (' || left(trim(p_name), 120) || ')' || COALESCE(' — delivery by ' || to_char(_max, 'DD Mon YYYY'), '') || COALESCE(': ' || NULLIF(trim(p_note), ''), ''));
  PERFORM _proc_notify(_po.site_id, 'po_acknowledged', 'Supplier confirmed ' || _po.po_number,
    COALESCE((SELECT supplier_name FROM procurement_suppliers WHERE id = _po.supplier_id), 'The supplier') || ' confirmed the order'
      || COALESCE(', delivery by ' || to_char(_max, 'DD Mon'), '') || '.', '/procurement/proc_orders');
  RETURN jsonb_build_object('ok', true, 'delivery_by', _max);
END $$;

REVOKE ALL ON FUNCTION proc_po_ack_get(text), proc_po_ack_submit(text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION proc_po_ack_get(text), proc_po_ack_submit(text, text, text, jsonb) TO anon, authenticated;
REVOKE ALL ON FUNCTION proc_po_ack_link(uuid), _users_with_permission(text, uuid), _proc_notify(uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION proc_po_ack_link(uuid) TO authenticated;

-- Daily: deliveries due soon, late deliveries, and orders the supplier hasn't confirmed.
CREATE OR REPLACE FUNCTION public.proc_delivery_reminders() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r record; _n int := 0;
BEGIN
  FOR _r IN SELECT po.*, ps.supplier_name, ps.reminder_days FROM purchase_orders po LEFT JOIN procurement_suppliers ps ON ps.id = po.supplier_id
             WHERE po.status IN ('sent','partially_received') LOOP
    IF _r.expected_date IS NOT NULL AND _r.expected_date - COALESCE(_r.reminder_days, 2) = CURRENT_DATE THEN
      _n := _n + _proc_notify(_r.site_id, 'po_due', 'Delivery due ' || to_char(_r.expected_date, 'DD Mon') || ': ' || _r.po_number,
              COALESCE(_r.supplier_name, 'Supplier') || ' is due to deliver in ' || COALESCE(_r.reminder_days, 2) || ' days. Check with them.', '/procurement/proc_orders');
    ELSIF _r.expected_date IS NOT NULL AND _r.expected_date = CURRENT_DATE - 1 THEN
      _n := _n + _proc_notify(_r.site_id, 'po_late', 'Late delivery: ' || _r.po_number,
              COALESCE(_r.supplier_name, 'Supplier') || ' was due to deliver yesterday.', '/procurement/proc_orders');
    END IF;
    IF _r.acknowledged_at IS NULL AND _r.confirmed_at IS NOT NULL AND _r.confirmed_at::date = CURRENT_DATE - 2 THEN
      _n := _n + _proc_notify(_r.site_id, 'po_not_ack', 'Not confirmed by supplier: ' || _r.po_number,
              COALESCE(_r.supplier_name, 'The supplier') || ' hasn''t confirmed this order after 2 days. Send them the confirmation link or call.', '/procurement/proc_orders');
    END IF;
  END LOOP;
  RETURN _n;
END $$;
REVOKE ALL ON FUNCTION proc_delivery_reminders() FROM PUBLIC, anon, authenticated;

DO $$ BEGIN
  PERFORM cron.unschedule('procurement-reminders') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'procurement-reminders');
  PERFORM cron.schedule('procurement-reminders', '0 5 * * *', 'SELECT public.proc_delivery_reminders()');
END $$;

-- ── P5: supplier hold ───────────────────────────────────────────────────────────
ALTER TABLE procurement_suppliers ADD COLUMN IF NOT EXISTS hold_type text NOT NULL DEFAULT 'none';
ALTER TABLE procurement_suppliers ADD COLUMN IF NOT EXISTS hold_reason text;
ALTER TABLE procurement_suppliers ADD COLUMN IF NOT EXISTS hold_set_at timestamptz;
ALTER TABLE procurement_suppliers ADD COLUMN IF NOT EXISTS hold_set_by uuid REFERENCES profiles(id);
ALTER TABLE procurement_suppliers DROP CONSTRAINT IF EXISTS procurement_suppliers_hold_type_check;
ALTER TABLE procurement_suppliers ADD CONSTRAINT procurement_suppliers_hold_type_check CHECK (hold_type IN ('none','all','bills','payments'));

CREATE OR REPLACE FUNCTION public.proc_supplier_set_hold(p_supplier uuid, p_hold text, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _s procurement_suppliers%ROWTYPE;
BEGIN
  SELECT * INTO _s FROM procurement_suppliers WHERE id = p_supplier;
  IF NOT FOUND THEN RAISE EXCEPTION 'Supplier not found'; END IF;
  IF NOT (_has_permission('procurement.approve', _s.site_id) OR _has_permission('finance.approve', _s.site_id)) THEN
    RAISE EXCEPTION 'Only procurement or finance approvers can put a supplier on hold';
  END IF;
  IF p_hold <> 'none' AND NULLIF(trim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Give the reason for the hold'; END IF;
  UPDATE procurement_suppliers SET hold_type = p_hold, hold_reason = CASE WHEN p_hold = 'none' THEN NULL ELSE trim(p_reason) END,
         hold_set_at = now(), hold_set_by = auth.uid(), updated_at = now() WHERE id = p_supplier;
END $$;
REVOKE ALL ON FUNCTION proc_supplier_set_hold(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION proc_supplier_set_hold(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.trg_supplier_hold_po() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _h text; _why text; _name text;
BEGIN
  IF NEW.status IN ('pending_approval','sent') AND (TG_OP = 'INSERT' OR OLD.status IN ('draft','rfq','rfq_sent')) THEN
    SELECT hold_type, hold_reason, supplier_name INTO _h, _why, _name FROM procurement_suppliers WHERE id = NEW.supplier_id;
    IF _h = 'all' THEN RAISE EXCEPTION '% is on hold (%) — no new orders', _name, COALESCE(_why, 'no reason given'); END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_supplier_hold_po ON purchase_orders;
CREATE TRIGGER trg_supplier_hold_po BEFORE INSERT OR UPDATE OF status ON purchase_orders FOR EACH ROW EXECUTE FUNCTION trg_supplier_hold_po();

CREATE OR REPLACE FUNCTION public.trg_supplier_hold_bill() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _h text; _why text; _name text;
BEGIN
  SELECT hold_type, hold_reason, supplier_name INTO _h, _why, _name FROM procurement_suppliers WHERE id = NEW.supplier_id;
  IF _h IS NULL OR _h = 'none' THEN RETURN NEW; END IF;
  IF _h IN ('all','bills') AND NEW.status = 'approved' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'approved') AND (TG_OP = 'INSERT' OR OLD.status <> 'paid') THEN
    RAISE EXCEPTION '% is on hold for bills (%)', _name, COALESCE(_why, 'no reason given');
  END IF;
  IF _h IN ('all','payments') AND ((NEW.status = 'paid' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'paid'))
       OR (NEW.payment_run_id IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.payment_run_id IS NULL))) THEN
    RAISE EXCEPTION '% is on hold for payments (%)', _name, COALESCE(_why, 'no reason given');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_supplier_hold_bill ON purchase_invoices;
CREATE TRIGGER trg_supplier_hold_bill BEFORE INSERT OR UPDATE ON purchase_invoices FOR EACH ROW EXECUTE FUNCTION trg_supplier_hold_bill();

-- ── P5: supplier price list ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS supplier_prices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id        uuid NOT NULL REFERENCES sites(id),
  supplier_id    uuid NOT NULL REFERENCES procurement_suppliers(id),
  item_id        uuid REFERENCES items(id),
  description    text,
  unit           text,
  price          numeric(14,4) NOT NULL CHECK (price >= 0),
  min_qty        numeric NOT NULL DEFAULT 0,
  lead_time_days int,
  valid_from     date,
  valid_to       date,
  notes          text,
  is_archived    boolean NOT NULL DEFAULT false,
  created_by     uuid REFERENCES profiles(id) DEFAULT auth.uid(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (item_id IS NOT NULL OR NULLIF(trim(description), '') IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS supplier_prices_lookup ON supplier_prices (item_id, supplier_id) WHERE NOT is_archived;
ALTER TABLE supplier_prices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sp_select ON supplier_prices;
CREATE POLICY sp_select ON supplier_prices FOR SELECT TO authenticated USING (_proc_can('view', site_id));
DROP POLICY IF EXISTS sp_insert ON supplier_prices;
CREATE POLICY sp_insert ON supplier_prices FOR INSERT TO authenticated WITH CHECK (_has_permission('procurement.edit', site_id) OR _has_permission('procurement.create', site_id));
DROP POLICY IF EXISTS sp_update ON supplier_prices;
CREATE POLICY sp_update ON supplier_prices FOR UPDATE TO authenticated USING (_has_permission('procurement.edit', site_id)) WITH CHECK (_has_permission('procurement.edit', site_id));

-- Price for a new PO line: the supplier's valid price list first, then the last price paid.
CREATE OR REPLACE FUNCTION public._po_last_price(p_item uuid, p_supplier uuid) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT sp.price FROM supplier_prices sp WHERE sp.item_id = p_item AND sp.supplier_id = p_supplier AND NOT sp.is_archived
        AND CURRENT_DATE BETWEEN COALESCE(sp.valid_from, CURRENT_DATE) AND COALESCE(sp.valid_to, CURRENT_DATE)
      ORDER BY sp.valid_from DESC NULLS LAST, sp.created_at DESC LIMIT 1),
    (SELECT pl.unit_cost FROM po_lines pl JOIN purchase_orders po ON po.id = pl.po_id
      WHERE pl.item_id = p_item AND NOT pl.is_archived AND po.status IN ('sent','partially_received','received')
      ORDER BY (po.supplier_id = p_supplier) DESC NULLS LAST, COALESCE(po.order_date, po.created_at::date) DESC LIMIT 1));
$$;

-- ── P5: scorecard ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.proc_supplier_scorecard(p_supplier uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _s procurement_suppliers%ROWTYPE;
BEGIN
  SELECT * INTO _s FROM procurement_suppliers WHERE id = p_supplier;
  IF NOT FOUND OR NOT _proc_can('view', _s.site_id) THEN RAISE EXCEPTION 'No access'; END IF;
  RETURN (WITH pos AS (
      SELECT po.*, (SELECT min(g.received_date) FROM goods_received_notes g WHERE g.po_id = po.id AND g.status IN ('accepted','accepted_partial')) AS first_grn
        FROM purchase_orders po WHERE po.supplier_id = p_supplier AND po.status IN ('sent','partially_received','received')),
    gl AS (SELECT sum(gl.quantity_received) rec, sum(gl.quantity_rejected) rej FROM grn_lines gl JOIN goods_received_notes g ON g.id = gl.grn_id WHERE g.supplier_id = p_supplier)
    SELECT jsonb_build_object(
      'orders', (SELECT count(*) FROM pos),
      'open_orders', (SELECT count(*) FROM pos WHERE status IN ('sent','partially_received')),
      'spend_12m', (SELECT COALESCE(sum(total_amount), 0) FROM pos WHERE COALESCE(order_date, created_at::date) >= CURRENT_DATE - 365),
      'delivered', (SELECT count(*) FROM pos WHERE first_grn IS NOT NULL AND expected_date IS NOT NULL),
      'on_time', (SELECT count(*) FROM pos WHERE first_grn IS NOT NULL AND expected_date IS NOT NULL AND first_grn <= expected_date),
      'avg_lead_days', (SELECT round(avg(first_grn - COALESCE(order_date, created_at::date)), 1) FROM pos WHERE first_grn IS NOT NULL),
      'late_now', (SELECT count(*) FROM pos WHERE status IN ('sent','partially_received') AND expected_date < CURRENT_DATE),
      'reject_rate', (SELECT CASE WHEN COALESCE(rec, 0) > 0 THEN round(COALESCE(rej, 0) / rec * 100, 1) END FROM gl),
      'acknowledged', (SELECT count(*) FROM pos WHERE acknowledged_at IS NOT NULL),
      'last_order', (SELECT max(COALESCE(order_date, created_at::date)) FROM pos),
      'prices', (SELECT count(*) FROM supplier_prices WHERE supplier_id = p_supplier AND NOT is_archived),
      'owed', (SELECT COALESCE(sum(total_amount), 0) FROM purchase_invoices WHERE supplier_id = p_supplier AND status = 'approved')));
END $$;
REVOKE ALL ON FUNCTION proc_supplier_scorecard(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION proc_supplier_scorecard(uuid) TO authenticated;

-- ── P5: agreements ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS proc_agreements (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id        uuid NOT NULL REFERENCES sites(id),
  agreement_no   text,
  agreement_type text NOT NULL DEFAULT 'blanket' CHECK (agreement_type IN ('blanket','template')),
  supplier_id    uuid REFERENCES procurement_suppliers(id),
  title          text NOT NULL,
  valid_from     date,
  valid_to       date,
  status         text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','closed')),
  notes          text,
  is_archived    boolean NOT NULL DEFAULT false,
  created_by     uuid REFERENCES profiles(id) DEFAULT auth.uid(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (agreement_type = 'template' OR supplier_id IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS proc_agreement_lines (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id uuid NOT NULL REFERENCES proc_agreements(id),
  item_id      uuid REFERENCES items(id),
  description  text,
  unit         text,
  price        numeric(14,4),
  quantity     numeric,          -- blanket: agreed quantity for the period (blank = no limit); template: usual quantity
  is_archived  boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (item_id IS NOT NULL OR NULLIF(trim(description), '') IS NOT NULL)
);
ALTER TABLE po_lines ADD COLUMN IF NOT EXISTS agreement_line_id uuid REFERENCES proc_agreement_lines(id);
ALTER TABLE proc_agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE proc_agreement_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pa_select ON proc_agreements;
CREATE POLICY pa_select ON proc_agreements FOR SELECT TO authenticated USING (_proc_can('view', site_id));
DROP POLICY IF EXISTS pal2_select ON proc_agreement_lines;
CREATE POLICY pal2_select ON proc_agreement_lines FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM proc_agreements a WHERE a.id = agreement_id AND _proc_can('view', a.site_id)));
-- writes through proc_agreement_save / proc_agreement_set_status

CREATE OR REPLACE FUNCTION public.proc_agreement_save(p jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid := NULLIF(p->>'id','')::uuid; _site uuid := (p->>'site_id')::uuid; _a proc_agreements%ROWTYPE; _l jsonb; _keep uuid[] := '{}'; _lid uuid;
BEGIN
  IF _id IS NULL THEN
    IF _site IS NULL OR NOT (_has_permission('procurement.create', _site) OR _has_permission('procurement.edit', _site)) THEN RAISE EXCEPTION 'No access'; END IF;
    INSERT INTO proc_agreements (site_id, agreement_type, supplier_id, title)
    VALUES (_site, COALESCE(NULLIF(p->>'agreement_type',''), 'blanket'), NULLIF(p->>'supplier_id','')::uuid, COALESCE(NULLIF(trim(p->>'title'),''), 'Agreement'))
    RETURNING id INTO _id;
    UPDATE proc_agreements SET agreement_no = (SELECT code FROM sites WHERE id = _site) || '-AG-' || to_char(now(), 'YYYY') || '-'
        || lpad((SELECT count(*) FROM proc_agreements WHERE site_id = _site)::text, 4, '0') WHERE id = _id;
  END IF;
  SELECT * INTO _a FROM proc_agreements WHERE id = _id FOR UPDATE;
  IF NOT _has_permission('procurement.edit', _a.site_id) AND NOT (_has_permission('procurement.create', _a.site_id) AND _a.created_by = auth.uid()) THEN RAISE EXCEPTION 'No access'; END IF;
  IF _a.status = 'closed' THEN RAISE EXCEPTION 'This agreement is closed'; END IF;
  UPDATE proc_agreements SET agreement_type = COALESCE(NULLIF(p->>'agreement_type',''), agreement_type), supplier_id = NULLIF(p->>'supplier_id','')::uuid,
    title = COALESCE(NULLIF(trim(p->>'title'),''), title), valid_from = NULLIF(p->>'valid_from','')::date, valid_to = NULLIF(p->>'valid_to','')::date,
    notes = NULLIF(p->>'notes',''), updated_at = now() WHERE id = _id;
  FOR _l IN SELECT * FROM jsonb_array_elements(COALESCE(p->'lines','[]'::jsonb)) LOOP
    IF NULLIF(_l->>'item_id','') IS NULL AND NULLIF(trim(_l->>'description'),'') IS NULL THEN CONTINUE; END IF;
    _lid := NULLIF(_l->>'id','')::uuid;
    IF _lid IS NOT NULL AND EXISTS (SELECT 1 FROM proc_agreement_lines WHERE id = _lid AND agreement_id = _id AND NOT is_archived) THEN
      UPDATE proc_agreement_lines SET item_id = NULLIF(_l->>'item_id','')::uuid, description = NULLIF(trim(_l->>'description'),''), unit = NULLIF(_l->>'unit',''),
        price = NULLIF(_l->>'price','')::numeric, quantity = NULLIF(_l->>'quantity','')::numeric WHERE id = _lid;
    ELSE
      INSERT INTO proc_agreement_lines (agreement_id, item_id, description, unit, price, quantity)
      VALUES (_id, NULLIF(_l->>'item_id','')::uuid, NULLIF(trim(_l->>'description'),''), NULLIF(_l->>'unit',''), NULLIF(_l->>'price','')::numeric, NULLIF(_l->>'quantity','')::numeric)
      RETURNING id INTO _lid;
    END IF;
    _keep := _keep || _lid;
  END LOOP;
  UPDATE proc_agreement_lines SET is_archived = true WHERE agreement_id = _id AND NOT is_archived AND NOT (id = ANY(_keep));
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.proc_agreement_set_status(p_id uuid, p_status text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _a proc_agreements%ROWTYPE;
BEGIN
  SELECT * INTO _a FROM proc_agreements WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agreement not found'; END IF;
  IF p_status = 'active' AND NOT _has_permission('procurement.approve', _a.site_id) THEN RAISE EXCEPTION 'Only a procurement approver can activate an agreement'; END IF;
  IF p_status <> 'active' AND NOT _has_permission('procurement.edit', _a.site_id) THEN RAISE EXCEPTION 'No access'; END IF;
  IF p_status = 'active' AND _a.agreement_type = 'blanket' AND EXISTS (SELECT 1 FROM proc_agreement_lines WHERE agreement_id = p_id AND NOT is_archived AND COALESCE(price, 0) <= 0) THEN
    RAISE EXCEPTION 'Every line of a blanket order needs its agreed price';
  END IF;
  IF p_status = 'active' AND NOT EXISTS (SELECT 1 FROM proc_agreement_lines WHERE agreement_id = p_id AND NOT is_archived) THEN RAISE EXCEPTION 'Add at least one line'; END IF;
  UPDATE proc_agreements SET status = p_status, updated_at = now() WHERE id = p_id;
END $$;

CREATE OR REPLACE FUNCTION public.proc_agreement_list(p_site_ids uuid[]) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', a.id, 'agreement_no', a.agreement_no, 'agreement_type', a.agreement_type, 'title', a.title, 'status', a.status,
      'site_id', a.site_id, 'site', s.name, 'supplier_id', a.supplier_id, 'supplier', ps.supplier_name, 'valid_from', a.valid_from, 'valid_to', a.valid_to, 'notes', a.notes,
      'expired', a.valid_to < CURRENT_DATE,
      'lines', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', l.id, 'item_id', l.item_id, 'description', l.description, 'unit', l.unit, 'price', l.price, 'quantity', l.quantity,
                 'what', COALESCE(i.item_code || ' — ' || i.description, l.description),
                 'drawn', COALESCE((SELECT sum(pl.quantity) FROM po_lines pl JOIN purchase_orders po ON po.id = pl.po_id
                                     WHERE pl.agreement_line_id = l.id AND NOT pl.is_archived AND po.status NOT IN ('cancelled','rfq','rfq_sent','draft')), 0))
                 ORDER BY l.created_at)
               FROM proc_agreement_lines l LEFT JOIN items i ON i.id = l.item_id WHERE l.agreement_id = a.id AND NOT l.is_archived), '[]'::jsonb))
      ORDER BY a.status = 'closed', a.created_at DESC)
    FROM proc_agreements a JOIN sites s ON s.id = a.site_id LEFT JOIN procurement_suppliers ps ON ps.id = a.supplier_id
   WHERE a.site_id = ANY(p_site_ids) AND _proc_can('view', a.site_id) AND NOT a.is_archived), '[]'::jsonb);
END $$;

-- Draft PO from an agreement: blanket = its supplier at agreed prices (within remaining quantities);
-- template = the standard list, priced from the supplier's price list / last price.
CREATE OR REPLACE FUNCTION public.proc_po_from_agreement(p_agreement uuid, p_site uuid, p_supplier uuid, p_lines jsonb, p_warehouse uuid DEFAULT NULL, p_expected date DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _a proc_agreements%ROWTYPE; _po uuid; _j jsonb; _l proc_agreement_lines%ROWTYPE; _qty numeric; _drawn numeric; _sup uuid; _n int := 0;
BEGIN
  SELECT * INTO _a FROM proc_agreements WHERE id = p_agreement;
  IF NOT FOUND OR _a.status <> 'active' THEN RAISE EXCEPTION 'Only an active agreement can be ordered from'; END IF;
  IF _a.valid_to < CURRENT_DATE OR _a.valid_from > CURRENT_DATE THEN RAISE EXCEPTION 'This agreement is outside its valid dates'; END IF;
  IF NOT _proc_can('create', p_site) THEN RAISE EXCEPTION 'You cannot raise purchase orders for this site'; END IF;
  _sup := CASE WHEN _a.agreement_type = 'blanket' THEN _a.supplier_id ELSE COALESCE(p_supplier, _a.supplier_id) END;
  INSERT INTO purchase_orders (po_number, site_id, supplier_id, warehouse_id, status, expected_date, total_amount, created_by, notes)
  VALUES ('', p_site, _sup, COALESCE(p_warehouse, (SELECT id FROM warehouses WHERE site_id = p_site AND is_active ORDER BY name LIMIT 1)),
          'draft', p_expected, 0, auth.uid(), 'From ' || COALESCE(_a.agreement_no, 'agreement') || ' — ' || _a.title)
  RETURNING id INTO _po;
  FOR _j IN SELECT * FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) LOOP
    _qty := COALESCE((_j->>'quantity')::numeric, 0);
    CONTINUE WHEN _qty <= 0;
    SELECT * INTO _l FROM proc_agreement_lines WHERE id = (_j->>'agreement_line_id')::uuid AND agreement_id = p_agreement AND NOT is_archived;
    IF NOT FOUND THEN RAISE EXCEPTION 'Line is not on this agreement'; END IF;
    IF _a.agreement_type = 'blanket' AND _l.quantity IS NOT NULL THEN
      SELECT COALESCE(sum(pl.quantity), 0) INTO _drawn FROM po_lines pl JOIN purchase_orders po ON po.id = pl.po_id
       WHERE pl.agreement_line_id = _l.id AND NOT pl.is_archived AND po.status NOT IN ('cancelled','rfq','rfq_sent','draft');
      IF _drawn + _qty > _l.quantity THEN RAISE EXCEPTION 'Only % left on the agreement for one of the lines', _l.quantity - _drawn; END IF;
    END IF;
    INSERT INTO po_lines (po_id, item_id, description, unit, quantity, unit_cost, agreement_line_id)
    VALUES (_po, _l.item_id, _l.description, _l.unit, _qty,
            CASE WHEN _a.agreement_type = 'blanket' THEN _l.price ELSE COALESCE(_po_last_price(_l.item_id, _sup), _l.price, 0) END, _l.id);
    _n := _n + 1;
  END LOOP;
  IF _n = 0 THEN RAISE EXCEPTION 'Enter a quantity for at least one line'; END IF;
  PERFORM _po_recalc(_po);
  RETURN _po;
END $$;

REVOKE ALL ON FUNCTION proc_agreement_save(jsonb), proc_agreement_set_status(uuid, text), proc_agreement_list(uuid[]),
  proc_po_from_agreement(uuid, uuid, uuid, jsonb, uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION proc_agreement_save(jsonb), proc_agreement_set_status(uuid, text), proc_agreement_list(uuid[]),
  proc_po_from_agreement(uuid, uuid, uuid, jsonb, uuid, date) TO authenticated;

INSERT INTO schema_migrations (filename) VALUES ('0216_receiving_suppliers_agreements.sql') ON CONFLICT DO NOTHING;
