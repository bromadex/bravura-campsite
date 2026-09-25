-- 0191: Fleet preventive maintenance plans + downtime analysis
--   * status changes on fleet_assets are logged by trigger (fleet_status_history) — the source for downtime
--   * PM plans by km / engine hours / days, per asset or per asset type; due list; one-click or bulk work orders;
--     completing a PM work order resets that plan's counter for the asset
--   * fleet_downtime(): hours down per asset (maintenance / grounded / awaiting parts), failures, MTTR, MTBF, availability

-- ── Status history (server-side, so every change is captured) ────────
CREATE OR REPLACE FUNCTION trg_fleet_status_history() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO fleet_status_history (asset_id, old_status, new_status, changed_by, reason)
    VALUES (NEW.id, OLD.status, NEW.status, auth.uid(), NULLIF(current_setting('app.fleet_status_reason', true), ''));
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_fleet_status_history ON fleet_assets;
CREATE TRIGGER trg_fleet_status_history AFTER UPDATE OF status ON fleet_assets FOR EACH ROW EXECUTE FUNCTION trg_fleet_status_history();

-- ── PM plans ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fleet_pm_plans (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id         UUID NOT NULL REFERENCES sites(id),
  name            TEXT NOT NULL,
  asset_id        UUID REFERENCES fleet_assets(id),
  asset_type_id   UUID REFERENCES fleet_asset_types(id),
  interval_km     NUMERIC CHECK (interval_km > 0),
  interval_hours  NUMERIC CHECK (interval_hours > 0),
  interval_days   INT CHECK (interval_days > 0),
  tasks           TEXT,
  estimated_cost  NUMERIC(15,2),
  is_active       BOOLEAN NOT NULL DEFAULT true,
  is_archived     BOOLEAN NOT NULL DEFAULT false,
  created_by      UUID REFERENCES profiles(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (interval_km IS NOT NULL OR interval_hours IS NOT NULL OR interval_days IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS fleet_pm_status (
  asset_id        UUID NOT NULL REFERENCES fleet_assets(id),
  plan_id         UUID NOT NULL REFERENCES fleet_pm_plans(id),
  last_done_date  DATE,
  last_done_km    NUMERIC,
  last_done_hours NUMERIC,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (asset_id, plan_id)
);
ALTER TABLE fleet_work_orders ADD COLUMN IF NOT EXISTS pm_plan_id UUID REFERENCES fleet_pm_plans(id);

ALTER TABLE fleet_pm_plans  ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet_pm_status ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fpp_select ON fleet_pm_plans; DROP POLICY IF EXISTS fpp_write ON fleet_pm_plans;
CREATE POLICY fpp_select ON fleet_pm_plans FOR SELECT USING (_has_permission('fleet.view', site_id));
CREATE POLICY fpp_write  ON fleet_pm_plans FOR ALL USING (_has_permission('fleet.edit', site_id)) WITH CHECK (_has_permission('fleet.edit', site_id));
DROP POLICY IF EXISTS fps_select ON fleet_pm_status;
CREATE POLICY fps_select ON fleet_pm_status FOR SELECT USING (
  EXISTS (SELECT 1 FROM fleet_assets a WHERE a.id = asset_id AND _has_permission('fleet.view', a.site_id)));

-- What's due: every active plan × applicable asset, measured from the last time it was done
-- (or from zero / the asset's purchase date if never recorded).
CREATE OR REPLACE FUNCTION _fleet_pm_due_core(p_site_id UUID)
RETURNS TABLE (asset_id UUID, asset_label TEXT, plan_id UUID, plan_name TEXT, current_km NUMERIC, current_hours NUMERIC,
               next_km NUMERIC, next_hours NUMERIC, next_date DATE, pct_used NUMERIC, state TEXT, open_wo_id UUID,
               open_wo_number TEXT, estimated_cost NUMERIC, last_done_date DATE)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _remind INT;
BEGIN
  SELECT COALESCE(pm_reminder_days, 7) INTO _remind FROM fleet_settings WHERE site_id = p_site_id;
  _remind := COALESCE(_remind, 7);
  RETURN QUERY
  WITH pairs AS (
    SELECT a.id aid, TRIM(CONCAT_WS(' ', COALESCE(a.fleet_number, a.asset_number), a.make, a.model, NULLIF('(' || a.registration || ')', '()'))) lbl,
           p.id pid, p.name pname, p.interval_km, p.interval_hours, p.interval_days, p.estimated_cost ec,
           COALESCE(a.current_odometer_km, 0) ckm, COALESCE(a.current_hours, 0) chr,
           s.last_done_date ld, COALESCE(s.last_done_km, 0) lkm, COALESCE(s.last_done_hours, 0) lhr,
           COALESCE(s.last_done_date, a.purchase_date, a.created_at::date) base_date
      FROM fleet_pm_plans p
      JOIN fleet_assets a ON a.site_id = p.site_id AND (a.id = p.asset_id OR (p.asset_id IS NULL AND a.asset_type_id = p.asset_type_id))
      LEFT JOIN fleet_pm_status s ON s.asset_id = a.id AND s.plan_id = p.id
     WHERE p.site_id = p_site_id AND p.is_active AND NOT p.is_archived
       AND NOT COALESCE(a.is_archived, false) AND COALESCE(a.status, '') <> 'decommissioned'
  ), calc AS (
    SELECT pairs.*,
           CASE WHEN interval_km    IS NOT NULL THEN lkm + interval_km END nkm,
           CASE WHEN interval_hours IS NOT NULL THEN lhr + interval_hours END nhr,
           CASE WHEN interval_days  IS NOT NULL THEN base_date + interval_days END nd,
           GREATEST(
             CASE WHEN interval_km    IS NOT NULL THEN (ckm - lkm) / interval_km END,
             CASE WHEN interval_hours IS NOT NULL THEN (chr - lhr) / interval_hours END,
             CASE WHEN interval_days  IS NOT NULL THEN (CURRENT_DATE - base_date)::numeric / interval_days END) used,
           GREATEST(
             CASE WHEN interval_km    IS NOT NULL THEN 1 - 0.1 END,
             CASE WHEN interval_hours IS NOT NULL THEN 1 - 0.1 END,
             CASE WHEN interval_days  IS NOT NULL THEN 1 - _remind::numeric / interval_days END) soon
      FROM pairs
  )
  SELECT c.aid, c.lbl, c.pid, c.pname, c.ckm, c.chr, c.nkm, c.nhr, c.nd, ROUND(COALESCE(c.used, 0) * 100, 0),
         CASE WHEN COALESCE(c.used, 0) >= 1 THEN 'overdue' WHEN COALESCE(c.used, 0) >= COALESCE(c.soon, 0.9) THEN 'due_soon' ELSE 'ok' END,
         w.id, w.work_order_number, c.ec, c.ld
    FROM calc c
    LEFT JOIN LATERAL (SELECT wo.id, wo.work_order_number FROM fleet_work_orders wo
                        WHERE wo.asset_id = c.aid AND wo.pm_plan_id = c.pid AND COALESCE(wo.status, '') NOT IN ('completed','cancelled','closed')
                        ORDER BY wo.created_at DESC LIMIT 1) w ON true
   ORDER BY COALESCE(c.used, 0) DESC;
END;
$$;

CREATE OR REPLACE FUNCTION fleet_pm_due(p_site_id UUID)
RETURNS TABLE (asset_id UUID, asset_label TEXT, plan_id UUID, plan_name TEXT, current_km NUMERIC, current_hours NUMERIC,
               next_km NUMERIC, next_hours NUMERIC, next_date DATE, pct_used NUMERIC, state TEXT, open_wo_id UUID,
               open_wo_number TEXT, estimated_cost NUMERIC, last_done_date DATE)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT _has_permission('fleet.view', p_site_id) THEN RAISE EXCEPTION 'No access'; END IF;
  RETURN QUERY SELECT * FROM _fleet_pm_due_core(p_site_id);
END;
$$;

CREATE OR REPLACE FUNCTION _fleet_pm_make_wo(p_site_id UUID, p_asset_id UUID, p_plan_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _p fleet_pm_plans%ROWTYPE; _id UUID; _lbl TEXT;
BEGIN
  SELECT * INTO _p FROM fleet_pm_plans WHERE id = p_plan_id AND site_id = p_site_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plan not found'; END IF;
  SELECT id INTO _id FROM fleet_work_orders WHERE asset_id = p_asset_id AND pm_plan_id = p_plan_id
     AND COALESCE(status, '') NOT IN ('completed','cancelled','closed') LIMIT 1;
  IF _id IS NOT NULL THEN RETURN _id; END IF;
  SELECT COALESCE(fleet_number, asset_number) INTO _lbl FROM fleet_assets WHERE id = p_asset_id;
  INSERT INTO fleet_work_orders (site_id, work_order_number, asset_id, fault_description, priority, status, cost_est, notes, pm_plan_id, created_by)
  VALUES (p_site_id, 'auto', p_asset_id, 'Preventive maintenance: ' || _p.name || ' — ' || COALESCE(_lbl, ''), 'medium', 'scheduled',
          _p.estimated_cost, _p.tasks, p_plan_id, auth.uid())
  RETURNING id INTO _id;
  RETURN _id;
END;
$$;

CREATE OR REPLACE FUNCTION fleet_pm_create_wo(p_asset_id UUID, p_plan_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _site UUID;
BEGIN
  SELECT site_id INTO _site FROM fleet_assets WHERE id = p_asset_id;
  IF NOT _has_permission('fleet.create', _site) THEN RAISE EXCEPTION 'You do not have permission to create work orders'; END IF;
  RETURN _fleet_pm_make_wo(_site, p_asset_id, p_plan_id);
END;
$$;

-- Work orders for everything overdue or due soon that doesn't already have one.
CREATE OR REPLACE FUNCTION _fleet_pm_generate(p_site_id UUID)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r RECORD; _n INT := 0;
BEGIN
  FOR _r IN SELECT * FROM _fleet_pm_due_core(p_site_id) d WHERE d.state IN ('overdue','due_soon') AND d.open_wo_id IS NULL LOOP
    PERFORM _fleet_pm_make_wo(p_site_id, _r.asset_id, _r.plan_id);
    _n := _n + 1;
  END LOOP;
  IF _n > 0 THEN
    PERFORM _notify_permission(p_site_id, 'fleet.edit', 'fleet_pm_due', _n || ' preventive maintenance job(s) due',
      'Work orders were created for assets that are due or overdue for service.', '/fleet/fleet_maintenance', 'reminder');
  END IF;
  RETURN _n;
END;
$$;
CREATE OR REPLACE FUNCTION fleet_pm_generate(p_site_id UUID)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT _has_permission('fleet.create', p_site_id) THEN RAISE EXCEPTION 'You do not have permission to create work orders'; END IF;
  RETURN _fleet_pm_generate(p_site_id);
END;
$$;

-- Record a service as done (manually, or automatically when its PM work order completes).
CREATE OR REPLACE FUNCTION fleet_pm_record_done(p_asset_id UUID, p_plan_id UUID, p_date DATE, p_km NUMERIC, p_hours NUMERIC)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _a fleet_assets%ROWTYPE;
BEGIN
  SELECT * INTO _a FROM fleet_assets WHERE id = p_asset_id;
  IF NOT _has_permission('fleet.edit', _a.site_id) THEN RAISE EXCEPTION 'You do not have permission to record services'; END IF;
  INSERT INTO fleet_pm_status (asset_id, plan_id, last_done_date, last_done_km, last_done_hours, updated_at)
  VALUES (p_asset_id, p_plan_id, COALESCE(p_date, CURRENT_DATE), COALESCE(p_km, _a.current_odometer_km), COALESCE(p_hours, _a.current_hours), now())
  ON CONFLICT (asset_id, plan_id) DO UPDATE SET last_done_date = EXCLUDED.last_done_date, last_done_km = EXCLUDED.last_done_km,
    last_done_hours = EXCLUDED.last_done_hours, updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION trg_fleet_pm_wo_completed() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _a fleet_assets%ROWTYPE;
BEGIN
  IF NEW.pm_plan_id IS NOT NULL AND NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    SELECT * INTO _a FROM fleet_assets WHERE id = NEW.asset_id;
    INSERT INTO fleet_pm_status (asset_id, plan_id, last_done_date, last_done_km, last_done_hours, updated_at)
    VALUES (NEW.asset_id, NEW.pm_plan_id, COALESCE(NEW.completed_at::date, CURRENT_DATE), _a.current_odometer_km, _a.current_hours, now())
    ON CONFLICT (asset_id, plan_id) DO UPDATE SET last_done_date = EXCLUDED.last_done_date, last_done_km = EXCLUDED.last_done_km,
      last_done_hours = EXCLUDED.last_done_hours, updated_at = now();
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_fleet_pm_wo_completed ON fleet_work_orders;
CREATE TRIGGER trg_fleet_pm_wo_completed AFTER UPDATE OF status ON fleet_work_orders FOR EACH ROW EXECUTE FUNCTION trg_fleet_pm_wo_completed();

-- ── Downtime ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fleet_downtime(p_site_id UUID, p_from DATE, p_to DATE)
RETURNS TABLE (asset_id UUID, asset_label TEXT, status_now TEXT, hours_down NUMERIC, hours_maintenance NUMERIC, hours_grounded NUMERIC,
               hours_awaiting_parts NUMERIC, failures BIGINT, mttr_hours NUMERIC, mtbf_hours NUMERIC, availability_pct NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _t0 TIMESTAMPTZ := p_from::timestamptz; _t1 TIMESTAMPTZ := LEAST((p_to + 1)::timestamptz, now());
BEGIN
  IF NOT _has_permission('fleet.view', p_site_id) THEN RAISE EXCEPTION 'No access'; END IF;
  RETURN QUERY
  WITH a AS (
    SELECT fa.id, TRIM(CONCAT_WS(' ', COALESCE(fa.fleet_number, fa.asset_number), fa.make, fa.model)) lbl, fa.status
      FROM fleet_assets fa WHERE fa.site_id = p_site_id AND NOT COALESCE(fa.is_archived, false) AND COALESCE(fa.status, '') <> 'decommissioned'
  ), ev AS (   -- status at the start of the window, then every change inside it
    SELECT a.id aid, _t0 t,
           COALESCE((SELECT h.new_status FROM fleet_status_history h WHERE h.asset_id = a.id AND h.created_at <= _t0 ORDER BY h.created_at DESC LIMIT 1),
                    (SELECT h.old_status FROM fleet_status_history h WHERE h.asset_id = a.id AND h.created_at > _t0 ORDER BY h.created_at LIMIT 1),
                    a.status) st
      FROM a
    UNION ALL
    SELECT h.asset_id, h.created_at, h.new_status FROM fleet_status_history h JOIN a ON a.id = h.asset_id
     WHERE h.created_at > _t0 AND h.created_at < _t1
  ), seg AS (
    SELECT aid, st, t, LEAD(t, 1, _t1) OVER (PARTITION BY aid ORDER BY t) t_end,
           LAG(st) OVER (PARTITION BY aid ORDER BY t) prev_st
      FROM ev
  ), agg AS (
    SELECT aid,
           SUM(EXTRACT(EPOCH FROM (t_end - t)) / 3600) FILTER (WHERE st IN ('maintenance','grounded','awaiting_parts')) down_h,
           SUM(EXTRACT(EPOCH FROM (t_end - t)) / 3600) FILTER (WHERE st = 'maintenance') m_h,
           SUM(EXTRACT(EPOCH FROM (t_end - t)) / 3600) FILTER (WHERE st = 'grounded') g_h,
           SUM(EXTRACT(EPOCH FROM (t_end - t)) / 3600) FILTER (WHERE st = 'awaiting_parts') p_h,
           SUM(EXTRACT(EPOCH FROM (t_end - t)) / 3600) total_h,
           COUNT(*) FILTER (WHERE st IN ('grounded','maintenance','awaiting_parts') AND COALESCE(prev_st, 'x') NOT IN ('grounded','maintenance','awaiting_parts') AND t > _t0) fails
      FROM seg GROUP BY aid
  )
  SELECT a.id, a.lbl, a.status,
         ROUND(COALESCE(g.down_h, 0)::numeric, 1), ROUND(COALESCE(g.m_h, 0)::numeric, 1), ROUND(COALESCE(g.g_h, 0)::numeric, 1), ROUND(COALESCE(g.p_h, 0)::numeric, 1),
         COALESCE(g.fails, 0),
         CASE WHEN g.fails > 0 THEN ROUND((g.down_h / g.fails)::numeric, 1) END,
         CASE WHEN g.fails > 0 THEN ROUND(((g.total_h - COALESCE(g.down_h, 0)) / g.fails)::numeric, 1) END,
         CASE WHEN g.total_h > 0 THEN ROUND((100 * (g.total_h - COALESCE(g.down_h, 0)) / g.total_h)::numeric, 1) END
    FROM a LEFT JOIN agg g ON g.aid = a.id
   ORDER BY COALESCE(g.down_h, 0) DESC, a.lbl;
END;
$$;

REVOKE ALL ON FUNCTION _fleet_pm_due_core(UUID), fleet_pm_due(UUID), _fleet_pm_make_wo(UUID, UUID, UUID), fleet_pm_create_wo(UUID, UUID),
  _fleet_pm_generate(UUID), fleet_pm_generate(UUID), fleet_pm_record_done(UUID, UUID, DATE, NUMERIC, NUMERIC), fleet_downtime(UUID, DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION fleet_pm_due(UUID), fleet_pm_create_wo(UUID, UUID), fleet_pm_generate(UUID),
  fleet_pm_record_done(UUID, UUID, DATE, NUMERIC, NUMERIC), fleet_downtime(UUID, DATE, DATE) TO authenticated;

INSERT INTO schema_migrations (filename) VALUES ('0191_fleet_pm_downtime.sql') ON CONFLICT DO NOTHING;
