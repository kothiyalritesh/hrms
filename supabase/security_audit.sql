-- Run in the Supabase SQL editor after migrations are deployed. Any table with
-- rls_enabled = false or policy_count = 0 requires an explicit release review.
with sensitive_tables(table_name) as (
  values
    ('profiles'),
    ('attendance_logs'),
    ('location_tracking'),
    ('attendance_fraud_events'),
    ('attendance_audit_logs'),
    ('smartoffice_device_logs'),
    ('leave_balance'),
    ('roles'),
    ('offices'),
    ('attendance_policies'),
    ('field_visits'),
    ('field_visit_location_audit'),
    ('notifications'),
    ('tracking_sessions'),
    ('journey_events'),
    ('transit_warnings')
)
select
  target.table_name,
  coalesce(class.relrowsecurity, false) as rls_enabled,
  count(policy.policyname) as policy_count,
  coalesce(
    string_agg(
      distinct concat(policy.cmd, ':', policy.policyname),
      ', ' order by concat(policy.cmd, ':', policy.policyname)
    ),
    ''
  ) as policies
from sensitive_tables target
left join pg_class class
  on class.oid = to_regclass('public.' || target.table_name)
left join pg_policies policy
  on policy.schemaname = 'public'
 and policy.tablename = target.table_name
group by target.table_name, class.relrowsecurity
order by target.table_name;

-- Anonymous users must have no direct table privileges on HRMS data.
select table_schema, table_name, privilege_type
from information_schema.role_table_grants
where grantee = 'anon'
  and table_schema in ('public', 'storage')
order by table_schema, table_name, privilege_type;

-- Review all authenticated executable functions and confirm each one performs
-- its documented role/ownership check.
select routine_schema, routine_name, privilege_type
from information_schema.role_routine_grants
where grantee = 'authenticated'
  and routine_schema = 'public'
order by routine_name;

-- These checks must return the expected booleans after the release migration.
-- The raw v2 implementation is intentionally private; authenticated clients
-- can call only the identity-confirming v3 wrapper.
select
  has_function_privilege(
    'authenticated',
    'public.submit_field_visit_current_location_v2(uuid,uuid,uuid,double precision,double precision,double precision,timestamp with time zone,text,boolean,text,text,text,text,integer,text,text,text,timestamp with time zone,text,text,text,text,text,boolean,text)',
    'EXECUTE'
  ) as authenticated_can_execute_evidence_v2,
  has_function_privilege(
    'authenticated',
    'public.submit_field_visit_current_location_v3(uuid,uuid,uuid,double precision,double precision,double precision,timestamp with time zone,text,boolean,text,text,text,text,integer,text,text,text,timestamp with time zone,text,text,text,text,text,boolean,text)',
    'EXECUTE'
  ) as authenticated_can_execute_evidence_v3;

-- Expected: v2 = false, v3 = true, bucket public = false.
select id, public
from storage.buckets
where id in ('field-visit-evidence', 'profile-pics');

-- Evidence objects must have no anonymous policies and authenticated access
-- must remain ownership/reviewer scoped.
select policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and (
    coalesce(qual, '') ilike '%field-visit-evidence%'
    or coalesce(with_check, '') ilike '%field-visit-evidence%'
    or coalesce(qual, '') ilike '%profile-pics%'
    or coalesce(with_check, '') ilike '%profile-pics%'
  )
order by policyname;
