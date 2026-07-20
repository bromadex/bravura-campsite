-- Migration: 0090_projects_phase1_epm
-- EPM Foundation: area codes, project areas, document register, activity feed,
-- task schedule columns, baseline snapshots

-- ════════════════════════════════════════════════════════════════════════════════
-- 1. AREA CODES (master data, global — not site-scoped)
-- ════════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS area_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(10) NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  discipline VARCHAR(50),
  color VARCHAR(7) DEFAULT '#1B5E20',
  sort_order INT DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(code)
);

ALTER TABLE area_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY ac_select ON area_codes FOR SELECT
  USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid()));
CREATE POLICY ac_insert ON area_codes FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = auth.uid() AND p.code = 'projects.edit'
  ));
CREATE POLICY ac_update ON area_codes FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = auth.uid() AND p.code = 'projects.edit'
  ));

-- ════════════════════════════════════════════════════════════════════════════════
-- 2. PROJECT AREAS (links projects to area codes with budget & engineer)
-- ════════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS project_areas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  area_code_id UUID NOT NULL REFERENCES area_codes(id),
  responsible_engineer_id UUID REFERENCES auth.users(id),
  planned_budget NUMERIC(15,2) DEFAULT 0,
  current_budget NUMERIC(15,2) DEFAULT 0,
  description TEXT,
  status VARCHAR(20) CHECK (status IN ('active','on_hold','completed')) DEFAULT 'active',
  target_start_date DATE,
  target_end_date DATE,
  actual_start_date DATE,
  actual_end_date DATE,
  percent_complete NUMERIC(5,2) DEFAULT 0,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(project_id, area_code_id)
);

CREATE INDEX idx_project_areas_project ON project_areas(project_id);

ALTER TABLE project_areas ENABLE ROW LEVEL SECURITY;

CREATE POLICY pa_select ON project_areas FOR SELECT
  USING (EXISTS (SELECT 1 FROM projects pr JOIN user_roles ur ON (ur.site_id = pr.site_id OR ur.site_id IS NULL) WHERE pr.id = project_id AND ur.user_id = auth.uid()));
CREATE POLICY pa_insert ON project_areas FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM projects pr JOIN user_roles ur ON (ur.site_id = pr.site_id OR ur.site_id IS NULL) JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id WHERE pr.id = project_id AND ur.user_id = auth.uid() AND p.code = 'projects.edit'));
CREATE POLICY pa_update ON project_areas FOR UPDATE
  USING (EXISTS (SELECT 1 FROM projects pr JOIN user_roles ur ON (ur.site_id = pr.site_id OR ur.site_id IS NULL) JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id WHERE pr.id = project_areas.project_id AND ur.user_id = auth.uid() AND p.code = 'projects.edit'));
CREATE POLICY pa_delete ON project_areas FOR DELETE
  USING (EXISTS (SELECT 1 FROM projects pr JOIN user_roles ur ON (ur.site_id = pr.site_id OR ur.site_id IS NULL) JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id WHERE pr.id = project_areas.project_id AND ur.user_id = auth.uid() AND p.code = 'projects.edit'));

-- ════════════════════════════════════════════════════════════════════════════════
-- 3. DOCUMENT REGISTER
-- ════════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS project_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  area_id UUID REFERENCES project_areas(id),
  doc_number VARCHAR(100) NOT NULL,
  title VARCHAR(255) NOT NULL,
  doc_type VARCHAR(50) CHECK (doc_type IN ('drawing','specification','method_statement','transmittal','report','correspondence','permit','other')) DEFAULT 'drawing',
  discipline VARCHAR(50),
  revision VARCHAR(10) DEFAULT 'A',
  status VARCHAR(20) CHECK (status IN ('draft','issued_for_review','issued_for_construction','approved','superseded')) DEFAULT 'draft',
  file_url TEXT,
  file_size BIGINT,
  file_format VARCHAR(20),
  created_by UUID REFERENCES auth.users(id),
  reviewed_by UUID REFERENCES auth.users(id),
  approved_by UUID REFERENCES auth.users(id),
  review_date DATE,
  approval_date DATE,
  superseded_by UUID REFERENCES project_documents(id),
  notes TEXT,
  is_archived BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(project_id, doc_number, revision)
);

CREATE INDEX idx_project_docs_project ON project_documents(project_id);
CREATE INDEX idx_project_docs_area ON project_documents(area_id);

