-- 0159 — Concrete Operations module foundation
-- Tables: aggregate_types, mix_designs, mix_design_aggregates, concrete_batches,
--         batch_aggregates, cement_deliveries, aggregate_deliveries, cube_tests,
--         batch_plant_settings
-- Permissions: concrete.view/create/edit/delete/approve

BEGIN;

-- ── Aggregate Types ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS aggregate_types (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id     UUID NOT NULL REFERENCES sites(id),
  name        TEXT NOT NULL,
  unit        TEXT NOT NULL DEFAULT 'kg' CHECK (unit IN ('kg', 'tonnes')),
  is_archived BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_aggregate_types_site ON aggregate_types(site_id);

-- ── Mix Designs ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mix_designs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id             UUID NOT NULL REFERENCES sites(id),
  grade               TEXT NOT NULL,
  name                TEXT,
  description         TEXT,
  cement_kg_per_m3    NUMERIC(10,2) NOT NULL,
  water_litres_per_m3 NUMERIC(10,2) NOT NULL,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  is_archived         BOOLEAN NOT NULL DEFAULT false,
  created_by          UUID REFERENCES profiles(id),
  updated_by          UUID REFERENCES profiles(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_mix_designs_site ON mix_designs(site_id);

-- ── Mix Design Aggregates ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mix_design_aggregates (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mix_design_id     UUID NOT NULL REFERENCES mix_designs(id) ON DELETE CASCADE,
  aggregate_type_id UUID NOT NULL REFERENCES aggregate_types(id),
  quantity_kg_per_m3 NUMERIC(10,2) NOT NULL,
  UNIQUE (mix_design_id, aggregate_type_id)
);

CREATE INDEX idx_mix_design_agg_design ON mix_design_aggregates(mix_design_id);

-- ── Concrete Batches ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS concrete_batches (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id           UUID NOT NULL REFERENCES sites(id),
  batch_number      TEXT NOT NULL,
  mix_design_id     UUID NOT NULL REFERENCES mix_designs(id),
  project_id        UUID REFERENCES projects(id),
  grade             TEXT NOT NULL,
  quantity_m3       NUMERIC(10,3) NOT NULL,
  actual_cement_kg  NUMERIC(10,2),
  actual_water_litres NUMERIC(10,2),
  fleet_asset_id    UUID REFERENCES fleet_assets(id),
  driver_id         UUID REFERENCES profiles(id),
  dispatch_time     TIMESTAMPTZ,
  return_time       TIMESTAMPTZ,
  delivery_location TEXT,
  customer_notes    TEXT,
  status            TEXT NOT NULL DEFAULT 'mixing'
                      CHECK (status IN ('mixing', 'dispatched', 'delivered', 'cancelled')),
  is_archived       BOOLEAN NOT NULL DEFAULT false,
  created_by        UUID REFERENCES profiles(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (site_id, batch_number)
);

CREATE INDEX idx_concrete_batches_site ON concrete_batches(site_id);
CREATE INDEX idx_concrete_batches_project ON concrete_batches(project_id);
CREATE INDEX idx_concrete_batches_date ON concrete_batches(created_at);

-- ── Batch Aggregates ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS batch_aggregates (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id            UUID NOT NULL REFERENCES concrete_batches(id) ON DELETE CASCADE,
  aggregate_type_id   UUID NOT NULL REFERENCES aggregate_types(id),
  theoretical_qty_kg  NUMERIC(10,2) NOT NULL,
  actual_qty_kg       NUMERIC(10,2),
  UNIQUE (batch_id, aggregate_type_id)
);

CREATE INDEX idx_batch_agg_batch ON batch_aggregates(batch_id);

-- ── Cement Deliveries ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cement_deliveries (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id               UUID NOT NULL REFERENCES sites(id),
  supplier              TEXT,
  delivery_note_number  TEXT,
  truck_registration    TEXT,
  quantity_kg           NUMERIC(12,2) NOT NULL,
  unit_cost             NUMERIC(12,4),
  total_cost            NUMERIC(14,2),
  silo_number           TEXT,
  delivery_date         DATE NOT NULL DEFAULT CURRENT_DATE,
  notes                 TEXT,
  is_archived           BOOLEAN NOT NULL DEFAULT false,
  created_by            UUID REFERENCES profiles(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_cement_deliveries_site ON cement_deliveries(site_id);

-- ── Aggregate Deliveries ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS aggregate_deliveries (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id               UUID NOT NULL REFERENCES sites(id),
  aggregate_type_id     UUID NOT NULL REFERENCES aggregate_types(id),
  supplier              TEXT,
  delivery_note_number  TEXT,
  quantity_kg           NUMERIC(12,2) NOT NULL,
  unit_cost             NUMERIC(12,4),
  total_cost            NUMERIC(14,2),
  stockpile_location    TEXT,
  delivery_date         DATE NOT NULL DEFAULT CURRENT_DATE,
  notes                 TEXT,
  is_archived           BOOLEAN NOT NULL DEFAULT false,
  created_by            UUID REFERENCES profiles(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_aggregate_deliveries_site ON aggregate_deliveries(site_id);

-- ── Cube Tests ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cube_tests (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id             UUID NOT NULL REFERENCES sites(id),
  batch_id            UUID NOT NULL REFERENCES concrete_batches(id),
  sample_number       TEXT NOT NULL,
  test_date_7day      DATE,
  result_7day_mpa     NUMERIC(8,2),
  test_date_28day     DATE,
  result_28day_mpa    NUMERIC(8,2),
  target_strength_mpa NUMERIC(8,2) NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'pass', 'fail')),
  tested_by           UUID REFERENCES profiles(id),
  notes               TEXT,
  is_archived         BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_cube_tests_site ON cube_tests(site_id);
CREATE INDEX idx_cube_tests_batch ON cube_tests(batch_id);

-- ── Batch Plant Settings ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS batch_plant_settings (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id                 UUID NOT NULL REFERENCES sites(id),
  setting_key             TEXT NOT NULL,
  setting_value           TEXT NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (site_id, setting_key)
);

CREATE INDEX idx_batch_plant_settings_site ON batch_plant_settings(site_id);

-- ── RLS Policies ─────────────────────────────────────────────────────────────
ALTER TABLE aggregate_types        ENABLE ROW LEVEL SECURITY;
ALTER TABLE mix_designs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE mix_design_aggregates  ENABLE ROW LEVEL SECURITY;
ALTER TABLE concrete_batches       ENABLE ROW LEVEL SECURITY;
ALTER TABLE batch_aggregates       ENABLE ROW LEVEL SECURITY;
ALTER TABLE cement_deliveries      ENABLE ROW LEVEL SECURITY;
ALTER TABLE aggregate_deliveries   ENABLE ROW LEVEL SECURITY;
ALTER TABLE cube_tests             ENABLE ROW LEVEL SECURITY;
ALTER TABLE batch_plant_settings   ENABLE ROW LEVEL SECURITY;

-- View policies
CREATE POLICY aggregate_types_select ON aggregate_types FOR SELECT
  USING (_has_permission('concrete.view', site_id));
CREATE POLICY mix_designs_select ON mix_designs FOR SELECT
  USING (_has_permission('concrete.view', site_id));
CREATE POLICY mix_design_aggregates_select ON mix_design_aggregates FOR SELECT
  USING (EXISTS (SELECT 1 FROM mix_designs md WHERE md.id = mix_design_aggregates.mix_design_id AND _has_permission('concrete.view', md.site_id)));
CREATE POLICY concrete_batches_select ON concrete_batches FOR SELECT
  USING (_has_permission('concrete.view', site_id));
CREATE POLICY batch_aggregates_select ON batch_aggregates FOR SELECT
  USING (EXISTS (SELECT 1 FROM concrete_batches cb WHERE cb.id = batch_aggregates.batch_id AND _has_permission('concrete.view', cb.site_id)));
CREATE POLICY cement_deliveries_select ON cement_deliveries FOR SELECT
  USING (_has_permission('concrete.view', site_id));
CREATE POLICY aggregate_deliveries_select ON aggregate_deliveries FOR SELECT
  USING (_has_permission('concrete.view', site_id));
CREATE POLICY cube_tests_select ON cube_tests FOR SELECT
  USING (_has_permission('concrete.view', site_id));
CREATE POLICY batch_plant_settings_select ON batch_plant_settings FOR SELECT
  USING (_has_permission('concrete.view', site_id));

-- Insert policies
CREATE POLICY aggregate_types_insert ON aggregate_types FOR INSERT
  WITH CHECK (_has_permission('concrete.create', site_id));
CREATE POLICY mix_designs_insert ON mix_designs FOR INSERT
  WITH CHECK (_has_permission('concrete.create', site_id));
CREATE POLICY mix_design_aggregates_insert ON mix_design_aggregates FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM mix_designs md WHERE md.id = mix_design_aggregates.mix_design_id AND _has_permission('concrete.create', md.site_id)));
CREATE POLICY concrete_batches_insert ON concrete_batches FOR INSERT
  WITH CHECK (_has_permission('concrete.create', site_id));
CREATE POLICY batch_aggregates_insert ON batch_aggregates FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM concrete_batches cb WHERE cb.id = batch_aggregates.batch_id AND _has_permission('concrete.create', cb.site_id)));
CREATE POLICY cement_deliveries_insert ON cement_deliveries FOR INSERT
  WITH CHECK (_has_permission('concrete.create', site_id));
CREATE POLICY aggregate_deliveries_insert ON aggregate_deliveries FOR INSERT
  WITH CHECK (_has_permission('concrete.create', site_id));
CREATE POLICY cube_tests_insert ON cube_tests FOR INSERT
  WITH CHECK (_has_permission('concrete.create', site_id));
CREATE POLICY batch_plant_settings_insert ON batch_plant_settings FOR INSERT
  WITH CHECK (_has_permission('concrete.create', site_id));

-- Update policies
CREATE POLICY aggregate_types_update ON aggregate_types FOR UPDATE
  USING (_has_permission('concrete.edit', site_id));
CREATE POLICY mix_designs_update ON mix_designs FOR UPDATE
  USING (_has_permission('concrete.edit', site_id));
CREATE POLICY mix_design_aggregates_update ON mix_design_aggregates FOR UPDATE
  USING (EXISTS (SELECT 1 FROM mix_designs md WHERE md.id = mix_design_aggregates.mix_design_id AND _has_permission('concrete.edit', md.site_id)));
CREATE POLICY concrete_batches_update ON concrete_batches FOR UPDATE
  USING (_has_permission('concrete.edit', site_id));
CREATE POLICY batch_aggregates_update ON batch_aggregates FOR UPDATE
  USING (EXISTS (SELECT 1 FROM concrete_batches cb WHERE cb.id = batch_aggregates.batch_id AND _has_permission('concrete.edit', cb.site_id)));
CREATE POLICY cement_deliveries_update ON cement_deliveries FOR UPDATE
  USING (_has_permission('concrete.edit', site_id));
CREATE POLICY aggregate_deliveries_update ON aggregate_deliveries FOR UPDATE
  USING (_has_permission('concrete.edit', site_id));
CREATE POLICY cube_tests_update ON cube_tests FOR UPDATE
  USING (_has_permission('concrete.edit', site_id));
CREATE POLICY batch_plant_settings_update ON batch_plant_settings FOR UPDATE
  USING (_has_permission('concrete.edit', site_id));

-- Delete policies (soft-delete only, but RLS still needed)
CREATE POLICY aggregate_types_delete ON aggregate_types FOR DELETE
  USING (_has_permission('concrete.delete', site_id));
CREATE POLICY mix_designs_delete ON mix_designs FOR DELETE
  USING (_has_permission('concrete.delete', site_id));
CREATE POLICY concrete_batches_delete ON concrete_batches FOR DELETE
  USING (_has_permission('concrete.delete', site_id));
CREATE POLICY cement_deliveries_delete ON cement_deliveries FOR DELETE
  USING (_has_permission('concrete.delete', site_id));
CREATE POLICY aggregate_deliveries_delete ON aggregate_deliveries FOR DELETE
  USING (_has_permission('concrete.delete', site_id));
CREATE POLICY cube_tests_delete ON cube_tests FOR DELETE
  USING (_has_permission('concrete.delete', site_id));

-- ── Permissions ──────────────────────────────────────────────────────────────
INSERT INTO permissions (code, module, action, description) VALUES
  ('concrete.view',    'Concrete', 'View',    'View concrete operations data'),
  ('concrete.create',  'Concrete', 'Create',  'Create batches, deliveries, mix designs'),
  ('concrete.edit',    'Concrete', 'Edit',    'Edit concrete records'),
  ('concrete.delete',  'Concrete', 'Delete',  'Archive concrete records'),
  ('concrete.approve', 'Concrete', 'Approve', 'Approve batches and quality tests')
ON CONFLICT DO NOTHING;

-- ── Grant concrete permissions to System Administrator role ──────────────────
INSERT INTO role_permissions (role_id, permission_id)
SELECT '85928d6a-e1f8-45e4-95c0-b467b6baeef8', p.id
FROM permissions p
WHERE p.module = 'Concrete'
ON CONFLICT DO NOTHING;

-- ── Seed default aggregate types for Kamativi ────────────────────────────────
INSERT INTO aggregate_types (site_id, name, unit) VALUES
  ('fe3f29ed-e1d4-44a2-b409-9a15a98eba97', '10mm Stone',    'kg'),
  ('fe3f29ed-e1d4-44a2-b409-9a15a98eba97', '20mm Stone',    'kg'),
  ('fe3f29ed-e1d4-44a2-b409-9a15a98eba97', '40mm Stone',    'kg'),
  ('fe3f29ed-e1d4-44a2-b409-9a15a98eba97', 'Crusher Dust',  'kg'),
  ('fe3f29ed-e1d4-44a2-b409-9a15a98eba97', 'River Sand',    'kg')
ON CONFLICT DO NOTHING;

-- ── Seed default batch plant settings for Kamativi ───────────────────────────
INSERT INTO batch_plant_settings (site_id, setting_key, setting_value) VALUES
  ('fe3f29ed-e1d4-44a2-b409-9a15a98eba97', 'cement_min_stock_kg',    '5000'),
  ('fe3f29ed-e1d4-44a2-b409-9a15a98eba97', 'cement_lead_time_days',  '7'),
  ('fe3f29ed-e1d4-44a2-b409-9a15a98eba97', 'batch_number_prefix',    'BTH'),
  ('fe3f29ed-e1d4-44a2-b409-9a15a98eba97', 'safety_factor',          '1.2')
ON CONFLICT DO NOTHING;

-- ── Self-record ──────────────────────────────────────────────────────────────
INSERT INTO schema_migrations (filename)
VALUES ('0159_concrete_operations.sql')
ON CONFLICT DO NOTHING;

COMMIT;
