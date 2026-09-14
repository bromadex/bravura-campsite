-- Migration: 0158_finance_cost_centres.sql
-- Phase 4: Cost Centres for Finance module
-- Adds cost_centres table and cost_centre_id to journal_lines

BEGIN;

-- ── Cost Centres table ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cost_centres (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id     uuid NOT NULL REFERENCES sites(id),
  code        text NOT NULL,
  name        text NOT NULL,
  description text,
  module      text,  -- optional link to source module (fuel, fleet, meals, hr, etc.)
  is_archived boolean NOT NULL DEFAULT false,
  created_by  uuid REFERENCES profiles(id),
  updated_by  uuid REFERENCES profiles(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, code)
);

ALTER TABLE cost_centres ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cost_centres_select" ON cost_centres FOR SELECT
  USING (_has_permission('FI01', site_id));
CREATE POLICY "cost_centres_insert" ON cost_centres FOR INSERT
  WITH CHECK (_has_permission('FI03', site_id));
CREATE POLICY "cost_centres_update" ON cost_centres FOR UPDATE
  USING (_has_permission('FI04', site_id));

-- ── Add cost_centre_id to journal_lines ─────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'journal_lines' AND column_name = 'cost_centre_id'
  ) THEN
    ALTER TABLE journal_lines ADD COLUMN cost_centre_id uuid REFERENCES cost_centres(id);
  END IF;
END $$;

-- ── Seed default cost centres ───────────────────────────────────────────────
-- These match the ERP modules; sites can add custom ones later.
-- Using a CTE to get site IDs to avoid hardcoding.
INSERT INTO cost_centres (site_id, code, name, module)
SELECT s.id, cc.code, cc.name, cc.module
FROM sites s
CROSS JOIN (VALUES
  ('CC-GEN',  'General & Admin',     NULL),
  ('CC-FUEL', 'Fuel Operations',     'fuel'),
  ('CC-FLT',  'Fleet & Transport',   'fleet'),
  ('CC-MLZ',  'Meals & Catering',    'meals'),
  ('CC-CMP',  'Camp & Accommodation','campsite'),
  ('CC-HR',   'Human Resources',     'hr'),
  ('CC-PROC', 'Procurement',         'procurement')
) AS cc(code, name, module)
ON CONFLICT (site_id, code) DO NOTHING;

-- ── Self-record ─────────────────────────────────────────────────────────────
INSERT INTO schema_migrations (filename) VALUES ('0158_finance_cost_centres.sql')
ON CONFLICT DO NOTHING;

COMMIT;
