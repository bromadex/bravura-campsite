-- 0194: One set of tables for PPE, medicals and training certificates, shared by HR and SHEQ.
--   * PPE → sheq_ppe_items / sheq_ppe_issues; medicals → sheq_medical_fitness; certificates → sheq_training_matrix
--   * HR users (hr.*) get the same access as SHEQ users (sheq.*) to these tables
--   * the old HR tables (ppe_issues, medical_records) are frozen — no new rows (both were empty)
--   * completing an HR training programme writes the certificate into the SHEQ training matrix
--   * fix: the sheq_ppe_* "ALL using sheq.view" policies let viewers write — now read-only

ALTER TABLE sheq_medical_fitness ADD COLUMN IF NOT EXISTS blood_group TEXT;
ALTER TABLE sheq_medical_fitness ADD COLUMN IF NOT EXISTS allergies   TEXT;
ALTER TABLE sheq_training_matrix ADD COLUMN IF NOT EXISTS training_enrollment_id UUID REFERENCES training_enrollments(id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_training_matrix_enrollment ON sheq_training_matrix (training_enrollment_id) WHERE training_enrollment_id IS NOT NULL;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['sheq_ppe_items','sheq_ppe_issues','sheq_medical_fitness','sheq_training_matrix'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_policy', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_delete', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (_has_permission(''sheq.view'', site_id) OR _has_hr_permission(''hr.view'', site_id))', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT WITH CHECK (_has_permission(''sheq.create'', site_id) OR _has_hr_permission(''hr.create'', site_id))', t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE USING (_has_permission(''sheq.edit'', site_id) OR _has_hr_permission(''hr.edit'', site_id)) WITH CHECK (_has_permission(''sheq.edit'', site_id) OR _has_hr_permission(''hr.edit'', site_id))', t || '_update', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR DELETE USING (_has_permission(''sheq.delete'', site_id))', t || '_delete', t);
  END LOOP;
END $$;

-- Freeze the duplicate HR tables.
CREATE OR REPLACE FUNCTION trg_moved_to_sheq() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% records now live in SHEQ (%). Use the PPE / Medical screens — HR and SHEQ share them.', TG_ARGV[0], TG_ARGV[1];
END;
$$;
DROP TRIGGER IF EXISTS trg_frozen ON ppe_issues;
CREATE TRIGGER trg_frozen BEFORE INSERT ON ppe_issues FOR EACH ROW EXECUTE FUNCTION trg_moved_to_sheq('PPE issue', 'sheq_ppe_issues');
DROP TRIGGER IF EXISTS trg_frozen ON medical_records;
CREATE TRIGGER trg_frozen BEFORE INSERT ON medical_records FOR EACH ROW EXECUTE FUNCTION trg_moved_to_sheq('Medical', 'sheq_medical_fitness');
COMMENT ON TABLE ppe_issues IS 'Retired (0194): use sheq_ppe_issues';
COMMENT ON TABLE medical_records IS 'Retired (0194): use sheq_medical_fitness';

-- HR training completion → competency certificate in the SHEQ matrix.
CREATE OR REPLACE FUNCTION trg_training_to_matrix() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _p training_programs%ROWTYPE;
BEGIN
  IF COALESCE(NEW.status, '') <> 'completed' THEN RETURN NEW; END IF;
  SELECT * INTO _p FROM training_programs WHERE id = NEW.training_program_id;
  INSERT INTO sheq_training_matrix (site_id, employee_id, training_type, course_name, provider, certificate_number, date_completed,
                                    status, notes, attachment_url, created_by, training_enrollment_id)
  VALUES (NEW.site_id, NEW.employee_id, 'course', COALESCE(_p.title, 'Training'), _p.trainer, NULL,
          COALESCE(NEW.completion_date, CURRENT_DATE), 'valid', 'From HR training programme', NEW.certificate_path, auth.uid(), NEW.id)
  ON CONFLICT (training_enrollment_id) WHERE training_enrollment_id IS NOT NULL DO UPDATE
    SET date_completed = EXCLUDED.date_completed, attachment_url = COALESCE(EXCLUDED.attachment_url, sheq_training_matrix.attachment_url), updated_at = now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_training_to_matrix ON training_enrollments;
CREATE TRIGGER trg_training_to_matrix AFTER INSERT OR UPDATE OF status, completion_date, certificate_path ON training_enrollments
  FOR EACH ROW EXECUTE FUNCTION trg_training_to_matrix();

INSERT INTO schema_migrations (filename) VALUES ('0194_merge_hr_sheq_health.sql') ON CONFLICT DO NOTHING;
