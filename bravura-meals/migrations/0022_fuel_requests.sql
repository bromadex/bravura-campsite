-- ── Fuel Requests ────────────────────────────────────────────────────────────
-- Allows any site user to raise a fuel request; approvers action them;
-- issuance links back via issued_transaction_id.

CREATE TABLE IF NOT EXISTS fuel_requests (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id               UUID          NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  request_number        TEXT          NOT NULL,
  requested_by          UUID          NOT NULL REFERENCES profiles(id),
  vehicle_id            UUID          REFERENCES fuel_vehicles(id),
  equipment_id          UUID          REFERENCES fuel_equipment(id),
  fuel_type_id          UUID          NOT NULL REFERENCES fuel_types(id),
  quantity_requested    NUMERIC(12,3) NOT NULL CHECK (quantity_requested > 0),
  intended_use          TEXT,
  priority              TEXT          NOT NULL DEFAULT 'normal'
                                        CHECK (priority IN ('normal','urgent','emergency')),
  status                TEXT          NOT NULL DEFAULT 'pending'
                                        CHECK (status IN ('pending','approved','rejected','issued','cancelled')),
  approved_by           UUID          REFERENCES profiles(id),
  approved_at           TIMESTAMPTZ,
  rejected_reason       TEXT,
  issued_transaction_id UUID          REFERENCES fuel_transactions(id),
  issued_at             TIMESTAMPTZ,
  notes                 TEXT,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by            UUID          REFERENCES profiles(id),
  UNIQUE (site_id, request_number),
  CHECK (vehicle_id IS NOT NULL OR equipment_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS fuel_requests_site_id_idx    ON fuel_requests(site_id);
CREATE INDEX IF NOT EXISTS fuel_requests_status_idx     ON fuel_requests(site_id, status);
CREATE INDEX IF NOT EXISTS fuel_requests_requested_by   ON fuel_requests(requested_by);

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE fuel_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fuel_requests_select" ON fuel_requests;
DROP POLICY IF EXISTS "fuel_requests_insert" ON fuel_requests;
DROP POLICY IF EXISTS "fuel_requests_update" ON fuel_requests;

-- Any authenticated user at this site can view requests
CREATE POLICY "fuel_requests_select" ON fuel_requests
  FOR SELECT USING (
    site_id IN (
      SELECT site_id FROM user_roles WHERE user_id = auth.uid()
    )
  );

-- Any authenticated user at this site can INSERT their own request
CREATE POLICY "fuel_requests_insert" ON fuel_requests
  FOR INSERT WITH CHECK (
    site_id IN (
      SELECT site_id FROM user_roles WHERE user_id = auth.uid()
    )
    AND requested_by = auth.uid()
    AND created_by   = auth.uid()
  );

-- Only fuel.approve holders can UPDATE (approve/reject/cancel)
CREATE POLICY "fuel_requests_update" ON fuel_requests
  FOR UPDATE USING (
    EXISTS (
      SELECT 1
      FROM user_roles ur
      JOIN role_permissions rp ON rp.role_id = ur.role_id
      JOIN permissions p        ON p.id = rp.permission_id
      WHERE ur.user_id = auth.uid()
        AND ur.site_id = fuel_requests.site_id
        AND p.code     = 'fuel.approve'
    )
  );
