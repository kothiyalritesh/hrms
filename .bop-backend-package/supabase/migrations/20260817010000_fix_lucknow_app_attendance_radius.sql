-- Lucknow has no physical biometric terminal and uses protected HRMS app
-- attendance. The original setup script intended a 300 m radius, but only
-- attendance_radius was set. The current check-in RPC prioritizes
-- allowed_radius_meters, whose 100 m default therefore remained effective.

do $$
declare
  v_office_id uuid;
begin
  select id into v_office_id
  from public.offices
  where lower(btrim(name)) = 'lucknow office'
  order by created_at
  limit 1;

  if v_office_id is null then
    raise exception 'LUCKNOW_OFFICE_NOT_CONFIGURED';
  end if;

  if not exists (
    select 1
    from public.attendance_policies policy
    where policy.office_id = v_office_id
      and policy.is_active
  ) then
    raise exception 'LUCKNOW_ATTENDANCE_POLICY_NOT_CONFIGURED';
  end if;

  update public.offices
  set attendance_radius = 300,
      allowed_radius_meters = 300,
      is_active = true
  where id = v_office_id;
end
$$;

