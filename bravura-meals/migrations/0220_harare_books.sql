-- 0220 harare_books — set up Harare (head office) books, done in the database on 25 Sep 2026 as Clement
-- (recorded here for the history; the functions check finance.edit at Harare).
--   • chart of accounts: the same mining template accounts Kamativi uses (78 accounts)
--   • posting rules: finance_setup_suggest_rules (46 rules, incl. hq_paid_for_site / hq_funded_site_cash)
--   • bank account "Harare main current account" → GL 1110 (bank name to be filled in)
--   • MOCK opening balances as at 30 Sep 2026: Dr 1110 bank 1,500,000; Dr 2500 owed by sites 3,000,000
--     (mirrors Kamativi's mock Cr 2500 3,000,000); Cr 3900 opening balance equity 4,500,000.
--     Clear with finance_setup_clear_mock_opening(<harare id>) before the real figures go in.
--   • went live (testing) 25 Sep 2026.
DO $$
DECLARE h uuid; k uuid; bank uuid; b2500 uuid; b3900 uuid;
BEGIN
  SELECT id INTO h FROM sites WHERE site_type = 'head_office' ORDER BY name LIMIT 1;
  SELECT id INTO k FROM sites WHERE code = 'KAM';
  IF EXISTS (SELECT 1 FROM finance_setup WHERE site_id = h AND went_live_at IS NOT NULL) THEN RETURN; END IF;
  PERFORM finance_setup_apply_template(h, (SELECT array_agg(code) FROM accounts WHERE site_id = k AND NOT is_archived));
  PERFORM finance_setup_suggest_rules(h);
  SELECT id INTO bank FROM accounts WHERE site_id = h AND code = '1110';
  SELECT id INTO b2500 FROM accounts WHERE site_id = h AND code = '2500';
  SELECT id INTO b3900 FROM accounts WHERE site_id = h AND code = '3900';
  INSERT INTO bank_accounts (site_id, account_name, bank_name, currency, gl_account_id, opening_balance, current_balance, is_active, is_archived)
  VALUES (h, 'Harare main current account', '(set bank name)', 'USD', bank, 0, 0, true, false);
  PERFORM finance_setup_opening_balances(h, '2026-09-30', jsonb_build_array(
    jsonb_build_object('account_id', bank, 'debit', 1500000, 'credit', 0),
    jsonb_build_object('account_id', b2500, 'debit', 3000000, 'credit', 0),
    jsonb_build_object('account_id', b3900, 'debit', 0, 'credit', 4500000)), true);
  PERFORM finance_setup_go_live(h, '2026-09-25');
END $$;
INSERT INTO schema_migrations (filename) VALUES ('0220_harare_books.sql') ON CONFLICT DO NOTHING;
