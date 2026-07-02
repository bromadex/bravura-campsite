-- ── Fuel issuance acknowledgement workflow ──────────────────────────────────
-- Diesel can be issued manually without a prior fuel request (e.g. an
-- emergency). Instead of blocking the operator, we let the issuance go
-- through immediately but require an "Authorised by" name + reason,
-- flag the row as pending acknowledgement, and notify every approver
-- for the site so they can acknowledge or query it after the fact.
--
-- If the issuance IS linked to an approved fuel_request, no acknowledgement
-- is required (acknowledgement_status defaults to 'not_required').

BEGIN;

-- ── 1. Schema additions on fuel_transactions ───────────────────────────────
ALTER TABLE fuel_transactions
  ADD COLUMN IF NOT EXISTS authorised_by_name      text,
  ADD COLUMN IF NOT EXISTS authorisation_reason    text,
  ADD COLUMN IF NOT EXISTS acknowledgement_status  text
       DEFAULT 'not_required'
       CHECK (acknowledgement_status IN ('not_required','pending','acknowledged','queried')),
  ADD COLUMN IF NOT EXISTS acknowledged_by         uuid REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS acknowledged_at         timestamptz,
  ADD COLUMN IF NOT EXISTS acknowledgement_note    text;

COMMENT ON COLUMN fuel_transactions.authorised_by_name IS
  'Free-text name of the person on the ground who authorised this manual/emergency issuance. Recorded on unlinked issuances so the audit trail is not lost.';
COMMENT ON COLUMN fuel_transactions.acknowledgement_status IS
  'not_required = issuance linked to an approved fuel_request; pending = manual issuance awaiting a fuel.approve acknowledgement; acknowledged = an approver has confirmed the issuance was authorised; queried = an approver has raised a query on it.';

CREATE INDEX IF NOT EXISTS fuel_tx_ack_pending
  ON fuel_transactions (site_id, transaction_date DESC)
  WHERE acknowledgement_status = 'pending';

-- ── 2. Trigger: notify approvers on pending issuances ──────────────────────
CREATE OR REPLACE FUNCTION public.notify_fuel_issuance_pending()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_site_name text;
BEGIN
  IF NEW.transaction_type = 'issuance'
     AND NEW.acknowledgement_status = 'pending'
     AND (TG_OP = 'INSERT'
          OR OLD.acknowledgement_status IS DISTINCT FROM NEW.acknowledgement_status)
  THEN
    SELECT name INTO v_site_name FROM public.sites WHERE id = NEW.site_id;

    INSERT INTO public.notifications (site_id, recipient_id, type, title, body, action_url)
    SELECT NEW.site_id,
           ur.user_id,
           'fuel_issuance_pending',
           'Manual fuel issuance needs acknowledgement',
           format('%s L authorised by %s at %s. Reason: %s',
                  round(NEW.litres::numeric, 1),
                  COALESCE(NEW.authorised_by_name, 'someone on site'),
                  COALESCE(v_site_name, 'this site'),
                  COALESCE(NEW.authorisation_reason, '(no reason recorded)')),
           '/fuel/fuel_issues'
      FROM public.user_roles ur
      JOIN public.role_permissions rp ON rp.role_id = ur.role_id
      JOIN public.permissions       p ON p.id = rp.permission_id
     WHERE p.code = 'fuel.approve'
       AND (ur.site_id IS NULL OR ur.site_id = NEW.site_id)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_fuel_issuance_pending ON fuel_transactions;
CREATE TRIGGER trg_notify_fuel_issuance_pending
  AFTER INSERT OR UPDATE ON fuel_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_fuel_issuance_pending();

-- ── 3. RPC: acknowledge (or query) a pending issuance ──────────────────────
CREATE OR REPLACE FUNCTION public.acknowledge_fuel_issuance(
  p_transaction_id uuid,
  p_note           text DEFAULT NULL,
  p_query          boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_site_id uuid;
  v_allowed boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT site_id INTO v_site_id
    FROM public.fuel_transactions
   WHERE id = p_transaction_id AND transaction_type = 'issuance';
  IF v_site_id IS NULL THEN
    RAISE EXCEPTION 'Issuance not found';
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM public.user_roles ur
      JOIN public.role_permissions rp ON rp.role_id = ur.role_id
      JOIN public.permissions       p ON p.id = rp.permission_id
     WHERE ur.user_id = auth.uid()
       AND p.code = 'fuel.approve'
       AND (ur.site_id IS NULL OR ur.site_id = v_site_id)
  ) INTO v_allowed;
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'You do not have permission to acknowledge issuances on this site';
  END IF;

  UPDATE public.fuel_transactions
     SET acknowledgement_status = CASE WHEN p_query THEN 'queried' ELSE 'acknowledged' END,
         acknowledged_by        = auth.uid(),
         acknowledged_at        = NOW(),
         acknowledgement_note   = p_note
   WHERE id = p_transaction_id;
END;
$$;

REVOKE ALL ON FUNCTION public.acknowledge_fuel_issuance(uuid, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.acknowledge_fuel_issuance(uuid, text, boolean) TO authenticated;

COMMIT;
