-- 0217 ask_bravura_a1 — AI assistant stage A1: spending questions (issue #49).
-- The AI never touches tables. It may only call these read-only functions, which run as the person
-- asking (the edge function forwards their login), check finance/procurement view permission per site,
-- and return only what's needed. Every question and answer is logged in ai_questions.

CREATE TABLE IF NOT EXISTS ai_questions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES profiles(id) DEFAULT auth.uid(),
  site_id     uuid REFERENCES sites(id),
  question    text NOT NULL,
  answer      text,
  tools       jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{name, args}] the model called
  model       text,
  tokens      int,
  error       text,
  rating      smallint,                              -- 1 helpful / -1 not helpful
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_questions_user ON ai_questions (user_id, created_at DESC);
ALTER TABLE ai_questions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aiq_own ON ai_questions;
CREATE POLICY aiq_own ON ai_questions FOR SELECT TO authenticated USING (user_id = auth.uid() OR _has_permission('finance.approve', site_id));
DROP POLICY IF EXISTS aiq_insert ON ai_questions;
CREATE POLICY aiq_insert ON ai_questions FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS aiq_rate ON ai_questions;
CREATE POLICY aiq_rate ON ai_questions FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Sites the caller may ask about (finance or procurement view), optionally narrowed.
CREATE OR REPLACE FUNCTION public._ai_sites(p_site_ids uuid[]) RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT array_agg(s.id) FROM sites s
   WHERE (p_site_ids IS NULL OR cardinality(p_site_ids) = 0 OR s.id = ANY(p_site_ids))
     AND (_has_permission('finance.view', s.id) OR _has_permission('procurement.view', s.id));
$$;

-- Spend (posted ledger costs, 6xxx expense accounts) for a period, grouped.
CREATE OR REPLACE FUNCTION public.ai_spend_summary(p_site_ids uuid[], p_from date, p_to date, p_group text DEFAULT 'account')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _sites uuid[] := _ai_sites(p_site_ids);
BEGIN
  IF _sites IS NULL THEN RETURN jsonb_build_object('error', 'You have no finance or procurement access to those sites'); END IF;
  RETURN (WITH l AS (
      SELECT (jl.debit - jl.credit) amt, a.code, a.name acct, s.name site, cc.name cc, pj.name project,
             je.entry_date, to_char(date_trunc('week', je.entry_date), 'YYYY-MM-DD') wk, to_char(je.entry_date, 'YYYY-MM') mon
        FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_id JOIN accounts a ON a.id = jl.account_id
        JOIN sites s ON s.id = je.site_id LEFT JOIN cost_centres cc ON cc.id = jl.cost_centre_id LEFT JOIN projects pj ON pj.id = jl.project_id
       WHERE je.site_id = ANY(_sites) AND je.status = 'posted' AND a.code LIKE '6%' AND je.entry_date BETWEEN p_from AND p_to)
    SELECT jsonb_build_object('from', p_from, 'to', p_to, 'currency', 'USD', 'total', COALESCE((SELECT round(sum(amt), 2) FROM l), 0),
      'groups', COALESCE((SELECT jsonb_agg(g ORDER BY (g->>'amount')::numeric DESC) FROM (
          SELECT jsonb_build_object('name', k, 'amount', round(sum(amt), 2), 'lines', count(*)) g FROM (
            SELECT amt, CASE p_group WHEN 'site' THEN site WHEN 'cost_centre' THEN COALESCE(cc, '(no cost centre)')
                                     WHEN 'project' THEN COALESCE(project, '(no project)') WHEN 'week' THEN 'week of ' || wk
                                     WHEN 'month' THEN mon ELSE code || ' ' || acct END k FROM l) x GROUP BY k LIMIT 25) y), '[]'::jsonb)));
END $$;

