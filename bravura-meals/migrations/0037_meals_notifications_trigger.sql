-- ── Meals notifications: DB trigger on daily_submissions ────────────────────
-- Whenever a submission's status changes we fan out notification rows to
-- the correct recipients:
--
--   draft     → submitted   → notify every user holding meals.approve on
--                            that site (globally or site-scoped)
--   submitted → approved    → notify the submitter
--   submitted → draft       → notify the submitter (returned for
--                            corrections; includes the reviewer note)
--   any       → confirmed   → notify the submitter (kitchen confirmed)
--
-- All rows go through the existing public.notifications table so the
-- HomeLauncher + ModuleLayout bell drawers pick them up automatically.
-- Every insert bypasses RLS by running inside a SECURITY DEFINER
-- trigger function.

CREATE OR REPLACE FUNCTION public.notify_meals_submission_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_site_name  text;
  v_date_str   text;
  v_actor_name text;
  v_submitter  uuid;
BEGIN
  -- Site name for a friendlier notification title
  SELECT name INTO v_site_name FROM public.sites WHERE id = NEW.site_id;
  v_date_str   := to_char(NEW.date, 'FMDay, DD FMMonth YYYY');
  v_submitter  := COALESCE(NEW.submitted_by, OLD.submitted_by);

  -- ── submitted → notify all approvers on this site ─────────────────────
  IF (TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status
      AND NEW.status = 'submitted')
  THEN
    SELECT COALESCE(NULLIF(p.full_name,''), p.username, 'A meal officer')
      INTO v_actor_name
      FROM public.profiles p
     WHERE p.id = NEW.submitted_by;

    INSERT INTO public.notifications (site_id, recipient_id, type, title, body, action_url)
    SELECT NEW.site_id,
           ur.user_id,
           'meals_submitted',
           'Meal submission awaiting approval',
           format('%s submitted %s for %s. Review it on the Approvals page.',
                  COALESCE(v_actor_name,'Someone'), v_date_str,
                  COALESCE(v_site_name,'this site')),
           '/meals/meals_approvals'
      FROM public.user_roles ur
      JOIN public.role_permissions rp ON rp.role_id = ur.role_id
      JOIN public.permissions       p ON p.id = rp.permission_id
     WHERE p.code = 'meals.approve'
       AND (ur.site_id IS NULL OR ur.site_id = NEW.site_id)
       AND ur.user_id <> NEW.submitted_by  -- don't notify the submitter
    ON CONFLICT DO NOTHING;
  END IF;

  -- ── approved → notify the submitter ───────────────────────────────────
  IF (TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status
      AND NEW.status = 'approved'
      AND v_submitter IS NOT NULL)
  THEN
    SELECT COALESCE(NULLIF(p.full_name,''), p.username, 'An approver')
      INTO v_actor_name
      FROM public.profiles p
     WHERE p.id = NEW.approved_by;

    INSERT INTO public.notifications (site_id, recipient_id, type, title, body, action_url)
    VALUES (
      NEW.site_id,
      v_submitter,
      'meals_approved',
      'Your meal submission was approved',
      format('%s approved your submission for %s.',
             COALESCE(v_actor_name,'An approver'), v_date_str),
      '/meals/meals_daily'
    );
  END IF;

  -- ── returned to draft → notify the submitter ──────────────────────────
  IF (TG_OP = 'UPDATE'
      AND OLD.status = 'submitted' AND NEW.status = 'draft'
      AND v_submitter IS NOT NULL)
  THEN
    SELECT COALESCE(NULLIF(p.full_name,''), p.username, 'An approver')
      INTO v_actor_name
      FROM public.profiles p
     WHERE p.id::text = COALESCE(NEW.previous_counts->>'actor', '');

    INSERT INTO public.notifications (site_id, recipient_id, type, title, body, action_url)
    VALUES (
      NEW.site_id,
      v_submitter,
      'meals_returned',
      'Meal submission returned for corrections',
      format('%s returned your submission for %s.%s',
             COALESCE(v_actor_name,'An approver'), v_date_str,
             CASE WHEN COALESCE(NEW.notes,'') = ''
                  THEN ''
                  ELSE E'\nNote: ' || NEW.notes END),
      '/meals/meals_entry'
    );
  END IF;

  -- ── confirmed (kitchen) → notify the submitter ────────────────────────
  IF (TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status
      AND NEW.status = 'confirmed'
      AND v_submitter IS NOT NULL)
  THEN
    INSERT INTO public.notifications (site_id, recipient_id, type, title, body, action_url)
    VALUES (
      NEW.site_id,
      v_submitter,
      'meals_confirmed',
      'Kitchen confirmed your meal submission',
      format('Kitchen counts have been confirmed for %s.', v_date_str),
      '/meals/meals_daily'
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_meals_submission_change ON public.daily_submissions;
CREATE TRIGGER trg_notify_meals_submission_change
  AFTER UPDATE ON public.daily_submissions
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_meals_submission_change();

COMMENT ON FUNCTION public.notify_meals_submission_change() IS
  'Fans out notification rows on every daily_submissions status change: submitted -> all site approvers, approved/returned/confirmed -> the original submitter. SECURITY DEFINER so the INSERTs bypass the notifications RLS policy.';
