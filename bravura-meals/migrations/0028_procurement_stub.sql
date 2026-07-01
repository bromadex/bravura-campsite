-- ── Procurement stub — module integration seed ──────────────────────────────
-- Creates the procurement_requisitions table used by the fuel-procurement-hook
-- Edge Function. Any module (fuel, inventory, maintenance) can insert into it
-- to request purchase orders; the future Procurement module will adopt this
-- table as its canonical requisition register.

CREATE TABLE IF NOT EXISTS procurement_requisitions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id                UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  requisition_number     TEXT NOT NULL,
  source_module          TEXT,
  source_reference_id    UUID,
  item_description       TEXT NOT NULL,
  quantity               NUMERIC(12,3) NOT NULL,
  unit                   TEXT,
  estimated_unit_cost    NUMERIC(10,4),
  total_estimated_cost   NUMERIC(15,2),
  justification          TEXT,
  status                 TEXT NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'approved', 'ordered', 'received', 'cancelled')),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by             UUID REFERENCES profiles(id),
  UNIQUE (site_id, requisition_number)
);

CREATE INDEX IF NOT EXISTS procurement_requisitions_site_status_idx
  ON procurement_requisitions(site_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS procurement_requisitions_source_idx
  ON procurement_requisitions(source_module, source_reference_id);

ALTER TABLE procurement_requisitions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS procurement_requisitions_read ON procurement_requisitions;
CREATE POLICY procurement_requisitions_read ON procurement_requisitions
  FOR SELECT USING (site_id IN (SELECT site_id FROM user_sites WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS procurement_requisitions_insert_service ON procurement_requisitions;
CREATE POLICY procurement_requisitions_insert_service ON procurement_requisitions
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS procurement_requisitions_update_site ON procurement_requisitions;
CREATE POLICY procurement_requisitions_update_site ON procurement_requisitions
  FOR UPDATE USING (site_id IN (SELECT site_id FROM user_sites WHERE user_id = auth.uid()));

COMMENT ON TABLE procurement_requisitions IS 'Cross-module purchase requisition register. Seeded by Fuel Phase 4 (auto-requisition on low tank). Adopted by the Procurement module when built.';
