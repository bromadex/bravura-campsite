-- 0103: Employee numbering starts with BRA
-- Updates any already-saved HR settings rows still using the old EMP- prefix.
-- New sites pick up BRA automatically from the client-side default.

UPDATE module_settings
SET value = to_jsonb('BRA'::text)
WHERE module = 'hr'
  AND key = 'employee_number_prefix'
  AND value = to_jsonb('EMP-'::text);

INSERT INTO schema_migrations (filename)
VALUES ('0103_employee_number_prefix_bra.sql')
ON CONFLICT DO NOTHING;
