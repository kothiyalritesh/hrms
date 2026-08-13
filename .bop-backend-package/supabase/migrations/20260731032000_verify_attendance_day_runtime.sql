-- Deployment-time smoke test for the two authenticated attendance functions.
-- It changes no application data and aborts the release if their runtime
-- record shapes do not match PostgreSQL's declared contracts.
do $$
declare
  v_profile_id uuid;
  v_policy_count integer;
  v_monthly jsonb;
begin
  select profile.id
  into v_profile_id
  from public.profiles profile
  join public.offices office
    on office.id = profile.office_id and office.is_active = true
  where profile.is_active = true
    and exists (
      select 1
      from public.attendance_policies policy
      where policy.office_id = profile.office_id
        and policy.is_active = true
        and lower(coalesce(policy.role, 'all')) in (
          lower(coalesce(profile.role, '')),
          'all'
        )
    )
  order by profile.id
  limit 1;

  if v_profile_id is null then
    raise exception 'ATTENDANCE_RUNTIME_TEST_PROFILE_NOT_FOUND';
  end if;

  perform set_config('request.jwt.claim.sub', v_profile_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', v_profile_id,
      'role', 'authenticated'
    )::text,
    true
  );

  select count(*) into v_policy_count
  from public.get_attendance_policy(v_profile_id);
  if v_policy_count <> 1 then
    raise exception 'ATTENDANCE_POLICY_RUNTIME_SHAPE_INVALID';
  end if;

  v_monthly := public.rpc_get_my_monthly_attendance_v2(
    date_trunc('month', now() at time zone 'Asia/Kolkata')::date
  );
  if not coalesce((v_monthly->>'success')::boolean, false)
     or v_monthly->>'detail_contract' <> 'attendance-day-v2'
     or jsonb_typeof(v_monthly->'records') <> 'array' then
    raise exception 'ATTENDANCE_DAY_RUNTIME_SHAPE_INVALID';
  end if;
end;
$$;
