-- 0152: Project Cost & EVM — cost breakdown, progress measurement, change orders, EVM RPCs
-- Phase 3 of Projects/EPM module

-- Cost breakdown structure (CBS) items
CREATE TABLE IF NOT EXISTS project_cost_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  area_id UUID REFERENCES area_codes(id),
  parent_id UUID REFERENCES project_cost_items(id),
  cbs_code VARCHAR(30) NOT NULL,
  description TEXT NOT NULL,
  cost_type TEXT NOT NULL DEFAULT 'direct' CHECK (cost_type IN ('direct','indirect','contingency','management_reserve')),
  category TEXT CHECK (category IN ('labour','materials','equipment','subcontract','other')),
  budgeted_cost NUMERIC(14,2) DEFAULT 0,
  committed_cost NUMERIC(14,2) DEFAULT 0,
  actual_cost NUMERIC(14,2) DEFAULT 0,
  estimate_to_complete NUMERIC(14,2) DEFAULT 0,
  estimate_at_completion NUMERIC(14,2) DEFAULT 0,
  currency VARCHAR(3) DEFAULT 'USD',
  is_archived BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Progress measurement records (periodic snapshots)
CREATE TABLE IF NOT EXISTS project_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  reporting_date DATE NOT NULL,
  planned_percent NUMERIC(5,2) DEFAULT 0,
  actual_percent NUMERIC(5,2) DEFAULT 0,
  bcws NUMERIC(14,2) DEFAULT 0,
  bcwp NUMERIC(14,2) DEFAULT 0,
  acwp NUMERIC(14,2) DEFAULT 0,
  spi NUMERIC(6,3),
  cpi NUMERIC(6,3),
  sv NUMERIC(14,2),
  cv NUMERIC(14,2),
  eac NUMERIC(14,2),
  etc NUMERIC(14,2),
  vac NUMERIC(14,2),
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(project_id, reporting_date)
);

-- Change orders
CREATE TABLE IF NOT EXISTS project_change_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  change_order_number VARCHAR(30) NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','under_review','approved','rejected','implemented')),
  impact_type TEXT CHECK (impact_type IN ('cost','schedule','scope','cost_and_schedule')),
  cost_impact NUMERIC(14,2) DEFAULT 0,
  schedule_impact_days INT DEFAULT 0,
  requested_by UUID REFERENCES auth.users(id),
  approved_by UUID REFERENCES auth.users(id),
  requested_date DATE,
  approved_date DATE,
  notes TEXT,
  is_archived BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(project_id, change_order_number)
);

-- RLS
ALTER TABLE project_cost_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_change_orders ENABLE ROW LEVEL SECURITY;

-- Cost items policies
CREATE POLICY "cost_items_select" ON project_cost_items FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM projects p JOIN user_roles ur ON (ur.site_id = p.site_id OR ur.site_id IS NULL)
  JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions perm ON perm.id = rp.permission_id
  WHERE p.id = project_cost_items.project_id AND ur.user_id = auth.uid() AND perm.code = 'projects.view'
));
CREATE POLICY "cost_items_insert" ON project_cost_items FOR INSERT TO authenticated
WITH CHECK (EXISTS (
  SELECT 1 FROM projects p JOIN user_roles ur ON (ur.site_id = p.site_id OR ur.site_id IS NULL)
  JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions perm ON perm.id = rp.permission_id
  WHERE p.id = project_cost_items.project_id AND ur.user_id = auth.uid() AND perm.code = 'projects.edit'
));
CREATE POLICY "cost_items_update" ON project_cost_items FOR UPDATE TO authenticated
USING (EXISTS (
  SELECT 1 FROM projects p JOIN user_roles ur ON (ur.site_id = p.site_id OR ur.site_id IS NULL)
  JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions perm ON perm.id = rp.permission_id
  WHERE p.id = project_cost_items.project_id AND ur.user_id = auth.uid() AND perm.code = 'projects.edit'
));

-- Progress policies
CREATE POLICY "progress_select" ON project_progress FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM projects p JOIN user_roles ur ON (ur.site_id = p.site_id OR ur.site_id IS NULL)
  JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions perm ON perm.id = rp.permission_id
  WHERE p.id = project_progress.project_id AND ur.user_id = auth.uid() AND perm.code = 'projects.view'
));
CREATE POLICY "progress_insert" ON project_progress FOR INSERT TO authenticated
WITH CHECK (EXISTS (
  SELECT 1 FROM projects p JOIN user_roles ur ON (ur.site_id = p.site_id OR ur.site_id IS NULL)
  JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions perm ON perm.id = rp.permission_id
  WHERE p.id = project_progress.project_id AND ur.user_id = auth.uid() AND perm.code = 'projects.edit'
));
CREATE POLICY "progress_update" ON project_progress FOR UPDATE TO authenticated
USING (EXISTS (
  SELECT 1 FROM projects p JOIN user_roles ur ON (ur.site_id = p.site_id OR ur.site_id IS NULL)
  JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions perm ON perm.id = rp.permission_id
  WHERE p.id = project_progress.project_id AND ur.user_id = auth.uid() AND perm.code = 'projects.edit'
));

