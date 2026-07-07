-- ── 0058: Procurement suppliers table ────────────────────────────────────────
-- Central supplier registry for use across modules (fuel deliveries, etc.).

CREATE TABLE IF NOT EXISTS procurement_suppliers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id          UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  supplier_name    TEXT NOT NULL,
  contact_person   TEXT,
  phone            TEXT,
  email            TEXT,
  address          TEXT,
  category         TEXT,
  status           TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'inactive')),
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       UUID REFERENCES profiles(id),
  UNIQUE (site_id, supplier_name)
);

CREATE INDEX IF NOT EXISTS procurement_suppliers_site_status_idx
  ON procurement_suppliers(site_id, status);

ALTER TABLE procurement_suppliers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS procurement_suppliers_read ON procurement_suppliers;
CREATE POLICY procurement_suppliers_read ON procurement_suppliers
  FOR SELECT USING (user_in_site(site_id));

DROP POLICY IF EXISTS procurement_suppliers_write ON procurement_suppliers;
CREATE POLICY procurement_suppliers_write ON procurement_suppliers
  FOR ALL USING (user_in_site(site_id));
