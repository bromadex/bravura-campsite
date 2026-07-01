-- ── Fuel Deliveries ──────────────────────────────────────────────────────────
-- Records physical fuel deliveries from suppliers into tanks.
-- Separate from fuel_transactions — a delivery here triggers an INSERT into
-- fuel_transactions (type='delivery') to update the tank balance via trigger.

CREATE TABLE IF NOT EXISTS fuel_deliveries (
  id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id              UUID          NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  delivery_number      TEXT          NOT NULL,
  tank_id              UUID          NOT NULL REFERENCES fuel_tanks(id),
  supplier_name        TEXT          NOT NULL,
  delivery_note_number TEXT,
  delivery_date        DATE          NOT NULL,
  quantity_ordered     NUMERIC(12,3),
  quantity_delivered   NUMERIC(12,3) NOT NULL CHECK (quantity_delivered > 0),
  unit_price           NUMERIC(10,4),
  total_cost           NUMERIC(15,2),
  dip_before           NUMERIC(12,3),
  dip_after            NUMERIC(12,3),
  delivery_note_path   TEXT,                     -- Supabase Storage object path
  status               TEXT          NOT NULL DEFAULT 'pending'
                                       CHECK (status IN ('pending','confirmed','queried')),
  confirmed_by         UUID          REFERENCES profiles(id),
  confirmed_at         TIMESTAMPTZ,
  query_notes          TEXT,
  notes                TEXT,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by           UUID          REFERENCES profiles(id),
  UNIQUE (site_id, delivery_number)
);

CREATE INDEX IF NOT EXISTS fuel_deliveries_site_idx   ON fuel_deliveries(site_id);
CREATE INDEX IF NOT EXISTS fuel_deliveries_tank_idx   ON fuel_deliveries(tank_id);
CREATE INDEX IF NOT EXISTS fuel_deliveries_date_idx   ON fuel_deliveries(delivery_date DESC);
CREATE INDEX IF NOT EXISTS fuel_deliveries_status_idx ON fuel_deliveries(site_id, status);

ALTER TABLE fuel_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fuel_deliveries_select" ON fuel_deliveries;
DROP POLICY IF EXISTS "fuel_deliveries_insert" ON fuel_deliveries;
DROP POLICY IF EXISTS "fuel_deliveries_update" ON fuel_deliveries;

-- Any authenticated user at this site can view deliveries
CREATE POLICY "fuel_deliveries_select" ON fuel_deliveries
  FOR SELECT USING (
    site_id IN (SELECT site_id FROM user_roles WHERE user_id = auth.uid())
  );

-- fuel.create holders can record deliveries
CREATE POLICY "fuel_deliveries_insert" ON fuel_deliveries
  FOR INSERT WITH CHECK (
    site_id IN (SELECT site_id FROM user_roles WHERE user_id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN role_permissions rp ON rp.role_id = ur.role_id
      JOIN permissions p        ON p.id = rp.permission_id
      WHERE ur.user_id = auth.uid()
        AND ur.site_id = fuel_deliveries.site_id
        AND p.code     = 'fuel.create'
    )
  );

-- fuel.approve holders can confirm/query deliveries
CREATE POLICY "fuel_deliveries_update" ON fuel_deliveries
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN role_permissions rp ON rp.role_id = ur.role_id
      JOIN permissions p        ON p.id = rp.permission_id
      WHERE ur.user_id = auth.uid()
        AND ur.site_id = fuel_deliveries.site_id
        AND p.code     = 'fuel.approve'
    )
  );


-- ── Dip Readings ──────────────────────────────────────────────────────────────
-- Manual tank dip measurements taken by operators (usually each shift).
-- Variance against system level flags reconciliation issues.

