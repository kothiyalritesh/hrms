-- Prevent false absence classification when calendar or source coverage is
-- incomplete. Existing evidence is never rewritten by this migration.

insert into public.holiday_calendar(
  holiday_date, name, office_id, team_id, user_id, is_optional, is_active
)
select date '2026-08-15', 'Independence Day', null, null, null, false, true
where not exists (
  select 1
  from public.holiday_calendar holiday
  where holiday.holiday_date = date '2026-08-15'
    and holiday.office_id is null
    and holiday.team_id is null
    and holiday.user_id is null
);

insert into public.weekly_off_rules(
  user_id, office_id, team_id, weekday, week_of_month,
  is_active, valid_from, valid_to
)
select null, null, null, 0, null, true, date '2020-01-01', null
where not exists (
  select 1
  from public.weekly_off_rules weekly
  where weekly.user_id is null
    and weekly.office_id is null
    and weekly.team_id is null
    and weekly.weekday = 0
    and weekly.week_of_month is null
    and weekly.is_active
    and weekly.valid_from <= date '2026-08-16'
    and coalesce(weekly.valid_to, 'infinity'::date) >= date '2026-08-16'
);

insert into public.hrms_migration_report(
  migration_key, entity_type, entity_id, status, detail
)
values
  (
    '20260817040000', 'CALENDAR_RULE', 'GLOBAL_HOLIDAY_2026-08-15',
    'BACKFILLED',
    jsonb_build_object(
      'kind', 'HOLIDAY', 'date', '2026-08-15',
      'name', 'Independence Day', 'scope', 'GLOBAL'
    )
  ),
  (
    '20260817040000', 'CALENDAR_RULE', 'GLOBAL_WEEKLY_OFF_SUNDAY',
    'BACKFILLED',
    jsonb_build_object(
      'kind', 'WEEKLY_OFF', 'weekday', 0,
      'valid_from', '2020-01-01', 'scope', 'GLOBAL'
    )
  )
on conflict (migration_key, entity_type, entity_id) do update
set status = excluded.status,
    detail = excluded.detail;

create index if not exists smartoffice_device_logs_report_date_idx
  on public.smartoffice_device_logs(log_date_only);
create index if not exists biometric_device_punches_report_date_idx
  on public.biometric_device_punches(attendance_date);

create or replace view public.v_attendance_daily_enterprise_v5
with (security_invoker = true)
as
with enriched as (
  select
    report.*,
    public.resolve_hrms_calendar_day_at_assignment(
      report.user_id,
      report.office_id,
      report.team_id,
      report.work_date
    ) calendar_value,
    (
      nullif(btrim(profile.smartoffice_employee_code), '') is not null
      or exists (
        select 1
        from public.employee_biometric_mappings mapping
        where mapping.user_id = report.user_id
          and mapping.is_active
      )
    ) has_biometric_mapping,
    (
      exists (
        select 1
        from public.smartoffice_device_logs device_log
        where device_log.log_date_only = report.work_date
      )
      or exists (
        select 1
        from public.biometric_device_punches punch
        where punch.attendance_date = report.work_date
      )
    ) biometric_day_covered
  from public.v_attendance_daily_enterprise report
  join public.profiles profile on profile.id = report.user_id
), resolved as (
  select
    enriched.*,
    case
      when not enriched.history_verified then 'CONFIG_REQUIRED'
      when enriched.attendance_status = 'ON_LEAVE' then 'ON_LEAVE'
      when enriched.official_first_in is null
        and enriched.calendar_value->>'kind' = 'HOLIDAY' then 'HOLIDAY'
      when enriched.official_first_in is null
        and enriched.calendar_value->>'kind' = 'WEEKLY_OFF' then 'WEEKLY_OFF'
      when enriched.official_first_in is null
        and not enriched.biometric_day_covered then 'DATA_NOT_SYNCED'
      when enriched.official_first_in is null
        and not enriched.has_biometric_mapping then 'MAPPING_REQUIRED'
      when enriched.official_first_in is null then 'ABSENT'
      when enriched.calendar_value->>'kind' = 'HOLIDAY' then 'WORKED_HOLIDAY'
      when enriched.calendar_value->>'kind' = 'WEEKLY_OFF'
        then 'WORKED_WEEKLY_OFF'
      when enriched.is_late then 'LATE'
      when enriched.has_field_visit then 'FIELD_VISIT'
      else 'PRESENT'
    end resolved_attendance_status
  from enriched
)
select
  resolved.*,
  case
    when resolved.calendar_value->>'kind' in ('HOLIDAY', 'WEEKLY_OFF')
      or resolved.attendance_status = 'ON_LEAVE' then 'NOT_REQUIRED'
    when resolved.biometric_day_covered then 'COMPLETE'
    when resolved.official_first_in is not null then 'PARTIAL_EVIDENCE'
    else 'NOT_SYNCED'
  end source_coverage_status,
  case
    when resolved.configuration_issue is not null
      then resolved.configuration_issue
    when resolved.resolved_attendance_status = 'DATA_NOT_SYNCED'
      then 'ATTENDANCE_SOURCE_NOT_SYNCED'
    when resolved.resolved_attendance_status = 'MAPPING_REQUIRED'
      then 'BIOMETRIC_MAPPING_REQUIRED'
    else null
  end resolution_issue,
  resolved.calendar_value->>'kind' calendar_kind
