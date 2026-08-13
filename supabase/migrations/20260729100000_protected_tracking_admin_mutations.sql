create or replace function public.rpc_admin_review_fraud_event(
  p_event_id uuid,
  p_notes text default null
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  perform public.require_profile_admin();
  update public.attendance_fraud_events
  set reviewed_at = now(), reviewed_by = auth.uid(),
      review_notes = left(coalesce(nullif(btrim(p_notes), ''), 'Reviewed by admin'), 500)
  where id = p_event_id;
  if not found then raise exception 'FRAUD_EVENT_NOT_FOUND'; end if;
  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.rpc_admin_resolve_location_alert(p_alert_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  perform public.require_profile_admin();
  update public.location_alerts set resolved = true where id = p_alert_id;
  if not found then raise exception 'LOCATION_ALERT_NOT_FOUND'; end if;
  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.rpc_admin_request_location_pings(
  p_target_user_ids uuid[]
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_requests jsonb;
begin
  perform public.require_profile_admin();
  if coalesce(array_length(p_target_user_ids, 1), 0) not between 1 and 500 then
    raise exception 'INVALID_PING_TARGETS';
  end if;
  with inserted as (
    insert into public.location_ping_requests(target_user_id, requested_by, status)
    select distinct target, auth.uid(), 'pending'
    from unnest(p_target_user_ids) target
    join public.profiles profile on profile.id = target and profile.is_active = true
    returning id, target_user_id
  )
  select coalesce(
    jsonb_agg(jsonb_build_object('id', id, 'target_user_id', target_user_id)),
    '[]'::jsonb
  ) into v_requests from inserted;
  return jsonb_build_object('success', true, 'requests', v_requests);
end;
$$;

create or replace function public.rpc_register_device_push_token(
  p_token text,
  p_platform text,
  p_device_id text,
  p_app_version text default null
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  if nullif(btrim(p_token), '') is null
     or p_platform not in ('android', 'ios')
     or nullif(btrim(p_device_id), '') is null then
    raise exception 'INVALID_PUSH_TOKEN';
  end if;
  insert into public.device_push_tokens(
    user_id, token, platform, device_id, app_version, active,
    updated_at, last_used_at
  ) values (
    auth.uid(), p_token, p_platform, p_device_id,
    nullif(btrim(p_app_version), ''), true, now(), now()
  )
  on conflict (user_id, token) do update
  set platform = excluded.platform, device_id = excluded.device_id,
      app_version = excluded.app_version, active = true,
      updated_at = now(), last_used_at = now()
  returning id into v_id;
  return jsonb_build_object('success', true, 'id', v_id);
end;
$$;

revoke all on function public.rpc_admin_review_fraud_event(uuid, text),
  public.rpc_admin_resolve_location_alert(uuid),
  public.rpc_admin_request_location_pings(uuid[]),
  public.rpc_register_device_push_token(text, text, text, text)
  from public, anon;
grant execute on function public.rpc_admin_review_fraud_event(uuid, text),
  public.rpc_admin_resolve_location_alert(uuid),
  public.rpc_admin_request_location_pings(uuid[]),
  public.rpc_register_device_push_token(text, text, text, text)
  to authenticated;

revoke insert, update, delete on table public.attendance_fraud_events,
  public.location_alerts, public.location_ping_requests,
  public.device_push_tokens from anon, authenticated;

notify pgrst, 'reload schema';
