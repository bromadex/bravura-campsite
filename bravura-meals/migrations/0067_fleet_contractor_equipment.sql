BEGIN;

CREATE TABLE IF NOT EXISTS fleet_contractor_equipment (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id           UUID          NOT NULL REFERENCES sites(id),
  contractor_id     UUID          REFERENCES contractors(id),
  contractor_name   TEXT          NOT NULL,
  asset_description TEXT          NOT NULL,
  asset_type        TEXT,           -- 'excavator', 'truck', 'crane', 'loader', 'other'
  registration      TEXT,
  serial_number     TEXT,
  make              TEXT,
  model             TEXT,
  year              INTEGER,
  daily_rate        NUMERIC(12,2),
  monthly_rate      NUMERIC(12,2),
  hire_start_date   DATE          NOT NULL,
  hire_end_date     DATE,
  status            TEXT          NOT NULL DEFAULT 'on_hire',
    -- 'on_hire' | 'off_hire' | 'standby' | 'returned'
  project           TEXT,
  department_id     UUID,
  department_name   TEXT,
  insurance_expiry  DATE,
  fitness_cert_expiry DATE,
  operator_name     TEXT,
  operator_contact  TEXT,
  notes             TEXT,
  is_archived       BOOLEAN       NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by        UUID          REFERENCES profiles(id)
);

CREATE INDEX IF NOT EXISTS fleet_contractor_eq_site ON fleet_contractor_equipment(site_id);
CREATE INDEX IF NOT EXISTS fleet_contractor_eq_contractor ON fleet_contractor_equipment(contractor_id);

ALTER TABLE fleet_contractor_equipment ENABLE ROW LEVEL SECURITY;

CREATE POLICY fleet_contractor_eq_read ON fleet_contractor_equipment FOR SELECT TO authenticated USING (true);
CREATE POLICY fleet_contractor_eq_insert ON fleet_contractor_equipment FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY fleet_contractor_eq_update ON fleet_contractor_equipment FOR UPDATE TO authenticated USING (true);
CREATE POLICY fleet_contractor_eq_delete ON fleet_contractor_equipment FOR DELETE TO authenticated USING (true);

COMMIT;