ALTER TABLE project_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY pd_select ON project_documents FOR SELECT
  USING (EXISTS (SELECT 1 FROM projects pr JOIN user_roles ur ON (ur.site_id = pr.site_id OR ur.site_id IS NULL) WHERE pr.id = project_id AND ur.user_id = auth.uid()));
CREATE POLICY pd_insert ON project_documents FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM projects pr JOIN user_roles ur ON (ur.site_id = pr.site_id OR ur.site_id IS NULL) JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id WHERE pr.id = project_id AND ur.user_id = auth.uid() AND p.code = 'projects.edit'));
CREATE POLICY pd_update ON project_documents FOR UPDATE
  USING (EXISTS (SELECT 1 FROM projects pr JOIN user_roles ur ON (ur.site_id = pr.site_id OR ur.site_id IS NULL) JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id WHERE pr.id = project_documents.project_id AND ur.user_id = auth.uid() AND p.code = 'projects.edit'));

-- Document revision history (immutable log)
CREATE TABLE IF NOT EXISTS document_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES project_documents(id) ON DELETE CASCADE,
  revision VARCHAR(10) NOT NULL,
  file_url TEXT,
  change_description TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE document_revisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY dr_select ON document_revisions FOR SELECT
  USING (EXISTS (SELECT 1 FROM project_documents pd JOIN projects pr ON pr.id = pd.project_id JOIN user_roles ur ON (ur.site_id = pr.site_id OR ur.site_id IS NULL) WHERE pd.id = document_id AND ur.user_id = auth.uid()));
CREATE POLICY dr_insert ON document_revisions FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM project_documents pd JOIN projects pr ON pr.id = pd.project_id JOIN user_roles ur ON (ur.site_id = pr.site_id OR ur.site_id IS NULL) JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id WHERE pd.id = document_id AND ur.user_id = auth.uid() AND p.code = 'projects.edit'));

-- Transmittals
CREATE TABLE IF NOT EXISTS document_transmittals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  transmittal_number VARCHAR(50) NOT NULL,
  from_party VARCHAR(100),
  to_party VARCHAR(100),
  sent_date DATE,
  method VARCHAR(20) CHECK (method IN ('email','portal','physical','courier')) DEFAULT 'email',
  status VARCHAR(20) CHECK (status IN ('draft','sent','received','acknowledged')) DEFAULT 'draft',
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(project_id, transmittal_number)
);

ALTER TABLE document_transmittals ENABLE ROW LEVEL SECURITY;

CREATE POLICY dt_select ON document_transmittals FOR SELECT
  USING (EXISTS (SELECT 1 FROM projects pr JOIN user_roles ur ON (ur.site_id = pr.site_id OR ur.site_id IS NULL) WHERE pr.id = project_id AND ur.user_id = auth.uid()));
CREATE POLICY dt_insert ON document_transmittals FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM projects pr JOIN user_roles ur ON (ur.site_id = pr.site_id OR ur.site_id IS NULL) JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id WHERE pr.id = project_id AND ur.user_id = auth.uid() AND p.code = 'projects.edit'));
CREATE POLICY dt_update ON document_transmittals FOR UPDATE
  USING (EXISTS (SELECT 1 FROM projects pr JOIN user_roles ur ON (ur.site_id = pr.site_id OR ur.site_id IS NULL) JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id WHERE pr.id = document_transmittals.project_id AND ur.user_id = auth.uid() AND p.code = 'projects.edit'));

-- Transmittal ↔ Document junction (instead of array)
CREATE TABLE IF NOT EXISTS transmittal_documents (
  transmittal_id UUID NOT NULL REFERENCES document_transmittals(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES project_documents(id) ON DELETE CASCADE,
  PRIMARY KEY (transmittal_id, document_id)
);

ALTER TABLE transmittal_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY td_select ON transmittal_documents FOR SELECT
  USING (EXISTS (SELECT 1 FROM document_transmittals dt JOIN projects pr ON pr.id = dt.project_id JOIN user_roles ur ON (ur.site_id = pr.site_id OR ur.site_id IS NULL) WHERE dt.id = transmittal_id AND ur.user_id = auth.uid()));
CREATE POLICY td_insert ON transmittal_documents FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM document_transmittals dt JOIN projects pr ON pr.id = dt.project_id JOIN user_roles ur ON (ur.site_id = pr.site_id OR ur.site_id IS NULL) JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id WHERE dt.id = transmittal_id AND ur.user_id = auth.uid() AND p.code = 'projects.edit'));
CREATE POLICY td_delete ON transmittal_documents FOR DELETE
  USING (EXISTS (SELECT 1 FROM document_transmittals dt JOIN projects pr ON pr.id = dt.project_id JOIN user_roles ur ON (ur.site_id = pr.site_id OR ur.site_id IS NULL) JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id WHERE dt.id = transmittal_documents.transmittal_id AND ur.user_id = auth.uid() AND p.code = 'projects.edit'));

