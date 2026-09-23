-- 0170: DocShare foundation — folders, documents, access control
-- Apply in Supabase SQL editor

BEGIN;

-- ── Folders ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ds_folders (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id     uuid NOT NULL REFERENCES sites(id),
  name        text NOT NULL,
  parent_id   uuid REFERENCES ds_folders(id),
  created_by  uuid REFERENCES profiles(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  is_archived boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_ds_folders_site ON ds_folders(site_id);
CREATE INDEX IF NOT EXISTS idx_ds_folders_parent ON ds_folders(parent_id);

-- ── Documents ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ds_documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id     uuid NOT NULL REFERENCES sites(id),
  title       text NOT NULL,
  description text,
  category    text,
  doc_mode    text NOT NULL DEFAULT 'general' CHECK (doc_mode IN ('controlled','general')),
  folder_id   uuid REFERENCES ds_folders(id),
  created_by  uuid REFERENCES profiles(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  is_archived boolean NOT NULL DEFAULT false,
  file_path   text,
  file_name   text,
  file_size   bigint,
  file_type   text,
  tags        text[] DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_ds_documents_site ON ds_documents(site_id);
CREATE INDEX IF NOT EXISTS idx_ds_documents_folder ON ds_documents(folder_id);
CREATE INDEX IF NOT EXISTS idx_ds_documents_category ON ds_documents(category);

-- ── Document access control ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ds_document_access (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   uuid NOT NULL REFERENCES ds_documents(id),
  user_id       uuid REFERENCES profiles(id),
  role_id       uuid REFERENCES roles(id),
  access_level  text NOT NULL DEFAULT 'view' CHECK (access_level IN ('view','edit')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_access_target CHECK (user_id IS NOT NULL OR role_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_ds_access_doc ON ds_document_access(document_id);
CREATE INDEX IF NOT EXISTS idx_ds_access_user ON ds_document_access(user_id);

-- ── Permissions ──────────────────────────────────────────────────────────────
INSERT INTO permissions (code, module, action, description) VALUES
  ('ds.view',    'DocShare', 'View',   'View documents'),
  ('ds.create',  'DocShare', 'Create', 'Upload documents'),
  ('ds.edit',    'DocShare', 'Edit',   'Edit document metadata'),
  ('ds.delete',  'DocShare', 'Delete', 'Archive documents'),
  ('ds.approve', 'DocShare', 'Approve','Approve controlled documents')
ON CONFLICT (code) DO NOTHING;

-- Grant to all existing roles
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE p.code IN ('ds.view','ds.create','ds.edit','ds.delete','ds.approve')
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE ds_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE ds_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE ds_document_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY ds_folders_select ON ds_folders FOR SELECT USING (
  _has_permission('ds.view', site_id)
);
CREATE POLICY ds_folders_insert ON ds_folders FOR INSERT WITH CHECK (
  _has_permission('ds.create', site_id)
);
CREATE POLICY ds_folders_update ON ds_folders FOR UPDATE USING (
  _has_permission('ds.edit', site_id)
);

CREATE POLICY ds_documents_select ON ds_documents FOR SELECT USING (
  _has_permission('ds.view', site_id)
);
CREATE POLICY ds_documents_insert ON ds_documents FOR INSERT WITH CHECK (
  _has_permission('ds.create', site_id)
);
CREATE POLICY ds_documents_update ON ds_documents FOR UPDATE USING (
  _has_permission('ds.edit', site_id)
);

CREATE POLICY ds_access_select ON ds_document_access FOR SELECT USING (
  EXISTS (SELECT 1 FROM ds_documents d WHERE d.id = document_id AND _has_permission('ds.view', d.site_id))
);
CREATE POLICY ds_access_insert ON ds_document_access FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM ds_documents d WHERE d.id = document_id AND _has_permission('ds.edit', d.site_id))
);

-- ── Signed URL RPC ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION ds_signed_url(p_document_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER STABLE AS $$
DECLARE
  v_path text;
  v_site uuid;
BEGIN
  SELECT file_path, site_id INTO v_path, v_site
  FROM ds_documents WHERE id = p_document_id AND NOT is_archived;
  IF v_path IS NULL THEN RETURN NULL; END IF;
  IF NOT _has_permission('ds.view', v_site) THEN RETURN NULL; END IF;
  RETURN (
    SELECT signedurl FROM storage.get_signed_url('docshare-files', v_path, 300)
  );
END;
$$;

INSERT INTO schema_migrations (filename) VALUES ('0170_docshare_foundation.sql') ON CONFLICT DO NOTHING;

COMMIT;
