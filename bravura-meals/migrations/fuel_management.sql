-- ──────────────────────────────────────────────────────────────────────────────
-- Fuel Management Module — Initial Schema
-- Apply via Supabase Dashboard > SQL Editor, or supabase db push
-- ──────────────────────────────────────────────────────────────────────────────

-- Fuel tanks / containers defined per site
CREATE TABLE IF NOT EXISTS fuel_tanks (
  id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id          uuid          NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  name             text          NOT NULL,
  designation      text,
  capacity_litres  numeric(10,2),
  fuel_type        text          NOT NULL DEFAULT 'Diesel',
  is_active        boolean       NOT NULL DEFAULT true,
  created_at       timestamptz   NOT NULL DEFAULT now()
);

-- Bulk fuel deliveries into a tank
CREATE TABLE IF NOT EXISTS fuel_receipts (
  id                 uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id            uuid          NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  tank_id            uuid          REFERENCES fuel_tanks(id) ON DELETE SET NULL,
  receipt_date       date          NOT NULL,
  quantity_litres    numeric(10,2) NOT NULL CHECK (quantity_litres > 0),
  supplier           text,
  delivery_note_ref  text,
  recorded_by        uuid,
  recorded_by_name   text,
  notes              text,
  created_at         timestamptz   NOT NULL DEFAULT now()
);

-- Fuel drawn from a tank (issued to a vehicle, generator, machine, etc.)
CREATE TABLE IF NOT EXISTS fuel_issues (
  id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id          uuid          NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  tank_id          uuid          REFERENCES fuel_tanks(id) ON DELETE SET NULL,
  issue_date       date          NOT NULL,
  quantity_litres  numeric(10,2) NOT NULL CHECK (quantity_litres > 0),
  asset_type       text          NOT NULL,  -- 'vehicle' | 'generator' | 'machine' | 'other'
  asset_name       text          NOT NULL,
  asset_reg        text,
  purpose          text,
  issued_by        uuid,
  issued_by_name   text,
  approved_by      uuid,
  approved_by_name text,
  received_by      text,
  notes            text,
  created_at       timestamptz   NOT NULL DEFAULT now()
);

-- Physical dip-stick tank measurements
CREATE TABLE IF NOT EXISTS fuel_dip_readings (
  id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id          uuid          NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  tank_id          uuid          REFERENCES fuel_tanks(id) ON DELETE SET NULL,
  reading_date     date          NOT NULL,
  reading_litres   numeric(10,2) NOT NULL CHECK (reading_litres >= 0),
  recorded_by      uuid,
  recorded_by_name text,
  notes            text,
  created_at       timestamptz   NOT NULL DEFAULT now()
);

-- ── Row-Level Security ─────────────────────────────────────────────────────────
ALTER TABLE fuel_tanks         ENABLE ROW LEVEL SECURITY;
ALTER TABLE fuel_receipts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE fuel_issues        ENABLE ROW LEVEL SECURITY;
ALTER TABLE fuel_dip_readings  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read fuel_tanks"         ON fuel_tanks        FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated write fuel_tanks"        ON fuel_tanks        FOR ALL    USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated read fuel_receipts"      ON fuel_receipts     FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated write fuel_receipts"     ON fuel_receipts     FOR ALL    USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated read fuel_issues"        ON fuel_issues       FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated write fuel_issues"       ON fuel_issues       FOR ALL    USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated read fuel_dip_readings"  ON fuel_dip_readings FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated write fuel_dip_readings" ON fuel_dip_readings FOR ALL    USING (auth.role() = 'authenticated');

-- ── Permissions ────────────────────────────────────────────────────────────────
INSERT INTO permissions (code, description) VALUES
  ('fuel.view',   'View fuel dashboards, tank levels, and reports'),
  ('fuel.create', 'Record fuel receipts, issues, and dip-stick readings'),
  ('fuel.approve','Approve fuel issue requests'),
  ('fuel.delete', 'Delete fuel records and manage tanks')
ON CONFLICT (code) DO NOTHING;

-- Grant all fuel permissions to System Admin / Group Admin roles
INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id
  FROM   roles r
  CROSS JOIN permissions p
  WHERE  r.name IN ('System Admin', 'Group Admin')
    AND  p.code LIKE 'fuel.%'
ON CONFLICT DO NOTHING;

-- Uncomment to create a Fuel Officer role with view + create permissions:
-- INSERT INTO roles (name) VALUES ('Fuel Officer') ON CONFLICT (name) DO NOTHING;
-- INSERT INTO role_permissions (role_id, permission_id)
--   SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
--   WHERE  r.name = 'Fuel Officer' AND p.code IN ('fuel.view','fuel.create')
--   ON CONFLICT DO NOTHING;
