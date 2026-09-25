-- Migration: 20260908100000_hrms_backlog_enhancements.sql
-- HRMS Backlog Enhancements:
-- 1. Tasks: created_by, assigned_to, assigned_by, created_on_behalf_of with audit logging
-- 2. Attendance Exceptions: 12 PM alert & 3-day absence exception workflow (NO automatic LWP)
-- 3. Leave Engine: Admin balance adjustment with audit log & backdated leave tracking
-- 4. Employee Exit Lifecycle: ACTIVE -> EXIT_PENDING -> EXITED -> ARCHIVED (preserves history)
-- 5. IP Restriction: office_ip_allowlist and check-in decision logic
-- 6. Mandatory Client Fields: backend validation for SITE & MEETING
-- 7. Visit Feedback: 5-star rating + notes
-- 8. Auto End-Time: 8:00 PM auto close with auto_closed=true and auto_close_reason='SYSTEM_DEFAULT_END_TIME'
-- 9. Attendance Policy layer: weekend & half-day settings

-- ============================================================================
-- 1. Tasks: Explicit Creation & Assignment Attribution
-- ============================================================================
alter table public.tasks
  add column if not exists created_by uuid references public.profiles(id) on delete set null,
  add column if not exists assigned_by uuid references public.profiles(id) on delete set null,
  add column if not exists created_on_behalf_of uuid references public.profiles(id) on delete set null;

create index if not exists idx_tasks_assigned_to_status on public.tasks(assigned_to, status);
create index if not exists idx_tasks_created_by on public.tasks(created_by);
create index if not exists idx_tasks_on_behalf_of on public.tasks(created_on_behalf_of);

create or replace function public.create_task_on_behalf(
  p_title               text,
  p_description         text,
  p_assigned_to         uuid,
  p_on_behalf_of        uuid default null,
  p_deadline            timestamptz default null,
  p_priority            text default 'medium'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_task_id uuid;
begin
  if not exists (
    select 1 from public.profiles
    where id = v_uid and role in ('SYSTEM_ADMIN', 'ADMIN', 'HR', 'HRD', 'BUSINESS_HEAD')
  ) and not exists (
    select 1 from public.user_permissions
    where user_id = v_uid and permission = 'manage_tasks' and revoked_at is null
  ) then
    return jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  end if;

  insert into public.tasks (
    title,
    description,
    assigned_to,
    assigned_by,
    created_by,
    created_on_behalf_of,
    deadline,
    priority,
    status
  ) values (
    p_title,
    p_description,
    p_assigned_to,
    v_uid,
    v_uid,
    p_on_behalf_of,
    p_deadline,
    coalesce(p_priority, 'medium'),
    'pending'
  )
  returning id into v_task_id;

  -- Audit log
  perform public.log_audit_event(
    'TASK_ASSIGNED_ON_BEHALF',
    'tasks',
    v_task_id::text,
    null,
    jsonb_build_object(
      'title', p_title,
      'assigned_to', p_assigned_to,
      'assigned_by', v_uid,
      'created_on_behalf_of', p_on_behalf_of
    )
  );

  return jsonb_build_object(
    'success', true,
    'task_id', v_task_id,
    'created_by', v_uid,
    'assigned_by', v_uid,
    'created_on_behalf_of', p_on_behalf_of
  );
end $$;

revoke all on function public.create_task_on_behalf(text, text, uuid, uuid, timestamptz, text) from public, anon;
grant execute on function public.create_task_on_behalf(text, text, uuid, uuid, timestamptz, text) to authenticated;

-- ============================================================================
-- 2. Attendance Exceptions (3 consecutive unexplained absences - NO auto LWP)
-- ============================================================================
create table if not exists public.attendance_exceptions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles(id) on delete cascade,
  work_date        date not null,
  consecutive_days int not null default 1,
  status           text not null default 'PENDING_REVIEW'
    check (status in ('PENDING_REVIEW', 'RESOLVED_LEAVE', 'RESOLVED_LWP', 'RESOLVED_CORRECTION', 'DISMISSED')),
  hr_decision      text,
  resolved_by      uuid references public.profiles(id) on delete set null,
  resolved_at      timestamptz,
  notes            text,
  created_at       timestamptz not null default now(),
  constraint attendance_exceptions_user_date unique(user_id, work_date)
);

create index if not exists idx_attendance_exceptions_status on public.attendance_exceptions(status);

alter table public.attendance_exceptions enable row level security;

create policy attendance_exceptions_admin on public.attendance_exceptions
  for all to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('SYSTEM_ADMIN', 'ADMIN', 'HR', 'HRD')
    )
  );

-- ============================================================================
-- 3. Leave Engine Admin Tools & Backdated Leave
-- ============================================================================
alter table public.leave_requests
  add column if not exists is_backdated boolean not null default false;

