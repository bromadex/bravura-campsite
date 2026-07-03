-- ── 0055: Allow hard-delete on dip readings & deliveries with audit trail ────
-- Replaces the audit trigger to fire on UPDATE OR DELETE.
-- On DELETE the full OLD row is logged with action = 'delete'.
-- Adds RLS DELETE policies requiring fuel.delete permission.
-- Also adds a BEFORE DELETE trigger on fuel_deliveries to reverse the
-- delivery's effect on the tank level.

-- ─── 1. Extend audit trigger to handle DELETE ───────────────────────────────

CREATE OR REPLACE FUNCTION _fuel_audit_edit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO fuel_edit_log (table_name, record_id, action, old_values, new_values, changed_by, site_id)
    VALUES (
      TG_TABLE_NAME,
      OLD.id,
      'delete',
      to_jsonb(OLD),
      NULL,
      auth.uid(),
      OLD.site_id
    );
    RETURN OLD;
  END IF;

  -- UPDATE (existing behaviour)
  INSERT INTO fuel_edit_log (table_name, record_id, action, old_values, new_values, changed_by, site_id)
  VALUES (
    TG_TABLE_NAME,
    NEW.id,
    'update',
    to_jsonb(OLD),
    to_jsonb(NEW),
    NEW.updated_by,
    NEW.site_id
  );
  RETURN NEW;
END;
$$;

-- Re-create audit triggers to fire on UPDATE OR DELETE

DROP TRIGGER IF EXISTS trg_fuel_transactions_audit ON fuel_transactions;
CREATE TRIGGER trg_fuel_transactions_audit
  AFTER UPDATE OR DELETE ON fuel_transactions
  FOR EACH ROW EXECUTE FUNCTION _fuel_audit_edit();

DROP TRIGGER IF EXISTS trg_fuel_deliveries_audit ON fuel_deliveries;
CREATE TRIGGER trg_fuel_deliveries_audit
  AFTER UPDATE OR DELETE ON fuel_deliveries
  FOR EACH ROW EXECUTE FUNCTION _fuel_audit_edit();

DROP TRIGGER IF EXISTS trg_fuel_dip_readings_audit ON fuel_dip_readings;
CREATE TRIGGER trg_fuel_dip_readings_audit
  AFTER UPDATE OR DELETE ON fuel_dip_readings
  FOR EACH ROW EXECUTE FUNCTION _fuel_audit_edit();

-- ─── 2. Reverse delivery effect on tank level when deleted ──────────────────

CREATE OR REPLACE FUNCTION _fuel_delivery_reverse_on_delete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE fuel_tanks
  SET current_level_litres = GREATEST(0, current_level_litres - COALESCE(OLD.quantity_delivered, 0)),
      updated_at = now()
  WHERE id = OLD.tank_id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_fuel_delivery_reverse_delete ON fuel_deliveries;
CREATE TRIGGER trg_fuel_delivery_reverse_delete
  BEFORE DELETE ON fuel_deliveries
  FOR EACH ROW EXECUTE FUNCTION _fuel_delivery_reverse_on_delete();

-- ─── 3. RLS DELETE policies ─────────────────────────────────────────────────

-- Add 'fuel.delete' permission if it doesn't exist
INSERT INTO permissions (code, description, module)
VALUES ('fuel.delete', 'Delete fuel records (dip readings, deliveries)', 'fuel')
ON CONFLICT (code) DO NOTHING;

DROP POLICY IF EXISTS fuel_dip_readings_delete ON fuel_dip_readings;
CREATE POLICY fuel_dip_readings_delete ON fuel_dip_readings
  FOR DELETE USING (
    _user_has_fuel_perm(site_id, ARRAY['fuel.delete'])
  );

DROP POLICY IF EXISTS fuel_deliveries_delete ON fuel_deliveries;
CREATE POLICY fuel_deliveries_delete ON fuel_deliveries
  FOR DELETE USING (
    _user_has_fuel_perm(site_id, ARRAY['fuel.delete'])
  );

DROP POLICY IF EXISTS fuel_transactions_delete ON fuel_transactions;
CREATE POLICY fuel_transactions_delete ON fuel_transactions
  FOR DELETE USING (
    _user_has_fuel_perm(site_id, ARRAY['fuel.delete'])
  );
