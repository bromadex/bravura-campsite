-- 0099 — Enhance contractor cost summary RPC with meals and accommodation
-- Requires 0097 (employee_id FK on contractor_employees / casual_workers).
-- Adds meal_cost and accommodation_cost columns to the cross-module aggregation.

BEGIN;

CREATE OR REPLACE FUNCTION public.rpc_contractor_cost_summary(
  p_site_id   UUID,
  p_date_from DATE,
  p_date_to   DATE
)
RETURNS TABLE (
  contractor_id      UUID,
  contractor_name    TEXT,
  labour_cost        NUMERIC,
  vehicle_cost       NUMERIC,
  equipment_cost     NUMERIC,
  fuel_cost          NUMERIC,
  meal_cost          NUMERIC,
  accommodation_cost NUMERIC,
  contract_value     NUMERIC,
  spent_to_date      NUMERIC,
  total_cost         NUMERIC
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH labour AS (
    SELECT contractor_id, COALESCE(SUM(total_cost), 0) AS labour_cost
    FROM casual_timesheets
    WHERE site_id = p_site_id AND approved = true
      AND date BETWEEN p_date_from AND p_date_to
    GROUP BY contractor_id
  ),
  vehicles AS (
    SELECT contractor_id,
      COALESCE(SUM(
        COALESCE(daily_rate, 0) * GREATEST(0,
          (LEAST(COALESCE(end_date, p_date_to), p_date_to)
           - GREATEST(start_date, p_date_from) + 1)
        )
      ), 0) AS vehicle_cost
    FROM hired_vehicles
    WHERE site_id = p_site_id AND is_archived IS NOT TRUE
      AND start_date <= p_date_to AND COALESCE(end_date, p_date_to) >= p_date_from
    GROUP BY contractor_id
  ),
  equipment AS (
    SELECT contractor_id,
      COALESCE(SUM(
        COALESCE(daily_rate, 0) * GREATEST(0,
          (LEAST(COALESCE(end_date, p_date_to), p_date_to)
           - GREATEST(start_date, p_date_from) + 1)
        )
      ), 0) AS equipment_cost
    FROM hired_equipment
    WHERE site_id = p_site_id AND is_archived IS NOT TRUE
      AND start_date <= p_date_to AND COALESCE(end_date, p_date_to) >= p_date_from
    GROUP BY contractor_id
  ),
  fuel AS (
    SELECT hv.contractor_id, COALESCE(SUM(ft.total_cost), 0) AS fuel_cost
    FROM fuel_transactions ft
    JOIN hired_vehicles hv ON hv.fleet_asset_id = ft.fleet_asset_id AND hv.site_id = p_site_id
    WHERE ft.site_id = p_site_id AND ft.is_deleted IS NOT TRUE
      AND ft.transaction_type = 'issuance'
      AND ft.transaction_date BETWEEN p_date_from AND p_date_to
    GROUP BY hv.contractor_id
  ),
  -- Meal costs: contractor_employees + casual_workers linked via employee_id
  contractor_emp_ids AS (
    SELECT ce.contractor_id, ce.employee_id
    FROM contractor_employees ce
    WHERE ce.site_id = p_site_id AND ce.employee_id IS NOT NULL AND ce.meals_authorised = true
    UNION ALL
    SELECT cw.contractor_id, cw.employee_id
    FROM casual_workers cw
    WHERE cw.site_id = p_site_id AND cw.employee_id IS NOT NULL
  ),
  meals AS (
    SELECT cei.contractor_id,
      COALESCE(SUM(
        CASE WHEN ml.had_breakfast THEN COALESCE(mp.breakfast_usd, 0) ELSE 0 END
        + CASE WHEN ml.had_lunch THEN COALESCE(mp.lunch_usd, 0) ELSE 0 END
        + CASE WHEN ml.had_supper THEN COALESCE(mp.supper_usd, 0) ELSE 0 END
      ), 0) AS meal_cost
    FROM contractor_emp_ids cei
    JOIN meal_logs ml ON ml.employee_id = cei.employee_id
      AND ml.date BETWEEN p_date_from AND p_date_to
    LEFT JOIN LATERAL (
      SELECT breakfast_usd, lunch_usd, supper_usd
      FROM meal_prices
      WHERE site_id = p_site_id AND effective_date <= ml.date
      ORDER BY effective_date DESC LIMIT 1
    ) mp ON true
    GROUP BY cei.contractor_id
  ),
  -- Accommodation: contractor_employees with accommodation_id (room_assignments)
  accommodation AS (
    SELECT ce.contractor_id,
      COUNT(DISTINCT ce.id) AS housed_workers
    FROM contractor_employees ce
    WHERE ce.site_id = p_site_id
      AND ce.accommodation_id IS NOT NULL
      AND ce.is_archived IS NOT TRUE
    GROUP BY ce.contractor_id
  ),
  contracts AS (
    SELECT contractor_id,
      COALESCE(SUM(contract_value), 0) AS contract_value,
      COALESCE(SUM(spent_to_date), 0)  AS spent_to_date
    FROM contractor_contracts
    WHERE site_id = p_site_id
    GROUP BY contractor_id
  )
  SELECT
    c.id, c.name,
    COALESCE(l.labour_cost, 0),
    COALESCE(v.vehicle_cost, 0),
    COALESCE(e.equipment_cost, 0),
    COALESCE(f.fuel_cost, 0),
    COALESCE(m.meal_cost, 0),
    -- Accommodation: housed_workers * days in period * notional daily rate ($5 placeholder)
    COALESCE(a.housed_workers, 0) * GREATEST(0, p_date_to - p_date_from + 1) * 5.00,
    COALESCE(k.contract_value, 0),
    COALESCE(k.spent_to_date, 0),
    COALESCE(l.labour_cost, 0) + COALESCE(v.vehicle_cost, 0)
      + COALESCE(e.equipment_cost, 0) + COALESCE(f.fuel_cost, 0)
      + COALESCE(m.meal_cost, 0)
      + COALESCE(a.housed_workers, 0) * GREATEST(0, p_date_to - p_date_from + 1) * 5.00
    AS total_cost
  FROM contractors c
  LEFT JOIN labour        l ON l.contractor_id = c.id
  LEFT JOIN vehicles      v ON v.contractor_id = c.id
  LEFT JOIN equipment     e ON e.contractor_id = c.id
  LEFT JOIN fuel          f ON f.contractor_id = c.id
  LEFT JOIN meals         m ON m.contractor_id = c.id
  LEFT JOIN accommodation a ON a.contractor_id = c.id
  LEFT JOIN contracts     k ON k.contractor_id = c.id
  WHERE c.is_archived IS NOT TRUE
    AND (c.site_id IS NULL OR c.site_id = p_site_id)
  ORDER BY total_cost DESC;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_contractor_cost_summary(UUID, DATE, DATE) TO authenticated;

INSERT INTO public.schema_migrations (filename)
VALUES ('0099_contractor_cost_with_meals.sql') ON CONFLICT (filename) DO NOTHING;

COMMIT;
