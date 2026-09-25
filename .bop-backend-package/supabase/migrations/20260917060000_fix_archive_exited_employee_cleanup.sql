-- Migration: 20260917060000_fix_archive_exited_employee_cleanup.sql
-- F-025: Add device binding deactivation and open field_visit closure
--        to the archive_exited_employee RPC.

create or replace function public.archive_exited_employee(
  p_user_id   uuid,
  p_exit_date date,
  p_reason    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid               uuid := auth.uid();
  v_closed_visits     int;
  v_deactivated_devices int;
begin
  -- Permission check: caller must be SYSTEM_ADMIN, ADMIN, HR or HRD,
  -- or hold the manage_employee_details fine-grained permission.
  if not exists (
    select 1 from public.profiles
    where id = v_uid and role in ('SYSTEM_ADMIN', 'ADMIN', 'HR', 'HRD')
  ) and not exists (
    select 1 from public.user_permissions
    where user_id = v_uid and permission = 'manage_employee_details'
  ) then
    return jsonb_build_object('success', false, 'error', 'PERMISSION_DENIED');
  end if;

  -- 1. Mark profile as inactive and set last working date
  update public.profiles
  set
    is_active        = false,
    last_working_date = coalesce(p_exit_date, (now() at time zone 'Asia/Kolkata')::date),
    updated_at       = now()
  where id = p_user_id;

  -- 2. Revoke all fine-grained permissions
  delete from public.user_permissions
  where user_id = p_user_id;

  -- 3. Deactivate all trusted device bindings so the employee can no longer
  --    clock in or access the app from any registered device.
  update public.employee_device_bindings
  set
    is_active  = false,
    updated_at = now()
  where user_id = p_user_id
    and is_active = true;

  get diagnostics v_deactivated_devices = row_count;

  -- 4. Close any open field visits (status = 'CHECKED_IN') by force-checking them
  --    out at the employee's exit date / now, whichever is earlier.
  --    This prevents orphan live-tracking records and stale GPS pings.
  update public.field_visits
  set
    status        = 'COMPLETED',
    checkout_time = least(
                      now(),
                      (coalesce(p_exit_date, (now() at time zone 'Asia/Kolkata')::date)
                         + interval '23 hours 59 minutes')
                    ),
    updated_at    = now()
  where user_id = p_user_id
    and status   = 'CHECKED_IN';

  get diagnostics v_closed_visits = row_count;

  -- 5. Also mark any PENDING (not yet started) visits as CANCELLED so they
  --    never show up in live-tracking for this employee.
  update public.field_visits
  set
    status     = 'CANCELLED',
    updated_at = now()
  where user_id = p_user_id
    and status  = 'PENDING';

  return jsonb_build_object(
    'success',              true,
    'user_id',              p_user_id,
    'exit_date',            p_exit_date,
    'deactivated_devices',  v_deactivated_devices,
    'closed_field_visits',  v_closed_visits
  );
end $$;

revoke all on function public.archive_exited_employee(uuid, date, text) from public, anon;
grant execute on function public.archive_exited_employee(uuid, date, text) to authenticated;

