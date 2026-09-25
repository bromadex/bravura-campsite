-- 0216c — the supplier's promised delivery date may be set on an ordered (locked) PO line.
CREATE OR REPLACE FUNCTION public.trg_lock_po_lines() RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE _st TEXT;
BEGIN
  SELECT status INTO _st FROM purchase_orders WHERE id = COALESCE(NEW.po_id, OLD.po_id);
  IF _st IS NULL OR _st IN ('draft','rfq','rfq_sent') THEN RETURN COALESCE(NEW, OLD); END IF;
  -- On an ordered PO only received quantities and the supplier's promised date may change.
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'received_qty' - 'promised_date' - 'updated_at' - 'line_total')
                        = (to_jsonb(OLD) - 'received_qty' - 'promised_date' - 'updated_at' - 'line_total') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'This purchase order is % — its lines can no longer be changed. Use Amend to make a new version.', replace(_st, '_', ' ');
END $function$;
INSERT INTO schema_migrations (filename) VALUES ('0216c_lock_allows_promised_date.sql') ON CONFLICT DO NOTHING;
