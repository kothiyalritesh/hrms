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
  v_team text;
  v_is_monday boolean;
  v_bonus_enabled boolean;
BEGIN
  -- We only run this on insert of a biometric punch
  -- Find the user's team from profiles
  SELECT p.department INTO v_team
  FROM public.profiles p
  WHERE p.smartoffice_employee_code = NEW.employee_code
  LIMIT 1;

  IF v_team IS NULL THEN
    RETURN NEW;
  END IF;

  -- Check if today is Monday (1 = Monday in extract isodow)
  v_is_monday := extract(isodow from (NEW.punch_timestamp at time zone 'Asia/Kolkata')) = 1;

  IF v_is_monday THEN
    -- Check if their team has monday_credit_bonus
    SELECT monday_credit_bonus INTO v_bonus_enabled
    FROM public.work_schedule_configs
    WHERE team = v_team;

    IF v_bonus_enabled THEN
      -- We need to ensure we don't grant multiple credits for the same Monday.
      -- Let's check if we already granted a bonus this month or week?
      -- "auto-credit +1 compliance/credit score"
      -- Actually, we can just insert a row into a new table or an existing event ledger.
      -- Let's insert into hrms_audit_events or a custom employee_compliance_scores if it exists.
      -- For now, just logging it as an audit event is fine if there is no explicit score table.
      -- Let's just create an event in leave_transactions as a 'MONDAY_CREDIT' (comp_off maybe?).
      -- The plan says "+1 compliance/credit score". 
      
      -- Instead of guessing, let's insert into a new table for compliance credits.
      -- No, let's check if compliance_score exists on profiles.
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;