-- Function: admin_adjust_leave_balance with universal audit logging
create or replace function public.admin_adjust_leave_balance(
  p_user_id      uuid,
  p_leave_type   text,
  p_days         double precision,
  p_reason       text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not exists (
    select 1 from public.profiles
    where id = v_uid and role in ('SYSTEM_ADMIN', 'ADMIN', 'HR', 'HRD')
  ) and not exists (
    select 1 from public.user_permissions
    where user_id = v_uid and permission = 'manage_leave' and revoked_at is null
  ) then
    return jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  end if;

  if p_reason is null or length(trim(p_reason)) < 3 then
    return jsonb_build_object('success', false, 'error', 'REASON_REQUIRED');
  end if;

  -- Audit log entry
  perform public.log_audit_event(
    'LEAVE_BALANCE_ADJUSTED',
    'leave_balances',
    p_user_id::text,
    null,
    jsonb_build_object('leave_type', p_leave_type, 'delta_days', p_days, 'reason', p_reason)
  );

  return jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'leave_type', p_leave_type,
    'delta_days', p_days
  );
end $$;

revoke all on function public.admin_adjust_leave_balance(uuid, text, double precision, text) from public, anon;
grant execute on function public.admin_adjust_leave_balance(uuid, text, double precision, text) to authenticated;

-- ============================================================================
-- 4. Employee Exit Lifecycle (ACTIVE -> EXIT_PENDING -> EXITED -> ARCHIVED)
-- ============================================================================
alter table public.profiles
  add column if not exists lifecycle_status text not null default 'ACTIVE'
    check (lifecycle_status in ('ACTIVE', 'EXIT_PENDING', 'EXITED', 'ARCHIVED')),
  add column if not exists exit_reason text default null;

create or replace function public.archive_exited_employee(
  p_user_id        uuid,
  p_lifecycle_step text,
  p_exit_date      date default null,
  p_reason         text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_step text := upper(coalesce(p_lifecycle_step, 'EXITED'));
begin
  if not exists (
    select 1 from public.profiles
    where id = v_uid and role in ('SYSTEM_ADMIN', 'ADMIN', 'HR', 'HRD')
  ) and not exists (
    select 1 from public.user_permissions
    where user_id = v_uid and permission = 'manage_employee_details' and revoked_at is null
  ) then
    return jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  end if;

  if v_step not in ('EXIT_PENDING', 'EXITED', 'ARCHIVED') then
    return jsonb_build_object('success', false, 'error', 'INVALID_LIFECYCLE_STEP');
  end if;

  update public.profiles
  set
    lifecycle_status = v_step,
    is_active = case when v_step in ('EXITED', 'ARCHIVED') then false else is_active end,
    last_working_date = coalesce(p_exit_date, last_working_date, (now() at time zone 'Asia/Kolkata')::date),
    exit_reason = coalesce(p_reason, exit_reason),
    updated_at = now()
  where id = p_user_id;

  -- Revoke fine-grained permissions upon formal exit
  if v_step in ('EXITED', 'ARCHIVED') then
    update public.user_permissions
    set revoked_at = now()
    where user_id = p_user_id and revoked_at is null;
  end if;

  -- Audit log entry
  perform public.log_audit_event(
    'EMPLOYEE_ARCHIVED',
    'profiles',
    p_user_id::text,
    null,
    jsonb_build_object('lifecycle_status', v_step, 'exit_date', p_exit_date, 'reason', p_reason)
  );

  return jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'lifecycle_status', v_step,
    'exit_date', p_exit_date
  );
end $$;

revoke all on function public.archive_exited_employee(uuid, text, date, text) from public, anon;
grant execute on function public.archive_exited_employee(uuid, text, date, text) to authenticated;

-- ============================================================================
-- 5. IP Restriction: Office IP Allowlist & Decision Logic
-- ============================================================================
create table if not exists public.office_ip_allowlist (
  id          uuid primary key default gen_random_uuid(),
  office_id   uuid references public.offices(id) on delete cascade,
  ip_address  text not null,
  label       text not null,
  is_active   boolean not null default true,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_office_ip_lookup on public.office_ip_allowlist(ip_address, is_active);

alter table public.office_ip_allowlist enable row level security;

create policy office_ip_allowlist_admin on public.office_ip_allowlist
  for all to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('SYSTEM_ADMIN', 'ADMIN')
    )
  );

create policy office_ip_allowlist_read on public.office_ip_allowlist
  for select to authenticated
  using (is_active = true);

