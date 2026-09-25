-- 0210 supplier_statements_and_layouts — Finance extras (issue #49).
--   • Supplier statement reconciliation: compare the balance on a supplier's statement with what
--     our books say we owe them on that date; tick the bills that appear on their statement; the
--     unticked ones and the difference are what to query. Saved per supplier and date.
--   • Finance Home layout per person: widget order, hidden widgets, and saved Explorer views.

CREATE TABLE IF NOT EXISTS supplier_statement_recs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id           uuid NOT NULL REFERENCES sites(id),
  supplier_id       uuid NOT NULL REFERENCES procurement_suppliers(id),
  statement_date    date NOT NULL,
  statement_balance numeric(14,2) NOT NULL,
  books_balance     numeric(14,2) NOT NULL,
  difference        numeric(14,2) GENERATED ALWAYS AS (statement_balance - books_balance) STORED,
  on_statement      uuid[] NOT NULL DEFAULT '{}',   -- our bills that appear on their statement
  notes             text,
  status            text NOT NULL DEFAULT 'open' CHECK (status IN ('open','agreed')),
  created_by        uuid REFERENCES profiles(id) DEFAULT auth.uid(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  is_archived       boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS supplier_statement_recs_idx ON supplier_statement_recs (site_id, supplier_id, statement_date DESC);
ALTER TABLE supplier_statement_recs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ssr_select ON supplier_statement_recs;
CREATE POLICY ssr_select ON supplier_statement_recs FOR SELECT TO authenticated USING (_has_permission('finance.view', site_id));
DROP POLICY IF EXISTS ssr_insert ON supplier_statement_recs;
CREATE POLICY ssr_insert ON supplier_statement_recs FOR INSERT TO authenticated WITH CHECK (_has_permission('finance.edit', site_id));
DROP POLICY IF EXISTS ssr_update ON supplier_statement_recs;
CREATE POLICY ssr_update ON supplier_statement_recs FOR UPDATE TO authenticated
  USING (_has_permission('finance.edit', site_id)) WITH CHECK (_has_permission('finance.edit', site_id));

-- What we owed a supplier on a date: bills dated on/before it, not cancelled, unpaid then.
CREATE OR REPLACE FUNCTION ap_supplier_position(p_site uuid, p_supplier uuid, p_date date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT _has_permission('finance.view', p_site) THEN RAISE EXCEPTION 'No access'; END IF;
  RETURN (SELECT jsonb_build_object(
    'balance', COALESCE(sum(i.total_amount), 0),
    'bills', COALESCE(jsonb_agg(jsonb_build_object('id', i.id, 'invoice_number', i.invoice_number, 'invoice_date', i.invoice_date,
               'due_date', i.due_date, 'amount', i.total_amount, 'status', i.status, 'po', po.po_number) ORDER BY i.invoice_date, i.invoice_number), '[]'::jsonb),
    'paid_since', (SELECT COALESCE(sum(total_amount), 0) FROM purchase_invoices WHERE site_id = p_site AND supplier_id = p_supplier
                    AND status = 'paid' AND paid_at::date > p_date AND invoice_date <= p_date))
    FROM purchase_invoices i LEFT JOIN purchase_orders po ON po.id = i.po_id
   WHERE i.site_id = p_site AND i.supplier_id = p_supplier AND i.invoice_date <= p_date AND i.status <> 'cancelled'
     AND (i.status <> 'paid' OR i.paid_at::date > p_date));
END $$;
REVOKE ALL ON FUNCTION ap_supplier_position(uuid, uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION ap_supplier_position(uuid, uuid, date) TO authenticated;

-- Finance Home layout, one per person.
CREATE TABLE IF NOT EXISTS finance_home_layouts (
  user_id    uuid PRIMARY KEY REFERENCES profiles(id),
  layout     jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {order:[..], hidden:[..], views:[{id,title,group,heading,period}]}
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE finance_home_layouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fhl_own ON finance_home_layouts;
CREATE POLICY fhl_own ON finance_home_layouts FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

INSERT INTO schema_migrations (filename) VALUES ('0210_supplier_statements_and_layouts.sql') ON CONFLICT DO NOTHING;
