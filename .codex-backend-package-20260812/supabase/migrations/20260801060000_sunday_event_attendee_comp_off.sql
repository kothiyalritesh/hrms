-- Sunday event comp-off follows verified attendance, not the employee's role.
-- A unique event/user credit makes retries and backfills idempotent.

create or replace function public.grant_sunday_event_comp_off(
  p_event_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event public.events%rowtype;
  v_profile public.profiles%rowtype;
  v_credited boolean := false;
  v_rows integer := 0;
begin
  if p_event_id is null or p_user_id is null then
    raise exception 'EVENT_AND_EMPLOYEE_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_event_id::text || ':' || p_user_id::text, 0)
  );

  select * into v_event
  from public.events event
  where event.id = p_event_id;
  select * into v_profile
  from public.profiles profile
  where profile.id = p_user_id;

  if v_event.id is null or v_profile.id is null then
    return jsonb_build_object(
      'success', false,
      'eligible', false,
      'credited', false,
      'message', 'Event or employee was not found.'
    );
  end if;

  if not v_event.comp_off_enabled
     or extract(isodow from v_event.event_date) <> 7
     or not exists (
       select 1
       from public.event_checkins checkin
       where checkin.event_id = v_event.id
         and checkin.user_id = v_profile.id
     )
     or not (
       upper(coalesce(v_event.comp_off_team, '')) in
         ('ALL', 'ALL_ATTENDEES', '*')
       or position(
         upper(v_event.comp_off_team)
         in upper(coalesce(v_profile.department, ''))
       ) > 0
       or position(
         upper(v_event.comp_off_team)
         in upper(coalesce(v_profile.team, ''))
       ) > 0
       or position(
         upper(v_event.comp_off_team)
         in upper(coalesce(v_profile.role, ''))
       ) > 0
     ) then
    return jsonb_build_object(
      'success', true,
      'eligible', false,
      'credited', false,
      'message', 'This event attendance is not eligible for comp-off.'
    );
  end if;

  insert into public.event_comp_off_credits(event_id, user_id, days)
  values(v_event.id, v_profile.id, v_event.comp_off_days)
  on conflict(event_id, user_id) do nothing;
  get diagnostics v_rows = row_count;
  v_credited := v_rows > 0;

  if v_credited then
    insert into public.leave_balance(user_id, comp_off)
    values(v_profile.id, v_event.comp_off_days)
    on conflict(user_id) do update
    set comp_off = public.leave_balance.comp_off + excluded.comp_off,
        updated_at = now();

    if to_regclass('public.leave_application_audit') is not null then
      execute
        'insert into public.leave_application_audit(
           user_id, actor_id, action, days, notes
         ) values($1, $2, $3, $4, $5)'
      using
        v_profile.id,
        v_event.created_by,
        'EVENT_COMP_OFF_GRANTED',
        v_event.comp_off_days,
        'Sunday event attendance: ' || v_event.title;
    end if;

    insert into public.notifications(user_id, title, message, type)
    values(
      v_profile.id,
      'Comp-Off Credited',
      v_event.comp_off_days || ' comp-off credited for attending ' ||
        v_event.title || '.',
      'comp_off_credited'
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'eligible', true,
    'credited', v_credited,
    'already_credited', not v_credited,
    'days', v_event.comp_off_days,
    'message', case
      when v_credited then 'Sunday event comp-off credited.'
      else 'Sunday event comp-off was already credited.'
    end
  );
end;
$$;

revoke all on function public.grant_sunday_event_comp_off(uuid, uuid)
  from public, anon, authenticated;

