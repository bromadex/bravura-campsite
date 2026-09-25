-- 0185: The remaining client .delete() calls only rewrite a document's child lines or remove links
-- (labels, members, reactions, role permissions). They stay, but lines of a document that has
-- left draft are locked here so approved paperwork can't be rewritten or deleted.
CREATE OR REPLACE FUNCTION trg_lock_po_lines() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _st TEXT;
BEGIN
  SELECT status INTO _st FROM purchase_orders WHERE id = COALESCE(NEW.po_id, OLD.po_id);
  IF _st IS NOT NULL AND _st <> 'draft' THEN
    RAISE EXCEPTION 'This purchase order is % — its lines can no longer be changed', replace(_st, '_', ' ');
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
DROP TRIGGER IF EXISTS trg_lock_po_lines ON po_lines;
CREATE TRIGGER trg_lock_po_lines BEFORE INSERT OR UPDATE OR DELETE ON po_lines FOR EACH ROW EXECUTE FUNCTION trg_lock_po_lines();

CREATE OR REPLACE FUNCTION trg_lock_ra_items() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _st TEXT;
BEGIN
  SELECT status INTO _st FROM sheq_risk_assessments WHERE id = COALESCE(NEW.assessment_id, OLD.assessment_id);
  IF _st IN ('approved','expired','archived') THEN
    RAISE EXCEPTION 'This risk assessment is % — revise it as a new version instead', _st;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
DROP TRIGGER IF EXISTS trg_lock_ra_items ON sheq_risk_assessment_items;
CREATE TRIGGER trg_lock_ra_items BEFORE INSERT OR UPDATE OR DELETE ON sheq_risk_assessment_items FOR EACH ROW EXECUTE FUNCTION trg_lock_ra_items();

INSERT INTO schema_migrations (filename) VALUES ('0185_line_locks.sql') ON CONFLICT DO NOTHING;