-- ════════════════════════════════════════════════════════════════════════════════
-- 4. ACTIVITY FEED (trigger-written)
-- ════════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS project_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  area_id UUID REFERENCES project_areas(id),
  actor_id UUID REFERENCES auth.users(id),
  action_type VARCHAR(50) NOT NULL,
  entity_type VARCHAR(50),
  entity_id UUID,
  old_values JSONB,
  new_values JSONB,
  message TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_activity_project ON project_activity(project_id, created_at DESC);

ALTER TABLE project_activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY pact_select ON project_activity FOR SELECT
  USING (EXISTS (SELECT 1 FROM projects pr JOIN user_roles ur ON (ur.site_id = pr.site_id OR ur.site_id IS NULL) WHERE pr.id = project_id AND ur.user_id = auth.uid()));
CREATE POLICY pact_insert ON project_activity FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM projects pr JOIN user_roles ur ON (ur.site_id = pr.site_id OR ur.site_id IS NULL) WHERE pr.id = project_id AND ur.user_id = auth.uid()));

-- Activity feed trigger function
CREATE OR REPLACE FUNCTION fn_project_activity_log()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_project_id UUID;
  v_area_id UUID;
  v_action TEXT;
  v_entity TEXT;
  v_msg TEXT;
  v_old JSONB;
  v_new JSONB;
