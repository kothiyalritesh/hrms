-- Migration: Overdue Tasks Cron Job (Module 15)
-- Description: Schedules a daily pg_cron job to scan for tasks that are past their due date and notify assignees.

CREATE OR REPLACE FUNCTION public.check_overdue_tasks()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Insert notifications for overdue tasks that are not completed
  INSERT INTO public.notifications (user_id, title, message, type, reference_id)
  SELECT 
    assigned_to, 
    'Task Overdue', 
    'The task "' || title || '" was due on ' || (due_date::date)::text,
    'TASK_OVERDUE', 
    id
  FROM public.tasks
  WHERE status != 'COMPLETED' 
    AND due_date < (now() AT TIME ZONE 'Asia/Kolkata')
    AND assigned_to IS NOT NULL
    -- Only notify once per overdue task by checking if a notification already exists
    AND NOT EXISTS (
      SELECT 1 FROM public.notifications n 
      WHERE n.reference_id = tasks.id 
        AND n.type = 'TASK_OVERDUE'
    );
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('hrms-overdue-tasks-check');
    PERFORM cron.schedule(
      'hrms-overdue-tasks-check',
      '30 3 * * *', -- 03:30 UTC -> 09:00 AM IST
      SELECT public.check_overdue_tasks()
    );
  END IF;
END $$;
