-- 0085_procurement_lifecycle.sql
-- Adds the missing tables for a full procure-to-pay lifecycle:
-- po_lines, goods_received_notes, grn_lines, purchase_invoices, invoice_lines.
-- RLS follows the meals-pattern: _has_permission(code, site_id) checked server-side.

-- =========================================================
-- 1. po_lines
-- =========================================================
CREATE TABLE IF NOT EXISTS po_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id uuid NOT NULL REFERENCES purchase_orders(id),
  item_description text NOT NULL,
  item_id uuid,
  quantity numeric NOT NULL,
  unit text,
  unit_price numeric NOT NULL DEFAULT 0,
  total_price numeric GENERATED ALWAYS AS (quantity * unit_price) STORED,
  notes text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_po_lines_po_id ON po_lines(po_id);

ALTER TABLE po_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY po_lines_select ON po_lines
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM purchase_orders po
      WHERE po.id = po_lines.po_id
        AND _has_permission('procurement.view', po.site_id)
    )
  );

CREATE POLICY po_lines_insert ON po_lines
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM purchase_orders po
      WHERE po.id = po_lines.po_id
        AND _has_permission('procurement.create', po.site_id)
    )
  );

CREATE POLICY po_lines_update ON po_lines
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM purchase_orders po
      WHERE po.id = po_lines.po_id
        AND _has_permission('procurement.edit', po.site_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM purchase_orders po
      WHERE po.id = po_lines.po_id
        AND _has_permission('procurement.edit', po.site_id)
    )
  );

-- =========================================================
-- 2. goods_received_notes
-- =========================================================
CREATE TABLE IF NOT EXISTS goods_received_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grn_number text NOT NULL UNIQUE,
  site_id uuid NOT NULL REFERENCES sites(id),
  po_id uuid REFERENCES purchase_orders(id),
  supplier_id uuid REFERENCES procurement_suppliers(id),
  received_by uuid REFERENCES auth.users(id),
  received_date date NOT NULL DEFAULT CURRENT_DATE,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','inspecting','accepted','accepted_partial','rejected')),
  delivery_note_ref text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_grn_site_id ON goods_received_notes(site_id);
CREATE INDEX IF NOT EXISTS idx_grn_po_id ON goods_received_notes(po_id);
CREATE INDEX IF NOT EXISTS idx_grn_supplier_id ON goods_received_notes(supplier_id);

ALTER TABLE goods_received_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY grn_select ON goods_received_notes
  FOR SELECT
  USING (_has_permission('procurement.view', site_id));

CREATE POLICY grn_insert ON goods_received_notes
  FOR INSERT
  WITH CHECK (_has_permission('procurement.create', site_id));

CREATE POLICY grn_update ON goods_received_notes
  FOR UPDATE
  USING (_has_permission('procurement.edit', site_id))
  WITH CHECK (_has_permission('procurement.edit', site_id));

-- =========================================================
-- 3. grn_lines
-- =========================================================
CREATE TABLE IF NOT EXISTS grn_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grn_id uuid NOT NULL REFERENCES goods_received_notes(id),
  po_line_id uuid REFERENCES po_lines(id),
  item_description text NOT NULL,
  quantity_expected numeric NOT NULL DEFAULT 0,
  quantity_received numeric NOT NULL DEFAULT 0,
  quantity_rejected numeric NOT NULL DEFAULT 0,
  unit text,
  unit_price numeric NOT NULL DEFAULT 0,
  rejection_reason text,
  notes text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_grn_lines_grn_id ON grn_lines(grn_id);
CREATE INDEX IF NOT EXISTS idx_grn_lines_po_line_id ON grn_lines(po_line_id);

ALTER TABLE grn_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY grn_lines_select ON grn_lines
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM goods_received_notes g
      WHERE g.id = grn_lines.grn_id
        AND _has_permission('procurement.view', g.site_id)
    )
  );

