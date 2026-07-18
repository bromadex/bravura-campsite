-- 0095 — Inventory Phase 3 & 4: Stock Takes, Purchase Requisitions, Purchase Orders
BEGIN;

-- ── Stock Takes ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stock_takes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference     text NOT NULL,
  warehouse_id  uuid NOT NULL REFERENCES warehouses(id),
  status        text NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','in_progress','completed','cancelled')),
  started_at    timestamptz,
  completed_at  timestamptz,
  notes         text,
  created_by    uuid REFERENCES profiles(id),
  approved_by   uuid REFERENCES profiles(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stock_take_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_take_id   uuid NOT NULL REFERENCES stock_takes(id) ON DELETE CASCADE,
  item_id         uuid NOT NULL REFERENCES items(id),
  system_qty      numeric NOT NULL DEFAULT 0,
  counted_qty     numeric,
  variance        numeric GENERATED ALWAYS AS (COALESCE(counted_qty, 0) - system_qty) STORED,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_takes_wh ON stock_takes(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_stock_take_lines_st ON stock_take_lines(stock_take_id);

-- ── Purchase Requisitions ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchase_requisitions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requisition_no  text UNIQUE NOT NULL,
  site_id         uuid NOT NULL REFERENCES sites(id),
  warehouse_id    uuid REFERENCES warehouses(id),
  status          text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','submitted','approved','rejected','ordered','cancelled')),
  priority        text NOT NULL DEFAULT 'normal'
                  CHECK (priority IN ('low','normal','high','urgent')),
  requested_by    uuid REFERENCES profiles(id),
  approved_by     uuid REFERENCES profiles(id),
  approved_at     timestamptz,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS requisition_lines (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requisition_id    uuid NOT NULL REFERENCES purchase_requisitions(id) ON DELETE CASCADE,
  item_id           uuid NOT NULL REFERENCES items(id),
  quantity          numeric NOT NULL,
  estimated_cost    numeric,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pr_site ON purchase_requisitions(site_id);
CREATE INDEX IF NOT EXISTS idx_pr_lines_pr ON requisition_lines(requisition_id);

-- ── Purchase Orders ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchase_orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number       text UNIQUE NOT NULL,
  site_id         uuid NOT NULL REFERENCES sites(id),
  supplier_id     uuid REFERENCES procurement_suppliers(id),
  warehouse_id    uuid REFERENCES warehouses(id),
  requisition_id  uuid REFERENCES purchase_requisitions(id),
  status          text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','sent','partially_received','received','cancelled')),
  order_date      date,
  expected_date   date,
  total_amount    numeric NOT NULL DEFAULT 0,
  notes           text,
  created_by      uuid REFERENCES profiles(id),
  approved_by     uuid REFERENCES profiles(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS po_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id           uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  item_id         uuid NOT NULL REFERENCES items(id),
  quantity        numeric NOT NULL,
  unit_cost       numeric NOT NULL DEFAULT 0,
  received_qty    numeric NOT NULL DEFAULT 0,
  line_total      numeric GENERATED ALWAYS AS (quantity * unit_cost) STORED,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_po_site ON purchase_orders(site_id);
CREATE INDEX IF NOT EXISTS idx_po_supplier ON purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_po_lines_po ON po_lines(po_id);

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE stock_takes ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_take_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_requisitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE requisition_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE po_lines ENABLE ROW LEVEL SECURITY;

-- Stock takes: via warehouse site
CREATE POLICY st_select ON stock_takes FOR SELECT USING (
  EXISTS (SELECT 1 FROM warehouses w JOIN permissions p ON p.code='inventory.view'
          JOIN role_permissions rp ON rp.permission_id=p.id
          JOIN user_roles ur ON ur.role_id=rp.role_id
          WHERE w.id=stock_takes.warehouse_id AND ur.user_id=auth.uid() AND ur.site_id=w.site_id));
CREATE POLICY st_insert ON stock_takes FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM warehouses w JOIN permissions p ON p.code='inventory.create'
          JOIN role_permissions rp ON rp.permission_id=p.id
          JOIN user_roles ur ON ur.role_id=rp.role_id
          WHERE w.id=stock_takes.warehouse_id AND ur.user_id=auth.uid() AND ur.site_id=w.site_id));
CREATE POLICY st_update ON stock_takes FOR UPDATE USING (
  EXISTS (SELECT 1 FROM warehouses w JOIN permissions p ON p.code='inventory.edit'
          JOIN role_permissions rp ON rp.permission_id=p.id
          JOIN user_roles ur ON ur.role_id=rp.role_id
          WHERE w.id=stock_takes.warehouse_id AND ur.user_id=auth.uid() AND ur.site_id=w.site_id));

-- Stock take lines: via parent
CREATE POLICY stl_select ON stock_take_lines FOR SELECT USING (
  EXISTS (SELECT 1 FROM stock_takes st JOIN warehouses w ON w.id=st.warehouse_id
          JOIN permissions p ON p.code='inventory.view'
          JOIN role_permissions rp ON rp.permission_id=p.id
          JOIN user_roles ur ON ur.role_id=rp.role_id
          WHERE st.id=stock_take_lines.stock_take_id AND ur.user_id=auth.uid() AND ur.site_id=w.site_id));
CREATE POLICY stl_all ON stock_take_lines FOR ALL USING (
  EXISTS (SELECT 1 FROM stock_takes st JOIN warehouses w ON w.id=st.warehouse_id
          JOIN permissions p ON p.code='inventory.edit'
          JOIN role_permissions rp ON rp.permission_id=p.id
          JOIN user_roles ur ON ur.role_id=rp.role_id
          WHERE st.id=stock_take_lines.stock_take_id AND ur.user_id=auth.uid() AND ur.site_id=w.site_id));

-- Requisitions: site-scoped
CREATE POLICY pr_select ON purchase_requisitions FOR SELECT USING (
  EXISTS (SELECT 1 FROM permissions p JOIN role_permissions rp ON rp.permission_id=p.id
          JOIN user_roles ur ON ur.role_id=rp.role_id
          WHERE ur.user_id=auth.uid() AND p.code='inventory.view' AND ur.site_id=purchase_requisitions.site_id));
CREATE POLICY pr_insert ON purchase_requisitions FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM permissions p JOIN role_permissions rp ON rp.permission_id=p.id
          JOIN user_roles ur ON ur.role_id=rp.role_id
          WHERE ur.user_id=auth.uid() AND p.code='inventory.create' AND ur.site_id=purchase_requisitions.site_id));
