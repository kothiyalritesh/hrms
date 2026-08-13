-- The field-visit mutation RPC has always accepted an optional journey origin,
-- but origin_lat/origin_lon/origin_name existed only in a one-off setup script,
-- not in the ordered migration chain. Projects created or repaired from the
-- migrations could therefore have the current RPC without its required table
-- columns, causing every CREATE action to fail at the INSERT statement.

begin;

do $$
begin
  if to_regclass('public.field_visits') is null then
    raise exception 'FIELD_VISITS_TABLE_REQUIRED';
  end if;
end $$;

alter table public.field_visits
  add column if not exists origin_lat double precision,
  add column if not exists origin_lon double precision,
  add column if not exists origin_name text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.field_visits'::regclass
      and conname = 'field_visits_origin_lat_ck'
  ) then
    alter table public.field_visits
      add constraint field_visits_origin_lat_ck
      check (origin_lat is null or origin_lat between -90 and 90) not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.field_visits'::regclass
      and conname = 'field_visits_origin_lon_ck'
  ) then
    alter table public.field_visits
      add constraint field_visits_origin_lon_ck
      check (origin_lon is null or origin_lon between -180 and 180) not valid;
  end if;
end $$;

alter table public.field_visits validate constraint field_visits_origin_lat_ck;
alter table public.field_visits validate constraint field_visits_origin_lon_ck;

create or replace function public.rpc_get_release_contract()
returns jsonb language sql stable security definer set search_path=public,pg_temp
as $$
  select jsonb_build_object(
    'success',true,
    'backend_schema_version','20260805000000',
    'minimum_frontend_version','1.1.0',
    'attendance_checkin_rpc','rpc_attendance_checkin_v3',
    'attendance_checkout_rpc','rpc_attendance_checkout_reconciled',
    'attendance_state_contract','NOT_CHECKED_IN|WORKING|ON_FIELD_VISIT|CHECKED_OUT',
    'attendance_checkout_precedence','GOING_HOME_SERVER_CONFIRMED',
    'biometric_checkin_policy','FIRST_VALID_PUNCH_NO_AUTOMATIC_CHECKOUT',
    'biometric_ingest_rpc','ingest_biometric_punches',
    'field_visit_mutation_rpc','rpc_mutate_own_field_visit',
    'field_visit_origin_contract','origin_lat|origin_lon|origin_name',
    'device_session_rpc','rpc_register_device_session',
    'edge_function_versions',jsonb_build_object(
      'biometric-attendance-sync','20260803.1',
      'otp-auth','20260731.1',
      'field-visit-evidence-upload','20260731.2',
      'smartoffice-proxy','20260801.1',
      'biometric-punch-webhook','20260803.1'
    )
  );
$$;

revoke all on function public.rpc_get_release_contract() from public;
grant execute on function public.rpc_get_release_contract()
  to anon,authenticated,service_role;

notify pgrst, 'reload schema';

commit;