CREATE POLICY grn_lines_insert ON grn_lines
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM goods_received_notes g
      WHERE g.id = grn_lines.grn_id
        AND _has_permission('procurement.create', g.site_id)
    )
  );

CREATE POLICY grn_lines_update ON grn_lines
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM goods_received_notes g
      WHERE g.id = grn_lines.grn_id
        AND _has_permission('procurement.edit', g.site_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM goods_received_notes g
      WHERE g.id = grn_lines.grn_id
        AND _has_permission('procurement.edit', g.site_id)
    )
  );

-- =========================================================
-- 4. purchase_invoices
-- =========================================================
CREATE TABLE IF NOT EXISTS purchase_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text NOT NULL,
  site_id uuid NOT NULL REFERENCES sites(id),
  po_id uuid REFERENCES purchase_orders(id),
  grn_id uuid REFERENCES goods_received_notes(id),
  supplier_id uuid NOT NULL REFERENCES procurement_suppliers(id),
  invoice_date date NOT NULL DEFAULT CURRENT_DATE,
  due_date date,
  subtotal numeric NOT NULL DEFAULT 0,
  tax_amount numeric NOT NULL DEFAULT 0,
  total_amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','pending_approval','approved','paid','cancelled')),
  payment_ref text,
  paid_at timestamptz,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  approved_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purchase_invoices_site_id ON purchase_invoices(site_id);
CREATE INDEX IF NOT EXISTS idx_purchase_invoices_po_id ON purchase_invoices(po_id);
CREATE INDEX IF NOT EXISTS idx_purchase_invoices_grn_id ON purchase_invoices(grn_id);
CREATE INDEX IF NOT EXISTS idx_purchase_invoices_supplier_id ON purchase_invoices(supplier_id);

ALTER TABLE purchase_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY purchase_invoices_select ON purchase_invoices
  FOR SELECT
  USING (_has_permission('procurement.view', site_id));

CREATE POLICY purchase_invoices_insert ON purchase_invoices
  FOR INSERT
  WITH CHECK (_has_permission('procurement.create', site_id));

CREATE POLICY purchase_invoices_update ON purchase_invoices
  FOR UPDATE
  USING (_has_permission('procurement.edit', site_id))
  WITH CHECK (_has_permission('procurement.edit', site_id));

-- =========================================================
-- 5. invoice_lines
-- =========================================================
CREATE TABLE IF NOT EXISTS invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES purchase_invoices(id),
  grn_line_id uuid REFERENCES grn_lines(id),
  item_description text NOT NULL,
  quantity numeric NOT NULL,
  unit text,
  unit_price numeric NOT NULL DEFAULT 0,
  total_price numeric GENERATED ALWAYS AS (quantity * unit_price) STORED,
  notes text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice_id ON invoice_lines(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_grn_line_id ON invoice_lines(grn_line_id);

ALTER TABLE invoice_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY invoice_lines_select ON invoice_lines
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM purchase_invoices pi
      WHERE pi.id = invoice_lines.invoice_id
        AND _has_permission('procurement.view', pi.site_id)
    )
  );

CREATE POLICY invoice_lines_insert ON invoice_lines
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM purchase_invoices pi
      WHERE pi.id = invoice_lines.invoice_id
        AND _has_permission('procurement.create', pi.site_id)
    )
  );

CREATE POLICY invoice_lines_update ON invoice_lines
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM purchase_invoices pi
      WHERE pi.id = invoice_lines.invoice_id
        AND _has_permission('procurement.edit', pi.site_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM purchase_invoices pi
      WHERE pi.id = invoice_lines.invoice_id
        AND _has_permission('procurement.edit', pi.site_id)
    )
  );

-- =========================================================
-- Self-record migration
-- =========================================================
INSERT INTO schema_migrations (filename) VALUES ('0085_procurement_lifecycle.sql') ON CONFLICT DO NOTHING;
