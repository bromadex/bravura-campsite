-- 0092 — Inventory Module Foundation
-- Tables: item_categories, units_of_measure, items, warehouses,
--         stock_balances, inventory_movements
-- Trigger: on movement insert → upsert stock_balances + AVCO
-- Permissions: inventory.view/create/edit/delete/approve

BEGIN;

-- ── Item Categories ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS item_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  parent_id   uuid REFERENCES item_categories(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Seed categories
INSERT INTO item_categories (name) VALUES
  ('Electrical'), ('Mechanical'), ('Civil'), ('Mining'), ('Safety / PPE'),
  ('ICT'), ('Kitchen'), ('Camp'), ('Workshop'), ('Lubricants'),
  ('Chemicals'), ('Stationery'), ('Consumables')
ON CONFLICT DO NOTHING;

-- ── Units of Measure ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS units_of_measure (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  abbreviation text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

INSERT INTO units_of_measure (name, abbreviation) VALUES
  ('Pieces', 'pcs'), ('Kilograms', 'kg'), ('Grams', 'g'),
  ('Litres', 'L'), ('Millilitres', 'mL'), ('Metres', 'm'),
  ('Millimetres', 'mm'), ('Box', 'box'), ('Bag', 'bag'),
  ('Pair', 'pair'), ('Set', 'set'), ('Roll', 'roll'),
  ('Drum', 'drum'), ('Ream', 'ream')
ON CONFLICT DO NOTHING;

-- ── Items (global SKU catalogue — no site_id) ───────────────────────────────
CREATE TABLE IF NOT EXISTS items (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_code            text UNIQUE NOT NULL,
  description          text NOT NULL,
  category_id          uuid REFERENCES item_categories(id),
  subcategory          text,
  uom_id               uuid REFERENCES units_of_measure(id),
  brand                text,
  manufacturer         text,
  part_number          text,
  barcode              text,
  preferred_supplier_id uuid REFERENCES procurement_suppliers(id),
  min_stock            numeric,
  max_stock            numeric,
  reorder_level        numeric,
  reorder_qty          numeric,
  standard_cost        numeric,
  average_cost         numeric DEFAULT 0,
  last_purchase_price  numeric,
  photo_url            text,
  datasheet_url        text,
  msds_url             text,
  location             text,
  status               text NOT NULL DEFAULT 'active',
  is_archived          boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_items_category ON items(category_id);
CREATE INDEX IF NOT EXISTS idx_items_archived ON items(is_archived);

-- ── Warehouses (site-scoped) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS warehouses (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       text,
  name       text NOT NULL,
  site_id    uuid NOT NULL REFERENCES sites(id),
  type       text NOT NULL DEFAULT 'main'
             CHECK (type IN ('main','workshop','electrical','kitchen','fuel_store','other')),
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_warehouses_site ON warehouses(site_id);

-- Seed one main warehouse per existing site
INSERT INTO warehouses (name, code, site_id, type)
SELECT s.name || ' Main Store', UPPER(LEFT(s.name, 3)) || '-MAIN', s.id, 'main'
FROM sites s
WHERE NOT EXISTS (SELECT 1 FROM warehouses w WHERE w.site_id = s.id)
ON CONFLICT DO NOTHING;

-- ── Stock Balances ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stock_balances (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id         uuid NOT NULL REFERENCES items(id),
  warehouse_id    uuid NOT NULL REFERENCES warehouses(id),
  on_hand_qty     numeric NOT NULL DEFAULT 0,
  valuation_rate  numeric NOT NULL DEFAULT 0,
  stock_value     numeric NOT NULL DEFAULT 0,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, warehouse_id)
);

CREATE INDEX IF NOT EXISTS idx_stock_balances_item ON stock_balances(item_id);
CREATE INDEX IF NOT EXISTS idx_stock_balances_wh   ON stock_balances(warehouse_id);

-- ── Inventory Movements (immutable ledger) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_movements (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id                uuid NOT NULL REFERENCES items(id),
  warehouse_id           uuid NOT NULL REFERENCES warehouses(id),
  movement_type          text NOT NULL
                         CHECK (movement_type IN (
                           'opening','grn','issue','return',
                           'transfer_out','transfer_in',
                           'adjustment','stock_take'
                         )),
  quantity               numeric NOT NULL,
  qty_after              numeric,
  unit_cost              numeric NOT NULL DEFAULT 0,
  value                  numeric NOT NULL DEFAULT 0,
  voucher_type           text,
  voucher_no             text,
  source_module          text,
  source_reference_id    uuid,
  issued_to_employee_id  uuid REFERENCES employees(id),
  issued_to_contractor_id uuid,
  department_id          uuid REFERENCES departments(id),
  notes                  text,
  created_by             uuid REFERENCES profiles(id),
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inv_mov_item  ON inventory_movements(item_id);
CREATE INDEX IF NOT EXISTS idx_inv_mov_wh    ON inventory_movements(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_inv_mov_type  ON inventory_movements(movement_type);
CREATE INDEX IF NOT EXISTS idx_inv_mov_date  ON inventory_movements(created_at);

-- ── Trigger: movement → stock_balances + AVCO ───────────────────────────────
CREATE OR REPLACE FUNCTION trg_inventory_movement_balance()
RETURNS TRIGGER AS $$
DECLARE
  v_old_qty numeric;
  v_old_val numeric;
  v_new_qty numeric;
  v_new_rate numeric;
  v_new_val numeric;
BEGIN
  -- Get current balance (or zeros)
  SELECT COALESCE(on_hand_qty, 0), COALESCE(stock_value, 0)
  INTO v_old_qty, v_old_val
  FROM stock_balances
  WHERE item_id = NEW.item_id AND warehouse_id = NEW.warehouse_id
  FOR UPDATE;

  IF NOT FOUND THEN
    v_old_qty := 0;
    v_old_val := 0;
  END IF;

  v_new_qty := v_old_qty + NEW.quantity;

  -- AVCO: recalculate on inbound movements (positive qty with cost)
  IF NEW.quantity > 0 AND NEW.unit_cost > 0 THEN
    v_new_val := v_old_val + (NEW.quantity * NEW.unit_cost);
    v_new_rate := CASE WHEN v_new_qty > 0 THEN v_new_val / v_new_qty ELSE 0 END;
  ELSE
    -- Outbound: value decreases at current average rate
    v_new_rate := CASE WHEN v_old_qty > 0 THEN v_old_val / v_old_qty ELSE 0 END;
    v_new_val := v_new_qty * v_new_rate;
  END IF;

  IF v_new_val < 0 THEN v_new_val := 0; END IF;

  -- Stamp running balance on the movement row
  NEW.qty_after := v_new_qty;

  -- Upsert balance
  INSERT INTO stock_balances (item_id, warehouse_id, on_hand_qty, valuation_rate, stock_value, updated_at)
  VALUES (NEW.item_id, NEW.warehouse_id, v_new_qty, v_new_rate, v_new_val, now())
  ON CONFLICT (item_id, warehouse_id)
  DO UPDATE SET
    on_hand_qty    = v_new_qty,
    valuation_rate = v_new_rate,
    stock_value    = v_new_val,
    updated_at     = now();

  -- Update item average_cost from the new rate
  UPDATE items SET average_cost = v_new_rate, updated_at = now()
  WHERE id = NEW.item_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_inv_movement ON inventory_movements;
CREATE TRIGGER trg_inv_movement
  BEFORE INSERT ON inventory_movements
  FOR EACH ROW EXECUTE FUNCTION trg_inventory_movement_balance();

-- ── Permissions ─────────────────────────────────────────────────────────────
INSERT INTO permissions (code, module, action, description) VALUES
  ('inventory.view',    'Inventory', 'View',    'View inventory items, stock balances and movements'),
  ('inventory.create',  'Inventory', 'Create',  'Create items, warehouses, record stock movements'),
  ('inventory.edit',    'Inventory', 'Edit',    'Edit items, warehouses, categories'),
  ('inventory.delete',  'Inventory', 'Delete',  'Archive items and deactivate warehouses'),
  ('inventory.approve', 'Inventory', 'Approve', 'Approve adjustments, stock takes, negative stock override')
ON CONFLICT DO NOTHING;

-- Grant to System Administrator and Operations Administrator roles
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name IN ('System Administrator', 'Operations Administrator')
  AND p.code LIKE 'inventory.%'
ON CONFLICT DO NOTHING;

-- ── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE items ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE units_of_measure ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;

-- Items, categories, UoMs are global — readable by anyone with inventory.view
CREATE POLICY items_select ON items FOR SELECT USING (
  EXISTS (SELECT 1 FROM permissions p JOIN role_permissions rp ON rp.permission_id = p.id
          JOIN user_roles ur ON ur.role_id = rp.role_id
          WHERE ur.user_id = auth.uid() AND p.code = 'inventory.view')
);
CREATE POLICY items_insert ON items FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM permissions p JOIN role_permissions rp ON rp.permission_id = p.id
          JOIN user_roles ur ON ur.role_id = rp.role_id
          WHERE ur.user_id = auth.uid() AND p.code = 'inventory.create')
);
CREATE POLICY items_update ON items FOR UPDATE USING (
  EXISTS (SELECT 1 FROM permissions p JOIN role_permissions rp ON rp.permission_id = p.id
          JOIN user_roles ur ON ur.role_id = rp.role_id
          WHERE ur.user_id = auth.uid() AND p.code = 'inventory.edit')
);

CREATE POLICY categories_select ON item_categories FOR SELECT USING (
  EXISTS (SELECT 1 FROM permissions p JOIN role_permissions rp ON rp.permission_id = p.id
          JOIN user_roles ur ON ur.role_id = rp.role_id
          WHERE ur.user_id = auth.uid() AND p.code = 'inventory.view')
);
CREATE POLICY categories_insert ON item_categories FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM permissions p JOIN role_permissions rp ON rp.permission_id = p.id
          JOIN user_roles ur ON ur.role_id = rp.role_id
          WHERE ur.user_id = auth.uid() AND p.code = 'inventory.create')
);
CREATE POLICY categories_update ON item_categories FOR UPDATE USING (
  EXISTS (SELECT 1 FROM permissions p JOIN role_permissions rp ON rp.permission_id = p.id
          JOIN user_roles ur ON ur.role_id = rp.role_id
          WHERE ur.user_id = auth.uid() AND p.code = 'inventory.edit')
);

CREATE POLICY uom_select ON units_of_measure FOR SELECT USING (
  EXISTS (SELECT 1 FROM permissions p JOIN role_permissions rp ON rp.permission_id = p.id
          JOIN user_roles ur ON ur.role_id = rp.role_id
          WHERE ur.user_id = auth.uid() AND p.code = 'inventory.view')
);
CREATE POLICY uom_insert ON units_of_measure FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM permissions p JOIN role_permissions rp ON rp.permission_id = p.id
          JOIN user_roles ur ON ur.role_id = rp.role_id
          WHERE ur.user_id = auth.uid() AND p.code = 'inventory.create')
);
CREATE POLICY uom_update ON units_of_measure FOR UPDATE USING (
  EXISTS (SELECT 1 FROM permissions p JOIN role_permissions rp ON rp.permission_id = p.id
          JOIN user_roles ur ON ur.role_id = rp.role_id
          WHERE ur.user_id = auth.uid() AND p.code = 'inventory.edit')
);

