-- 0260b: Ask Bravura may propose project tasks (ai_action_confirm kind 'project_task').
ALTER TABLE ai_actions DROP CONSTRAINT ai_actions_kind_check;
ALTER TABLE ai_actions ADD CONSTRAINT ai_actions_kind_check CHECK (kind = ANY (ARRAY['receive_delivery','draft_bill','petty_cash_spend','purchase_request','approval_decision','po_from_quote','stock_issue','small_asset_issue','small_asset_return','fleet_job','fleet_meter','stock_transfer','project_task']));
INSERT INTO schema_migrations (filename) VALUES ('0260b_ai_actions_project_task.sql') ON CONFLICT DO NOTHING;
