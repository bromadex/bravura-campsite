-- ── 0050: Make fuel transactions editable with full audit trail ──────────────
-- Adds updated_at / updated_by to the three core fuel tables, plus a
-- dedicated fuel_edit_log table that captures before/after snapshots.
-- A DB trigger on each table writes the audit row automatically on UPDATE,
-- and a second trigger recalculates the tank's current_level_litres whenever
-- a fuel_transaction row is modified.

-- ─── 1. updated_at / updated_by columns ──────────────────────────────────────

ALTER TABLE fuel_transactions
  ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_by  UUID REFERENCES profiles(id);

ALTER TABLE fuel_deliveries
  ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_by  UUID REFERENCES profiles(id);

ALTER TABLE fuel_dip_readings
  ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_by  UUID REFERENCES profiles(id);

-- ─── 2. Fuel edit audit log table ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fuel_edit_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name   TEXT        NOT NULL,
  record_id    UUID        NOT NULL,
  action       TEXT        NOT NULL DEFAULT 'update',
  old_values   JSONB,
  new_values   JSONB,
  changed_by   UUID        REFERENCES profiles(id),
  changed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  site_id      UUID        REFERENCES sites(id)
);

CREATE INDEX IF NOT EXISTS idx_fuel_edit_log_record
  ON fuel_edit_log (record_id);
CREATE INDEX IF NOT EXISTS idx_fuel_edit_log_table
  ON fuel_edit_log (table_name, changed_at DESC);

COMMENT ON TABLE fuel_edit_log IS
  'Immutable audit trail for all fuel record edits — before/after JSONB snapshots.';

-- ─── 3. Auto-set updated_at on UPDATE ────────────────────────────────────────

CREATE OR REPLACE FUNCTION _fuel_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fuel_transactions_updated_at ON fuel_transactions;
CREATE TRIGGER trg_fuel_transactions_updated_at
  BEFORE UPDATE ON fuel_transactions
  FOR EACH ROW EXECUTE FUNCTION _fuel_set_updated_at();

DROP TRIGGER IF EXISTS trg_fuel_deliveries_updated_at ON fuel_deliveries;
CREATE TRIGGER trg_fuel_deliveries_updated_at
  BEFORE UPDATE ON fuel_deliveries
  FOR EACH ROW EXECUTE FUNCTION _fuel_set_updated_at();

DROP TRIGGER IF EXISTS trg_fuel_dip_readings_updated_at ON fuel_dip_readings;
CREATE TRIGGER trg_fuel_dip_readings_updated_at
  BEFORE UPDATE ON fuel_dip_readings
  FOR EACH ROW EXECUTE FUNCTION _fuel_set_updated_at();

-- ─── 4. Audit trigger — writes to fuel_edit_log on every UPDATE ──────────────

CREATE OR REPLACE FUNCTION _fuel_audit_edit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
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

DROP TRIGGER IF EXISTS trg_fuel_transactions_audit ON fuel_transactions;
CREATE TRIGGER trg_fuel_transactions_audit
  AFTER UPDATE ON fuel_transactions
  FOR EACH ROW EXECUTE FUNCTION _fuel_audit_edit();

DROP TRIGGER IF EXISTS trg_fuel_deliveries_audit ON fuel_deliveries;
CREATE TRIGGER trg_fuel_deliveries_audit
  AFTER UPDATE ON fuel_deliveries
  FOR EACH ROW EXECUTE FUNCTION _fuel_audit_edit();

DROP TRIGGER IF EXISTS trg_fuel_dip_readings_audit ON fuel_dip_readings;
CREATE TRIGGER trg_fuel_dip_readings_audit
  AFTER UPDATE ON fuel_dip_readings
  FOR EACH ROW EXECUTE FUNCTION _fuel_audit_edit();

-- ─── 5. Recalculate tank level after transaction edit ────────────────────────
-- When a fuel_transaction row is updated (litres changed, tank changed, etc.)
-- we recalculate the tank's current_level_litres from scratch.
-- This is the authoritative "replay all transactions" approach.

CREATE OR REPLACE FUNCTION _fuel_recalc_tank_level()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _tank_id UUID;
  _new_level NUMERIC(12,3);
BEGIN
  -- Recalc for the NEW tank
  _tank_id := NEW.tank_id;

  SELECT COALESCE(
    (SELECT ft.capacity_litres FROM fuel_tanks ft WHERE ft.id = _tank_id),
    0
  ) INTO _new_level;

  -- Sum all transactions for this tank
  SELECT COALESCE(SUM(
    CASE
      WHEN t.transaction_type IN ('delivery', 'adjustment') THEN t.litres
      WHEN t.transaction_type = 'issuance' THEN -t.litres
      ELSE 0
    END
  ), 0)
  INTO _new_level
  FROM fuel_transactions t
  WHERE t.tank_id = _tank_id;

  UPDATE fuel_tanks
  SET current_level_litres = GREATEST(0, _new_level)
  WHERE id = _tank_id;

  -- If the tank changed, also recalc the OLD tank
  IF TG_OP = 'UPDATE' AND OLD.tank_id IS DISTINCT FROM NEW.tank_id THEN
    SELECT COALESCE(SUM(
      CASE
        WHEN t.transaction_type IN ('delivery', 'adjustment') THEN t.litres
        WHEN t.transaction_type = 'issuance' THEN -t.litres
        ELSE 0
      END
    ), 0)
    INTO _new_level
    FROM fuel_transactions t
    WHERE t.tank_id = OLD.tank_id;

    UPDATE fuel_tanks
    SET current_level_litres = GREATEST(0, _new_level)
    WHERE id = OLD.tank_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fuel_transactions_recalc ON fuel_transactions;
CREATE TRIGGER trg_fuel_transactions_recalc
  AFTER UPDATE ON fuel_transactions
  FOR EACH ROW EXECUTE FUNCTION _fuel_recalc_tank_level();

-- ─── 6. RLS on fuel_edit_log ─────────────────────────────────────────────────

ALTER TABLE fuel_edit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fuel_edit_log_select ON fuel_edit_log;
CREATE POLICY fuel_edit_log_select ON fuel_edit_log
  FOR SELECT USING (
    _user_at_site(site_id)
  );

DROP POLICY IF EXISTS fuel_edit_log_insert ON fuel_edit_log;
CREATE POLICY fuel_edit_log_insert ON fuel_edit_log
  FOR INSERT WITH CHECK (true);

-- ─── 7. Allow UPDATE on fuel_transactions (was previously blocked by absence of policy) ─

DROP POLICY IF EXISTS fuel_transactions_update ON fuel_transactions;
CREATE POLICY fuel_transactions_update ON fuel_transactions
  FOR UPDATE USING (
    _user_has_fuel_perm(site_id, ARRAY['fuel.edit'])
  );

DROP POLICY IF EXISTS fuel_dip_readings_update ON fuel_dip_readings;
CREATE POLICY fuel_dip_readings_update ON fuel_dip_readings
  FOR UPDATE USING (
    _user_has_fuel_perm(site_id, ARRAY['fuel.edit'])
  );
