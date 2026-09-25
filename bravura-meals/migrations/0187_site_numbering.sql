-- 0187: Per-site document numbering (KAM-PO-2026-0001) assigned by the database on insert,
-- replacing browser-generated numbers. Existing documents keep their old numbers.
-- trigger args: (column name, document prefix)
CREATE OR REPLACE FUNCTION trg_assign_doc_number() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.site_id IS NULL THEN RETURN NEW; END IF;
  NEW := jsonb_populate_record(NEW, jsonb_build_object(TG_ARGV[0], doc_next_number(NEW.site_id, TG_ARGV[1], CURRENT_DATE)));
  RETURN NEW;
END;
$$;

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('purchase_orders',          'po_number',          'PO'),
    ('purchase_requisitions',    'requisition_no',     'PR'),
    ('procurement_requisitions', 'requisition_number', 'PR'),
    ('rfqs',                     'rfq_number',         'RFQ'),
    ('goods_received_notes',     'grn_number',         'GRN'),
    ('fleet_work_orders',        'work_order_number',  'WO'),
    ('fuel_requests',            'request_number',     'FR')
  ) v(t, c, p) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_doc_number ON %I', r.t);
    EXECUTE format('CREATE TRIGGER trg_doc_number BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION trg_assign_doc_number(%L, %L)', r.t, r.c, r.p);
  END LOOP;
END $$;

INSERT INTO schema_migrations (filename) VALUES ('0187_site_numbering.sql') ON CONFLICT DO NOTHING;