create or replace function public.rpc_event_check_in(
  p_event_id uuid,
  p_user_id uuid,
  p_latitude double precision,
  p_longitude double precision
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event public.events%rowtype;
  v_profile public.profiles%rowtype;
  v_requester uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_distance integer;
  v_checked_now boolean := false;
  v_comp_off_result jsonb;
  v_comp_off_credited boolean := false;
  v_comp_off_eligible boolean := false;
  v_rows integer := 0;
begin
  if v_requester is null or v_requester <> p_user_id then
    return jsonb_build_object(
      'success', false,
      'message', 'You can only check yourself into an event.'
    );
  end if;

  if p_latitude is null or p_longitude is null
     or p_latitude not between -90 and 90
     or p_longitude not between -180 and 180
     or (p_latitude = 0 and p_longitude = 0) then
    return jsonb_build_object(
      'success', false,
      'message', 'A valid GPS location is required for event check-in.'
    );
  end if;

  select * into v_event from public.events where id = p_event_id;
  if not found then
    return jsonb_build_object('success', false, 'message', 'Event not found.');
  end if;

  select * into v_profile
  from public.profiles
  where id = p_user_id and coalesce(is_active, true) = true;
  if not found then
    return jsonb_build_object(
      'success', false,
      'message', 'Active employee profile not found.'
    );
  end if;

  if v_event.event_date <> v_today then
    return jsonb_build_object(
      'success', false,
      'message', case
        when v_event.event_date > v_today
          then 'Event check-in will open on ' ||
            to_char(v_event.event_date, 'DD Mon YYYY') || '.'
        else 'This event has already ended.'
      end
    );
  end if;

  v_distance := round(public.event_distance_metres(
    v_event.latitude,
    v_event.longitude,
    p_latitude,
    p_longitude
  ));
  if v_distance > v_event.checkin_radius_m then
    return jsonb_build_object(
      'success', false,
      'distance_metres', v_distance,
      'message', 'You are ' || v_distance ||
        'm from the event. Move within ' || v_event.checkin_radius_m ||
        'm of the venue and try again.'
    );
  end if;

  insert into public.event_checkins(
    event_id, user_id, checkin_location, distance_metres
  ) values (
    v_event.id,
    v_profile.id,
    jsonb_build_object('latitude', p_latitude, 'longitude', p_longitude),
    v_distance
  )
  on conflict(event_id, user_id) do nothing;
  get diagnostics v_rows = row_count;
  v_checked_now := v_rows > 0;

  v_comp_off_result := public.grant_sunday_event_comp_off(
    v_event.id,
    v_profile.id
  );
  v_comp_off_credited :=
    coalesce((v_comp_off_result->>'credited')::boolean, false);
  v_comp_off_eligible :=
    coalesce((v_comp_off_result->>'eligible')::boolean, false);

  return jsonb_build_object(
    'success', true,
    'already_checked_in', not v_checked_now,
    'distance_metres', v_distance,
    'comp_off_credited', v_comp_off_credited,
    'comp_off_eligible', v_comp_off_eligible,
    'message', case
      when v_comp_off_credited
        then 'Event check-in completed and comp-off credited.'
      when not v_checked_now and v_comp_off_eligible
        then 'You are already checked in and your comp-off is available.'
      when not v_checked_now then 'You are already checked in to this event.'
      else 'Event check-in completed.'
    end
  );
exception when others then
  return jsonb_build_object(
    'success', false,
    'message', 'Event check-in failed: ' || sqlerrm
  );
end;
$$;

revoke all on function public.rpc_event_check_in(
  uuid, uuid, double precision, double precision
) from public, anon;
grant execute on function public.rpc_event_check_in(
  uuid, uuid, double precision, double precision
) to authenticated;

-- Event attendance mutations must go through the protected RPCs. Reads remain
-- available to the existing employee/admin screens.
revoke insert, update, delete on public.event_checkins
  from anon, authenticated;
grant select on public.event_checkins to authenticated;

-- The 26 July event was attended across roles, so its enabled comp-off applies
-- to every verified attendee rather than only employees labelled Marketing.
update public.events
set comp_off_team = 'ALL_ATTENDEES'
where id = 'f6c29d23-9a08-4cd1-81d4-9748913d0072'
  and event_date = date '2026-07-26'
  and comp_off_enabled;

do $$
declare
  v_attendee record;
begin
  for v_attendee in
    select checkin.event_id, checkin.user_id
    from public.event_checkins checkin
    join public.events event on event.id = checkin.event_id
    where event.comp_off_enabled
      and extract(isodow from event.event_date) = 7
  loop
    perform public.grant_sunday_event_comp_off(
      v_attendee.event_id,
      v_attendee.user_id
    );
  end loop;
end;
$$;

create or replace function public.rpc_get_release_contract()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'success', true,
    'backend_schema_version', '20260801060000',
    'minimum_frontend_version', '1.1.0',
    'attendance_checkin_rpc', 'rpc_attendance_checkin_v3',
    'attendance_history_rpc', 'rpc_get_my_monthly_attendance_v2',
    'attendance_day_detail_contract', 'attendance-day-v4',
    'attendance_checkin_precedence', 'BIOMETRIC_FIRST_PUNCH',
    'attendance_checkout_precedence', 'HRMS_THEN_IST_ROLLOVER',
    'sunday_event_comp_off', 'VERIFIED_ATTENDEE_IDEMPOTENT',
    'attendance_regularization_list_rpc',
      'rpc_admin_list_attendance_regularization',
    'attendance_late_cutoff', '10:32:00',
    'attendance_late_boundary', 'INCLUSIVE',
    'biometric_import_rpc', 'apply_biometric_import_batch_v3',
    'biometric_sync_rpc', 'apply_biometric_import_batch_v4',
    'biometric_cron_auth', 'PROJECT_PUBLISHABLE_KEY',
    'smartoffice_config', 'DATABASE_VAULT_SERVICE_ROLE',
    'field_visit_evidence_rpc', 'submit_field_visit_current_location_v3',
    'admin_dashboard_rpc', 'rpc_admin_dashboard_summary',
    'authenticated_profile_rpc', 'rpc_get_my_profile_v2',
    'historical_report_rpc', 'rpc_admin_attendance_reconciliation',
    'edge_function_versions', jsonb_build_object(
      'biometric-attendance-sync', '20260801.1',
      'otp-auth', '20260731.1',
      'field-visit-evidence-upload', '20260731.2',
      'smartoffice-proxy', '20260801.1'
    )
  );
$$;

revoke all on function public.rpc_get_release_contract() from public;
grant execute on function public.rpc_get_release_contract()
  to anon, authenticated, service_role;

notify pgrst, 'reload schema';
