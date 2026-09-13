-- 0090: Finance Module — Phase 1 Foundation
-- Chart of Accounts, Journal Entries, Journal Lines, GL posting RPC, permissions.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════
-- 1. Chart of Accounts
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS accounts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id       UUID NOT NULL REFERENCES sites(id),
  code          TEXT NOT NULL,
  name          TEXT NOT NULL,
  account_type  TEXT NOT NULL CHECK (account_type IN ('Asset','Liability','Equity','Revenue','Expense')),
  sub_type      TEXT,  -- e.g. 'Current Asset', 'Fixed Asset', 'Cost of Sales', 'Operating Expense'
  parent_id     UUID REFERENCES accounts(id),
  description   TEXT,
  balance       NUMERIC(15,2) NOT NULL DEFAULT 0,
  is_archived   BOOLEAN NOT NULL DEFAULT false,
  created_by    UUID REFERENCES auth.users(id),
  updated_by    UUID REFERENCES auth.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(site_id, code)
);

ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY accounts_select ON accounts FOR SELECT USING (
  _has_permission('FI01', site_id) OR _has_permission('FI02', site_id)
);
CREATE POLICY accounts_insert ON accounts FOR INSERT WITH CHECK (
  _has_permission('FI03', site_id)
);
CREATE POLICY accounts_update ON accounts FOR UPDATE USING (
  _has_permission('FI04', site_id)
);
CREATE POLICY accounts_delete ON accounts FOR DELETE USING (
  _has_permission('FI05', site_id)
);

-- ═══════════════════════════════════════════════════════════════════════
-- 2. Journal Entries (header)
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS journal_entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id         UUID NOT NULL REFERENCES sites(id),
  entry_number    TEXT NOT NULL,
  entry_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  description     TEXT,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','void')),
  source_module   TEXT,       -- e.g. 'fuel', 'fleet', 'meals'
  source_record_id UUID,     -- FK to originating record
  total_debit     NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_credit    NUMERIC(15,2) NOT NULL DEFAULT 0,
  posted_at       TIMESTAMPTZ,
  posted_by       UUID REFERENCES auth.users(id),
  voided_at       TIMESTAMPTZ,
  voided_by       UUID REFERENCES auth.users(id),
  void_reason     TEXT,
  is_archived     BOOLEAN NOT NULL DEFAULT false,
  created_by      UUID REFERENCES auth.users(id),
  updated_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(site_id, entry_number)
);

ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY je_select ON journal_entries FOR SELECT USING (
  _has_permission('FI01', site_id)
);
CREATE POLICY je_insert ON journal_entries FOR INSERT WITH CHECK (
  _has_permission('FI03', site_id)
);
CREATE POLICY je_update ON journal_entries FOR UPDATE USING (
  _has_permission('FI04', site_id)
);
CREATE POLICY je_delete ON journal_entries FOR DELETE USING (
  _has_permission('FI05', site_id)
);

-- ═══════════════════════════════════════════════════════════════════════
-- 3. Journal Lines (detail rows)
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS journal_lines (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_id    UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id    UUID NOT NULL REFERENCES accounts(id),
  description   TEXT,
  debit         NUMERIC(15,2) NOT NULL DEFAULT 0,
  credit        NUMERIC(15,2) NOT NULL DEFAULT 0,
  line_order    INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (debit >= 0 AND credit >= 0),
  CHECK (NOT (debit > 0 AND credit > 0))  -- a line is debit OR credit, not both
);

ALTER TABLE journal_lines ENABLE ROW LEVEL SECURITY;

-- Lines inherit access from their parent journal entry
CREATE POLICY jl_select ON journal_lines FOR SELECT USING (
  EXISTS (SELECT 1 FROM journal_entries je WHERE je.id = journal_id AND _has_permission('FI01', je.site_id))
);
CREATE POLICY jl_insert ON journal_lines FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM journal_entries je WHERE je.id = journal_id AND _has_permission('FI03', je.site_id))
);
CREATE POLICY jl_update ON journal_lines FOR UPDATE USING (
  EXISTS (SELECT 1 FROM journal_entries je WHERE je.id = journal_id AND _has_permission('FI04', je.site_id))
);
CREATE POLICY jl_delete ON journal_lines FOR DELETE USING (
  EXISTS (SELECT 1 FROM journal_entries je WHERE je.id = journal_id AND _has_permission('FI05', je.site_id))
);

