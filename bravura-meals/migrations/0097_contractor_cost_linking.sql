-- 0097 — Link contractor workers to meals and accommodation
-- Adds employee_id FK to contractor_employees so meal_logs and room_assignments
-- can be joined, plus a view for cross-module contractor cost aggregation.

BEGIN;

-- 1. Add employee_id to contractor_employees (nullable — not all have an ERP employee record)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'contractor_employees' AND column_name = 'employee_id'
  ) THEN
    ALTER TABLE contractor_employees
      ADD COLUMN employee_id UUID REFERENCES employees(id);
    CREATE INDEX idx_ce_employee_id ON contractor_employees(employee_id);
  END IF;
END $$;

-- 2. Add employee_id to casual_workers (nullable — links casual to ERP employee for meal/room lookup)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'casual_workers' AND column_name = 'employee_id'
  ) THEN
    ALTER TABLE casual_workers
      ADD COLUMN employee_id UUID REFERENCES employees(id);
    CREATE INDEX idx_cw_employee_id ON casual_workers(employee_id);
  END IF;
END $$;

-- 3. View: contractor worker cost summary including meals
CREATE OR REPLACE VIEW v_contractor_worker_costs AS
SELECT
  ce.id           AS worker_id,
  ce.name         AS worker_name,
  ce.contractor_id,
  c.name          AS contractor_name,
  ce.site_id,
  'contractor_employee' AS worker_type,
  ce.employee_id,
  ce.meals_authorised,
  ce.accommodation_id,
  -- Timesheet costs (last 30 days)
  COALESCE(ts.total_cost, 0) AS timesheet_cost_30d,
  -- Meal counts (last 30 days)
  COALESCE(ml.meal_count, 0) AS meal_count_30d
FROM contractor_employees ce
JOIN contractors c ON c.id = ce.contractor_id
LEFT JOIN LATERAL (
  SELECT SUM(ct.total_cost) AS total_cost
  FROM casual_timesheets ct
  WHERE ct.casual_worker_id = ce.id
    AND ct.date >= CURRENT_DATE - 30
    AND ct.approved = true
) ts ON true
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS meal_count
  FROM meal_logs ml2
  WHERE ml2.employee_id = ce.employee_id
    AND ml2.date >= CURRENT_DATE - 30
    AND (ml2.had_breakfast OR ml2.had_lunch OR ml2.had_supper)
) ml ON ce.employee_id IS NOT NULL

UNION ALL

SELECT
  cw.id           AS worker_id,
  cw.name         AS worker_name,
  cw.contractor_id,
  c2.name         AS contractor_name,
  cw.site_id,
  'casual_worker' AS worker_type,
  cw.employee_id,
  false           AS meals_authorised,
  NULL::uuid      AS accommodation_id,
  COALESCE(ts2.total_cost, 0) AS timesheet_cost_30d,
  COALESCE(ml2.meal_count, 0) AS meal_count_30d
FROM casual_workers cw
JOIN contractors c2 ON c2.id = cw.contractor_id
LEFT JOIN LATERAL (
  SELECT SUM(ct2.total_cost) AS total_cost
  FROM casual_timesheets ct2
  WHERE ct2.casual_worker_id = cw.id
    AND ct2.date >= CURRENT_DATE - 30
    AND ct2.approved = true
) ts2 ON true
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS meal_count
  FROM meal_logs ml3
  WHERE ml3.employee_id = cw.employee_id
    AND ml3.date >= CURRENT_DATE - 30
    AND (ml3.had_breakfast OR ml3.had_lunch OR ml3.had_supper)
) ml2 ON cw.employee_id IS NOT NULL;

-- 4. RLS: view inherits base table policies, no extra needed

INSERT INTO schema_migrations (filename) VALUES ('0097_contractor_cost_linking.sql')
ON CONFLICT DO NOTHING;

COMMIT;
