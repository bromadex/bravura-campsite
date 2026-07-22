-- 0151: Document approval workflow — review cycles, comments, routing
-- Phase 2 of Projects/EPM module

-- Review cycles track each formal review round for a document
CREATE TABLE IF NOT EXISTS document_review_cycles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES project_documents(id) ON DELETE CASCADE,
  cycle_number INT NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_review','approved','rejected','cancelled')),
  initiated_by UUID REFERENCES auth.users(id),
  initiated_at TIMESTAMPTZ DEFAULT now(),
  closed_at TIMESTAMPTZ,
  due_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(document_id, cycle_number)
);

-- Individual reviewer assignments within a cycle
CREATE TABLE IF NOT EXISTS document_reviewers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id UUID NOT NULL REFERENCES document_review_cycles(id) ON DELETE CASCADE,
  reviewer_id UUID NOT NULL REFERENCES auth.users(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','reviewed','approved','rejected','skipped')),
  reviewed_at TIMESTAMPTZ,
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(cycle_id, reviewer_id)
);

-- Review comments on documents (not tied to a specific cycle)
CREATE TABLE IF NOT EXISTS document_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES project_documents(id) ON DELETE CASCADE,
  cycle_id UUID REFERENCES document_review_cycles(id) ON DELETE SET NULL,
  author_id UUID NOT NULL REFERENCES auth.users(id),
  comment TEXT NOT NULL,
  comment_type TEXT NOT NULL DEFAULT 'comment' CHECK (comment_type IN ('comment','approval','rejection','revision_request','status_change')),
  is_resolved BOOLEAN DEFAULT false,
  resolved_by UUID REFERENCES auth.users(id),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE document_review_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_reviewers ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_comments ENABLE ROW LEVEL SECURITY;

-- Policies: project members can view, editors can manage
CREATE POLICY "review_cycles_select" ON document_review_cycles FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM project_documents pd
  JOIN projects p ON p.id = pd.project_id
  JOIN user_roles ur ON ur.user_id = auth.uid()
  JOIN role_permissions rp ON rp.role_id = ur.role_id
  JOIN permissions perm ON perm.id = rp.permission_id AND perm.code = 'projects.view'
  WHERE pd.id = document_review_cycles.document_id
  AND (ur.site_id = p.site_id OR ur.site_id IS NULL)
));

CREATE POLICY "review_cycles_insert" ON document_review_cycles FOR INSERT TO authenticated
WITH CHECK (EXISTS (
  SELECT 1 FROM project_documents pd
  JOIN projects p ON p.id = pd.project_id
  JOIN user_roles ur ON ur.user_id = auth.uid()
  JOIN role_permissions rp ON rp.role_id = ur.role_id
  JOIN permissions perm ON perm.id = rp.permission_id AND perm.code = 'projects.edit'
  WHERE pd.id = document_review_cycles.document_id
  AND (ur.site_id = p.site_id OR ur.site_id IS NULL)
));

CREATE POLICY "review_cycles_update" ON document_review_cycles FOR UPDATE TO authenticated
USING (EXISTS (
  SELECT 1 FROM project_documents pd
  JOIN projects p ON p.id = pd.project_id
  JOIN user_roles ur ON ur.user_id = auth.uid()
  JOIN role_permissions rp ON rp.role_id = ur.role_id
  JOIN permissions perm ON perm.id = rp.permission_id AND perm.code = 'projects.edit'
  WHERE pd.id = document_review_cycles.document_id
  AND (ur.site_id = p.site_id OR ur.site_id IS NULL)
));

CREATE POLICY "reviewers_select" ON document_reviewers FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM document_review_cycles drc
  JOIN project_documents pd ON pd.id = drc.document_id
  JOIN projects p ON p.id = pd.project_id
  JOIN user_roles ur ON ur.user_id = auth.uid()
  JOIN role_permissions rp ON rp.role_id = ur.role_id
  JOIN permissions perm ON perm.id = rp.permission_id AND perm.code = 'projects.view'
  WHERE drc.id = document_reviewers.cycle_id
  AND (ur.site_id = p.site_id OR ur.site_id IS NULL)
));

CREATE POLICY "reviewers_insert" ON document_reviewers FOR INSERT TO authenticated
WITH CHECK (EXISTS (
  SELECT 1 FROM document_review_cycles drc
  JOIN project_documents pd ON pd.id = drc.document_id
  JOIN projects p ON p.id = pd.project_id
  JOIN user_roles ur ON ur.user_id = auth.uid()
  JOIN role_permissions rp ON rp.role_id = ur.role_id
  JOIN permissions perm ON perm.id = rp.permission_id AND perm.code = 'projects.edit'
  WHERE drc.id = document_reviewers.cycle_id
  AND (ur.site_id = p.site_id OR ur.site_id IS NULL)
));

CREATE POLICY "reviewers_update" ON document_reviewers FOR UPDATE TO authenticated
USING (
  document_reviewers.reviewer_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM document_review_cycles drc
    JOIN project_documents pd ON pd.id = drc.document_id
    JOIN projects p ON p.id = pd.project_id
    JOIN user_roles ur ON ur.user_id = auth.uid()
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions perm ON perm.id = rp.permission_id AND perm.code = 'projects.edit'
    WHERE drc.id = document_reviewers.cycle_id
    AND (ur.site_id = p.site_id OR ur.site_id IS NULL)
  )
);

CREATE POLICY "comments_select" ON document_comments FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM project_documents pd
  JOIN projects p ON p.id = pd.project_id
  JOIN user_roles ur ON ur.user_id = auth.uid()
  JOIN role_permissions rp ON rp.role_id = ur.role_id
  JOIN permissions perm ON perm.id = rp.permission_id AND perm.code = 'projects.view'
  WHERE pd.id = document_comments.document_id
  AND (ur.site_id = p.site_id OR ur.site_id IS NULL)
));

CREATE POLICY "comments_insert" ON document_comments FOR INSERT TO authenticated
WITH CHECK (EXISTS (
  SELECT 1 FROM project_documents pd
  JOIN projects p ON p.id = pd.project_id
  JOIN user_roles ur ON ur.user_id = auth.uid()
  JOIN role_permissions rp ON rp.role_id = ur.role_id
  JOIN permissions perm ON perm.id = rp.permission_id AND perm.code = 'projects.view'
  WHERE pd.id = document_comments.document_id
  AND (ur.site_id = p.site_id OR ur.site_id IS NULL)
));

CREATE POLICY "comments_update" ON document_comments FOR UPDATE TO authenticated
USING (
  document_comments.author_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM project_documents pd
    JOIN projects p ON p.id = pd.project_id
    JOIN user_roles ur ON ur.user_id = auth.uid()
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions perm ON perm.id = rp.permission_id AND perm.code = 'projects.edit'
    WHERE pd.id = document_comments.document_id
    AND (ur.site_id = p.site_id OR ur.site_id IS NULL)
  )
);

INSERT INTO schema_migrations (filename) VALUES ('0151_document_approval_workflow.sql') ON CONFLICT DO NOTHING;
