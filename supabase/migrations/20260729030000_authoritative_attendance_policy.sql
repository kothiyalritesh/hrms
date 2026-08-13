-- One fail-closed attendance policy source for actions, reminders and UI.

alter table public.attendance_policies
  add column if not exists late_checkin_time time not null default '10:30';

drop function if exists public.get_attendance_policy(uuid);
create function public.get_attendance_policy(p_user_id uuid)
returns table(
  min_work_duration_minutes integer,
  earliest_checkout_time text,
  auto_close_time text,
  allow_night_shift boolean,
  require_early_checkout_reason boolean,
  undo_checkout_minutes integer,
  office_id uuid,
  office_name text,
  late_checkin_time text,
  checkin_reminder_time text,
  checkout_reminder_time text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  if p_user_id <> v_actor and not exists (
    select 1 from public.profiles target
    where target.id = p_user_id
      and target.is_active = true
      and (
        target.reports_to = v_actor
        or exists (
          select 1 from public.profiles actor
          where actor.id = v_actor and actor.is_active = true
            and upper(coalesce(actor.role, '')) in
              ('SYSTEM_ADMIN', 'SUPER_ADMIN', 'ADMIN', 'HR', 'HRD')
        )
      )
  ) then
    raise exception 'POLICY_ACCESS_DENIED';
  end if;

  return query
  select
    ap.min_work_duration_minutes,
    ap.earliest_checkout_time,
    ap.auto_close_time,
    ap.allow_night_shift,
    ap.require_early_checkout_reason,
    ap.undo_checkout_minutes,
    o.id,
    o.name,
    to_char(ap.late_checkin_time, 'HH24:MI'),
    to_char(ap.checkin_reminder_time, 'HH24:MI'),
    to_char(ap.checkout_reminder_time, 'HH24:MI')
  from public.profiles p
  join public.offices o on o.id = p.office_id and o.is_active = true
  join public.attendance_policies ap
    on ap.office_id = p.office_id
   and ap.role = 'all'
   and ap.is_active = true
  where p.id = p_user_id and p.is_active = true
  limit 1;
end;
$$;

revoke all on function public.get_attendance_policy(uuid) from public, anon;
grant execute on function public.get_attendance_policy(uuid) to authenticated;

create or replace function public.get_attendance_reminder_schedule()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when policy.office_id is null then null else jsonb_build_object(
    'checkin_time', policy.checkin_reminder_time,
    'checkout_time', policy.checkout_reminder_time,
    'late_checkin_time', policy.late_checkin_time,
    'earliest_checkout_time', policy.earliest_checkout_time,
    'auto_close_time', policy.auto_close_time,
    'min_work_duration_minutes', policy.min_work_duration_minutes,
    'timezone', 'Asia/Kolkata',
    'office_id', policy.office_id
  ) end
  from public.get_attendance_policy(auth.uid()) policy
$$;

revoke all on function public.get_attendance_reminder_schedule()
  from public, anon;
grant execute on function public.get_attendance_reminder_schedule()
  to authenticated;