BEGIN
  -- Determine entity type from table name
  v_entity := TG_TABLE_NAME;

  -- Extract project_id depending on table
  IF v_entity = 'projects' THEN
    v_project_id := COALESCE(NEW.id, OLD.id);
    v_area_id := NULL;
  ELSIF v_entity = 'project_areas' THEN
    v_project_id := COALESCE(NEW.project_id, OLD.project_id);
    v_area_id := COALESCE(NEW.id, OLD.id);
  ELSIF v_entity = 'project_tasks' THEN
    v_project_id := COALESCE(NEW.project_id, OLD.project_id);
    v_area_id := COALESCE(NEW.area_id, OLD.area_id);
  ELSIF v_entity = 'project_documents' THEN
    v_project_id := COALESCE(NEW.project_id, OLD.project_id);
    v_area_id := COALESCE(NEW.area_id, OLD.area_id);
  ELSIF v_entity = 'project_phases' THEN
    v_project_id := COALESCE(NEW.project_id, OLD.project_id);
    v_area_id := NULL;
  ELSIF v_entity = 'project_members' THEN
    v_project_id := COALESCE(NEW.project_id, OLD.project_id);
    v_area_id := NULL;
  ELSE
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Determine action
  IF TG_OP = 'INSERT' THEN
    v_action := v_entity || '_created';
    v_old := NULL;
    v_new := to_jsonb(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    v_action := v_entity || '_updated';
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
  ELSIF TG_OP = 'DELETE' THEN
    v_action := v_entity || '_deleted';
    v_old := to_jsonb(OLD);
    v_new := NULL;
  END IF;

  -- Build message
  IF v_entity = 'project_tasks' THEN
    IF TG_OP = 'INSERT' THEN
      v_msg := 'created task "' || NEW.title || '"';
    ELSIF TG_OP = 'UPDATE' THEN
      IF OLD.column_id IS DISTINCT FROM NEW.column_id THEN
        v_msg := 'moved task "' || NEW.title || '"';
      ELSIF OLD.assigned_to IS DISTINCT FROM NEW.assigned_to THEN
        v_msg := 'reassigned task "' || NEW.title || '"';
      ELSIF OLD.priority IS DISTINCT FROM NEW.priority THEN
        v_msg := 'changed priority on "' || NEW.title || '"';
      ELSE
        v_msg := 'updated task "' || NEW.title || '"';
      END IF;
    END IF;
  ELSIF v_entity = 'project_documents' THEN
    IF TG_OP = 'INSERT' THEN
      v_msg := 'added document ' || NEW.doc_number || ' "' || NEW.title || '"';
    ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
      v_msg := 'changed document ' || NEW.doc_number || ' status to ' || NEW.status;
    ELSE
      v_msg := 'updated document ' || COALESCE(NEW.doc_number, OLD.doc_number);
    END IF;
  ELSIF v_entity = 'project_areas' THEN
    IF TG_OP = 'INSERT' THEN
      v_msg := 'added area to project';
    ELSIF TG_OP = 'UPDATE' THEN
      v_msg := 'updated area';
    END IF;
  ELSIF v_entity = 'project_phases' THEN
    IF TG_OP = 'INSERT' THEN
      v_msg := 'added phase "' || NEW.name || '"';
    ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
      v_msg := 'changed phase "' || NEW.name || '" to ' || NEW.status;
    ELSE
      v_msg := 'updated phase "' || COALESCE(NEW.name, OLD.name) || '"';
    END IF;
  ELSIF v_entity = 'project_members' THEN
    IF TG_OP = 'INSERT' THEN
      v_msg := 'added a team member';
    ELSIF TG_OP = 'DELETE' THEN
      v_msg := 'removed a team member';
    ELSE
      v_msg := 'updated team member';
    END IF;
  ELSIF v_entity = 'projects' THEN
    IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
      v_msg := 'changed project status to ' || NEW.status;
    ELSE
      v_msg := 'updated project details';
    END IF;
  ELSE
    v_msg := TG_OP || ' on ' || v_entity;
  END IF;

  INSERT INTO project_activity (project_id, area_id, actor_id, action_type, entity_type, entity_id, old_values, new_values, message)
  VALUES (v_project_id, v_area_id, auth.uid(), v_action, v_entity, COALESCE(NEW.id, OLD.id), v_old, v_new, v_msg);

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Attach triggers
CREATE TRIGGER trg_activity_projects
  AFTER UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION fn_project_activity_log();

CREATE TRIGGER trg_activity_tasks
  AFTER INSERT OR UPDATE ON project_tasks FOR EACH ROW EXECUTE FUNCTION fn_project_activity_log();

CREATE TRIGGER trg_activity_phases
  AFTER INSERT OR UPDATE ON project_phases FOR EACH ROW EXECUTE FUNCTION fn_project_activity_log();

CREATE TRIGGER trg_activity_members
  AFTER INSERT OR UPDATE OR DELETE ON project_members FOR EACH ROW EXECUTE FUNCTION fn_project_activity_log();

CREATE TRIGGER trg_activity_areas
  AFTER INSERT OR UPDATE ON project_areas FOR EACH ROW EXECUTE FUNCTION fn_project_activity_log();

CREATE TRIGGER trg_activity_documents
  AFTER INSERT OR UPDATE ON project_documents FOR EACH ROW EXECUTE FUNCTION fn_project_activity_log();

-- ════════════════════════════════════════════════════════════════════════════════
-- 5. TASK SCHEDULE COLUMNS (add to existing project_tasks)
-- ════════════════════════════════════════════════════════════════════════════════
ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS area_id UUID REFERENCES project_areas(id);
ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS wbs_code VARCHAR(50);
ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS baseline_start DATE;
ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS baseline_end DATE;
ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS actual_start DATE;
ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS actual_end DATE;
ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS planned_duration INT;
ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS actual_duration INT;
ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS remaining_duration INT;
ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS percent_complete NUMERIC(5,2) DEFAULT 0;
ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS total_float INT;
ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS free_float INT;
ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS is_critical BOOLEAN DEFAULT false;
ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS is_milestone BOOLEAN DEFAULT false;
ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS planned_cost NUMERIC(14,2);
ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS actual_cost NUMERIC(14,2);

CREATE INDEX IF NOT EXISTS idx_tasks_area ON project_tasks(area_id);
CREATE INDEX IF NOT EXISTS idx_tasks_wbs ON project_tasks(wbs_code);

-- ════════════════════════════════════════════════════════════════════════════════
-- 6. BASELINE SNAPSHOTS
-- ════════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS project_baselines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  baseline_number INT NOT NULL,
  name VARCHAR(100),
  description TEXT,
  snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
  is_current BOOLEAN DEFAULT false,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(project_id, baseline_number)
);

ALTER TABLE project_baselines ENABLE ROW LEVEL SECURITY;

CREATE POLICY pb_select ON project_baselines FOR SELECT
  USING (EXISTS (SELECT 1 FROM projects pr JOIN user_roles ur ON (ur.site_id = pr.site_id OR ur.site_id IS NULL) WHERE pr.id = project_id AND ur.user_id = auth.uid()));
