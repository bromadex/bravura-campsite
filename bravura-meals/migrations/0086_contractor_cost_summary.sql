BEGIN;

-- Cross-module cost aggregation for the Contractors (CL) module, Phase 3.
-- Pulls together everything we can reliably attribute to a contractor:
--   labour    -> approved casual_timesheets.total_cost
--   vehicles  -> hired_vehicles.daily_rate * days active within the period
--   equipment -> hired_equipment.daily_rate * days active within the period
--   fuel      -> fuel_transactions issued to a hired vehicle's fleet_asset_id
--   contract  -> contractor_contracts.contract_value / spent_to_date
-- Meals/accommodation are not included yet — contractor_employees/
-- casual_workers aren't linked to meal_logs or room_assignments today.
CREATE OR REPLACE FUNCTION public.rpc_contractor_cost_summary(
  p_site_id   UUID,
  p_date_from DATE,
  p_date_to   DATE
)
RETURNS TABLE (
  contractor_id   UUID,
  contractor_name TEXT,
  labour_cost     NUMERIC,
  vehicle_cost    NUMERIC,
  equipment_cost  NUMERIC,
  fuel_cost       NUMERIC,
  contract_value  NUMERIC,
  spent_to_date   NUMERIC,
  total_cost      NUMERIC
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
    COALESCE(k.contract_value, 0),
    COALESCE(k.spent_to_date, 0),
    COALESCE(l.labour_cost, 0) + COALESCE(v.vehicle_cost, 0)
      + COALESCE(e.equipment_cost, 0) + COALESCE(f.fuel_cost, 0) AS total_cost
  FROM contractors c
  LEFT JOIN labour    l ON l.contractor_id = c.id
  LEFT JOIN vehicles  v ON v.contractor_id = c.id
  LEFT JOIN equipment e ON e.contractor_id = c.id
  LEFT JOIN fuel       f ON f.contractor_id = c.id
  LEFT JOIN contracts  k ON k.contractor_id = c.id
  WHERE c.is_archived IS NOT TRUE
    AND (c.site_id IS NULL OR c.site_id = p_site_id)
  ORDER BY total_cost DESC;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_contractor_cost_summary(UUID, DATE, DATE) TO authenticated;

INSERT INTO public.schema_migrations (filename)
VALUES ('0086_contractor_cost_summary.sql') ON CONFLICT (filename) DO NOTHING;

COMMIT;
