-- 0166 Change SHEQ person-selection FKs from profiles to employees
-- Person-selection fields (dropdowns) should reference employees (HR records),
-- not profiles (auth users). System-actor fields (created_by, reported_by,
-- closed_by, resolved_by, issued_by, returned_to, observer_id, cleanup_verified_by)
-- remain referencing profiles since those are set from the logged-in user.

BEGIN;

-- sheq_audit_findings
ALTER TABLE sheq_audit_findings DROP CONSTRAINT sheq_audit_findings_responsible_id_fkey;
ALTER TABLE sheq_audit_findings ADD CONSTRAINT sheq_audit_findings_responsible_id_fkey FOREIGN KEY (responsible_id) REFERENCES employees(id);

-- sheq_audits
ALTER TABLE sheq_audits DROP CONSTRAINT sheq_audits_lead_auditor_id_fkey;
ALTER TABLE sheq_audits ADD CONSTRAINT sheq_audits_lead_auditor_id_fkey FOREIGN KEY (lead_auditor_id) REFERENCES employees(id);

-- sheq_capa
ALTER TABLE sheq_capa DROP CONSTRAINT sheq_capa_assigned_to_fkey;
ALTER TABLE sheq_capa ADD CONSTRAINT sheq_capa_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES employees(id);
ALTER TABLE sheq_capa DROP CONSTRAINT sheq_capa_owner_id_fkey;
ALTER TABLE sheq_capa ADD CONSTRAINT sheq_capa_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES employees(id);
ALTER TABLE sheq_capa DROP CONSTRAINT sheq_capa_verification_by_fkey;
ALTER TABLE sheq_capa ADD CONSTRAINT sheq_capa_verification_by_fkey FOREIGN KEY (verification_by) REFERENCES employees(id);

-- sheq_env_monitoring
ALTER TABLE sheq_env_monitoring DROP CONSTRAINT sheq_env_monitoring_recorded_by_fkey;
ALTER TABLE sheq_env_monitoring ADD CONSTRAINT sheq_env_monitoring_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES employees(id);
ALTER TABLE sheq_env_monitoring DROP CONSTRAINT sheq_env_monitoring_verified_by_fkey;
ALTER TABLE sheq_env_monitoring ADD CONSTRAINT sheq_env_monitoring_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES employees(id);

-- sheq_environmental_aspects
ALTER TABLE sheq_environmental_aspects DROP CONSTRAINT sheq_environmental_aspects_responsible_id_fkey;
ALTER TABLE sheq_environmental_aspects ADD CONSTRAINT sheq_environmental_aspects_responsible_id_fkey FOREIGN KEY (responsible_id) REFERENCES employees(id);

-- sheq_hazard_reports
ALTER TABLE sheq_hazard_reports DROP CONSTRAINT sheq_hazard_reports_assigned_to_fkey;
ALTER TABLE sheq_hazard_reports ADD CONSTRAINT sheq_hazard_reports_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES employees(id);

-- sheq_incidents
ALTER TABLE sheq_incidents DROP CONSTRAINT sheq_incidents_investigated_by_fkey;
ALTER TABLE sheq_incidents ADD CONSTRAINT sheq_incidents_investigated_by_fkey FOREIGN KEY (investigated_by) REFERENCES employees(id);

-- sheq_inspections
ALTER TABLE sheq_inspections DROP CONSTRAINT sheq_inspections_inspector_id_fkey;
ALTER TABLE sheq_inspections ADD CONSTRAINT sheq_inspections_inspector_id_fkey FOREIGN KEY (inspector_id) REFERENCES employees(id);
ALTER TABLE sheq_inspections DROP CONSTRAINT sheq_inspections_reviewed_by_fkey;
ALTER TABLE sheq_inspections ADD CONSTRAINT sheq_inspections_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES employees(id);

