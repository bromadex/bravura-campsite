-- 0179_approval_engine.sql
-- Roadmap #48 Phase C: configurable multi-step approvals, enforced in the database.
-- A site defines routes per document type (optionally per department and value band),
-- each with ordered steps. When a matching route exists, the document can only be
-- approved through approval_decide(); modules' own Approve buttons are blocked.
-- Documents with no matching route keep their existing single-approver flow.
BEGIN;

-- ═══════════════════════════════════════════════════════════════════════
-- 1. Permissions
-- ═══════════════════════════════════════════════════════════════════════
INSERT INTO permissions (code, module, action, description) VALUES
  ('approvals.view', 'approvals', 'View', 'See all approval requests and routes for a site'),
  ('approvals.edit', 'approvals', 'Edit', 'Configure approval routes')
ON CONFLICT (code) DO NOTHING;

-- Give route configuration to roles that already manage users.
INSERT INTO role_permissions (role_id, permission_id)
SELECT DISTINCT rp.role_id, np.id
  FROM role_permissions rp
  JOIN permissions p  ON p.id = rp.permission_id AND p.code = 'users.edit'
  JOIN permissions np ON np.code IN ('approvals.view','approvals.edit')
 WHERE NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = rp.role_id AND x.permission_id = np.id);

-- ═══════════════════════════════════════════════════════════════════════
-- 2. Tables
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS approval_routes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id       UUID NOT NULL REFERENCES sites(id),
  entity_type   TEXT NOT NULL CHECK (entity_type IN
                  ('purchase_requisitions','purchase_orders','purchase_invoices','fuel_requests','leave_requests')),
  name          TEXT NOT NULL,
  department_id UUID REFERENCES departments(id),   -- NULL = any department
  min_amount    NUMERIC(15,2) NOT NULL DEFAULT 0,
  max_amount    NUMERIC(15,2),                    -- NULL = no upper limit
  priority      INT NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  is_archived   BOOLEAN NOT NULL DEFAULT false,
  created_by    UUID REFERENCES auth.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_approval_routes_lookup ON approval_routes (site_id, entity_type) WHERE is_active AND NOT is_archived;