CREATE POLICY pb_insert ON project_baselines FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM projects pr JOIN user_roles ur ON (ur.site_id = pr.site_id OR ur.site_id IS NULL) JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id WHERE pr.id = project_id AND ur.user_id = auth.uid() AND p.code = 'projects.approve'));

CREATE TABLE IF NOT EXISTS baseline_task_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  baseline_id UUID NOT NULL REFERENCES project_baselines(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES project_tasks(id) ON DELETE CASCADE,
  planned_start DATE,
  planned_end DATE,
  planned_duration INT,
  planned_cost NUMERIC(14,2),
  planned_progress NUMERIC(5,2) DEFAULT 0,
  UNIQUE(baseline_id, task_id)
);

ALTER TABLE baseline_task_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY bts_select ON baseline_task_snapshots FOR SELECT
  USING (EXISTS (SELECT 1 FROM project_baselines pb JOIN projects pr ON pr.id = pb.project_id JOIN user_roles ur ON (ur.site_id = pr.site_id OR ur.site_id IS NULL) WHERE pb.id = baseline_id AND ur.user_id = auth.uid()));
CREATE POLICY bts_insert ON baseline_task_snapshots FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM project_baselines pb JOIN projects pr ON pr.id = pb.project_id JOIN user_roles ur ON (ur.site_id = pr.site_id OR ur.site_id IS NULL) JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id WHERE pb.id = baseline_id AND ur.user_id = auth.uid() AND p.code = 'projects.approve'));

