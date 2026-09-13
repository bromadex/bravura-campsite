-- 0091: Finance Module — Phase 2 Banking
-- Bank accounts and bank statement lines for reconciliation.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════
-- 1. Bank Accounts
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS bank_accounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id         UUID NOT NULL REFERENCES sites(id),
  account_name    TEXT NOT NULL,
  account_number  TEXT,
  bank_name       TEXT,
  branch          TEXT,
  currency        TEXT NOT NULL DEFAULT 'USD',
  gl_account_id   UUID REFERENCES accounts(id),
  opening_balance NUMERIC(15,2) NOT NULL DEFAULT 0,
  current_balance NUMERIC(15,2) NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  is_archived     BOOLEAN NOT NULL DEFAULT false,
  created_by      UUID REFERENCES auth.users(id),
  updated_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY ba_select ON bank_accounts FOR SELECT USING (
  _has_permission('FI01', site_id)
);
CREATE POLICY ba_insert ON bank_accounts FOR INSERT WITH CHECK (
  _has_permission('FI03', site_id)
);
CREATE POLICY ba_update ON bank_accounts FOR UPDATE USING (
  _has_permission('FI04', site_id)
);
CREATE POLICY ba_delete ON bank_accounts FOR DELETE USING (
  _has_permission('FI05', site_id)
);

-- ═══════════════════════════════════════════════════════════════════════
-- 2. Bank Statement Lines
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS bank_statement_lines (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_account_id   UUID NOT NULL REFERENCES bank_accounts(id),
  transaction_date  DATE NOT NULL,
  description       TEXT,
  reference         TEXT,
  debit             NUMERIC(15,2) NOT NULL DEFAULT 0,
  credit            NUMERIC(15,2) NOT NULL DEFAULT 0,
  balance           NUMERIC(15,2),
  is_reconciled     BOOLEAN NOT NULL DEFAULT false,
  reconciled_at     TIMESTAMPTZ,
  reconciled_by     UUID REFERENCES auth.users(id),
  matched_journal_id UUID REFERENCES journal_entries(id),
  import_batch      TEXT,
  is_archived       BOOLEAN NOT NULL DEFAULT false,
  created_by        UUID REFERENCES auth.users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE bank_statement_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY bsl_select ON bank_statement_lines FOR SELECT USING (
  EXISTS (SELECT 1 FROM bank_accounts ba WHERE ba.id = bank_account_id AND _has_permission('FI01', ba.site_id))
);
CREATE POLICY bsl_insert ON bank_statement_lines FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM bank_accounts ba WHERE ba.id = bank_account_id AND _has_permission('FI03', ba.site_id))
);
CREATE POLICY bsl_update ON bank_statement_lines FOR UPDATE USING (
  EXISTS (SELECT 1 FROM bank_accounts ba WHERE ba.id = bank_account_id AND _has_permission('FI04', ba.site_id))
);
CREATE POLICY bsl_delete ON bank_statement_lines FOR DELETE USING (
  EXISTS (SELECT 1 FROM bank_accounts ba WHERE ba.id = bank_account_id AND _has_permission('FI05', ba.site_id))
);

INSERT INTO schema_migrations (filename)
VALUES ('0091_finance_banking.sql')
ON CONFLICT DO NOTHING;

COMMIT;
