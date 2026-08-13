-- Production attendance guardrails:
-- - the authenticated employee can only use their assigned office
-- - the server calculates distance and the effective configured radius
-- - GPS uncertainty is included in the decision
-- - mock/stale/invalid coordinates are rejected

create or replace function public.rpc_attendance_checkin_v2(
  p_office_id uuid,
  p_location jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_office public.offices%rowtype;
  v_assigned_office_id uuid;
  v_lat double precision;
  v_lon double precision;
  v_accuracy double precision;
  v_radius double precision;
  v_distance double precision;
  v_captured_at timestamptz;
begin
  if v_uid is null then
    return jsonb_build_object(
      'success', false, 'error', 'AUTHENTICATION_REQUIRED',
      'message', 'A valid session is required.'
    );
  end if;

  select office_id into v_assigned_office_id
  from public.profiles
  where id = v_uid and is_active = true;
  if v_assigned_office_id is null or v_assigned_office_id <> p_office_id then
    return jsonb_build_object(
      'success', false, 'error', 'OFFICE_NOT_ASSIGNED',
      'message', 'Attendance can only be marked for your assigned office.'
    );
  end if;

  select * into v_office
  from public.offices
  where id = v_assigned_office_id and coalesce(is_active, true);
  if not found or v_office.latitude is null or v_office.longitude is null then
    return jsonb_build_object(
      'success', false, 'error', 'OFFICE_LOCATION_UNAVAILABLE',
      'message', 'Your assigned office location is unavailable.'
    );
  end if;

  begin
    v_lat := (p_location->>'latitude')::double precision;
    v_lon := (p_location->>'longitude')::double precision;
    v_accuracy := greatest(0, (p_location->>'accuracy')::double precision);
    v_captured_at := coalesce(
      (p_location->>'capturedAt')::timestamptz,
      (p_location->>'captured_at')::timestamptz,
      now()
    );
  exception when others then
    return jsonb_build_object(
      'success', false, 'error', 'INVALID_GPS',
      'message', 'A valid precise GPS reading is required.'
    );
  end;

  if v_lat = 0 or v_lon = 0 or
     v_lat not between -90 and 90 or v_lon not between -180 and 180 or
     v_accuracy > 100 or
     lower(coalesce(p_location->>'mocked', 'false')) = 'true' or
     v_captured_at < now() - interval '60 seconds' or
     v_captured_at > now() + interval '10 seconds' then
    return jsonb_build_object(
      'success', false, 'error', 'GPS_NOT_TRUSTED',
      'message', 'The GPS reading is inaccurate, stale, invalid, or mocked.'
    );
  end if;

  v_radius := greatest(
    10,
    least(
      1000,
      coalesce(v_office.allowed_radius_meters, v_office.attendance_radius, 100)
    )
  );
  v_distance := public.field_visit_distance_metres(
    v_office.latitude, v_office.longitude, v_lat, v_lon
  );
  if v_distance + v_accuracy > v_radius then
    return jsonb_build_object(
      'success', false, 'error', 'OUTSIDE_OFFICE_RADIUS',
      'message', format(
        'Your verified distance (%s m including GPS uncertainty) exceeds the %s m office radius.',
        ceil(v_distance + v_accuracy), ceil(v_radius)
      ),
      'distance_metres', v_distance,
      'accuracy_metres', v_accuracy,
      'allowed_radius_metres', v_radius
    );
  end if;

  return public.rpc_attendance_checkin(
    v_uid, v_assigned_office_id, p_location, v_distance, 'APP'
  );
end;
$$;

revoke all on function public.rpc_attendance_checkin_v2(uuid, jsonb)
  from public;
grant execute on function public.rpc_attendance_checkin_v2(uuid, jsonb)
  to authenticated;

create or replace function public.get_business_clock()
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'now', now(),
    'date', (now() at time zone 'Asia/Kolkata')::date,
    'timezone', 'Asia/Kolkata'
  )
  where auth.uid() is not null
$$;

revoke all on function public.get_business_clock() from public;
grant execute on function public.get_business_clock() to authenticated;

alter table public.attendance_policies
  add column if not exists checkin_reminder_time time not null default '10:30',
  add column if not exists checkout_reminder_time time not null default '18:30';

create or replace function public.get_attendance_reminder_schedule()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_schedule jsonb;
begin
  if v_uid is null then return null; end if;
  select jsonb_build_object(
    'checkin_time', to_char(ap.checkin_reminder_time, 'HH24:MI'),
    'checkout_time', to_char(ap.checkout_reminder_time, 'HH24:MI'),
    'timezone', 'Asia/Kolkata',
    'policy_id', ap.id
  ) into v_schedule
  from public.profiles p
  join public.attendance_policies ap
    on ap.office_id = p.office_id
   and ap.role = 'all'
   and ap.is_active = true
  where p.id = v_uid and p.is_active = true
  limit 1;
  return v_schedule;
end;
$$;

revoke all on function public.get_attendance_reminder_schedule() from public;
grant execute on function public.get_attendance_reminder_schedule()
  to authenticated;

-- Existing deployments may already have the old mandatory-photo function.
-- Patch that exact deployed definition while preserving all its validation.
alter table public.field_visits
  drop constraint if exists field_visits_marked_photo_required_ck;

do $$
declare
  v_signature regprocedure := 'public.submit_field_visit_current_location_v2(uuid,uuid,uuid,double precision,double precision,double precision,timestamp with time zone,text,boolean,text,text,text,text,integer,text,text,text,timestamp with time zone,text,text,text,text,text,boolean,text)'::regprocedure;
  v_definition text;
begin
  select pg_get_functiondef(v_signature) into v_definition;
  v_definition := replace(
    v_definition,
    'if not v_photo then raise exception ''PHOTO_EVIDENCE_REQUIRED''; end if;',
    ''
  );
  v_definition := replace(
    v_definition,
    'if p_evidence_photo_source not in (''CAMERA'', ''GALLERY'') or',
    'if v_photo and (p_evidence_photo_source not in (''CAMERA'', ''GALLERY'') or'
  );
  v_definition := replace(
    v_definition,
    'p_visit_id::text
     ) then',
    'p_visit_id::text
     )) then'
  );
  v_definition := replace(
    v_definition,
    'if not exists(
    select 1 from storage.objects',
    'if v_photo and not exists(
    select 1 from storage.objects'
  );
  v_definition := replace(v_definition, 'evidence_photo_added = true,', 'evidence_photo_added = v_photo,');
  v_definition := replace(v_definition, '''photo_added'', true,', '''photo_added'', v_photo,');
  execute v_definition;

  if pg_get_functiondef(v_signature) like '%PHOTO_EVIDENCE_REQUIRED%' then
    raise exception
      'Unable to make current-location photo evidence optional; deployed function body did not match the expected version';
  end if;
end
$$;