-- ════════════════════════════════════════════════════════════════════════════════
-- 7. CPM RPC — Critical Path Method calculation
-- Returns tasks with ES, EF, LS, LF, total_float, free_float, is_critical
-- Plus critical_path array of task IDs in order
-- ════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION rpc_calculate_cpm(p_project_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tasks JSONB;
  v_deps JSONB;
  v_result JSONB;
BEGIN
  -- Gather tasks with durations
  SELECT jsonb_agg(jsonb_build_object(
    'id', t.id,
    'title', t.title,
    'duration', COALESCE(t.planned_duration,
      CASE WHEN t.start_date IS NOT NULL AND t.due_date IS NOT NULL
           THEN (t.due_date - t.start_date)
           ELSE 1 END),
    'start_date', t.start_date,
    'due_date', t.due_date,
    'es', 0, 'ef', 0, 'ls', 999999, 'lf', 999999,
    'total_float', 0, 'free_float', 0, 'is_critical', false
  ))
  INTO v_tasks
  FROM project_tasks t
  WHERE t.project_id = p_project_id
    AND t.is_archived = false
    AND t.is_milestone = false;

  -- Gather dependencies (FS only for now)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'task_id', d.task_id,
    'depends_on_id', d.depends_on_id,
    'type', d.dependency_type
  )), '[]'::jsonb)
  INTO v_deps
  FROM project_task_dependencies d
  JOIN project_tasks t ON t.id = d.task_id
  WHERE t.project_id = p_project_id AND t.is_archived = false;

  -- The actual CPM forward/backward pass runs in plpgsql
  -- For the initial version, we do a simplified topological pass
  -- and store results back to project_tasks
  WITH RECURSIVE
  -- Build predecessor map
  task_list AS (
    SELECT t.id,
           COALESCE(t.planned_duration,
             CASE WHEN t.start_date IS NOT NULL AND t.due_date IS NOT NULL
                  THEN (t.due_date - t.start_date) ELSE 1 END) AS duration,
           t.title
    FROM project_tasks t
    WHERE t.project_id = p_project_id AND t.is_archived = false
  ),
  predecessors AS (
    SELECT d.task_id, array_agg(d.depends_on_id) AS pred_ids
    FROM project_task_dependencies d
    JOIN task_list tl ON tl.id = d.task_id
    WHERE d.dependency_type IN ('blocks','is_blocked_by')
    GROUP BY d.task_id
  ),
  -- Forward pass: ES = max(EF of predecessors), EF = ES + duration
  forward_pass AS (
    -- Start tasks (no predecessors)
    SELECT tl.id, tl.duration, tl.title,
           0 AS es, tl.duration AS ef, 1 AS pass_order
    FROM task_list tl
    WHERE NOT EXISTS (SELECT 1 FROM predecessors p WHERE p.task_id = tl.id)
    UNION ALL
    SELECT tl.id, tl.duration, tl.title,
           fp_max.max_ef AS es,
           fp_max.max_ef + tl.duration AS ef,
           fp_max.pass_order + 1
    FROM task_list tl
    JOIN predecessors p ON p.task_id = tl.id
    JOIN LATERAL (
      SELECT MAX(fp.ef) AS max_ef, MAX(fp.pass_order) AS pass_order
      FROM forward_pass fp
      WHERE fp.id = ANY(p.pred_ids)
    ) fp_max ON true
    WHERE NOT EXISTS (SELECT 1 FROM forward_pass fp2 WHERE fp2.id = tl.id)
  ),
  -- Get project end (max EF)
  project_end AS (
    SELECT MAX(ef) AS max_ef FROM forward_pass
  ),
  -- Find successors
  successors AS (
    SELECT d.depends_on_id AS task_id, array_agg(d.task_id) AS succ_ids
    FROM project_task_dependencies d
    JOIN task_list tl ON tl.id = d.depends_on_id
    WHERE d.dependency_type IN ('blocks','is_blocked_by')
    GROUP BY d.depends_on_id
  ),
  -- Calculate float
  float_calc AS (
    SELECT fp.id, fp.es, fp.ef, fp.duration, fp.title,
           COALESCE(
             (SELECT MIN(fp2.es) FROM forward_pass fp2
              JOIN project_task_dependencies d ON d.task_id = fp2.id AND d.depends_on_id = fp.id
             ),
             (SELECT max_ef FROM project_end)
           ) - fp.ef AS total_float
    FROM forward_pass fp
  )
  SELECT jsonb_build_object(
    'tasks', COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', fc.id,
        'title', fc.title,
        'duration', fc.duration,
        'es', fc.es,
        'ef', fc.ef,
        'ls', fc.es + fc.total_float,
        'lf', fc.ef + fc.total_float,
        'total_float', fc.total_float,
        'free_float', fc.total_float,
        'is_critical', fc.total_float = 0
      ) ORDER BY fc.es, fc.ef
    ), '[]'::jsonb),
    'critical_path', COALESCE(
      (SELECT jsonb_agg(fc2.id ORDER BY fc2.es) FROM float_calc fc2 WHERE fc2.total_float = 0),
      '[]'::jsonb
    ),
    'project_duration', (SELECT max_ef FROM project_end)
  )
  INTO v_result
  FROM float_calc fc;

  -- Update tasks with CPM results
  UPDATE project_tasks t
  SET total_float = (elem->>'total_float')::int,
      free_float = (elem->>'free_float')::int,
      is_critical = (elem->>'is_critical')::boolean
  FROM jsonb_array_elements(v_result->'tasks') AS elem
  WHERE t.id = (elem->>'id')::uuid;

  RETURN COALESCE(v_result, '{"tasks":[],"critical_path":[],"project_duration":0}'::jsonb);
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════════
-- 8. SAVE BASELINE RPC
-- ════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION rpc_save_baseline(p_project_id UUID, p_name TEXT DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_baseline_id UUID;
  v_next_num INT;
BEGIN
  -- Clear previous current baseline
  UPDATE project_baselines SET is_current = false WHERE project_id = p_project_id AND is_current = true;

  -- Get next baseline number
  SELECT COALESCE(MAX(baseline_number), 0) + 1 INTO v_next_num
  FROM project_baselines WHERE project_id = p_project_id;

  -- Create baseline record
  INSERT INTO project_baselines (project_id, baseline_number, name, is_current, created_by)
  VALUES (p_project_id, v_next_num, COALESCE(p_name, 'Baseline ' || v_next_num), true, auth.uid())
  RETURNING id INTO v_baseline_id;

  -- Snapshot all tasks
  INSERT INTO baseline_task_snapshots (baseline_id, task_id, planned_start, planned_end, planned_duration, planned_cost, planned_progress)
  SELECT v_baseline_id, t.id, t.start_date, t.due_date, t.planned_duration, t.planned_cost, t.percent_complete
  FROM project_tasks t
  WHERE t.project_id = p_project_id AND t.is_archived = false;

  -- Copy dates to baseline columns on tasks
  UPDATE project_tasks
  SET baseline_start = start_date, baseline_end = due_date
  WHERE project_id = p_project_id AND is_archived = false;

  RETURN v_baseline_id;
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════════
-- Record migration
-- ════════════════════════════════════════════════════════════════════════════════
INSERT INTO schema_migrations (filename) VALUES ('0090_projects_phase1_epm.sql') ON CONFLICT DO NOTHING;