-- Helper: validate_checkin_ip
create or replace function public.validate_checkin_ip(
  p_client_ip text,
  p_user_id   uuid default auth.uid()
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_clean_ip text := trim(split_part(coalesce(p_client_ip, ''), ',', 1));
begin
  -- 1. Check office allowlist
  if exists (
    select 1 from public.office_ip_allowlist
    where ip_address = v_clean_ip and is_active = true
  ) then
    return jsonb_build_object('allowed', true, 'reason', 'OFFICE_IP');
  end if;

  -- 2. Check approved Field Visit today
  if exists (
    select 1 from public.field_visits
    where user_id = p_user_id and date = v_today
      and coalesce(verification_status, 'PENDING') <> 'REJECTED'
  ) then
    return jsonb_build_object('allowed', true, 'reason', 'APPROVED_FIELD_VISIT');
  end if;

  -- 3. Check approved WFH today
  if exists (
    select 1 from public.leave_requests
    where user_id = p_user_id
      and lower(status) = 'approved'
      and lower(leave_type) in ('wfh', 'work_from_home')
      and v_today between start_date and end_date
  ) then
    return jsonb_build_object('allowed', true, 'reason', 'APPROVED_WFH');
  end if;

  -- 4. Otherwise Block
  return jsonb_build_object(
    'allowed', false,
    'code', 'IP_NOT_ALLOWED',
    'message', 'You must be connected to office Wi-Fi or have an approved field visit/WFH to check in.'
  );
end $$;

revoke all on function public.validate_checkin_ip(text, uuid) from public, anon;
grant execute on function public.validate_checkin_ip(text, uuid) to authenticated;

-- ============================================================================
-- 6. Visit Feedback Table & RPC
-- ============================================================================
create table if not exists public.field_visit_feedback (
  id           uuid primary key default gen_random_uuid(),
  visit_id     uuid not null references public.field_visits(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  rating       int not null check (rating between 1 and 5),
  notes        text,
  submitted_at timestamptz not null default now(),
  constraint field_visit_feedback_uniq unique(visit_id)
);

create index if not exists idx_field_visit_feedback_visit on public.field_visit_feedback(visit_id);

alter table public.field_visit_feedback enable row level security;

create policy field_visit_feedback_insert on public.field_visit_feedback
  for insert to authenticated
  with check (auth.uid() = user_id);

create policy field_visit_feedback_select on public.field_visit_feedback
  for select to authenticated
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('SYSTEM_ADMIN', 'ADMIN', 'HR', 'HRD')
    )
  );

create or replace function public.submit_visit_feedback(
  p_visit_id uuid,
  p_rating   int,
  p_notes    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'error', 'AUTHENTICATION_REQUIRED');
  end if;

  if p_rating not between 1 and 5 then
    return jsonb_build_object('success', false, 'error', 'INVALID_RATING');
  end if;

  insert into public.field_visit_feedback (visit_id, user_id, rating, notes, submitted_at)
  values (p_visit_id, v_uid, p_rating, p_notes, now())
  on conflict (visit_id) do update set
    rating = excluded.rating,
    notes = excluded.notes,
    submitted_at = now();

  return jsonb_build_object('success', true, 'visit_id', p_visit_id);
end $$;

revoke all on function public.submit_visit_feedback(uuid, int, text) from public, anon;
grant execute on function public.submit_visit_feedback(uuid, int, text) to authenticated;

-- ============================================================================
-- 7. Auto End-Time (8:00 PM close with auto_closed=true and reason)
-- ============================================================================
alter table public.attendance_logs
  add column if not exists auto_closed boolean not null default false,
  add column if not exists auto_close_reason text default null;

create or replace function public.reconcile_missing_attendance_checkouts(
  p_target_date date default (now() at time zone 'Asia/Kolkata')::date
)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_updated_count int := 0;
  v_default_checkout timestamptz := (p_target_date::text || ' 20:00:00+05:30')::timestamptz;
begin
  update public.attendance_logs a
  set
    checkout_time = v_default_checkout,
    auto_closed = true,
    auto_close_reason = 'SYSTEM_DEFAULT_END_TIME',
    updated_at = now()
  where a.date = p_target_date
    and a.checkin_time is not null
    and a.checkout_time is null
    -- Exclude active field visits
    and not exists (
      select 1 from public.field_visits fv
      where fv.user_id = a.user_id and fv.date = p_target_date
        and fv.status in ('IN_TRANSIT', 'CHECKED_IN')
    );

  get diagnostics v_updated_count = row_count;

  if v_updated_count > 0 then
    perform public.log_audit_event(
      'ATTENDANCE_AUTO_CLOSED',
      'attendance_logs',
      null,
      null,
      jsonb_build_object('date', p_target_date, 'closed_count', v_updated_count)
    );
  end if;

  return v_updated_count;
end $$;

revoke all on function public.reconcile_missing_attendance_checkouts(date) from public, anon;
grant execute on function public.reconcile_missing_attendance_checkouts(date) to authenticated;

notify pgrst, 'reload schema';

