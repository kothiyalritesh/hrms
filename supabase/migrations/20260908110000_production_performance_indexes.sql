-- Migration: 20260908110000_production_performance_indexes.sql
-- Production Performance Indexing Review (Section 26)

create index if not exists idx_field_visits_user_date
  on public.field_visits(user_id, date);

create index if not exists idx_field_visits_date_status
  on public.field_visits(date, status);

create index if not exists idx_site_visit_location_history_visit_rec
  on public.site_visit_location_history(field_visit_id, recorded_at asc);

create index if not exists idx_site_visit_location_history_user_rec
  on public.site_visit_location_history(user_id, recorded_at desc);

create index if not exists idx_site_visit_live_locations_user
  on public.site_visit_live_locations(user_id);

create index if not exists idx_attendance_logs_user_date
  on public.attendance_logs(user_id, date);

create index if not exists idx_attendance_logs_date
  on public.attendance_logs(date);

create index if not exists idx_user_permissions_user_perm
  on public.user_permissions(user_id, permission);

create index if not exists idx_audit_logs_actor_created
  on public.audit_logs(actor_user_id, created_at desc);

create index if not exists idx_office_ip_allowlist_active
  on public.office_ip_allowlist(ip_address, is_active);

create index if not exists idx_tasks_assigned_status
  on public.tasks(assigned_to, status);

create index if not exists idx_field_visit_feedback_visit
  on public.field_visit_feedback(visit_id);

notify pgrst, 'reload schema';