CREATE TABLE IF NOT EXISTS approval_route_steps (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id            UUID NOT NULL REFERENCES approval_routes(id),
  step_order          INT NOT NULL,
  label               TEXT NOT NULL,
  approver_type       TEXT NOT NULL CHECK (approver_type IN ('permission','user','line_manager')),
  approver_permission TEXT,
  approver_user_id    UUID REFERENCES auth.users(id),
  is_archived         BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (approver_type <> 'permission' OR approver_permission IS NOT NULL),
  CHECK (approver_type <> 'user' OR approver_user_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_approval_step_order ON approval_route_steps (route_id, step_order) WHERE NOT is_archived;

CREATE TABLE IF NOT EXISTS approval_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id       UUID NOT NULL REFERENCES sites(id),
  entity_type   TEXT NOT NULL,
  entity_id     UUID NOT NULL,
  route_id      UUID NOT NULL REFERENCES approval_routes(id),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  current_step  INT,
  amount        NUMERIC(15,2) NOT NULL DEFAULT 0,
  department_id UUID,
  title         TEXT,
  link          TEXT,
  requested_by  UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at    TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_approval_pending ON approval_requests (entity_type, entity_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS ix_approval_requests_site ON approval_requests (site_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS approval_actions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  UUID NOT NULL REFERENCES approval_requests(id),
  step_order  INT,
  step_label  TEXT,
  actor_id    UUID,
  action      TEXT NOT NULL CHECK (action IN ('submitted','approved','rejected','skipped','cancelled','resubmitted')),
  comment     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_approval_actions_request ON approval_actions (request_id, created_at);

-- Pending-approval state for purchase orders (draft → pending_approval → sent)
ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_status_check;
ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_status_check
  CHECK (status IN ('draft','pending_approval','sent','partially_received','received','cancelled'));

-- ═══════════════════════════════════════════════════════════════════════
-- 3. Helpers
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION _user_has_permission(p_user UUID, p_code TEXT, p_site_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles ur
      JOIN role_permissions rp ON rp.role_id = ur.role_id
      JOIN permissions p ON p.id = rp.permission_id
     WHERE ur.user_id = p_user AND p.code = p_code
       AND COALESCE(ur.is_active, true)
       AND (ur.site_id IS NULL OR ur.site_id = p_site_id))
$$;

-- The employee a document is "about" (leave: the employee; otherwise the requester's employee record)
CREATE OR REPLACE FUNCTION _approval_subject_employee(p_entity TEXT, p_id UUID, p_requested_by UUID)
RETURNS UUID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _emp UUID;
BEGIN
  IF p_entity = 'leave_requests' THEN
    SELECT employee_id INTO _emp FROM leave_requests WHERE id = p_id;
  ELSE
    SELECT employee_id INTO _emp FROM profiles WHERE id = p_requested_by;
  END IF;
  RETURN _emp;
END;
$$;

-- Normalised view of any supported document
CREATE OR REPLACE FUNCTION _approval_entity(p_entity TEXT, p_id UUID)
RETURNS TABLE (site_id UUID, amount NUMERIC, department_id UUID, requested_by UUID, title TEXT, link TEXT, status TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_entity = 'purchase_requisitions' THEN
    RETURN QUERY SELECT r.site_id,
      COALESCE((SELECT SUM(COALESCE(l.quantity,0) * COALESCE(l.estimated_cost,0)) FROM requisition_lines l WHERE l.requisition_id = r.id), 0),
      NULL::UUID, r.requested_by, 'Requisition ' || COALESCE(r.requisition_no, ''), '/inventory/inv_requisitions', r.status
      FROM purchase_requisitions r WHERE r.id = p_id;
  ELSIF p_entity = 'purchase_orders' THEN
    RETURN QUERY SELECT o.site_id, COALESCE(o.total_amount, 0), NULL::UUID, o.created_by,
      'Purchase order ' || COALESCE(o.po_number, ''), '/inventory/inv_purchase_orders', o.status
      FROM purchase_orders o WHERE o.id = p_id;
  ELSIF p_entity = 'purchase_invoices' THEN
    RETURN QUERY SELECT i.site_id, COALESCE(i.total_amount, 0), NULL::UUID, i.created_by,
      'Supplier invoice ' || COALESCE(i.invoice_number, ''), '/procurement/proc_invoices', i.status
      FROM purchase_invoices i WHERE i.id = p_id;
  ELSIF p_entity = 'fuel_requests' THEN
    RETURN QUERY SELECT f.site_id, COALESCE(f.quantity_requested, 0), NULL::UUID, COALESCE(f.requested_by, f.created_by),
      'Fuel request ' || COALESCE(f.request_number, '') || ' (' || COALESCE(f.quantity_requested, 0) || ' L)', '/fuel/fuel_requests_list', f.status
      FROM fuel_requests f WHERE f.id = p_id;
  ELSIF p_entity = 'leave_requests' THEN
    RETURN QUERY SELECT l.site_id, COALESCE(l.days_requested, 0), e.department_id, l.created_by,
      'Leave — ' || COALESCE(e.name, 'employee') || ' (' || COALESCE(l.days_requested, 0) || ' days)', '/workforce/wf_leave_requests', l.status
      FROM leave_requests l LEFT JOIN employees e ON e.id = l.employee_id WHERE l.id = p_id;
  END IF;
END;
$$;

-- Status that means "waiting for a decision", per document type
CREATE OR REPLACE FUNCTION _approval_submitted_status(p_entity TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_entity
    WHEN 'purchase_requisitions' THEN 'submitted'
    WHEN 'purchase_orders'       THEN 'pending_approval'
    WHEN 'purchase_invoices'     THEN 'pending_approval'
    WHEN 'fuel_requests'         THEN 'pending'
    WHEN 'leave_requests'        THEN 'pending' END
$$;

CREATE OR REPLACE FUNCTION approval_match_route(p_site_id UUID, p_entity TEXT, p_amount NUMERIC, p_department_id UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.id FROM approval_routes r
   WHERE r.site_id = p_site_id AND r.entity_type = p_entity AND r.is_active AND NOT r.is_archived
     AND (r.department_id IS NULL OR r.department_id = p_department_id)
     AND COALESCE(p_amount, 0) >= r.min_amount
     AND (r.max_amount IS NULL OR COALESCE(p_amount, 0) <= r.max_amount)
     AND EXISTS (SELECT 1 FROM approval_route_steps s WHERE s.route_id = r.id AND NOT s.is_archived)
   ORDER BY (r.department_id IS NOT NULL) DESC, r.priority DESC, r.min_amount DESC
   LIMIT 1
$$;

-- Users who may act on the request's current step (never the requester)
CREATE OR REPLACE FUNCTION _approval_step_approvers(p_request_id UUID)
RETURNS TABLE (user_id UUID) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _req  approval_requests%ROWTYPE;
  _step approval_route_steps%ROWTYPE;
  _emp  UUID;
BEGIN
  SELECT * INTO _req FROM approval_requests WHERE id = p_request_id;
  IF NOT FOUND OR _req.status <> 'pending' THEN RETURN; END IF;
  SELECT * INTO _step FROM approval_route_steps
   WHERE route_id = _req.route_id AND step_order = _req.current_step AND NOT is_archived;
  IF NOT FOUND THEN RETURN; END IF;

  IF _step.approver_type = 'user' THEN
    RETURN QUERY SELECT _step.approver_user_id WHERE _step.approver_user_id IS DISTINCT FROM _req.requested_by;
  ELSIF _step.approver_type = 'permission' THEN
    RETURN QUERY SELECT DISTINCT ur.user_id FROM user_roles ur
      JOIN role_permissions rp ON rp.role_id = ur.role_id
      JOIN permissions p ON p.id = rp.permission_id
     WHERE p.code = _step.approver_permission AND COALESCE(ur.is_active, true)
       AND (ur.site_id IS NULL OR ur.site_id = _req.site_id)
       AND ur.user_id IS DISTINCT FROM _req.requested_by;
  ELSIF _step.approver_type = 'line_manager' THEN
    _emp := _approval_subject_employee(_req.entity_type, _req.entity_id, _req.requested_by);
    RETURN QUERY SELECT pr.id FROM employees e JOIN profiles pr ON pr.employee_id = e.manager_id
     WHERE e.id = _emp AND pr.id IS DISTINCT FROM _req.requested_by;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION approval_can_act(p_request_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM _approval_step_approvers(p_request_id) a WHERE a.user_id = auth.uid())
$$;

CREATE OR REPLACE FUNCTION _approval_notify(p_user_ids UUID[], p_req approval_requests, p_title TEXT, p_message TEXT)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO notifications (site_id, user_id, type, title, message, link, category, metadata)
  SELECT p_req.site_id, u, 'approval', p_title, p_message, '/notifications/approvals_inbox', 'approval',
         jsonb_build_object('approval_request_id', p_req.id, 'entity_type', p_req.entity_type, 'entity_id', p_req.entity_id)
    FROM unnest(p_user_ids) u WHERE u IS NOT NULL
$$;

-- Move to the first actionable step from p_from; skip steps nobody can act on
-- (e.g. no line manager recorded). Returns false when no steps remain.
CREATE OR REPLACE FUNCTION _approval_move_to(p_request_id UUID, p_from INT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _req  approval_requests%ROWTYPE;
  _step approval_route_steps%ROWTYPE;
  _ids  UUID[];
BEGIN
  SELECT * INTO _req FROM approval_requests WHERE id = p_request_id;
  FOR _step IN SELECT * FROM approval_route_steps
                WHERE route_id = _req.route_id AND NOT is_archived AND step_order >= p_from
                ORDER BY step_order LOOP
    UPDATE approval_requests SET current_step = _step.step_order, updated_at = now() WHERE id = p_request_id;
    SELECT array_agg(user_id) INTO _ids FROM _approval_step_approvers(p_request_id);
    IF _ids IS NOT NULL AND array_length(_ids, 1) > 0 THEN
      SELECT * INTO _req FROM approval_requests WHERE id = p_request_id;
      PERFORM _approval_notify(_ids, _req, 'Approval needed: ' || COALESCE(_req.title, ''),
        _step.label || ' — ' || COALESCE(_req.title, '') || CASE WHEN _req.amount > 0 THEN ' (' || _req.amount || ')' ELSE '' END);
      RETURN true;
    END IF;
    INSERT INTO approval_actions (request_id, step_order, step_label, action, comment)
    VALUES (p_request_id, _step.step_order, _step.label, 'skipped', 'No eligible approver for this step');
  END LOOP;
  RETURN false;
END;
$$;

-- No step has an eligible approver: park on the last step and tell route managers.
CREATE OR REPLACE FUNCTION _approval_stuck(p_request_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _req approval_requests%ROWTYPE;
  _ids UUID[];
BEGIN
  UPDATE approval_requests
     SET current_step = (SELECT MAX(step_order) FROM approval_route_steps s
                          WHERE s.route_id = approval_requests.route_id AND NOT s.is_archived),
         updated_at = now()
   WHERE id = p_request_id RETURNING * INTO _req;
  SELECT array_agg(DISTINCT ur.user_id) INTO _ids FROM user_roles ur
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE p.code = 'approvals.edit' AND COALESCE(ur.is_active, true) AND (ur.site_id IS NULL OR ur.site_id = _req.site_id);
  PERFORM _approval_notify(_ids, _req, 'Approval stuck: ' || COALESCE(_req.title, ''),
    'No one on the approval route can approve this. Add an approver to the route.');
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 4. Apply decisions to the source document (engine flag bypasses the gate)
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION _leave_apply_approval(p_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r RECORD;
BEGIN
  SELECT * INTO r FROM leave_requests WHERE id = p_id;
  UPDATE leave_requests SET status = 'approved', approved_by = auth.uid(), approved_at = now() WHERE id = p_id;
  INSERT INTO leave_allocations (employee_id, site_id, leave_type_id, year, allocated_days, used_days, created_by)
  VALUES (r.employee_id, r.site_id, r.leave_type_id, EXTRACT(YEAR FROM r.start_date)::INT, 0, r.days_requested, auth.uid())
  ON CONFLICT (employee_id, leave_type_id, year) DO UPDATE SET used_days = leave_allocations.used_days + EXCLUDED.used_days;
  IF r.start_date <= CURRENT_DATE THEN
    PERFORM set_config('app.status_change_reason', 'Approved leave request', true);
    UPDATE employees SET status = 'on_leave' WHERE id = r.employee_id AND status = 'active';
  END IF;
  IF r.created_by IS NOT NULL THEN
    INSERT INTO notifications (site_id, user_id, type, title, message, link, category)
    VALUES (r.site_id, r.created_by, 'hr_leave_approved', 'Leave request approved',
            'The leave request you filed has been approved.', '/workforce/wf_leave_requests', 'approval');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION _leave_apply_rejection(p_id UUID, p_reason TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r RECORD;
BEGIN
  SELECT * INTO r FROM leave_requests WHERE id = p_id;
  UPDATE leave_requests SET status = 'rejected', rejected_reason = p_reason, approved_by = auth.uid(), approved_at = now() WHERE id = p_id;
  IF r.created_by IS NOT NULL THEN
    INSERT INTO notifications (site_id, user_id, type, title, message, link, category)
    VALUES (r.site_id, r.created_by, 'hr_leave_rejected', 'Leave request rejected', p_reason, '/workforce/wf_leave_requests', 'approval');
  END IF;
END;
$$;

-- Existing leave RPCs: same behaviour, notifications fixed (they wrote to non-existent columns).
CREATE OR REPLACE FUNCTION approve_leave_request(p_request_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r RECORD;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO r FROM leave_requests WHERE id = p_request_id;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF NOT _has_hr_permission('hr.approve', r.site_id) THEN RAISE EXCEPTION 'Permission denied'; END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'Request is already %', r.status; END IF;
  PERFORM _leave_apply_approval(p_request_id);
END;
$$;

CREATE OR REPLACE FUNCTION reject_leave_request(p_request_id UUID, p_reason TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r RECORD;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO r FROM leave_requests WHERE id = p_request_id;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF NOT _has_hr_permission('hr.approve', r.site_id) THEN RAISE EXCEPTION 'Permission denied'; END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'Request is already %', r.status; END IF;
  IF COALESCE(TRIM(p_reason), '') = '' THEN RAISE EXCEPTION 'A rejection reason is required'; END IF;
  PERFORM _leave_apply_rejection(p_request_id, p_reason);
END;
$$;

CREATE OR REPLACE FUNCTION _approval_apply(p_entity TEXT, p_id UUID, p_approved BOOLEAN, p_comment TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM set_config('app.approval_engine', 'on', true);
  IF p_entity = 'purchase_requisitions' THEN
    IF p_approved THEN
      UPDATE purchase_requisitions SET status = 'approved', approved_by = auth.uid(), approved_at = now(), updated_at = now() WHERE id = p_id;
    ELSE
      UPDATE purchase_requisitions SET status = 'rejected', updated_at = now() WHERE id = p_id;
    END IF;
  ELSIF p_entity = 'purchase_orders' THEN
    UPDATE purchase_orders SET status = CASE WHEN p_approved THEN 'sent' ELSE 'draft' END,
           approved_by = CASE WHEN p_approved THEN auth.uid() ELSE approved_by END, updated_at = now() WHERE id = p_id;
  ELSIF p_entity = 'purchase_invoices' THEN
    UPDATE purchase_invoices SET status = CASE WHEN p_approved THEN 'approved' ELSE 'draft' END,
           approved_by = CASE WHEN p_approved THEN auth.uid() ELSE approved_by END, updated_at = now() WHERE id = p_id;
  ELSIF p_entity = 'fuel_requests' THEN
    IF p_approved THEN
      UPDATE fuel_requests SET status = 'approved', approved_by = auth.uid(), approved_at = now() WHERE id = p_id;
    ELSE
      UPDATE fuel_requests SET status = 'rejected', rejected_reason = p_comment WHERE id = p_id;
    END IF;
  ELSIF p_entity = 'leave_requests' THEN
    IF p_approved THEN PERFORM _leave_apply_approval(p_id); ELSE PERFORM _leave_apply_rejection(p_id, p_comment); END IF;
  END IF;
  PERFORM set_config('app.approval_engine', 'off', true);
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 5. Submit / decide / cancel
-- ═══════════════════════════════════════════════════════════════════════
-- Idempotent: creates the request, or refreshes amount/route while no one has decided yet.
CREATE OR REPLACE FUNCTION approval_submit(p_entity TEXT, p_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _e      RECORD;
  _dept   UUID;
  _route  UUID;
  _req    approval_requests%ROWTYPE;
  _first  INT;
BEGIN
  SELECT * INTO _e FROM _approval_entity(p_entity, p_id);
  IF NOT FOUND THEN RETURN NULL; END IF;
  _dept := COALESCE(_e.department_id,
           (SELECT e.department_id FROM employees e
             WHERE e.id = _approval_subject_employee(p_entity, p_id, _e.requested_by)));
  _route := approval_match_route(_e.site_id, p_entity, _e.amount, _dept);

  SELECT * INTO _req FROM approval_requests WHERE entity_type = p_entity AND entity_id = p_id AND status = 'pending';
  IF FOUND THEN
    IF EXISTS (SELECT 1 FROM approval_actions WHERE request_id = _req.id AND action = 'approved') THEN
      RETURN _req.id;   -- decisions already made; keep the route
    END IF;
    IF _route IS NULL THEN
      UPDATE approval_requests SET status = 'cancelled', decided_at = now(), updated_at = now() WHERE id = _req.id;
      INSERT INTO approval_actions (request_id, action, comment) VALUES (_req.id, 'cancelled', 'No approval route applies any more');
      RETURN NULL;
    END IF;
    IF _route = _req.route_id AND _req.amount = _e.amount THEN RETURN _req.id; END IF;
    UPDATE approval_requests SET route_id = _route, amount = _e.amount, department_id = _dept,
           title = _e.title, updated_at = now() WHERE id = _req.id;
    INSERT INTO approval_actions (request_id, action, comment) VALUES (_req.id, 'resubmitted', 'Value or route changed');
  ELSE
    IF _route IS NULL THEN RETURN NULL; END IF;
    INSERT INTO approval_requests (site_id, entity_type, entity_id, route_id, amount, department_id, title, link, requested_by)
    VALUES (_e.site_id, p_entity, p_id, _route, _e.amount, _dept, _e.title, _e.link, _e.requested_by)
    RETURNING * INTO _req;
    INSERT INTO approval_actions (request_id, actor_id, action) VALUES (_req.id, _e.requested_by, 'submitted');
  END IF;

  SELECT MIN(step_order) INTO _first FROM approval_route_steps WHERE route_id = _route AND NOT is_archived;
  IF NOT _approval_move_to(_req.id, _first) THEN
    PERFORM _approval_stuck(_req.id);
  END IF;
  RETURN _req.id;
END;
$$;

CREATE OR REPLACE FUNCTION approval_decide(p_request_id UUID, p_approve BOOLEAN, p_comment TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _req  approval_requests%ROWTYPE;
  _step approval_route_steps%ROWTYPE;
  _next INT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO _req FROM approval_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Approval request not found'; END IF;
  IF _req.status <> 'pending' THEN RAISE EXCEPTION 'This request is already %', _req.status; END IF;
  IF NOT approval_can_act(p_request_id) THEN
    RAISE EXCEPTION 'You are not an approver for the current step of this request';
  END IF;
  IF NOT p_approve AND COALESCE(TRIM(p_comment), '') = '' THEN
    RAISE EXCEPTION 'A reason is required to reject';
  END IF;

  SELECT * INTO _step FROM approval_route_steps
   WHERE route_id = _req.route_id AND step_order = _req.current_step AND NOT is_archived;
  INSERT INTO approval_actions (request_id, step_order, step_label, actor_id, action, comment)
  VALUES (p_request_id, _req.current_step, _step.label, auth.uid(),
          CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END, NULLIF(TRIM(p_comment), ''));

  IF NOT p_approve THEN
    UPDATE approval_requests SET status = 'rejected', decided_at = now(), updated_at = now() WHERE id = p_request_id;
    PERFORM _approval_apply(_req.entity_type, _req.entity_id, false, p_comment);
    PERFORM _approval_notify(ARRAY[_req.requested_by], _req, 'Rejected: ' || COALESCE(_req.title, ''),
                             _step.label || ': ' || p_comment);
    RETURN jsonb_build_object('status', 'rejected');
  END IF;

  SELECT MIN(step_order) INTO _next FROM approval_route_steps
   WHERE route_id = _req.route_id AND NOT is_archived AND step_order > _req.current_step;
  IF _next IS NOT NULL THEN
    IF NOT _approval_move_to(p_request_id, _next) THEN PERFORM _approval_stuck(p_request_id); END IF;
    RETURN jsonb_build_object('status', 'pending', 'next_step', (SELECT current_step FROM approval_requests WHERE id = p_request_id));
  END IF;

  UPDATE approval_requests SET status = 'approved', decided_at = now(), updated_at = now() WHERE id = p_request_id;
  PERFORM _approval_apply(_req.entity_type, _req.entity_id, true, p_comment);
  PERFORM _approval_notify(ARRAY[_req.requested_by], _req, 'Approved: ' || COALESCE(_req.title, ''), 'All approval steps are complete.');
  RETURN jsonb_build_object('status', 'approved');
END;
$$;

CREATE OR REPLACE FUNCTION _approval_cancel(p_entity TEXT, p_id UUID, p_reason TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _rid UUID;
BEGIN
  UPDATE approval_requests SET status = 'cancelled', decided_at = now(), updated_at = now()
   WHERE entity_type = p_entity AND entity_id = p_id AND status = 'pending' RETURNING id INTO _rid;
  IF _rid IS NOT NULL THEN
    INSERT INTO approval_actions (request_id, actor_id, action, comment) VALUES (_rid, auth.uid(), 'cancelled', p_reason);
  END IF;
END;
$$;

-- Everything the current user can act on now, across all their sites
CREATE OR REPLACE FUNCTION approval_inbox()
RETURNS TABLE (id UUID, site_id UUID, site_name TEXT, entity_type TEXT, entity_id UUID, title TEXT, link TEXT,
               amount NUMERIC, current_step INT, step_label TEXT, total_steps INT,
               requested_by UUID, requester_name TEXT, created_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.id, r.site_id, s.name, r.entity_type, r.entity_id, r.title, r.link, r.amount, r.current_step,
         st.label, (SELECT COUNT(*)::INT FROM approval_route_steps x WHERE x.route_id = r.route_id AND NOT x.is_archived),
         r.requested_by, COALESCE(p.full_name, p.username), r.created_at
    FROM approval_requests r
    JOIN sites s ON s.id = r.site_id
    LEFT JOIN approval_route_steps st ON st.route_id = r.route_id AND st.step_order = r.current_step AND NOT st.is_archived
    LEFT JOIN profiles p ON p.id = r.requested_by
   WHERE r.status = 'pending' AND approval_can_act(r.id)
   ORDER BY r.created_at
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 6. Gates on source documents
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION trg_approval_gate() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _entity TEXT := TG_TABLE_NAME;
  _sub    TEXT := _approval_submitted_status(TG_TABLE_NAME);
  _label  TEXT;
  _dept   UUID;
BEGIN
  IF current_setting('app.approval_engine', true) = 'on' THEN RETURN NEW; END IF;

  -- Purchase orders: sending one that needs approval parks it as pending_approval.
  IF _entity = 'purchase_orders' AND NEW.status = 'sent'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'sent') THEN
    IF TG_OP = 'UPDATE' AND OLD.status = 'pending_approval' THEN
      RAISE EXCEPTION 'This purchase order is awaiting approval — decide it in the Approvals inbox';
    END IF;
    SELECT e.department_id INTO _dept FROM profiles p JOIN employees e ON e.id = p.employee_id WHERE p.id = NEW.created_by;
    IF approval_match_route(NEW.site_id, _entity, NEW.total_amount, _dept) IS NOT NULL THEN
      NEW.status := 'pending_approval';
    END IF;
    RETURN NEW;
  END IF;

  -- Everything else: a decision while an approval request is open must go through the engine.
  IF TG_OP = 'UPDATE' AND OLD.status = _sub AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status NOT IN ('cancelled', 'draft') THEN
    SELECT st.label INTO _label
      FROM approval_requests r
      LEFT JOIN approval_route_steps st ON st.route_id = r.route_id AND st.step_order = r.current_step AND NOT st.is_archived
     WHERE r.entity_type = _entity AND r.entity_id = NEW.id AND r.status = 'pending';
    IF FOUND THEN
      RAISE EXCEPTION 'This needs approval in the Approvals inbox (waiting on: %)', COALESCE(_label, 'next approver');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION trg_approval_after() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _sub TEXT := _approval_submitted_status(TG_TABLE_NAME);
BEGIN
  IF current_setting('app.approval_engine', true) = 'on' THEN RETURN NEW; END IF;
  IF NEW.status = _sub AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM _sub) THEN
    PERFORM approval_submit(TG_TABLE_NAME, NEW.id);
  ELSIF TG_OP = 'UPDATE' AND OLD.status = _sub AND NEW.status IN ('cancelled', 'draft') THEN
    PERFORM _approval_cancel(TG_TABLE_NAME, NEW.id, 'Document ' || NEW.status);
  ELSIF TG_OP = 'UPDATE' AND NEW.status = _sub AND TG_TABLE_NAME IN ('purchase_orders','purchase_invoices') THEN
    -- total_amount only exists on these tables; read it via jsonb so other tables never touch it
    IF (to_jsonb(NEW)->>'total_amount') IS DISTINCT FROM (to_jsonb(OLD)->>'total_amount') THEN
      PERFORM approval_submit(TG_TABLE_NAME, NEW.id);   -- value changed while waiting
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['purchase_requisitions','purchase_orders','purchase_invoices','fuel_requests','leave_requests'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_approval_gate ON %I', t);
    EXECUTE format('CREATE TRIGGER trg_approval_gate BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION trg_approval_gate()', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_approval_after ON %I', t);
    EXECUTE format('CREATE TRIGGER trg_approval_after AFTER INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION trg_approval_after()', t);
  END LOOP;
END $$;

-- Requisition value arrives with its lines: refresh the pending request.
CREATE OR REPLACE FUNCTION trg_approval_requisition_lines() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _rid UUID := CASE WHEN TG_OP = 'DELETE' THEN OLD.requisition_id ELSE NEW.requisition_id END;
BEGIN
  IF EXISTS (SELECT 1 FROM purchase_requisitions WHERE id = _rid AND status = 'submitted') THEN
    PERFORM approval_submit('purchase_requisitions', _rid);
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_approval_requisition_lines ON requisition_lines;
CREATE TRIGGER trg_approval_requisition_lines
  AFTER INSERT OR UPDATE OR DELETE ON requisition_lines
  FOR EACH ROW EXECUTE FUNCTION trg_approval_requisition_lines();

-- ═══════════════════════════════════════════════════════════════════════
-- 7. RLS
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE approval_routes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_route_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_requests    ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_actions     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ar_select ON approval_routes;
DROP POLICY IF EXISTS ar_insert ON approval_routes;
DROP POLICY IF EXISTS ar_update ON approval_routes;
CREATE POLICY ar_select ON approval_routes FOR SELECT USING (_has_permission('approvals.view', site_id) OR _has_permission('approvals.edit', site_id));
CREATE POLICY ar_insert ON approval_routes FOR INSERT WITH CHECK (_has_permission('approvals.edit', site_id));
CREATE POLICY ar_update ON approval_routes FOR UPDATE USING (_has_permission('approvals.edit', site_id));

DROP POLICY IF EXISTS ars_select ON approval_route_steps;
DROP POLICY IF EXISTS ars_insert ON approval_route_steps;
DROP POLICY IF EXISTS ars_update ON approval_route_steps;
CREATE POLICY ars_select ON approval_route_steps FOR SELECT USING (EXISTS (SELECT 1 FROM approval_routes r WHERE r.id = route_id
  AND (_has_permission('approvals.view', r.site_id) OR _has_permission('approvals.edit', r.site_id))));
CREATE POLICY ars_insert ON approval_route_steps FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM approval_routes r WHERE r.id = route_id AND _has_permission('approvals.edit', r.site_id)));
CREATE POLICY ars_update ON approval_route_steps FOR UPDATE USING (EXISTS (SELECT 1 FROM approval_routes r WHERE r.id = route_id AND _has_permission('approvals.edit', r.site_id)));

DROP POLICY IF EXISTS areq_select ON approval_requests;
CREATE POLICY areq_select ON approval_requests FOR SELECT USING (
  requested_by = auth.uid() OR _has_permission('approvals.view', site_id) OR approval_can_act(approval_requests.id)
  OR EXISTS (SELECT 1 FROM approval_actions a WHERE a.request_id = approval_requests.id AND a.actor_id = auth.uid()));

DROP POLICY IF EXISTS aact_select ON approval_actions;
CREATE POLICY aact_select ON approval_actions FOR SELECT USING (
  EXISTS (SELECT 1 FROM approval_requests r WHERE r.id = approval_actions.request_id));   -- inherits request visibility
-- Requests and actions are written only by SECURITY DEFINER functions.

-- Named FKs so the app can embed requester / approver profiles; live inbox updates.
ALTER TABLE approval_requests DROP CONSTRAINT IF EXISTS approval_requests_requested_by_fkey;
ALTER TABLE approval_requests ADD CONSTRAINT approval_requests_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES profiles(id);
ALTER TABLE approval_actions DROP CONSTRAINT IF EXISTS approval_actions_actor_id_fkey;
ALTER TABLE approval_actions ADD CONSTRAINT approval_actions_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES profiles(id);
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE approval_requests;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

INSERT INTO schema_migrations (filename)
VALUES ('0179_approval_engine.sql')
ON CONFLICT DO NOTHING;

COMMIT;
