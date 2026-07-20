-- Migration: 0084_equipment_usage_log
-- Equipment usage/hours tracking for hired equipment costing

CREATE TABLE IF NOT EXISTS equipment_usage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES sites(id),
  equipment_id UUID NOT NULL REFERENCES hired_equipment(id),
  usage_date DATE NOT NULL,
  hours_worked NUMERIC(6,2) NOT NULL CHECK (hours_worked >= 0 AND hours_worked <= 24),
  operator_name TEXT,
  task_description TEXT,
  location TEXT,
  fuel_litres NUMERIC(8,2),
  downtime_hours NUMERIC(6,2) DEFAULT 0,
  notes TEXT,
  logged_by UUID REFERENCES auth.users(id),
  approved BOOLEAN DEFAULT false,
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ,
  is_archived BOOLEAN DEFAULT false,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(equipment_id, usage_date)
);

ALTER TABLE equipment_usage_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY eul_select ON equipment_usage_log FOR SELECT
  USING (site_id IN (SELECT site_id FROM user_roles WHERE user_id = auth.uid()));

CREATE POLICY eul_insert ON equipment_usage_log FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = auth.uid() AND ur.is_active = true
      AND p.code = 'contractors.create' AND ur.site_id = site_id
  ));

CREATE POLICY eul_update ON equipment_usage_log FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = auth.uid() AND ur.is_active = true
      AND p.code = 'contractors.edit' AND ur.site_id = equipment_usage_log.site_id
  ));

CREATE INDEX idx_eul_equipment ON equipment_usage_log(equipment_id);
CREATE INDEX idx_eul_site_date ON equipment_usage_log(site_id, usage_date);

INSERT INTO schema_migrations (filename) VALUES ('0084_equipment_usage_log.sql') ON CONFLICT DO NOTHING;