from resolved;

revoke all on public.v_attendance_daily_enterprise_v5
  from public, anon, authenticated;

create or replace function public.rpc_admin_attendance_report_v5(
  p_start date,
  p_end date,
  p_offset integer default 0,
  p_limit integer default 500,
  p_office_names text[] default null,
  p_team_names text[] default null,
  p_head_names text[] default null,
  p_roles text[] default null,
  p_statuses text[] default null,
  p_sources text[] default null,
  p_search text default null,
  p_exceptions_only boolean default false
) returns setof public.v_attendance_daily_enterprise_v5
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.require_profile_admin();
  if p_start is null
     or p_end is null
     or p_end < p_start
     or p_end > (now() at time zone 'Asia/Kolkata')::date
     or p_end - p_start > 366
     or p_offset < 0
     or p_limit < 1
     or p_limit > 1000 then
    raise exception 'INVALID_ATTENDANCE_REPORT_RANGE';
  end if;

  return query
  select report.*
  from public.v_attendance_daily_enterprise_v5 report
  where report.work_date between p_start and p_end
    and (
      coalesce(cardinality(p_office_names), 0) = 0
      or regexp_replace(lower(btrim(report.office_name)), '\\s+office$', '') = any (
        select regexp_replace(lower(btrim(value)), '\\s+office$', '')
        from unnest(p_office_names) value
      )
    )
    and (
      coalesce(cardinality(p_team_names), 0) = 0
      or regexp_replace(lower(btrim(report.team_name)), '\\s+team$', '') = any (
        select regexp_replace(lower(btrim(value)), '\\s+team$', '')
        from unnest(p_team_names) value
      )
    )
    and (
      coalesce(cardinality(p_head_names), 0) = 0
      or lower(btrim(report.team_head_name)) = any (
        select lower(btrim(value)) from unnest(p_head_names) value
      )
    )
    and (
      coalesce(cardinality(p_roles), 0) = 0
      or replace(upper(btrim(report.role)), '_', ' ') = any (
        select replace(upper(btrim(value)), '_', ' ')
        from unnest(p_roles) value
      )
    )
    and (
      coalesce(cardinality(p_sources), 0) = 0
      or upper(report.presence_source) = any (
        select upper(btrim(value)) from unnest(p_sources) value
      )
    )
    and (
      nullif(btrim(p_search), '') is null
      or report.employee_name ilike '%' || btrim(p_search) || '%'
      or coalesce(report.employee_number, '') ilike '%' || btrim(p_search) || '%'
    )
    and (
      coalesce(cardinality(p_statuses), 0) = 0
      or exists (
        select 1
        from unnest(p_statuses) requested(value)
        where
          upper(btrim(requested.value)) = upper(report.resolved_attendance_status)
          or (
            upper(btrim(requested.value)) = 'LATE'
            and report.is_late
          )
          or (
            upper(btrim(requested.value)) = 'PRESENT'
            and report.official_first_in is not null
          )
          or (
            upper(btrim(requested.value)) = 'NO_CHECKOUT'
            and report.official_first_in is not null
            and report.official_last_out is null
          )
          or (
            upper(btrim(requested.value)) = 'FIELD_VISIT'
            and report.has_field_visit
          )
          or (
            upper(btrim(requested.value)) = 'SUSPICIOUS_GPS'
            and (
              upper(coalesce(report.fraud_severity, '')) = 'SUSPICIOUS'
              or report.tracking_health_reason is not null
              or report.ping_is_stale
            )
          )
      )
    )
    and (
      not p_exceptions_only
      or report.resolved_attendance_status in (
        'ABSENT', 'LATE', 'CONFIG_REQUIRED',
        'DATA_NOT_SYNCED', 'MAPPING_REQUIRED'
      )
      or (
        report.official_first_in is not null
        and report.official_last_out is null
      )
      or upper(coalesce(report.fraud_severity, '')) in ('WARNING', 'SUSPICIOUS')
      or report.tracking_health_reason is not null
    )
  order by report.work_date desc,
    report.employee_number nulls last,
    report.user_id
  offset p_offset limit p_limit;
end
$$;

revoke all on function public.rpc_admin_attendance_report_v5(
  date, date, integer, integer, text[], text[], text[], text[], text[], text[], text, boolean
) from public, anon;
grant execute on function public.rpc_admin_attendance_report_v5(
  date, date, integer, integer, text[], text[], text[], text[], text[], text[], text, boolean
) to authenticated;

create or replace function public.rpc_get_release_contract()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
select jsonb_build_object(
  'backend_schema_version', '20260817040000',
  'attendance_timezone', 'Asia/Kolkata',
  'attendance_context_contract', 'OFFICE|BIOMETRIC|FIELD_VISIT|EVENT',
  'attendance_reporting_contract', 'enterprise-v5|source-complete|effective-dated',
  'event_audience_contract', 'participants_v2|team|department|employee|all',
  'event_comp_off_contract', 'ledger_v2|weekly_off|holiday|extended_duty',
  'notification_contract', 'outbox_v2|live_attendance_state|device_lifecycle'
)
$$;

revoke all on function public.rpc_get_release_contract() from public;
grant execute on function public.rpc_get_release_contract()
  to anon, authenticated, service_role;

notify pgrst, 'reload schema';