-- Warehouses: site-scoped
CREATE POLICY warehouses_select ON warehouses FOR SELECT USING (
  EXISTS (SELECT 1 FROM permissions p JOIN role_permissions rp ON rp.permission_id = p.id
          JOIN user_roles ur ON ur.role_id = rp.role_id
          WHERE ur.user_id = auth.uid() AND p.code = 'inventory.view'
            AND ur.site_id = warehouses.site_id)
);
CREATE POLICY warehouses_insert ON warehouses FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM permissions p JOIN role_permissions rp ON rp.permission_id = p.id
          JOIN user_roles ur ON ur.role_id = rp.role_id
          WHERE ur.user_id = auth.uid() AND p.code = 'inventory.create'
            AND ur.site_id = warehouses.site_id)
);
CREATE POLICY warehouses_update ON warehouses FOR UPDATE USING (
  EXISTS (SELECT 1 FROM permissions p JOIN role_permissions rp ON rp.permission_id = p.id
          JOIN user_roles ur ON ur.role_id = rp.role_id
          WHERE ur.user_id = auth.uid() AND p.code = 'inventory.edit'
            AND ur.site_id = warehouses.site_id)
);

-- Stock balances: scoped via warehouse
CREATE POLICY balances_select ON stock_balances FOR SELECT USING (
  EXISTS (SELECT 1 FROM warehouses w
          JOIN permissions p ON p.code = 'inventory.view'
          JOIN role_permissions rp ON rp.permission_id = p.id
          JOIN user_roles ur ON ur.role_id = rp.role_id
          WHERE w.id = stock_balances.warehouse_id
            AND ur.user_id = auth.uid()
            AND ur.site_id = w.site_id)
);
CREATE POLICY balances_all ON stock_balances FOR ALL USING (
  EXISTS (SELECT 1 FROM warehouses w
          JOIN permissions p ON p.code = 'inventory.edit'
          JOIN role_permissions rp ON rp.permission_id = p.id
          JOIN user_roles ur ON ur.role_id = rp.role_id
          WHERE w.id = stock_balances.warehouse_id
            AND ur.user_id = auth.uid()
            AND ur.site_id = w.site_id)
);

-- Movements: scoped via warehouse
CREATE POLICY movements_select ON inventory_movements FOR SELECT USING (
  EXISTS (SELECT 1 FROM warehouses w
          JOIN permissions p ON p.code = 'inventory.view'
          JOIN role_permissions rp ON rp.permission_id = p.id
          JOIN user_roles ur ON ur.role_id = rp.role_id
          WHERE w.id = inventory_movements.warehouse_id
            AND ur.user_id = auth.uid()
            AND ur.site_id = w.site_id)
);
CREATE POLICY movements_insert ON inventory_movements FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM warehouses w
          JOIN permissions p ON p.code = 'inventory.create'
          JOIN role_permissions rp ON rp.permission_id = p.id
          JOIN user_roles ur ON ur.role_id = rp.role_id
          WHERE w.id = inventory_movements.warehouse_id
            AND ur.user_id = auth.uid()
            AND ur.site_id = w.site_id)
);

-- Self-record
INSERT INTO schema_migrations (filename) VALUES ('0092_inventory_foundation.sql')
ON CONFLICT DO NOTHING;

COMMIT;
