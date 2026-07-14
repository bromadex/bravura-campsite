-- 0090: Restore employees.termination_date.
-- A parallel session re-applied old HR Phase 1 DDL on 2026-07-14, leaving
-- employees without termination_date (added later in the HR build). All HR
-- reports 400'd on the missing column. Data was intact; re-add and backfill
-- from end_date for already-terminated employees.

ALTER TABLE employees ADD COLUMN IF NOT EXISTS termination_date DATE;

UPDATE employees
   SET termination_date = end_date
 WHERE termination_date IS NULL
   AND end_date IS NOT NULL
   AND status IN ('terminated', 'resigned', 'retired', 'deceased', 'exited');

INSERT INTO schema_migrations (filename)
VALUES ('0090_restore_employees_termination_date.sql')
ON CONFLICT DO NOTHING;
