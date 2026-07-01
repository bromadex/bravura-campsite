-- ── Bowser Dispatches ────────────────────────────────────────────────────────
-- Tracks dispatch and return of mobile fuel bowser tanks.
-- Bowsers are fuel_tanks rows where tank_type = 'bowser'.

CREATE TABLE IF NOT EXISTS bowser_dispatches (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id               UUID          NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  bowser_id             UUID          NOT NULL REFERENCES fuel_tanks(id),
  dispatch_number       TEXT          NOT NULL,
  dispatched_to         TEXT          NOT NULL,
  dispatched_to_gps_lat NUMERIC(10,7),
  dispatched_to_gps_lng NUMERIC(10,7),
  driver_id             UUID          REFERENCES employees(id),
  dispatch_date         DATE          NOT NULL,
  dispatch_time         TIME,
  return_date           DATE,
  return_time           TIME,
  litres_at_dispatch    NUMERIC(12,3),
  litres_at_return      NUMERIC(12,3),
  litres_issued_onsite  NUMERIC(12,3),
  status                TEXT          NOT NULL DEFAULT 'dispatched'
                                        CHECK (status IN ('dispatched','returned','cancelled')),
  notes                 TEXT,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by            UUID          REFERENCES profiles(id),
  UNIQUE (site_id, dispatch_number)
);

CREATE INDEX IF NOT EXISTS bowser_dispatches_site_idx   ON bowser_dispatches(site_id);
CREATE INDEX IF NOT EXISTS bowser_dispatches_bowser_idx ON bowser_dispatches(bowser_id);
CREATE INDEX IF NOT EXISTS bowser_dispatches_date_idx   ON bowser_dispatches(dispatch_date DESC);
CREATE INDEX IF NOT EXISTS bowser_dispatches_status_idx ON bowser_dispatches(site_id, status);

ALTER TABLE bowser_dispatches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bowser_dispatches_select" ON bowser_dispatches;
DROP POLICY IF EXISTS "bowser_dispatches_insert" ON bowser_dispatches;
DROP POLICY IF EXISTS "bowser_dispatches_update" ON bowser_dispatches;

CREATE POLICY "bowser_dispatches_select" ON bowser_dispatches
  FOR SELECT USING (
    site_id IN (SELECT site_id FROM user_roles WHERE user_id = auth.uid())
  );

CREATE POLICY "bowser_dispatches_insert" ON bowser_dispatches
  FOR INSERT WITH CHECK (
    site_id IN (SELECT site_id FROM user_roles WHERE user_id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN role_permissions rp ON rp.role_id = ur.role_id
      JOIN permissions p        ON p.id = rp.permission_id
      WHERE ur.user_id = auth.uid()
        AND ur.site_id = bowser_dispatches.site_id
        AND p.code     = 'fuel.create'
    )
  );

-- Return recording and status changes require fuel.approve
CREATE POLICY "bowser_dispatches_update" ON bowser_dispatches
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN role_permissions rp ON rp.role_id = ur.role_id
      JOIN permissions p        ON p.id = rp.permission_id
      WHERE ur.user_id = auth.uid()
        AND ur.site_id = bowser_dispatches.site_id
        AND p.code     = 'fuel.approve'
    )
  );


-- ── Fuel Reconciliations ──────────────────────────────────────────────────────
-- Period-end stock reconciliation per tank.
-- Compares calculated closing level (from transactions) vs actual dip reading.

CREATE TABLE IF NOT EXISTS fuel_reconciliations (
  id                        UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id                   UUID          NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  reconciliation_number     TEXT          NOT NULL,
  tank_id                   UUID          NOT NULL REFERENCES fuel_tanks(id),
  period_start              DATE          NOT NULL,
  period_end                DATE          NOT NULL,
  opening_level_litres      NUMERIC(12,3) NOT NULL,
  total_delivered_litres    NUMERIC(12,3) NOT NULL DEFAULT 0,
  total_issued_litres       NUMERIC(12,3) NOT NULL DEFAULT 0,
  total_adjustments_litres  NUMERIC(12,3) NOT NULL DEFAULT 0,
  closing_level_expected    NUMERIC(12,3) NOT NULL,
  closing_level_actual      NUMERIC(12,3) NOT NULL,
  variance_litres           NUMERIC(12,3),
  variance_percent          NUMERIC(6,2),
  variance_notes            TEXT,
  status                    TEXT          NOT NULL DEFAULT 'draft'
                                            CHECK (status IN ('draft','submitted','approved','queried')),
  submitted_by              UUID          REFERENCES profiles(id),
  submitted_at              TIMESTAMPTZ,
  approved_by               UUID          REFERENCES profiles(id),
  approved_at               TIMESTAMPTZ,
  query_notes               TEXT,
  created_at                TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by                UUID          REFERENCES profiles(id),
  UNIQUE (site_id, reconciliation_number),
  UNIQUE (tank_id, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS fuel_reconciliations_site_idx   ON fuel_reconciliations(site_id);
CREATE INDEX IF NOT EXISTS fuel_reconciliations_tank_idx   ON fuel_reconciliations(tank_id);
CREATE INDEX IF NOT EXISTS fuel_reconciliations_period_idx ON fuel_reconciliations(period_end DESC);
CREATE INDEX IF NOT EXISTS fuel_reconciliations_status_idx ON fuel_reconciliations(site_id, status);

ALTER TABLE fuel_reconciliations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fuel_reconciliations_select" ON fuel_reconciliations;
DROP POLICY IF EXISTS "fuel_reconciliations_insert" ON fuel_reconciliations;
DROP POLICY IF EXISTS "fuel_reconciliations_update" ON fuel_reconciliations;

CREATE POLICY "fuel_reconciliations_select" ON fuel_reconciliations
  FOR SELECT USING (
    site_id IN (SELECT site_id FROM user_roles WHERE user_id = auth.uid())
  );

-- fuel.create holders can create/run reconciliations
CREATE POLICY "fuel_reconciliations_insert" ON fuel_reconciliations
  FOR INSERT WITH CHECK (
    site_id IN (SELECT site_id FROM user_roles WHERE user_id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN role_permissions rp ON rp.role_id = ur.role_id
      JOIN permissions p        ON p.id = rp.permission_id
      WHERE ur.user_id = auth.uid()
        AND ur.site_id = fuel_reconciliations.site_id
        AND p.code     = 'fuel.create'
    )
  );

-- fuel.approve holders can approve/query; fuel.create holders can update draft/submit
CREATE POLICY "fuel_reconciliations_update" ON fuel_reconciliations
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN role_permissions rp ON rp.role_id = ur.role_id
      JOIN permissions p        ON p.id = rp.permission_id
      WHERE ur.user_id = auth.uid()
        AND ur.site_id = fuel_reconciliations.site_id
        AND p.code     IN ('fuel.create', 'fuel.approve')
    )
  );