-- Change order policies
CREATE POLICY "co_select" ON project_change_orders FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM projects p JOIN user_roles ur ON (ur.site_id = p.site_id OR ur.site_id IS NULL)
  JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions perm ON perm.id = rp.permission_id
  WHERE p.id = project_change_orders.project_id AND ur.user_id = auth.uid() AND perm.code = 'projects.view'
));
CREATE POLICY "co_insert" ON project_change_orders FOR INSERT TO authenticated
WITH CHECK (EXISTS (
  SELECT 1 FROM projects p JOIN user_roles ur ON (ur.site_id = p.site_id OR ur.site_id IS NULL)
  JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions perm ON perm.id = rp.permission_id
  WHERE p.id = project_change_orders.project_id AND ur.user_id = auth.uid() AND perm.code = 'projects.edit'
));
CREATE POLICY "co_update" ON project_change_orders FOR UPDATE TO authenticated
USING (EXISTS (
  SELECT 1 FROM projects p JOIN user_roles ur ON (ur.site_id = p.site_id OR ur.site_id IS NULL)
  JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions perm ON perm.id = rp.permission_id
  WHERE p.id = project_change_orders.project_id AND ur.user_id = auth.uid() AND perm.code = 'projects.edit'
));

-- EVM calculation RPC
CREATE OR REPLACE FUNCTION rpc_calculate_evm(p_project_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_budget NUMERIC;
  v_bcws NUMERIC;
  v_bcwp NUMERIC;
  v_acwp NUMERIC;
  v_spi NUMERIC;
  v_cpi NUMERIC;
  v_sv NUMERIC;
  v_cv NUMERIC;
  v_eac NUMERIC;
  v_etc NUMERIC;
  v_vac NUMERIC;
  v_tcpi NUMERIC;
  v_pct_planned NUMERIC;
  v_pct_actual NUMERIC;
  v_cost_items JSONB;
BEGIN
  -- Get project budget (BAC)
  SELECT COALESCE(budget, 0) INTO v_budget FROM projects WHERE id = p_project_id;

  -- Sum cost items
  SELECT
    COALESCE(SUM(budgeted_cost), 0),
    COALESCE(SUM(actual_cost), 0),
    COALESCE(SUM(committed_cost), 0)
  INTO v_bcws, v_acwp, v_bcwp
  FROM project_cost_items
  WHERE project_id = p_project_id AND is_archived = false;

  -- If no cost items, use project-level budget with task % complete
  IF v_bcws = 0 AND v_budget > 0 THEN
    SELECT
      COALESCE(AVG(CASE WHEN start_date <= CURRENT_DATE THEN
        LEAST(100, GREATEST(0,
          EXTRACT(EPOCH FROM (CURRENT_DATE - start_date::timestamp)) /
          NULLIF(EXTRACT(EPOCH FROM (due_date::timestamp - start_date::timestamp)), 0) * 100
        )) ELSE 0 END), 0),
      COALESCE(AVG(percent_complete), 0)
    INTO v_pct_planned, v_pct_actual
    FROM project_tasks
    WHERE project_id = p_project_id AND is_archived = false;

    v_bcws := v_budget * v_pct_planned / 100;
    v_bcwp := v_budget * v_pct_actual / 100;
    -- Use actual_cost from tasks if available
    SELECT COALESCE(SUM(actual_cost), 0) INTO v_acwp
    FROM project_tasks WHERE project_id = p_project_id AND is_archived = false;
    IF v_acwp = 0 THEN v_acwp := v_bcwp; END IF;
  END IF;

  -- EVM formulas
  v_sv := v_bcwp - v_bcws;
  v_cv := v_bcwp - v_acwp;
  v_spi := CASE WHEN v_bcws > 0 THEN ROUND(v_bcwp / v_bcws, 3) ELSE NULL END;
  v_cpi := CASE WHEN v_acwp > 0 THEN ROUND(v_bcwp / v_acwp, 3) ELSE NULL END;
  v_eac := CASE WHEN v_cpi > 0 THEN ROUND(v_budget / v_cpi, 2) ELSE v_budget END;
  v_etc := GREATEST(0, v_eac - v_acwp);
  v_vac := v_budget - v_eac;
  v_tcpi := CASE WHEN (v_budget - v_bcwp) > 0 THEN ROUND((v_budget - v_bcwp) / (v_budget - v_acwp), 3) ELSE NULL END;

  -- Cost breakdown by category
  SELECT COALESCE(jsonb_agg(row_to_json(r)), '[]'::jsonb) INTO v_cost_items
  FROM (
    SELECT category,
      SUM(budgeted_cost) as budgeted,
      SUM(committed_cost) as committed,
      SUM(actual_cost) as actual,
      SUM(estimate_at_completion) as eac
    FROM project_cost_items
    WHERE project_id = p_project_id AND is_archived = false
    GROUP BY category
    ORDER BY category
  ) r;

  RETURN jsonb_build_object(
    'bac', v_budget,
    'bcws', v_bcws,
    'bcwp', v_bcwp,
    'acwp', v_acwp,
    'sv', v_sv,
    'cv', v_cv,
    'spi', v_spi,
    'cpi', v_cpi,
    'eac', v_eac,
    'etc', v_etc,
    'vac', v_vac,
    'tcpi', v_tcpi,
    'percent_planned', ROUND(COALESCE(v_pct_planned, CASE WHEN v_budget > 0 THEN v_bcws / v_budget * 100 ELSE 0 END), 1),
    'percent_actual', ROUND(COALESCE(v_pct_actual, CASE WHEN v_budget > 0 THEN v_bcwp / v_budget * 100 ELSE 0 END), 1),
    'cost_by_category', v_cost_items
  );
END;
$$;

INSERT INTO schema_migrations (filename) VALUES ('0152_project_cost_evm.sql') ON CONFLICT DO NOTHING;