-- sheq_loto_isolations
ALTER TABLE sheq_loto_isolations DROP CONSTRAINT sheq_loto_isolations_applied_by_fkey;
ALTER TABLE sheq_loto_isolations ADD CONSTRAINT sheq_loto_isolations_applied_by_fkey FOREIGN KEY (applied_by) REFERENCES employees(id);
ALTER TABLE sheq_loto_isolations DROP CONSTRAINT sheq_loto_isolations_restored_by_fkey;
ALTER TABLE sheq_loto_isolations ADD CONSTRAINT sheq_loto_isolations_restored_by_fkey FOREIGN KEY (restored_by) REFERENCES employees(id);
ALTER TABLE sheq_loto_isolations DROP CONSTRAINT sheq_loto_isolations_verified_by_fkey;
ALTER TABLE sheq_loto_isolations ADD CONSTRAINT sheq_loto_isolations_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES employees(id);

-- sheq_permits
ALTER TABLE sheq_permits DROP CONSTRAINT sheq_permits_area_authority_id_fkey;
ALTER TABLE sheq_permits ADD CONSTRAINT sheq_permits_area_authority_id_fkey FOREIGN KEY (area_authority_id) REFERENCES employees(id);
ALTER TABLE sheq_permits DROP CONSTRAINT sheq_permits_requested_by_fkey;
ALTER TABLE sheq_permits ADD CONSTRAINT sheq_permits_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES employees(id);
ALTER TABLE sheq_permits DROP CONSTRAINT sheq_permits_sheq_officer_id_fkey;
ALTER TABLE sheq_permits ADD CONSTRAINT sheq_permits_sheq_officer_id_fkey FOREIGN KEY (sheq_officer_id) REFERENCES employees(id);
ALTER TABLE sheq_permits DROP CONSTRAINT sheq_permits_supervisor_id_fkey;
ALTER TABLE sheq_permits ADD CONSTRAINT sheq_permits_supervisor_id_fkey FOREIGN KEY (supervisor_id) REFERENCES employees(id);

-- sheq_ppe_issues
ALTER TABLE sheq_ppe_issues DROP CONSTRAINT sheq_ppe_issues_issued_to_fkey;
ALTER TABLE sheq_ppe_issues ADD CONSTRAINT sheq_ppe_issues_issued_to_fkey FOREIGN KEY (issued_to) REFERENCES employees(id);

-- sheq_resource_consumption
ALTER TABLE sheq_resource_consumption DROP CONSTRAINT sheq_resource_consumption_recorded_by_fkey;
ALTER TABLE sheq_resource_consumption ADD CONSTRAINT sheq_resource_consumption_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES employees(id);

-- sheq_risk_assessments
ALTER TABLE sheq_risk_assessments DROP CONSTRAINT sheq_risk_assessments_approved_by_fkey;
ALTER TABLE sheq_risk_assessments ADD CONSTRAINT sheq_risk_assessments_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES employees(id);
ALTER TABLE sheq_risk_assessments DROP CONSTRAINT sheq_risk_assessments_assessed_by_fkey;
ALTER TABLE sheq_risk_assessments ADD CONSTRAINT sheq_risk_assessments_assessed_by_fkey FOREIGN KEY (assessed_by) REFERENCES employees(id);

-- sheq_risk_register
ALTER TABLE sheq_risk_register DROP CONSTRAINT sheq_risk_register_owner_id_fkey;
ALTER TABLE sheq_risk_register ADD CONSTRAINT sheq_risk_register_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES employees(id);

-- sheq_spill_incidents
ALTER TABLE sheq_spill_incidents DROP CONSTRAINT sheq_spill_incidents_response_lead_fkey;
ALTER TABLE sheq_spill_incidents ADD CONSTRAINT sheq_spill_incidents_response_lead_fkey FOREIGN KEY (response_lead) REFERENCES employees(id);

-- sheq_waste_records
ALTER TABLE sheq_waste_records DROP CONSTRAINT sheq_waste_records_collected_by_fkey;
ALTER TABLE sheq_waste_records ADD CONSTRAINT sheq_waste_records_collected_by_fkey FOREIGN KEY (collected_by) REFERENCES employees(id);
ALTER TABLE sheq_waste_records DROP CONSTRAINT sheq_waste_records_verified_by_fkey;
ALTER TABLE sheq_waste_records ADD CONSTRAINT sheq_waste_records_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES employees(id);

INSERT INTO schema_migrations (filename) VALUES ('0166_sheq_person_fks_to_employees.sql') ON CONFLICT DO NOTHING;

COMMIT;