CREATE POLICY pr_update ON purchase_requisitions FOR UPDATE USING (
  EXISTS (SELECT 1 FROM permissions p JOIN role_permissions rp ON rp.permission_id=p.id
          JOIN user_roles ur ON ur.role_id=rp.role_id
          WHERE ur.user_id=auth.uid() AND p.code='inventory.edit' AND ur.site_id=purchase_requisitions.site_id));

-- Requisition lines: via parent
CREATE POLICY prl_select ON requisition_lines FOR SELECT USING (
  EXISTS (SELECT 1 FROM purchase_requisitions pr JOIN permissions p ON p.code='inventory.view'
          JOIN role_permissions rp ON rp.permission_id=p.id
          JOIN user_roles ur ON ur.role_id=rp.role_id
          WHERE pr.id=requisition_lines.requisition_id AND ur.user_id=auth.uid() AND ur.site_id=pr.site_id));
CREATE POLICY prl_all ON requisition_lines FOR ALL USING (
  EXISTS (SELECT 1 FROM purchase_requisitions pr JOIN permissions p ON p.code='inventory.edit'
          JOIN role_permissions rp ON rp.permission_id=p.id
          JOIN user_roles ur ON ur.role_id=rp.role_id
          WHERE pr.id=requisition_lines.requisition_id AND ur.user_id=auth.uid() AND ur.site_id=pr.site_id));

-- Purchase orders: site-scoped
CREATE POLICY po_select ON purchase_orders FOR SELECT USING (
  EXISTS (SELECT 1 FROM permissions p JOIN role_permissions rp ON rp.permission_id=p.id
          JOIN user_roles ur ON ur.role_id=rp.role_id
          WHERE ur.user_id=auth.uid() AND p.code='inventory.view' AND ur.site_id=purchase_orders.site_id));
CREATE POLICY po_insert ON purchase_orders FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM permissions p JOIN role_permissions rp ON rp.permission_id=p.id
          JOIN user_roles ur ON ur.role_id=rp.role_id
          WHERE ur.user_id=auth.uid() AND p.code='inventory.create' AND ur.site_id=purchase_orders.site_id));
CREATE POLICY po_update ON purchase_orders FOR UPDATE USING (
  EXISTS (SELECT 1 FROM permissions p JOIN role_permissions rp ON rp.permission_id=p.id
          JOIN user_roles ur ON ur.role_id=rp.role_id
          WHERE ur.user_id=auth.uid() AND p.code='inventory.edit' AND ur.site_id=purchase_orders.site_id));

-- PO lines: via parent
CREATE POLICY pol_select ON po_lines FOR SELECT USING (
  EXISTS (SELECT 1 FROM purchase_orders po JOIN permissions p ON p.code='inventory.view'
          JOIN role_permissions rp ON rp.permission_id=p.id
          JOIN user_roles ur ON ur.role_id=rp.role_id
          WHERE po.id=po_lines.po_id AND ur.user_id=auth.uid() AND ur.site_id=po.site_id));
CREATE POLICY pol_all ON po_lines FOR ALL USING (
  EXISTS (SELECT 1 FROM purchase_orders po JOIN permissions p ON p.code='inventory.edit'
          JOIN role_permissions rp ON rp.permission_id=p.id
          JOIN user_roles ur ON ur.role_id=rp.role_id
          WHERE po.id=po_lines.po_id AND ur.user_id=auth.uid() AND ur.site_id=po.site_id));

INSERT INTO schema_migrations (filename) VALUES ('0095_inventory_phase3_4.sql')
ON CONFLICT DO NOTHING;

COMMIT;