-- Spend on something: ledger costs whose account or description matches, plus committed (ordered, not yet
-- billed) PO lines that match. Search is a word like 'tyres', 'diesel', 'catering'.
CREATE OR REPLACE FUNCTION public.ai_spend_on(p_site_ids uuid[], p_from date, p_to date, p_search text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _sites uuid[] := _ai_sites(p_site_ids); _q text := '%' || trim(COALESCE(p_search, '')) || '%';
BEGIN
  IF _sites IS NULL THEN RETURN jsonb_build_object('error', 'You have no finance or procurement access to those sites'); END IF;
  IF length(trim(COALESCE(p_search, ''))) < 2 THEN RETURN jsonb_build_object('error', 'Say what to look for'); END IF;
  RETURN (WITH l AS (
      SELECT (jl.debit - jl.credit) amt, a.code || ' ' || a.name acct, je.entry_number, je.entry_date, COALESCE(jl.description, je.description) descr, s.name site
        FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_id JOIN accounts a ON a.id = jl.account_id JOIN sites s ON s.id = je.site_id
       WHERE je.site_id = ANY(_sites) AND je.status = 'posted' AND a.code LIKE '6%' AND je.entry_date BETWEEN p_from AND p_to
         AND (a.name ILIKE _q OR jl.description ILIKE _q OR je.description ILIKE _q)),
    p AS (
      SELECT pl.quantity * pl.unit_cost amt, po.po_number, COALESCE(po.order_date, po.created_at::date) d, COALESCE(i.description, pl.description) what,
             ps.supplier_name, s.name site, po.status
        FROM po_lines pl JOIN purchase_orders po ON po.id = pl.po_id LEFT JOIN items i ON i.id = pl.item_id
        LEFT JOIN procurement_suppliers ps ON ps.id = po.supplier_id JOIN sites s ON s.id = po.site_id
       WHERE po.site_id = ANY(_sites) AND NOT pl.is_archived AND po.status IN ('pending_approval','sent','partially_received','received')
         AND COALESCE(po.order_date, po.created_at::date) BETWEEN p_from AND p_to
         AND (COALESCE(i.description, pl.description) ILIKE _q OR ps.supplier_name ILIKE _q))
    SELECT jsonb_build_object('search', p_search, 'from', p_from, 'to', p_to, 'currency', 'USD',
      'booked_cost', COALESCE((SELECT round(sum(amt), 2) FROM l), 0),
      'ordered_on_pos', COALESCE((SELECT round(sum(amt), 2) FROM p), 0),
      'ledger_examples', COALESCE((SELECT jsonb_agg(x) FROM (SELECT jsonb_build_object('journal', entry_number, 'date', entry_date, 'account', acct,
                                  'description', left(descr, 80), 'amount', round(amt, 2), 'site', site) x FROM l ORDER BY amt DESC LIMIT 8) q), '[]'::jsonb),
      'po_examples', COALESCE((SELECT jsonb_agg(x) FROM (SELECT jsonb_build_object('po', po_number, 'date', d, 'what', left(what, 80), 'supplier', supplier_name,
                                  'amount', round(amt, 2), 'status', status, 'site', site) x FROM p ORDER BY amt DESC LIMIT 8) q), '[]'::jsonb)));
END $$;

-- Everything about one supplier over a period: orders, bills, paid, owed, top items.
CREATE OR REPLACE FUNCTION public.ai_supplier_history(p_site_ids uuid[], p_supplier text, p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _sites uuid[] := _ai_sites(p_site_ids); _ids uuid[];
BEGIN
  IF _sites IS NULL THEN RETURN jsonb_build_object('error', 'You have no finance or procurement access to those sites'); END IF;
  SELECT array_agg(id) INTO _ids FROM procurement_suppliers WHERE site_id = ANY(_sites) AND supplier_name ILIKE '%' || trim(p_supplier) || '%';
  IF _ids IS NULL THEN RETURN jsonb_build_object('error', 'No supplier matching "' || p_supplier || '"'); END IF;
  RETURN jsonb_build_object('suppliers', (SELECT jsonb_agg(supplier_name) FROM procurement_suppliers WHERE id = ANY(_ids)), 'from', p_from, 'to', p_to, 'currency', 'USD',
    'orders', (SELECT count(*) FROM purchase_orders WHERE supplier_id = ANY(_ids) AND status NOT IN ('cancelled','rfq','rfq_sent','draft') AND COALESCE(order_date, created_at::date) BETWEEN p_from AND p_to),
    'ordered_value', (SELECT COALESCE(round(sum(total_amount), 2), 0) FROM purchase_orders WHERE supplier_id = ANY(_ids) AND status NOT IN ('cancelled','rfq','rfq_sent','draft') AND COALESCE(order_date, created_at::date) BETWEEN p_from AND p_to),
    'billed', (SELECT COALESCE(round(sum(total_amount), 2), 0) FROM purchase_invoices WHERE supplier_id = ANY(_ids) AND status IN ('approved','paid') AND invoice_date BETWEEN p_from AND p_to),
    'paid', (SELECT COALESCE(round(sum(total_amount), 2), 0) FROM purchase_invoices WHERE supplier_id = ANY(_ids) AND status = 'paid' AND paid_at::date BETWEEN p_from AND p_to),
    'owed_now', (SELECT COALESCE(round(sum(total_amount), 2), 0) FROM purchase_invoices WHERE supplier_id = ANY(_ids) AND status = 'approved'),
    'late_orders_now', (SELECT count(*) FROM purchase_orders WHERE supplier_id = ANY(_ids) AND status IN ('sent','partially_received') AND expected_date < CURRENT_DATE),
    'top_items', COALESCE((SELECT jsonb_agg(x) FROM (SELECT jsonb_build_object('what', COALESCE(i.description, pl.description), 'qty', sum(pl.quantity), 'amount', round(sum(pl.quantity * pl.unit_cost), 2)) x
        FROM po_lines pl JOIN purchase_orders po ON po.id = pl.po_id LEFT JOIN items i ON i.id = pl.item_id
       WHERE po.supplier_id = ANY(_ids) AND NOT pl.is_archived AND po.status NOT IN ('cancelled','rfq','rfq_sent','draft') AND COALESCE(po.order_date, po.created_at::date) BETWEEN p_from AND p_to
       GROUP BY COALESCE(i.description, pl.description) ORDER BY sum(pl.quantity * pl.unit_cost) DESC LIMIT 8) q), '[]'::jsonb));
END $$;

REVOKE ALL ON FUNCTION _ai_sites(uuid[]), ai_spend_summary(uuid[], date, date, text), ai_spend_on(uuid[], date, date, text),
  ai_supplier_history(uuid[], text, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION ai_spend_summary(uuid[], date, date, text), ai_spend_on(uuid[], date, date, text),
  ai_supplier_history(uuid[], text, date, date) TO authenticated;

INSERT INTO schema_migrations (filename) VALUES ('0217_ask_bravura_a1.sql') ON CONFLICT DO NOTHING;