-- ═══════════════════════════════════════════════════════════════════════
-- 4. Permissions
-- ═══════════════════════════════════════════════════════════════════════
INSERT INTO permissions (code, module, action, description) VALUES
  ('FI01', 'finance', 'View',    'View financial data'),
  ('FI03', 'finance', 'Create',  'Create journal entries and accounts'),
  ('FI04', 'finance', 'Edit',    'Edit journal entries and accounts'),
  ('FI05', 'finance', 'Delete',  'Archive financial records'),
  ('FI02', 'finance', 'Approve', 'Post and approve journal entries')
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════
-- 5. GL Posting RPC
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION finance_post_journal(
  p_journal_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _je          journal_entries%ROWTYPE;
  _total_debit NUMERIC(15,2);
  _total_credit NUMERIC(15,2);
  _line        RECORD;
BEGIN
  SELECT * INTO _je FROM journal_entries WHERE id = p_journal_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Journal entry not found');
  END IF;
  IF _je.status != 'draft' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Only draft entries can be posted');
  END IF;

  SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
    INTO _total_debit, _total_credit
    FROM journal_lines WHERE journal_id = p_journal_id;

  IF _total_debit = 0 AND _total_credit = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Journal has no lines');
  END IF;
  IF _total_debit != _total_credit THEN
    RETURN jsonb_build_object('ok', false, 'error',
      format('Debits (%s) do not equal credits (%s)', _total_debit, _total_credit));
  END IF;

  -- Update account balances
  FOR _line IN SELECT * FROM journal_lines WHERE journal_id = p_journal_id LOOP
    UPDATE accounts
       SET balance = CASE
             WHEN account_type IN ('Asset','Expense') THEN balance + _line.debit - _line.credit
             ELSE balance - _line.debit + _line.credit
           END,
           updated_at = now()
     WHERE id = _line.account_id;
  END LOOP;

  -- Mark posted
  UPDATE journal_entries
     SET status = 'posted',
         total_debit = _total_debit,
         total_credit = _total_credit,
         posted_at = now(),
         posted_by = auth.uid(),
         updated_at = now()
   WHERE id = p_journal_id;

  RETURN jsonb_build_object('ok', true, 'total', _total_debit);
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 6. Void Journal RPC
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION finance_void_journal(
  p_journal_id UUID,
  p_reason TEXT DEFAULT 'Voided'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _je   journal_entries%ROWTYPE;
  _line RECORD;
BEGIN
  SELECT * INTO _je FROM journal_entries WHERE id = p_journal_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Journal entry not found');
  END IF;
  IF _je.status != 'posted' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Only posted entries can be voided');
  END IF;

  -- Reverse account balances
  FOR _line IN SELECT * FROM journal_lines WHERE journal_id = p_journal_id LOOP
    UPDATE accounts
       SET balance = CASE
             WHEN account_type IN ('Asset','Expense') THEN balance - _line.debit + _line.credit
             ELSE balance + _line.debit - _line.credit
           END,
           updated_at = now()
     WHERE id = _line.account_id;
  END LOOP;

  UPDATE journal_entries
     SET status = 'void',
         voided_at = now(),
         voided_by = auth.uid(),
         void_reason = p_reason,
         updated_at = now()
   WHERE id = p_journal_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 7. Auto-number helper
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION finance_next_entry_number(p_site_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _max INT;
BEGIN
  SELECT COALESCE(MAX(
    CASE WHEN entry_number ~ '^JV-\d+$'
         THEN CAST(SUBSTRING(entry_number FROM 4) AS INT)
         ELSE 0
    END
  ), 0) INTO _max
  FROM journal_entries WHERE site_id = p_site_id;
  RETURN 'JV-' || LPAD((_max + 1)::TEXT, 4, '0');
END;
$$;

INSERT INTO schema_migrations (filename)
VALUES ('0090_finance_foundation.sql')
ON CONFLICT DO NOTHING;

COMMIT;
