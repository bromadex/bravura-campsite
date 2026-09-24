-- 0112: Employees record the meals they ate (today or yesterday) from My Camp.
-- They can only add meals; a meal the canteen already recorded is never removed here.
ALTER TABLE meal_logs ADD COLUMN IF NOT EXISTS self_reported BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION ess_log_meals(p_date DATE, p_breakfast BOOLEAN, p_lunch BOOLEAN, p_supper BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _e UUID := _ess_require_employee(); _name TEXT; _sub RECORD;
BEGIN
  IF p_date IS NULL OR p_date > CURRENT_DATE OR p_date < CURRENT_DATE - 1 THEN
    RAISE EXCEPTION 'You can record meals for today or yesterday only — ask the canteen to fix older days';
  END IF;
  IF NOT (COALESCE(p_breakfast,false) OR COALESCE(p_lunch,false) OR COALESCE(p_supper,false)) THEN
    RAISE EXCEPTION 'Tick at least one meal';
  END IF;
  -- Once the meals officer has submitted the day, the counts are locked for approval/billing.
  SELECT id, status INTO _sub FROM daily_submissions WHERE site_id = _ess_site() AND date = p_date LIMIT 1;
  IF _sub.id IS NOT NULL AND _sub.status <> 'draft' THEN
    RAISE EXCEPTION 'The meals officer has already submitted this day — ask them to add your meal';
  END IF;
  SELECT name INTO _name FROM employees WHERE id = _e;
  INSERT INTO meal_logs (employee_id, employee_name, date, breakfast, lunch, supper, had_breakfast, had_lunch, had_supper,
                         recorded_by, recorded_at, self_reported, submission_id)
  VALUES (_e, _name, p_date, COALESCE(p_breakfast,false), COALESCE(p_lunch,false), COALESCE(p_supper,false),
          COALESCE(p_breakfast,false), COALESCE(p_lunch,false), COALESCE(p_supper,false), auth.uid(), now(), true, _sub.id)
  ON CONFLICT (employee_id, date) DO UPDATE SET
    breakfast = meal_logs.breakfast OR EXCLUDED.breakfast, had_breakfast = COALESCE(meal_logs.had_breakfast,false) OR EXCLUDED.had_breakfast,
    lunch     = meal_logs.lunch     OR EXCLUDED.lunch,     had_lunch     = COALESCE(meal_logs.had_lunch,false)     OR EXCLUDED.had_lunch,
    supper    = meal_logs.supper    OR EXCLUDED.supper,    had_supper    = COALESCE(meal_logs.had_supper,false)    OR EXCLUDED.had_supper,
    self_reported = true, submission_id = COALESCE(meal_logs.submission_id, EXCLUDED.submission_id), recorded_by = auth.uid(), recorded_at = now(), updated_at = now();
END;
$$;
-- When the meals officer saves the day, the row becomes officer-confirmed.
CREATE OR REPLACE FUNCTION public.save_meal_logs(p_submission_id uuid, p_date date, p_logs jsonb)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_site_id uuid; v_status text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT site_id, status INTO v_site_id, v_status FROM public.daily_submissions WHERE id = p_submission_id;
  IF v_site_id IS NULL THEN RAISE EXCEPTION 'Submission not found'; END IF;
  IF v_status <> 'draft' THEN RAISE EXCEPTION 'Locked'; END IF;
  IF NOT public._has_meal_permission('meals.create', v_site_id) THEN RAISE EXCEPTION 'No permission'; END IF;
  INSERT INTO public.meal_logs (submission_id, date, employee_id, employee_name, had_breakfast, had_lunch, had_supper, recorded_by, recorded_at)
  SELECT p_submission_id, p_date, (row->>'employee_id')::uuid, row->>'employee_name',
    COALESCE((row->>'had_breakfast')::boolean, false), COALESCE((row->>'had_lunch')::boolean, false), COALESCE((row->>'had_supper')::boolean, false), auth.uid(), NOW()
  FROM jsonb_array_elements(p_logs) AS row
  ON CONFLICT (date, employee_id) DO UPDATE SET had_breakfast=EXCLUDED.had_breakfast, had_lunch=EXCLUDED.had_lunch, had_supper=EXCLUDED.had_supper,
    recorded_by=EXCLUDED.recorded_by, recorded_at=EXCLUDED.recorded_at, submission_id=EXCLUDED.submission_id, self_reported=false;
END;
$function$;

REVOKE ALL ON FUNCTION ess_log_meals(DATE, BOOLEAN, BOOLEAN, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION ess_log_meals(DATE, BOOLEAN, BOOLEAN, BOOLEAN) TO authenticated;

INSERT INTO schema_migrations (filename) VALUES ('0112_ess_meal_self_log.sql') ON CONFLICT DO NOTHING;
