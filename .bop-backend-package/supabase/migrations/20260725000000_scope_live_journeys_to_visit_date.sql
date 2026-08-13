-- Prevent a previous-day field visit from being restored as today's live journey.
--
-- Keep the original RPC implementation private and put a date-scoped guard in
-- front of it. This avoids duplicating the journey transition logic while also
-- making the server authoritative for clients that have an old cached visit ID.

alter function public.record_location_ping(
  uuid, uuid, uuid, uuid, double precision, double precision,
  double precision, double precision, double precision, double precision,
  boolean, timestamptz, text, text
) rename to record_location_ping_unscoped_20260725;

revoke all on function public.record_location_ping_unscoped_20260725(
  uuid, uuid, uuid, uuid, double precision, double precision,
  double precision, double precision, double precision, double precision,
  boolean, timestamptz, text, text
) from public, authenticated;

create or replace function public.record_location_ping(
  p_attendance_log_id uuid default null,
  p_tracking_session_id uuid default null,
  p_field_visit_id uuid default null,
  p_client_event_id uuid default null,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_accuracy_m double precision default null,
  p_altitude_m double precision default null,
  p_heading double precision default null,
  p_speed_mps double precision default null,
  p_mocked boolean default false,
  p_recorded_at timestamptz default now(),
  p_provider text default 'expo-location',
  p_client_quality_status text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_effective_field_visit_id uuid;
  v_tracking_date date := (p_recorded_at at time zone 'Asia/Kolkata')::date;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  -- Prefer the visit named by the device, but trust it only when it is an
  -- active visit for the ping's IST calendar date.
  if p_field_visit_id is not null then
    select fv.id into v_effective_field_visit_id
    from public.field_visits fv
    where fv.id = p_field_visit_id
      and fv.user_id = v_uid
      and fv.date = v_tracking_date
      and fv.status in ('PENDING', 'IN_TRANSIT', 'CHECKED_IN')
      and fv.destination_coords is not null;
  end if;

  -- The cached visit may just have completed while another visit is pending.
  -- In that case continue with the next valid visit from the same day.
  if v_effective_field_visit_id is null then
    select fv.id into v_effective_field_visit_id
    from public.field_visits fv
    where fv.user_id = v_uid
      and fv.date = v_tracking_date
      and fv.status in ('PENDING', 'IN_TRANSIT', 'CHECKED_IN')
      and fv.destination_coords is not null
    order by fv.created_at desc
    limit 1;
  end if;

  if v_effective_field_visit_id is null then
    update public.tracking_sessions
    set status = 'STOPPED',
        stopped_at = coalesce(stopped_at, now()),
        stop_reason = 'NO_ACTIVE_FIELD_VISIT_FOR_DATE',
        native_task_active = false,
        updated_at = now()
    where user_id = v_uid
      and status = 'ACTIVE'
      and (
        p_attendance_log_id is null
        or attendance_log_id = p_attendance_log_id
      )
      and (
        p_tracking_session_id is null
        or id = p_tracking_session_id
      );

    return jsonb_build_object(
      'tracking_session_id', p_tracking_session_id,
      'tracking_session_status', 'STOPPED',
      'journey_status', 'NO_DESTINATION',
      'distance_m', null,
      'quality_status', 'RELIABLE',
      'event_generated', null,
      'should_notify_local', false,
      'health_warning', null,
      'duplicate', false
    );
  end if;

  return public.record_location_ping_unscoped_20260725(
    p_attendance_log_id,
    p_tracking_session_id,
    v_effective_field_visit_id,
    p_client_event_id,
    p_latitude,
    p_longitude,
    p_accuracy_m,
    p_altitude_m,
    p_heading,
    p_speed_mps,
    p_mocked,
    p_recorded_at,
    p_provider,
    p_client_quality_status
  );
end $$;

revoke all on function public.record_location_ping(
  uuid, uuid, uuid, uuid, double precision, double precision,
  double precision, double precision, double precision, double precision,
  boolean, timestamptz, text, text
) from public;

grant execute on function public.record_location_ping(
  uuid, uuid, uuid, uuid, double precision, double precision,
  double precision, double precision, double precision, double precision,
  boolean, timestamptz, text, text
) to authenticated;
