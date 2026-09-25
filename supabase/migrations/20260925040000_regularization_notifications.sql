-- Migration: Notifications for Regularization Requests (Module 14)
-- Description: Triggers a push notification to Team Heads and HR when an employee submits a regularization request.

CREATE OR REPLACE FUNCTION public.notify_on_regularization_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_emp record;
  v_msg text;
  v_hr record;
BEGIN
  -- Get employee details
  SELECT id, name, reports_to INTO v_emp
  FROM public.profiles
  WHERE id = NEW.user_id;

  v_msg := coalesce(v_emp.name, 'An employee') || ' requested attendance regularization for ' || (NEW.requested_checkout::date)::text || '.';

  -- Notify Team Head
  IF v_emp.reports_to IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, message, type, reference_id)
    VALUES (v_emp.reports_to, 'Regularization Request: ' || coalesce(v_emp.name, 'Employee'), v_msg, 'REGULARIZATION_REQUEST', NEW.id);
  END IF;

  -- Notify HR
  FOR v_hr IN 
    SELECT id FROM public.profiles 
    WHERE role IN ('SYSTEM_ADMIN', 'SUPER_ADMIN', 'ADMIN', 'HR', 'HRD') 
      AND is_active = true
  LOOP
    -- Prevent duplicate if HR is also the team head
    IF v_emp.reports_to IS NULL OR v_hr.id <> v_emp.reports_to THEN
      INSERT INTO public.notifications (user_id, title, message, type, reference_id)
      VALUES (v_hr.id, 'Regularization Request: ' || coalesce(v_emp.name, 'Employee'), v_msg, 'REGULARIZATION_REQUEST', NEW.id);
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_regularization_request_trg ON public.attendance_regularization_requests;
CREATE TRIGGER notify_regularization_request_trg
AFTER INSERT ON public.attendance_regularization_requests
FOR EACH ROW EXECUTE FUNCTION public.notify_on_regularization_request();
