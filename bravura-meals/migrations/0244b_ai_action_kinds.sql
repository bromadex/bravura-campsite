-- 0244b — allow the Fleet A6 proposal kinds in ai_actions.
DO $$ DECLARE d text; BEGIN
  SELECT pg_get_constraintdef(oid) INTO d FROM pg_constraint WHERE conname = 'ai_actions_kind_check';
  IF d IS NOT NULL AND position('small_asset_issue' in d) = 0 THEN
    ALTER TABLE ai_actions DROP CONSTRAINT ai_actions_kind_check;
    EXECUTE 'ALTER TABLE ai_actions ADD CONSTRAINT ai_actions_kind_check '
      || replace(d, '''stock_issue''::text,', '''stock_issue''::text, ''small_asset_issue''::text, ''small_asset_return''::text, ''fleet_job''::text, ''fleet_meter''::text,');
    IF position('small_asset_issue' in pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = 'ai_actions_kind_check'))) = 0 THEN
      RAISE EXCEPTION 'kind check patch point not found: %', d;
    END IF;
  END IF;
END $$;
INSERT INTO schema_migrations (filename) VALUES ('0244b_ai_action_kinds.sql') ON CONFLICT DO NOTHING;
