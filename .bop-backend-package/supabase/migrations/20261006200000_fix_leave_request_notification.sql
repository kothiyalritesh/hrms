-- =============================================================================
-- 20261006200000_fix_leave_request_notification.sql
--
-- "Leave application failed: record "new" has no field "number_of_days""
--
-- The AFTER INSERT trigger notify_leave_request_trg (20260918050000) builds its
-- message from NEW.number_of_days, but leave_requests stores the day count in
-- requested_days. The trigger error rolled back every leave application.
--
-- Fix: use requested_days, and make the notification best-effort so a
-- notification problem can never block a leave application again.
-- Idempotent. Run in the Supabase SQL Editor.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.notify_on_leave_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_emp   record;
  v_hr    record;
  v_title text;
  v_msg   text;
  v_days  text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT p.name, p.office_id, p.reports_to INTO v_emp
    FROM public.profiles p WHERE p.id = NEW.user_id;

    -- 1 -> "1", 10 -> "10", 0.5 -> "0.5"
    v_days  := coalesce(rtrim(to_char(NEW.requested_days, 'FM9999990.99'), '.'), '?');
    v_title := 'Leave Request: ' || coalesce(v_emp.name, 'Employee');
    v_msg   := 'Leave application from ' || coalesce(v_emp.name, 'Employee')
               || ' for ' || v_days || ' day(s) of '
               || replace(initcap(coalesce(NEW.leave_type, 'leave')), '_', ' ')
               || ' from ' || NEW.start_date || ' to ' || NEW.end_date
               || '. Reason: ' || coalesce(nullif(trim(NEW.reason), ''), 'None');

    -- reporting manager
    IF v_emp.reports_to IS NOT NULL AND v_emp.reports_to <> NEW.user_id THEN
      INSERT INTO public.notifications (user_id, title, message, type, reference_id)
      VALUES (v_emp.reports_to, v_title, v_msg, 'LEAVE_REQUEST', NEW.id);
    END IF;

    -- HR / admins of the same office, or company-wide HR
    FOR v_hr IN
      SELECT p.id FROM public.profiles p
      WHERE upper(p.role) IN ('HR', 'HRD', 'ADMIN')
        AND coalesce(p.is_active, true)
        AND p.id <> NEW.user_id
        AND (p.office_id = v_emp.office_id OR p.office_id IS NULL)
        AND (v_emp.reports_to IS NULL OR p.id <> v_emp.reports_to)
    LOOP
      INSERT INTO public.notifications (user_id, title, message, type, reference_id)
      VALUES (v_hr.id, v_title, v_msg, 'LEAVE_REQUEST', NEW.id);
    END LOOP;
  EXCEPTION WHEN others THEN
    -- Never block the leave application because of a notification problem.
    RAISE WARNING 'notify_on_leave_request skipped for %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_leave_request_trg ON public.leave_requests;
CREATE TRIGGER notify_leave_request_trg
  AFTER INSERT ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_leave_request();
