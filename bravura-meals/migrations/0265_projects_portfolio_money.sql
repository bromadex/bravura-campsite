-- 0265 Projects (#76): one money view across the site's projects (replaces the separate Costs & EVM / Change Orders pages).
CREATE OR REPLACE FUNCTION pj_portfolio_money(p_site uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'projects', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'code', p.project_code, 'status', p.status,
        'budget', COALESCE(p.budget, 0), 'target_end_date', p.target_end_date,
        'spent', COALESCE((SELECT SUM(l.debit - l.credit) FROM journal_lines l JOIN journal_entries j ON j.id = l.journal_id JOIN accounts a ON a.id = l.account_id
                  WHERE l.project_id = p.id AND j.status = 'posted' AND NOT COALESCE(j.is_archived, false) AND a.account_type = 'Expense'), 0)
               + COALESCE((SELECT SUM(cost) FROM project_time_entries WHERE project_id = p.id AND status = 'approved' AND NOT is_archived), 0),
        'committed', COALESCE((SELECT SUM(GREATEST(0, pl.quantity - COALESCE(pl.received_qty, 0)) * pl.unit_cost) FROM purchase_orders po JOIN po_lines pl ON pl.po_id = po.id
                  WHERE po.project_id = p.id AND po.status IN ('sent','partially_received','pending_approval') AND NOT COALESCE(pl.is_archived, false)), 0),
        'changes_approved', COALESCE((SELECT SUM(cost_impact) FROM project_change_orders WHERE project_id = p.id AND status IN ('approved','implemented') AND NOT is_archived), 0))
        ORDER BY p.name)
      FROM projects p WHERE p.site_id = p_site AND NOT COALESCE(p.is_archived, false) AND NOT p.is_template AND _pj_can('view', p.id)), '[]'),
    'pending_changes', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'project_id', c.project_id, 'project', p.name, 'number', c.change_order_number,
        'title', c.title, 'status', c.status, 'cost_impact', c.cost_impact, 'days', c.schedule_impact_days, 'requested_date', c.requested_date) ORDER BY c.created_at DESC)
      FROM project_change_orders c JOIN projects p ON p.id = c.project_id
      WHERE p.site_id = p_site AND NOT c.is_archived AND c.status IN ('draft','submitted','under_review') AND _pj_can('view', p.id)), '[]'))
$$;

INSERT INTO schema_migrations (filename) VALUES ('0265_projects_portfolio_money.sql') ON CONFLICT DO NOTHING;
