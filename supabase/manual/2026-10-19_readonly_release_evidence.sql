-- =============================================================================
-- RealtyHRM: read-only release evidence (2026-10-19)
--
-- Run in the Supabase SQL Editor of the target project. It is ONE read-only
-- SELECT (the editor shows only the last statement's result) that returns a
-- checklist: section | item | status | detail.
--  * Reads catalog/metadata, counts and timestamps only. No employee data, no
--    names, no tokens. Writes nothing.
--  * status: OK, MISSING, NOT_PATCHED, OFF, CHECK (look at detail), INFO.
-- Save the result (Download CSV) as release evidence. Expected results for
-- this release are in docs/realtyhrm-audit/11_DEPLOYMENT_MANIFEST.md.
-- =============================================================================
WITH
expected_migrations(version) AS (VALUES
  ('20261009100000'), ('20261009110000'), ('20261009120000'), ('20261009130000'),
  ('20261009140000'), ('20261012100000'), ('20261012110000'), ('20261012120000'),
  ('20261012130000'), ('20261012140000'), ('20261014100000'), ('20261014110000'),
  ('20261014120000'), ('20261015120000'), ('20261015130000')
),
migration_log AS (
  SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS available
),
migrations AS (
  SELECT 'migrations'::text AS section, e.version AS item,
         CASE WHEN NOT l.available THEN 'CHECK'
              WHEN (xpath('/row/c/text()', query_to_xml(format(
                     'select count(*) c from supabase_migrations.schema_migrations where version = %L', e.version),
                     false, true, '')))[1]::text::int > 0 THEN 'OK'
              ELSE 'MISSING' END AS status,
         CASE WHEN NOT l.available
              THEN 'No migration log (migrations pasted in the SQL editor are not logged); rely on the object and marker checks below'
              ELSE '' END AS detail
  FROM expected_migrations e CROSS JOIN migration_log l
),
expected_rpcs(name) AS (VALUES
  ('admin_grant_permission'), ('admin_revoke_permission'), ('check_in_field_visit_at_selected_site'),
  ('ensure_tracking_session'), ('explain_access'), ('get_attendance_policy'), ('get_attendance_reminder_schedule'),
  ('get_business_clock'), ('get_effective_permissions'), ('get_my_permissions'), ('get_permission_catalog'),
  ('get_site_visit_observer_data'), ('get_user_permission_grants'), ('has_permission'), ('record_location_ping'),
  ('record_tracking_health_event'), ('reprocess_unmatched_biometric_punches'), ('review_field_visit_current_location'),
  ('rpc_acknowledge_event'), ('rpc_activity_analysis_day'), ('rpc_activity_logs_day'), ('rpc_admin_adjust_leave_balance'),
  ('rpc_admin_apply_hierarchy_import'), ('rpc_admin_attendance_configuration_issues'), ('rpc_admin_correct_attendance'),
  ('rpc_admin_create_event'), ('rpc_admin_dashboard_summary'), ('rpc_admin_delete_event'), ('rpc_admin_event_audience_options'),
  ('rpc_admin_grant_role_permission'), ('rpc_admin_import_employee_profiles_v2'), ('rpc_admin_leave_balance_summary'),
  ('rpc_admin_list_attendance_regularization'), ('rpc_admin_list_employees'), ('rpc_admin_list_role_permissions'),
  ('rpc_admin_mutate_configuration'), ('rpc_admin_request_location_pings'), ('rpc_admin_reset_all_leave_balances'),
  ('rpc_admin_resolve_location_alert'), ('rpc_admin_review_fraud_event'), ('rpc_admin_revoke_role_permission'),
  ('rpc_admin_save_profile'), ('rpc_admin_save_transit_warning'), ('rpc_admin_set_profile_active'),
  ('rpc_admin_sync_smartoffice_profiles_batch'), ('rpc_admin_update_hierarchy_v2'), ('rpc_analyze_attendance_fraud'),
  ('rpc_assign_biometric_employee_code'), ('rpc_assign_biometric_employee_codes_batch'), ('rpc_attendance_canonical_range'),
  ('rpc_attendance_checkin_v3'), ('rpc_attendance_checkout_reconciled'), ('rpc_attendance_correction_cancel'),
  ('rpc_attendance_correction_decide'), ('rpc_attendance_correction_employees'), ('rpc_attendance_correction_preview'),
  ('rpc_attendance_correction_return'), ('rpc_attendance_correction_submit'), ('rpc_attendance_corrections_list'),
  ('rpc_attendance_offline_checkin'), ('rpc_attendance_offline_checkout'), ('rpc_attendance_undo_checkout'),
  ('rpc_cancel_leave_request'), ('rpc_close_device_session'), ('rpc_compliance_scores'), ('rpc_deactivate_device_push_token'),
  ('rpc_employee_dashboard_summary'), ('rpc_event_check_in_v2'), ('rpc_event_check_out_v2'), ('rpc_field_visit_location_evidence'),
  ('rpc_fulfill_location_ping_request'), ('rpc_geofence_report'), ('rpc_geofence_review_queue'),
  ('rpc_get_my_monthly_attendance_v3'), ('rpc_get_my_profile_v2'), ('rpc_grant_comp_off_credit'), ('rpc_latest_location_pings'),
  ('rpc_latest_locations_for_users'), ('rpc_list_unmapped_biometric_employees'), ('rpc_location_timeline'),
  ('rpc_mutate_own_field_visit'), ('rpc_my_compliance_score'), ('rpc_my_direct_reports'), ('rpc_my_pending_geofence_reason'),
  ('rpc_my_pending_ping_requests'), ('rpc_my_regularization_policy'), ('rpc_my_regularization_requests'), ('rpc_my_tasks'),
  ('rpc_my_unified_activity_log'), ('rpc_recalculate_attendance_warnings'), ('rpc_record_checkin_attempt'),
  ('rpc_record_client_operational_error'), ('rpc_register_device_push_token'), ('rpc_register_device_session'),
  ('rpc_regularization_request_respond'), ('rpc_regularization_request_submit'), ('rpc_report_outside_office_checkin'),
  ('rpc_report_tracking_health'), ('rpc_review_field_visit'), ('rpc_review_fraud_event'), ('rpc_review_geofence_event'),
  ('rpc_review_leave_request'), ('rpc_review_predefined_site_location_v2'), ('rpc_revoke_device_session'),
  ('rpc_submit_geofence_reason'), ('rpc_submit_leave_request'), ('rpc_task_forward'), ('rpc_tracking_heartbeats'),
  ('rpc_unassign_biometric_employee_code'), ('rpc_update_my_profile'), ('stop_tracking_session'),
  ('submit_field_visit_current_location_v3'), ('submit_visit_feedback')
),
rpcs AS (
  SELECT 'rpc'::text, r.name,
         CASE WHEN p.n = 0 THEN 'MISSING'
              WHEN p.anon_exec THEN 'CHECK' ELSE 'OK' END,
         CASE WHEN p.n = 0 THEN 'called by the app but not in the database'
              WHEN p.anon_exec THEN 'executable by anon (signed-out users); confirm this is intended'
              ELSE p.n || ' overload(s)' END
  FROM expected_rpcs r
  CROSS JOIN LATERAL (
    SELECT count(*)::int AS n,
           coalesce(bool_or(has_function_privilege('anon', f.oid, 'EXECUTE')), false) AS anon_exec
    FROM pg_proc f JOIN pg_namespace ns ON ns.oid = f.pronamespace
    WHERE ns.nspname = 'public' AND f.proname = r.name
  ) p
),
expected_markers(function_name, marker, from_migration) AS (VALUES
  ('sync_event_checkout_to_attendance', 'still checked in at another event', '20261012100000'),
  ('record_location_ping', 'ATTENDANCE_CLOSED_TODAY', '20261012110000'),
  ('rpc_ingest_location_observation', 'geofence-exit:', '20261012120000'),
  ('rpc_attendance_checkin_v2', 'Check-in attempted with a fake-GPS', '20261012130000'),
  ('rpc_attendance_checkin', 'hrms.offline_captured_at', '20261012140000'),
  ('rpc_attendance_checkout_reconciled', 'hrms.offline_captured_at', '20261012140000'),
  ('rpc_attendance_checkin_v2', 'HRMS_OUTSIDE_RADIUS_SIGNAL', '20261014100000'),
  ('rpc_attendance_checkin_v3', 'HRMS_RADIUS_MANAGER_WARNING', '20261014100000'),
  ('rpc_sync_biometric_punches', 'HRMS_KEEP_ADMIN_CHECKIN', '20261014120000'),
  ('rpc_admin_save_profile__core', 'HRMS_DOB_FIELD', '20261015120000')
),
markers AS (
  SELECT 'patch'::text, m.from_migration || ' ' || m.function_name,
         CASE WHEN f.n = 0 THEN 'MISSING' WHEN f.hit THEN 'OK' ELSE 'NOT_PATCHED' END,
         'marker: ' || m.marker
  FROM expected_markers m
  CROSS JOIN LATERAL (
    SELECT count(*)::int AS n,
           coalesce(bool_or(position(m.marker IN pg_get_functiondef(p.oid)) > 0), false) AS hit
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'public' AND p.prokind = 'f'
      AND (p.proname = m.function_name
           -- the birthday patch goes into the plain save function when no __core exists
           OR (m.function_name = 'rpc_admin_save_profile__core' AND p.proname = 'rpc_admin_save_profile'))
  ) f
),
canonical_view AS (
  SELECT 'patch'::text, '20261012100000 v_attendance_daily_canonical',
         CASE WHEN to_regclass('public.v_attendance_daily_canonical') IS NULL THEN 'MISSING'
              WHEN pg_get_viewdef('public.v_attendance_daily_canonical'::regclass) LIKE '%^(APP|EVENT)%' THEN 'OK'
              ELSE 'NOT_PATCHED' END,
         'event check-ins count as presence'
),
expected_tables(name, must_rls) AS (VALUES
  ('attendance_logs', true), ('attendance_audit_logs', true), ('attendance_corrections', true),
  ('attendance_correction_events', true), ('attendance_fraud_events', true), ('attendance_offline_operations', true),
  ('task_audience', true), ('tasks', true), ('leave_requests', true), ('profiles', true), ('field_visits', true),
  ('location_tracking', true), ('device_push_tokens', true), ('notifications', true),
  ('notification_push_outbox', true), ('notification_dismissed_keys', true), ('user_device_sessions', true),
  ('user_permissions', true), ('checkin_attempts', true), ('attendance_runtime_settings', false)
),
tables AS (
  SELECT 'table'::text, t.name,
         CASE WHEN c.oid IS NULL THEN 'MISSING'
              WHEN t.must_rls AND NOT c.relrowsecurity THEN 'OFF'
              WHEN has_table_privilege('anon', c.oid, 'INSERT') OR has_table_privilege('anon', c.oid, 'UPDATE')
                   OR has_table_privilege('anon', c.oid, 'DELETE') THEN 'CHECK'
              ELSE 'OK' END,
         CASE WHEN c.oid IS NULL THEN ''
              ELSE 'RLS ' || CASE WHEN c.relrowsecurity THEN 'on' ELSE 'off' END
                   || ', policies ' || (SELECT count(*) FROM pg_policies pol WHERE pol.schemaname = 'public' AND pol.tablename = t.name)
                   || CASE WHEN has_table_privilege('anon', c.oid, 'INSERT') OR has_table_privilege('anon', c.oid, 'UPDATE')
                                OR has_table_privilege('anon', c.oid, 'DELETE')
                           THEN ', anon can write' ELSE '' END END
  FROM expected_tables t
  LEFT JOIN pg_class c ON c.relname = t.name AND c.relnamespace = 'public'::regnamespace
),
public_tables_without_rls AS (
  SELECT 'rls'::text, c.relname::text, 'CHECK', 'public table without row level security'
  FROM pg_class c
  WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND NOT c.relrowsecurity
),
settings AS (
  SELECT 'setting'::text, 'regularization_request_window_days',
         CASE WHEN to_regclass('public.attendance_runtime_settings') IS NULL THEN 'MISSING'
              WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns
                               WHERE table_schema = 'public' AND table_name = 'attendance_runtime_settings'
                                 AND column_name = 'regularization_request_window_days') THEN 'MISSING'
              ELSE 'INFO' END,
         CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_schema = 'public' AND table_name = 'attendance_runtime_settings'
                             AND column_name = 'regularization_request_window_days')
              THEN (xpath('/row/v/text()', query_to_xml(
                     'select regularization_request_window_days v from public.attendance_runtime_settings limit 1',
                     false, true, '')))[1]::text || ' days'
              ELSE '' END
),
cron_jobs AS (
  SELECT 'cron'::text, 'scheduled jobs',
         CASE WHEN to_regclass('cron.job') IS NULL THEN 'CHECK' ELSE 'INFO' END,
         CASE WHEN to_regclass('cron.job') IS NULL THEN 'pg_cron not installed or not visible'
              ELSE (xpath('/row/v/text()', query_to_xml(
                     'select string_agg(jobname || case when active then '' (on)'' else '' (OFF)'' end, ''; '' order by jobname) v from cron.job',
                     false, true, '')))[1]::text END
),
cron_failures AS (
  SELECT 'cron'::text, 'failed runs, last 24 h',
         CASE WHEN to_regclass('cron.job_run_details') IS NULL THEN 'CHECK' ELSE 'INFO' END,
         CASE WHEN to_regclass('cron.job_run_details') IS NULL THEN ''
              ELSE coalesce((xpath('/row/v/text()', query_to_xml(
                     'select string_agg(j.jobname || '': '' || d.n, ''; '') v from (select jobid, count(*) n from cron.job_run_details where status <> ''succeeded'' and start_time > now() - interval ''1 day'' group by jobid) d join cron.job j using (jobid)',
                     false, true, '')))[1]::text, 'none') END
),
push_health AS (
  SELECT 'push'::text, 'outbox by status, last 7 days',
         CASE WHEN to_regclass('public.notification_push_outbox') IS NULL THEN 'MISSING' ELSE 'INFO' END,
         CASE WHEN to_regclass('public.notification_push_outbox') IS NULL THEN ''
              ELSE coalesce((xpath('/row/v/text()', query_to_xml(
                     'select string_agg(status || '' '' || n, '', '' order by status) v from (select status, count(*) n from public.notification_push_outbox where created_at > now() - interval ''7 days'' group by status) s',
                     false, true, '')))[1]::text, 'no rows') END
  UNION ALL
  SELECT 'push', 'registered phones (active tokens)',
         CASE WHEN to_regclass('public.device_push_tokens') IS NULL THEN 'MISSING' ELSE 'INFO' END,
         CASE WHEN to_regclass('public.device_push_tokens') IS NULL THEN ''
              ELSE (xpath('/row/v/text()', query_to_xml(
                     'select count(*) filter (where active) || '' active of '' || count(*) v from public.device_push_tokens',
                     false, true, '')))[1]::text END
)
SELECT * FROM migrations
UNION ALL SELECT * FROM rpcs
UNION ALL SELECT * FROM markers
UNION ALL SELECT * FROM canonical_view
UNION ALL SELECT * FROM tables
UNION ALL SELECT * FROM public_tables_without_rls
UNION ALL SELECT * FROM settings
UNION ALL SELECT * FROM cron_jobs
UNION ALL SELECT * FROM cron_failures
UNION ALL SELECT * FROM push_health
ORDER BY 1, 3 DESC, 2;