CREATE TABLE IF NOT EXISTS dip_readings (
  id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id              UUID          NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  tank_id              UUID          NOT NULL REFERENCES fuel_tanks(id),
  reading_date         DATE          NOT NULL,
  reading_time         TIME,
  shift                TEXT          CHECK (shift IN ('morning','afternoon','night')),
  dip_mm               NUMERIC(8,1),            -- raw dip in millimetres
  level_litres         NUMERIC(12,3) NOT NULL,  -- calculated from calibration or entered directly
  system_level_litres  NUMERIC(12,3),           -- system level at time of reading
  variance_litres      NUMERIC(12,3),           -- dip - system
  variance_percent     NUMERIC(6,2),
  read_by              UUID          REFERENCES fuel_operators(id),
  notes                TEXT,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dip_readings_site_idx  ON dip_readings(site_id);
CREATE INDEX IF NOT EXISTS dip_readings_tank_idx  ON dip_readings(tank_id);
CREATE INDEX IF NOT EXISTS dip_readings_date_idx  ON dip_readings(reading_date DESC);

ALTER TABLE dip_readings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dip_readings_select" ON dip_readings;
DROP POLICY IF EXISTS "dip_readings_insert" ON dip_readings;

CREATE POLICY "dip_readings_select" ON dip_readings
  FOR SELECT USING (
    site_id IN (SELECT site_id FROM user_roles WHERE user_id = auth.uid())
  );

CREATE POLICY "dip_readings_insert" ON dip_readings
  FOR INSERT WITH CHECK (
    site_id IN (SELECT site_id FROM user_roles WHERE user_id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN role_permissions rp ON rp.role_id = ur.role_id
      JOIN permissions p        ON p.id = rp.permission_id
      WHERE ur.user_id = auth.uid()
        AND ur.site_id = dip_readings.site_id
        AND p.code     = 'fuel.create'
    )
  );


-- ── Tank Calibrations ─────────────────────────────────────────────────────────
-- Lookup table mapping dip depth (mm) → volume (litres) for each tank.
-- Used to convert raw dip readings into a litre figure.

CREATE TABLE IF NOT EXISTS tank_calibrations (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tank_id      UUID          NOT NULL REFERENCES fuel_tanks(id) ON DELETE CASCADE,
  dip_mm       NUMERIC(8,1)  NOT NULL,
  level_litres NUMERIC(12,3) NOT NULL,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (tank_id, dip_mm)
);

CREATE INDEX IF NOT EXISTS tank_calibrations_tank_idx ON tank_calibrations(tank_id);

ALTER TABLE tank_calibrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tank_calibrations_select" ON tank_calibrations;
DROP POLICY IF EXISTS "tank_calibrations_insert" ON tank_calibrations;
DROP POLICY IF EXISTS "tank_calibrations_delete" ON tank_calibrations;

-- Any authenticated user can read calibration tables (needed for dip conversion in the UI)
CREATE POLICY "tank_calibrations_select" ON tank_calibrations
  FOR SELECT USING (
    tank_id IN (
      SELECT id FROM fuel_tanks WHERE site_id IN (
        SELECT site_id FROM user_roles WHERE user_id = auth.uid()
      )
    )
  );

-- fuel.edit holders can manage calibration tables
CREATE POLICY "tank_calibrations_insert" ON tank_calibrations
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM fuel_tanks ft
      JOIN user_roles ur ON ur.site_id = ft.site_id
      JOIN role_permissions rp ON rp.role_id = ur.role_id
      JOIN permissions p        ON p.id = rp.permission_id
      WHERE ft.id        = tank_calibrations.tank_id
        AND ur.user_id   = auth.uid()
        AND p.code       = 'fuel.edit'
    )
  );

CREATE POLICY "tank_calibrations_delete" ON tank_calibrations
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM fuel_tanks ft
      JOIN user_roles ur ON ur.site_id = ft.site_id
      JOIN role_permissions rp ON rp.role_id = ur.role_id
      JOIN permissions p        ON p.id = rp.permission_id
      WHERE ft.id        = tank_calibrations.tank_id
        AND ur.user_id   = auth.uid()
        AND p.code       = 'fuel.edit'
    )
  );
