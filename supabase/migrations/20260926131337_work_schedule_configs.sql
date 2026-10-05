-- Create work_schedule_configs table
CREATE TABLE IF NOT EXISTS public.work_schedule_configs (
  id uuid primary key default gen_random_uuid(),
  team text not null unique,
  saturday_policy text check(saturday_policy in ('WFH', 'OFF', 'OFFICE')) default 'OFFICE',
  sunday_policy text check(sunday_policy in ('WFH', 'OFF', 'OFFICE')) default 'OFF',
  monday_credit_bonus boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Seed Marketing Team
INSERT INTO public.work_schedule_configs (team, saturday_policy, sunday_policy, monday_credit_bonus)
VALUES ('Marketing', 'WFH', 'OFF', true)
ON CONFLICT (team) DO UPDATE SET 
  saturday_policy = EXCLUDED.saturday_policy,
  sunday_policy = EXCLUDED.sunday_policy,
  monday_credit_bonus = EXCLUDED.monday_credit_bonus;

-- Monday biometric punch credit trigger
CREATE OR REPLACE FUNCTION public.trigger_monday_biometric_credit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_team text;
  v_is_monday boolean;
  v_bonus_enabled boolean;
  v_month_start date;
  v_punch_date date;
BEGIN
  -- We only run this on insert of a biometric punch
  v_punch_date := (NEW.punch_timestamp at time zone 'Asia/Kolkata')::date;
  v_is_monday := extract(isodow from (NEW.punch_timestamp at time zone 'Asia/Kolkata')) = 1;

  IF NOT v_is_monday THEN
    RETURN NEW;
  END IF;

  -- Find the user's team from profiles
  SELECT p.id, p.department INTO v_user_id, v_team
  FROM public.profiles p
  WHERE p.smartoffice_employee_code = NEW.employee_code
  LIMIT 1;

  IF v_user_id IS NULL OR v_team IS NULL THEN
    RETURN NEW;
  END IF;

  -- Check if their team has monday_credit_bonus
  SELECT monday_credit_bonus INTO v_bonus_enabled
  FROM public.work_schedule_configs
  WHERE team = v_team;

  IF coalesce(v_bonus_enabled, false) THEN
    -- Check if we already granted a bonus this Monday
    IF NOT EXISTS (
      SELECT 1 FROM public.compliance_score_deductions
      WHERE user_id = v_user_id
        AND reason = 'Monday Biometric Attendance Credit'
        AND (created_at at time zone 'Asia/Kolkata')::date = v_punch_date
    ) THEN
      v_month_start := date_trunc('month', v_punch_date)::date;

      -- Ensure score row exists
      INSERT INTO public.employee_compliance_scores (user_id, score_month, current_score)
      VALUES (v_user_id, v_month_start, 100)
      ON CONFLICT (user_id, score_month) DO NOTHING;

      -- Add credit (+1 score by applying -1 deduction)
      UPDATE public.employee_compliance_scores
      SET current_score = current_score + 1,
          updated_at = now()
      WHERE user_id = v_user_id AND score_month = v_month_start;

      -- Log it
      INSERT INTO public.compliance_score_deductions (user_id, score_month, deduction_amount, reason, source_table, source_id, deducted_by)
      VALUES (v_user_id, v_month_start, -1, 'Monday Biometric Attendance Credit', 'smartoffice_device_logs', NEW.id, null);
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_monday_biometric_credit ON public.smartoffice_device_logs;
CREATE TRIGGER tr_monday_biometric_credit
AFTER INSERT ON public.smartoffice_device_logs
FOR EACH ROW
EXECUTE FUNCTION public.trigger_monday_biometric_credit();

