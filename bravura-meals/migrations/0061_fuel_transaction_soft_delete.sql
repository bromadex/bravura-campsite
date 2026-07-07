-- ── 0061: Soft-delete + edit reasons for fuel transactions ────────────────────
-- Adds soft-delete columns to fuel_transactions and a reason column to
-- fuel_edit_log so every edit/delete carries a mandatory user-supplied reason.
-- Updates the audit trigger to detect soft-deletes and capture reasons.

-- ─── 1. Soft-delete columns on fuel_transactions ────────────────────────────

ALTER TABLE fuel_transactions
  ADD COLUMN IF NOT EXISTS is_deleted   BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by   UUID        REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS edit_reason  TEXT;

CREATE INDEX IF NOT EXISTS idx_fuel_transactions_not_deleted
  ON fuel_transactions (site_id, transaction_date DESC)
  WHERE NOT is_deleted;

-- ─── 2. Reason column on fuel_edit_log ──────────────────────────────────────

ALTER TABLE fuel_edit_log
  ADD COLUMN IF NOT EXISTS reason TEXT;

-- ─── 3. Updated audit trigger — captures edit_reason, detects soft-delete ───

CREATE OR REPLACE FUNCTION _fuel_audit_edit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _action TEXT;
  _reason TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO fuel_edit_log (table_name, record_id, action, old_values, new_values, changed_by, site_id, reason)
    VALUES (
      TG_TABLE_NAME,
      OLD.id,
      'delete',
      to_jsonb(OLD),
      NULL,
      auth.uid(),
      OLD.site_id,
      NULL
    );
    RETURN OLD;
  END IF;

  -- Detect soft-delete: is_deleted changed from false to true
  _action := 'update';
  _reason := NULL;

  -- Only fuel_transactions has edit_reason / is_deleted
  IF TG_TABLE_NAME = 'fuel_transactions' THEN
    _reason := NEW.edit_reason;
    IF NOT OLD.is_deleted AND NEW.is_deleted THEN
      _action := 'soft_delete';
    END IF;
    -- Clear edit_reason after capture so it doesn't persist
    NEW.edit_reason := NULL;
  END IF;

  INSERT INTO fuel_edit_log (table_name, record_id, action, old_values, new_values, changed_by, site_id, reason)
  VALUES (
    TG_TABLE_NAME,
    NEW.id,
    _action,
    to_jsonb(OLD),
    to_jsonb(NEW),
    NEW.updated_by,
    NEW.site_id,
    _reason
  );
  RETURN NEW;
END;
$$;

-- Re-create triggers (same as 0055 but with updated function)

-- Both triggers are BEFORE UPDATE. PostgreSQL fires same-timing triggers
-- in alphabetical order by name. We need updated_at set BEFORE the audit
-- trigger captures to_jsonb(NEW), so the names are chosen accordingly:
--   trg_fuel_txn_a_updated_at  (fires first — sets updated_at on NEW)
--   trg_fuel_txn_b_audit       (fires second — captures NEW with updated_at)

DROP TRIGGER IF EXISTS trg_fuel_transactions_updated_at ON fuel_transactions;
CREATE TRIGGER trg_fuel_txn_a_updated_at
  BEFORE UPDATE ON fuel_transactions
  FOR EACH ROW EXECUTE FUNCTION _fuel_set_updated_at();

DROP TRIGGER IF EXISTS trg_fuel_transactions_audit ON fuel_transactions;
CREATE TRIGGER trg_fuel_txn_b_audit
  BEFORE UPDATE OR DELETE ON fuel_transactions
  FOR EACH ROW EXECUTE FUNCTION _fuel_audit_edit();

-- ─── 4. Update recalc trigger to handle soft-delete ────────────────────────
-- When is_deleted flips to true, the row's effect should be reversed (treated
-- as if the transaction no longer exists). When is_deleted is true, NEW effect
-- is zero regardless of litres/type.

CREATE OR REPLACE FUNCTION _fuel_recalc_tank_level()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _old_effect NUMERIC(12,3);
  _new_effect NUMERIC(12,3);
BEGIN
  _old_effect := CASE
    WHEN OLD.is_deleted THEN 0
    WHEN OLD.transaction_type = 'issuance' THEN -OLD.litres
    WHEN OLD.transaction_type IN ('delivery', 'adjustment', 'dip_correction') THEN OLD.litres
    ELSE 0
  END;

  _new_effect := CASE
    WHEN NEW.is_deleted THEN 0
    WHEN NEW.transaction_type = 'issuance' THEN -NEW.litres
    WHEN NEW.transaction_type IN ('delivery', 'adjustment', 'dip_correction') THEN NEW.litres
    ELSE 0
  END;

  IF OLD.tank_id IS DISTINCT FROM NEW.tank_id THEN
    UPDATE fuel_tanks
    SET current_level_litres = GREATEST(0, current_level_litres - _old_effect),
        updated_at = now()
    WHERE id = OLD.tank_id;

    UPDATE fuel_tanks
    SET current_level_litres = GREATEST(0, current_level_litres + _new_effect),
        updated_at = now()
    WHERE id = NEW.tank_id;
  ELSE
    UPDATE fuel_tanks
    SET current_level_litres = GREATEST(0, current_level_litres + (_new_effect - _old_effect)),
        updated_at = now()
    WHERE id = NEW.tank_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fuel_deliveries_audit ON fuel_deliveries;
CREATE TRIGGER trg_fuel_deliveries_audit
  AFTER UPDATE OR DELETE ON fuel_deliveries
  FOR EACH ROW EXECUTE FUNCTION _fuel_audit_edit();

DROP TRIGGER IF EXISTS trg_fuel_dip_readings_audit ON fuel_dip_readings;
CREATE TRIGGER trg_fuel_dip_readings_audit
  AFTER UPDATE OR DELETE ON fuel_dip_readings
  FOR EACH ROW EXECUTE FUNCTION _fuel_audit_edit();
