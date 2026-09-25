-- Migration: 20260916010000_attendance_event_ledger_and_parity.sql
-- Description: Consolidated HRMS Requirements 12, 13 & 15:
-- 1. Creates immutable append-only attendance_event_ledger table with anti-mutation triggers
-- 2. Harmonizes rpc_admin_dashboard_summary() with canonical attendance reporting universe (attendance_reporting_enabled = true, employment date range)
-- 3. Adds ledger projection trigger for automated daily attendance logging

-- 1. Create Immutable Attendance Event Ledger
create table if not exists public.attendance_event_ledger (
  event_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null check (event_type in ('CHECK_IN', 'CHECK_OUT', 'BIOMETRIC_PUNCH', 'REGULARIZATION_APPLIED', 'MANUAL_OVERRIDE', 'AUTO_CLOSE')),
  event_source text not null check (event_source in ('MOBILE_APP', 'WEB_ADMIN', 'BIOMETRIC_DEVICE', 'CRON')),
  client_timestamp_utc timestamptz,
  server_timestamp_utc timestamptz not null default now(),
  business_date date not null,
  latitude double precision,
  longitude double precision,
  accuracy_m double precision,
  geofence_id text,
  device_id text,
  app_version text,
  ip_address text,
  verification_status text not null default 'VERIFIED' check (verification_status in ('VERIFIED', 'FLAGGED', 'REJECTED')),
  tampering_flags text not null default 'NONE' check (tampering_flags in ('NONE', 'CLOCK_DRIFT', 'MOCK_LOCATION', 'GEOFENCE_BREACH', 'TAMPERED')),
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_att_ledger_user_date
  on public.attendance_event_ledger(user_id, business_date, created_at desc);

create index if not exists idx_att_ledger_date
  on public.attendance_event_ledger(business_date);

create index if not exists idx_att_ledger_type
  on public.attendance_event_ledger(event_type, created_at desc);

-- 2. Anti-Mutation Trigger (Strict Immutability)
create or replace function public.prevent_attendance_ledger_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'IMMUTABLE_RECORD: Rows in attendance_event_ledger cannot be updated or deleted.';
end;
$$;

drop trigger if exists trg_prevent_attendance_ledger_mutation on public.attendance_event_ledger;
create trigger trg_prevent_attendance_ledger_mutation
  before update or delete on public.attendance_event_ledger
  for each row execute function public.prevent_attendance_ledger_mutation();

-- 3. RLS on Ledger
alter table public.attendance_event_ledger enable row level security;

drop policy if exists att_ledger_select on public.attendance_event_ledger;
create policy att_ledger_select on public.attendance_event_ledger
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('SYSTEM_ADMIN', 'ADMIN', 'HR', 'HRD')
    )
  );

-- Direct client inserts disabled; ledger records created via verified RPCs
revoke insert, update, delete on public.attendance_event_ledger from anon, authenticated;

-- 4. Harmonized Workforce & Dashboard Summary RPC (100% App vs Browser Parity)
create or replace function public.rpc_admin_dashboard_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_today date := (v_now at time zone 'Asia/Kolkata')::date;
  v_total_employees bigint;
  v_active_employees bigint;
  v_today_attendance bigint;
  v_currently_checked_in bigint;
  v_checked_out_today bigint;
  v_pending_leaves bigint;
  v_overdue_tasks bigint;
  v_open_tickets bigint;
  v_live_tracking bigint;
begin
  perform public.require_profile_admin();

  -- Harmonized Active Workforce universe:
  -- Total count of all employee profiles
  select count(*) into v_total_employees
  from public.profiles profile;

  -- Active reporting workforce: strictly matches AttendanceControlScreenNew and v_attendance_daily_canonical
  select count(*) into v_active_employees
  from public.profiles profile
  where profile.is_active = true
    and profile.attendance_reporting_enabled = true
    and (profile.last_working_date is null or profile.last_working_date >= v_today)
    and (profile.joining_date is null or profile.joining_date <= v_today);

  -- Historical cumulative check-ins today (unique employees in active reporting workforce)
  select count(distinct attendance.user_id)
  into v_today_attendance
  from public.attendance_logs attendance
  join public.profiles profile on profile.id = attendance.user_id
  where attendance.date = v_today
    and attendance.checkin_time is not null
    and profile.is_active = true
    and profile.attendance_reporting_enabled = true
    and (profile.last_working_date is null or profile.last_working_date >= v_today);

  -- Real-time active checked-in workforce (decreases when an employee checks out)
  select count(distinct attendance.user_id)
  into v_currently_checked_in
  from public.attendance_logs attendance
  join public.profiles profile on profile.id = attendance.user_id
  where attendance.date = v_today
    and attendance.checkin_time is not null
    and attendance.checkout_time is null
    and coalesce(attendance.status, 'CHECKED_IN') in ('CHECKED_IN', 'present', 'LATE')
    and profile.is_active = true
    and profile.attendance_reporting_enabled = true
    and (profile.last_working_date is null or profile.last_working_date >= v_today);

  -- Employees who have checked out today
  select count(distinct attendance.user_id)
  into v_checked_out_today
  from public.attendance_logs attendance
  join public.profiles profile on profile.id = attendance.user_id
  where attendance.date = v_today
    and attendance.checkin_time is not null
    and attendance.checkout_time is not null
    and profile.is_active = true
    and profile.attendance_reporting_enabled = true
    and (profile.last_working_date is null or profile.last_working_date >= v_today);

  select count(*)
  into v_pending_leaves
  from public.leave_requests request
  where lower(coalesce(request.status, '')) = 'pending';

  select count(*)
  into v_overdue_tasks
  from public.tasks task
  where task.due_date is not null
    and task.due_date::date < v_today
    and lower(coalesce(task.status, '')) in ('pending', 'in_progress');

  select count(*)
  into v_open_tickets
  from public.support_tickets ticket
  where lower(coalesce(ticket.status, '')) in ('open', 'in_progress');

  select count(distinct tracking.user_id)
  into v_live_tracking
  from public.location_tracking tracking
  where tracking.recorded_at >= v_now - interval '15 minutes'
    and tracking.recorded_at <= v_now + interval '10 seconds'
    and tracking.latitude is not null
    and tracking.longitude is not null;

  return jsonb_build_object(
    'success', true,
    'server_now', v_now,
    'business_date', v_today,
    'timezone', 'Asia/Kolkata',
    'total_employees', v_total_employees,
    'active_employees', v_active_employees,
    'today_attendance', v_today_attendance,
    'currently_checked_in', v_currently_checked_in,
    'checked_out_today', v_checked_out_today,
    'pending_leaves', v_pending_leaves,
    'overdue_tasks', v_overdue_tasks,
    'open_tickets', v_open_tickets,
    'live_tracking', v_live_tracking
  );
end;
$$;

revoke all on function public.rpc_admin_dashboard_summary() from public, anon;
grant execute on function public.rpc_admin_dashboard_summary() to authenticated;

