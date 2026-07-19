-- 0150 — HR Analytics server-side RPCs
-- Cross-module workforce cost summary + department analytics

BEGIN;

-- 1. Workforce cost summary per employee: meals, accommodation, fleet usage
CREATE OR REPLACE FUNCTION public.rpc_workforce_cost_summary(
  p_site_id   UUID,
  p_date_from DATE,
  p_date_to   DATE
)
RETURNS TABLE (
  employee_id        UUID,
  employee_name      TEXT,
  department         TEXT,
  status             TEXT,
  meal_cost          NUMERIC,
  accommodation_days BIGINT,
  fleet_trips        BIGINT,
  leave_days         NUMERIC,
  skills_count       BIGINT,
  total_cost         NUMERIC
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH meals AS (
    SELECT ml.employee_id,
      COALESCE(SUM(
        CASE WHEN ml.had_breakfast THEN COALESCE(mp.breakfast_usd, 0) ELSE 0 END
        + CASE WHEN ml.had_lunch THEN COALESCE(mp.lunch_usd, 0) ELSE 0 END
        + CASE WHEN ml.had_supper THEN COALESCE(mp.supper_usd, 0) ELSE 0 END
      ), 0) AS meal_cost
    FROM meal_logs ml
    JOIN daily_submissions ds ON ds.id = ml.submission_id
    LEFT JOIN LATERAL (
      SELECT breakfast_usd, lunch_usd, supper_usd
      FROM meal_prices
      WHERE site_id = p_site_id AND effective_date <= ml.date
      ORDER BY effective_date DESC LIMIT 1
    ) mp ON true
    WHERE ds.site_id = p_site_id
      AND ml.date BETWEEN p_date_from AND p_date_to
    GROUP BY ml.employee_id
  ),
  accommodation AS (
    SELECT ra.employee_id, COUNT(DISTINCT ra.id) AS accommodation_days
    FROM room_assignments ra
    WHERE ra.site_id = p_site_id
      AND ra.status = 'active'
    GROUP BY ra.employee_id
  ),
  fleet AS (
    SELECT ft.operator_id AS employee_id, COUNT(*) AS fleet_trips
    FROM fleet_trips ft
    WHERE ft.site_id = p_site_id
      AND ft.trip_date BETWEEN p_date_from AND p_date_to
    GROUP BY ft.operator_id
  ),
  leave_data AS (
    SELECT lr.employee_id,
      COALESCE(SUM(lr.days_requested), 0) AS leave_days
    FROM leave_requests lr
    WHERE lr.site_id = p_site_id
      AND lr.status = 'approved'
      AND lr.start_date <= p_date_to AND lr.end_date >= p_date_from
    GROUP BY lr.employee_id
  ),
  skills AS (
    SELECT es.employee_id, COUNT(*) AS skills_count
    FROM employee_skills es
    GROUP BY es.employee_id
  )
  SELECT
    e.id,
    e.name,
    d.name AS department,
    e.status,
    COALESCE(m.meal_cost, 0),
    COALESCE(a.accommodation_days, 0),
    COALESCE(fl.fleet_trips, 0),
    COALESCE(lv.leave_days, 0),
    COALESCE(sk.skills_count, 0),
    COALESCE(m.meal_cost, 0) AS total_cost
  FROM employees e
  LEFT JOIN departments d ON d.id = e.department_id
  LEFT JOIN meals m ON m.employee_id = e.id
  LEFT JOIN accommodation a ON a.employee_id = e.id
  LEFT JOIN fleet fl ON fl.employee_id = e.id
  LEFT JOIN leave_data lv ON lv.employee_id = e.id
  LEFT JOIN skills sk ON sk.employee_id = e.id
  WHERE e.site_id = p_site_id
    AND e.is_archived IS NOT TRUE
  ORDER BY total_cost DESC;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_workforce_cost_summary(UUID, DATE, DATE) TO authenticated;

-- 2. Department summary RPC
CREATE OR REPLACE FUNCTION public.rpc_department_analytics(
  p_site_id UUID
)
RETURNS TABLE (
  department_id   UUID,
  department_name TEXT,
  headcount       BIGINT,
  active_count    BIGINT,
  on_leave_count  BIGINT,
  avg_tenure_days INTEGER
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    d.id,
    d.name,
    COUNT(e.id) AS headcount,
    COUNT(e.id) FILTER (WHERE e.status = 'active') AS active_count,
    COUNT(e.id) FILTER (WHERE e.status IN ('on_leave', 'long_leave')) AS on_leave_count,
    COALESCE(AVG(CURRENT_DATE - e.start_date), 0)::INTEGER AS avg_tenure_days
  FROM departments d
  LEFT JOIN employees e ON e.department_id = d.id
    AND e.site_id = p_site_id AND e.is_archived IS NOT TRUE
  WHERE d.site_id = p_site_id AND d.is_archived IS NOT TRUE
  GROUP BY d.id, d.name
  ORDER BY headcount DESC;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_department_analytics(UUID) TO authenticated;

INSERT INTO schema_migrations (filename) VALUES ('0150_hr_analytics_rpcs.sql')
ON CONFLICT DO NOTHING;

COMMIT;
