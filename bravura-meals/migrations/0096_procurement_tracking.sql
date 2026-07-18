-- 0096 — Procurement: order tracking, delivery milestones, goods-in-transit
BEGIN;

-- ── Extend purchase_orders with tracking fields ─────────────────────────────
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS current_location  text,
  ADD COLUMN IF NOT EXISTS tracking_ref      text,
  ADD COLUMN IF NOT EXISTS delivery_status   text NOT NULL DEFAULT 'pending'
    CHECK (delivery_status IN ('pending','ordered','in_transit','at_customs','at_warehouse','delivered','delayed')),
  ADD COLUMN IF NOT EXISTS shipped_at        timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at      timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_address  text,
  ADD COLUMN IF NOT EXISTS priority          text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low','normal','high','urgent'));

-- ── Delivery milestones — breadcrumb trail for each PO ──────────────────────
CREATE TABLE IF NOT EXISTS po_tracking_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id       uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  event_type  text NOT NULL
    CHECK (event_type IN ('created','sent_to_supplier','confirmed','dispatched',
      'in_transit','at_customs','cleared_customs','at_hub','out_for_delivery',
      'delivered','delayed','note')),
  location    text,
  notes       text,
  created_by  uuid REFERENCES profiles(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_po_tracking_po ON po_tracking_events(po_id);

-- ── RFQs (Request for Quotation) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rfqs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_number     text UNIQUE NOT NULL,
  site_id        uuid NOT NULL REFERENCES sites(id),
  title          text NOT NULL,
  status         text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','sent','responses_received','evaluated','awarded','cancelled')),
  deadline       date,
  notes          text,
  created_by     uuid REFERENCES profiles(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rfq_lines (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id       uuid NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  item_id      uuid REFERENCES items(id),
  description  text NOT NULL,
  quantity     numeric NOT NULL,
  unit         text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rfq_responses (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id         uuid NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  supplier_id    uuid NOT NULL REFERENCES procurement_suppliers(id),
  total_amount   numeric NOT NULL DEFAULT 0,
  lead_time_days integer,
  validity_days  integer DEFAULT 30,
  status         text NOT NULL DEFAULT 'received'
    CHECK (status IN ('received','under_review','shortlisted','awarded','rejected')),
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rfq_response_lines (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id      uuid NOT NULL REFERENCES rfq_responses(id) ON DELETE CASCADE,
  rfq_line_id      uuid NOT NULL REFERENCES rfq_lines(id) ON DELETE CASCADE,
  unit_price       numeric NOT NULL DEFAULT 0,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rfq_site ON rfqs(site_id);
CREATE INDEX IF NOT EXISTS idx_rfq_lines_rfq ON rfq_lines(rfq_id);
CREATE INDEX IF NOT EXISTS idx_rfq_resp_rfq ON rfq_responses(rfq_id);
CREATE INDEX IF NOT EXISTS idx_rfq_resp_lines ON rfq_response_lines(response_id);

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE po_tracking_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfqs ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfq_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfq_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfq_response_lines ENABLE ROW LEVEL SECURITY;

-- Tracking events: via parent PO site
CREATE POLICY pte_select ON po_tracking_events FOR SELECT USING (
  EXISTS (SELECT 1 FROM purchase_orders po JOIN permissions p ON p.code='procurement.view'
          JOIN role_permissions rp ON rp.permission_id=p.id
          JOIN user_roles ur ON ur.role_id=rp.role_id
          WHERE po.id=po_tracking_events.po_id AND ur.user_id=auth.uid() AND ur.site_id=po.site_id));
CREATE POLICY pte_insert ON po_tracking_events FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM purchase_orders po JOIN permissions p ON p.code='procurement.edit'
          JOIN role_permissions rp ON rp.permission_id=p.id
          JOIN user_roles ur ON ur.role_id=rp.role_id
          WHERE po.id=po_tracking_events.po_id AND ur.user_id=auth.uid() AND ur.site_id=po.site_id));

-- RFQs: site-scoped
CREATE POLICY rfq_select ON rfqs FOR SELECT USING (
  EXISTS (SELECT 1 FROM permissions p JOIN role_permissions rp ON rp.permission_id=p.id
          JOIN user_roles ur ON ur.role_id=rp.role_id
          WHERE ur.user_id=auth.uid() AND p.code='procurement.view' AND ur.site_id=rfqs.site_id));
CREATE POLICY rfq_insert ON rfqs FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM permissions p JOIN role_permissions rp ON rp.permission_id=p.id
          JOIN user_roles ur ON ur.role_id=rp.role_id
          WHERE ur.user_id=auth.uid() AND p.code='procurement.create' AND ur.site_id=rfqs.site_id));
CREATE POLICY rfq_update ON rfqs FOR UPDATE USING (
  EXISTS (SELECT 1 FROM permissions p JOIN role_permissions rp ON rp.permission_id=p.id
          JOIN user_roles ur ON ur.role_id=rp.role_id
          WHERE ur.user_id=auth.uid() AND p.code='procurement.edit' AND ur.site_id=rfqs.site_id));

-- RFQ lines: via parent
CREATE POLICY rfql_select ON rfq_lines FOR SELECT USING (
  EXISTS (SELECT 1 FROM rfqs r JOIN permissions p ON p.code='procurement.view'
          JOIN role_permissions rp ON rp.permission_id=p.id
          JOIN user_roles ur ON ur.role_id=rp.role_id
          WHERE r.id=rfq_lines.rfq_id AND ur.user_id=auth.uid() AND ur.site_id=r.site_id));
CREATE POLICY rfql_all ON rfq_lines FOR ALL USING (
  EXISTS (SELECT 1 FROM rfqs r JOIN permissions p ON p.code='procurement.edit'
          JOIN role_permissions rp ON rp.permission_id=p.id
          JOIN user_roles ur ON ur.role_id=rp.role_id
          WHERE r.id=rfq_lines.rfq_id AND ur.user_id=auth.uid() AND ur.site_id=r.site_id));

-- RFQ responses: via parent RFQ
CREATE POLICY rfqr_select ON rfq_responses FOR SELECT USING (
  EXISTS (SELECT 1 FROM rfqs r JOIN permissions p ON p.code='procurement.view'
          JOIN role_permissions rp ON rp.permission_id=p.id
          JOIN user_roles ur ON ur.role_id=rp.role_id
          WHERE r.id=rfq_responses.rfq_id AND ur.user_id=auth.uid() AND ur.site_id=r.site_id));
CREATE POLICY rfqr_all ON rfq_responses FOR ALL USING (
  EXISTS (SELECT 1 FROM rfqs r JOIN permissions p ON p.code='procurement.edit'
          JOIN role_permissions rp ON rp.permission_id=p.id
          JOIN user_roles ur ON ur.role_id=rp.role_id
          WHERE r.id=rfq_responses.rfq_id AND ur.user_id=auth.uid() AND ur.site_id=r.site_id));

-- RFQ response lines: via parent response → RFQ
CREATE POLICY rfqrl_select ON rfq_response_lines FOR SELECT USING (
  EXISTS (SELECT 1 FROM rfq_responses resp JOIN rfqs r ON r.id=resp.rfq_id
          JOIN permissions p ON p.code='procurement.view'
          JOIN role_permissions rp ON rp.permission_id=p.id
          JOIN user_roles ur ON ur.role_id=rp.role_id
          WHERE resp.id=rfq_response_lines.response_id AND ur.user_id=auth.uid() AND ur.site_id=r.site_id));
CREATE POLICY rfqrl_all ON rfq_response_lines FOR ALL USING (
  EXISTS (SELECT 1 FROM rfq_responses resp JOIN rfqs r ON r.id=resp.rfq_id
          JOIN permissions p ON p.code='procurement.edit'
          JOIN role_permissions rp ON rp.permission_id=p.id
          JOIN user_roles ur ON ur.role_id=rp.role_id
          WHERE resp.id=rfq_response_lines.response_id AND ur.user_id=auth.uid() AND ur.site_id=r.site_id));

INSERT INTO schema_migrations (filename) VALUES ('0096_procurement_tracking.sql')
ON CONFLICT DO NOTHING;

COMMIT;
