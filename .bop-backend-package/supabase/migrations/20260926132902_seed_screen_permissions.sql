INSERT INTO public.permissions (name, description, category)
VALUES
  ('screen.attendance_control', 'Access Attendance Control Screen', 'screens'),
  ('screen.user_management', 'Access User Management Screen', 'screens'),
  ('screen.leave_balance', 'Access Leave Balance Screen', 'screens'),
  ('screen.audit_logs', 'Access Audit Logs', 'screens'),
  ('screen.birthday_management', 'Access Birthday Management', 'screens'),
  ('screen.task_project_control', 'Access Task/Project Control', 'screens'),
  ('screen.ticket_management', 'Access Ticket Management', 'screens'),
  ('screen.live_tracking', 'Access Live Tracking', 'screens'),
  ('screen.field_visit_admin', 'Access Field Visit Admin', 'screens'),
  ('screen.team_hierarchy', 'Access Team Hierarchy', 'screens'),
  ('screen.check_in_logs', 'Access Check In Logs', 'screens'),
  ('screen.suspicious_attendance', 'Access Suspicious Attendance', 'screens'),
  ('screen.attendance_regularization', 'Access Attendance Regularization', 'screens'),
  ('screen.event_management', 'Access Event Management', 'screens'),
  ('screen.smartoffice_integration', 'Access SmartOffice Integration', 'screens'),
  ('screen.site_settings', 'Access Site Settings', 'screens'),
  ('screen.office_settings', 'Access Office Settings', 'screens'),
  ('screen.notification_management', 'Access Notification Management', 'screens'),
  ('screen.anonymous_feedback', 'Access Anonymous Feedback', 'screens')
ON CONFLICT (name) DO NOTHING;
