const fs = require('fs');

const sql = `
-- Drop broken RPC
DROP FUNCTION IF EXISTS public.rpc_admin_attendance_daily_v3(date, date);

-- Recreate to use canonical view
CREATE OR REPLACE FUNCTION public.rpc_admin_attendance_daily_v3(
  p_start_date date,
  p_end_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_agg(
    jsonb_build_object(
      'date', att.date,
      'day_label', to_char(att.date, 'Dy, MMM DD'),
      'present_count', att.present_count,
      'present_missing_out_count', att.present_missing_out_count,
      'absent_count', att.absent_count,
      'leave_count', att.leave_count,
      'weekly_off_count', att.weekly_off_count,
      'holiday_count', att.holiday_count,
      'late_count', att.late_count,
      'attendance_rate', att.attendance_rate
    )
    ORDER BY att.date
  )
  INTO v_result
  FROM (
    SELECT
      v.work_date as date,
      COUNT(*) FILTER (WHERE v.effective_status = 'CHECKED_IN' OR v.effective_status = 'CHECKED_OUT') as present_count,
      COUNT(*) FILTER (WHERE v.effective_status = 'CHECKED_IN') as present_missing_out_count,
      COUNT(*) FILTER (WHERE v.effective_status = 'ABSENT') as absent_count,
      COUNT(*) FILTER (WHERE v.effective_status = 'LEAVE') as leave_count,
      COUNT(*) FILTER (WHERE v.effective_status = 'WEEKLY_OFF') as weekly_off_count,
      COUNT(*) FILTER (WHERE v.effective_status = 'HOLIDAY') as holiday_count,
      COUNT(*) FILTER (WHERE (v.app_first_in::time > v.late_checkin_time) OR (v.biometric_first_in::time > v.late_checkin_time)) as late_count,
      CASE
        WHEN COUNT(*) FILTER (WHERE v.effective_status NOT IN ('HOLIDAY', 'WEEKLY_OFF')) > 0
        THEN ROUND(
          (COUNT(*) FILTER (WHERE v.effective_status IN ('CHECKED_IN', 'CHECKED_OUT'))::numeric /
           COUNT(*) FILTER (WHERE v.effective_status NOT IN ('HOLIDAY', 'WEEKLY_OFF'))) * 100,
          2
        )
        ELSE 100
      END as attendance_rate
    FROM public.v_attendance_daily_canonical v
    WHERE v.work_date >= p_start_date
      AND v.work_date <= p_end_date
    GROUP BY v.work_date
  ) att;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

-- New function to grant comp off
CREATE OR REPLACE FUNCTION public.grant_weekly_off_comp_off(p_user_id uuid, p_work_date date)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_calendar jsonb;
  v_earning record;
  v_tx uuid;
BEGIN
  -- Get calendar resolution to check if it's a WEEKLY_OFF
  v_calendar := public.resolve_hrms_calendar_day(p_user_id, p_work_date);

  IF v_calendar->>'kind' = 'WEEKLY_OFF' THEN
    -- Prevent duplicate via idempotency key on insert
    BEGIN
      INSERT INTO public.comp_off_earnings(
        user_id, eligible_work_date, units, remaining_units,
        source_type, source_id, reason, status, created_by,
        expires_at
      )
      VALUES(
        p_user_id, p_work_date, 1, 1,
        'WEEKLY_OFF_ATTENDANCE', NULL, 'Worked on a designated Weekly Off', 'APPROVED', p_user_id,
        p_work_date + interval '3 months'
      )
      RETURNING * INTO v_earning;
      
      -- Credit to leave balance
      v_tx := public.apply_leave_transaction(
        p_user_id, 'COMP_OFF', 'COMP_OFF_EARNING', 1,
        p_work_date, NULL, 'WEEKLY_OFF_ATTENDANCE', NULL, 'Worked on Weekly Off', p_user_id,
        'weekly-off-comp:' || p_user_id || ':' || p_work_date
      );

      UPDATE public.comp_off_earnings SET credited_transaction_id = v_tx WHERE id = v_earning.id;

      INSERT INTO public.notifications(user_id, title, message, type, read)
      VALUES(p_user_id, 'Comp-Off Earned', 'You earned +1 Comp-Off for working on your Week Off!', 'SYSTEM', false);

      RETURN true;
    EXCEPTION WHEN unique_violation THEN
      RETURN false;
    END;
  END IF;
  
  RETURN false;
END;
$$;
`;

fs.writeFileSync('supabase/migrations/20260928000000_fix_weekly_off_display.sql', sql, 'utf-8');
console.log("Created migration");
