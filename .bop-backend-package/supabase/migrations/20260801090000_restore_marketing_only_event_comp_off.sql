-- Sunday event comp-off is restricted to verified Marketing employees. Reverse
-- only credits created for non-Marketing attendees by the prior broad rule.

set local statement_timeout = '10min';

update public.events
set comp_off_team = 'MARKETING'
where comp_off_enabled
  and upper(coalesce(comp_off_team, '')) <> 'MARKETING';

alter table public.events
  drop constraint if exists events_comp_off_team_marketing_only_ck;
alter table public.events
  add constraint events_comp_off_team_marketing_only_ck
  check (
    not comp_off_enabled
    or upper(coalesce(comp_off_team, '')) = 'MARKETING'
  );

create temporary table reversed_non_marketing_event_credits
on commit drop
as
select
  credit.event_id,
  credit.user_id,
  credit.days,
  event.title,
  event.created_by
from public.event_comp_off_credits credit
join public.events event on event.id = credit.event_id
join public.profiles profile on profile.id = credit.user_id
where event.comp_off_enabled
  and extract(isodow from event.event_date) = 7
  and not (
    position('MARKETING' in upper(coalesce(profile.department, ''))) > 0
    or position('MARKETING' in upper(coalesce(profile.team, ''))) > 0
    or position('MARKETING' in upper(coalesce(profile.role, ''))) > 0
  );

with totals as (
  select user_id, sum(days) as days
  from reversed_non_marketing_event_credits
  group by user_id
)
update public.leave_balance balance
set comp_off = greatest(0, balance.comp_off - totals.days),
    updated_at = now()
from totals
where balance.user_id = totals.user_id;

do $$
begin
  if to_regclass('public.leave_application_audit') is not null then
    execute $sql$
      insert into public.leave_application_audit(
        user_id, actor_id, action, days, notes
      )
      select
        credit.user_id,
        credit.created_by,
        'EVENT_COMP_OFF_REVERSED',
        credit.days,
        'Corrected to Marketing-only Sunday event policy: ' || credit.title
      from reversed_non_marketing_event_credits credit
    $sql$;
  end if;
end;
$$;

update public.notifications notification
set title = 'Comp-Off Correction',
    message = 'The event comp-off was reversed because Sunday event comp-off ' ||
      'is available only to the Marketing team.',
    type = 'comp_off_reversed'
from reversed_non_marketing_event_credits credit
where notification.user_id = credit.user_id
  and notification.type = 'comp_off_credited'
  and notification.message like '%' || credit.title || '%';

delete from public.event_comp_off_credits credit
using reversed_non_marketing_event_credits reversed
where credit.event_id = reversed.event_id
  and credit.user_id = reversed.user_id;

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

  select * into v_event from public.events where id = p_event_id;
  select * into v_profile from public.profiles where id = p_user_id;
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
     or upper(coalesce(v_event.comp_off_team, '')) <> 'MARKETING'
     or not exists (
       select 1 from public.event_checkins checkin
       where checkin.event_id = v_event.id
         and checkin.user_id = v_profile.id
     )
     or not (
       position('MARKETING' in upper(coalesce(v_profile.department, ''))) > 0
       or position('MARKETING' in upper(coalesce(v_profile.team, ''))) > 0
       or position('MARKETING' in upper(coalesce(v_profile.role, ''))) > 0
     ) then
    return jsonb_build_object(
      'success', true,
      'eligible', false,
      'credited', false,
      'message', 'Sunday event comp-off is restricted to the Marketing team.'
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
        'Sunday Marketing event attendance: ' || v_event.title;
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
      when v_credited then 'Sunday Marketing event comp-off credited.'
      else 'Sunday Marketing event comp-off was already credited.'
    end
  );
end;
$$;

revoke all on function public.grant_sunday_event_comp_off(uuid, uuid)
  from public, anon, authenticated;

create or replace function public.rpc_get_release_contract()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'success', true,
    'backend_schema_version', '20260801090000',
    'minimum_frontend_version', '1.1.0',
    'attendance_checkin_rpc', 'rpc_attendance_checkin_v3',
    'attendance_history_rpc', 'rpc_get_my_monthly_attendance_v3',
    'attendance_day_detail_contract', 'attendance-day-v6',
    'attendance_checkin_precedence', 'BIOMETRIC_FIRST_PUNCH',
    'attendance_checkout_precedence', 'HRMS_THEN_IST_ROLLOVER',
    'sunday_event_comp_off', 'MARKETING_ONLY_IDEMPOTENT',
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
