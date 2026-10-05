insert into public.permissions (module, action, permission_key, description) values
('EMPLOYEE', 'view', 'employee.view', 'View employee profiles'),
('EMPLOYEE', 'create', 'employee.create', 'Create new employees'),
('EMPLOYEE', 'edit', 'employee.edit', 'Edit employee profiles'),
('EMPLOYEE', 'deactivate', 'employee.deactivate', 'Deactivate employees'),
('ATTENDANCE', 'view', 'attendance.view', 'View attendance records'),
('ATTENDANCE', 'edit', 'attendance.edit', 'Edit attendance records'),
('ATTENDANCE', 'export', 'attendance.export', 'Export attendance reports'),
('ATTENDANCE', 'approve', 'attendance.approve', 'Approve manual attendance/regularizations'),
('LEAVE', 'view', 'leave.view', 'View leave requests'),
('LEAVE', 'approve', 'leave.approve', 'Approve or reject leave requests'),
('LOCATION', 'view_live', 'location.view_live', 'View live tracking on maps'),
('FIELD_VISIT', 'view', 'field_visit.view', 'View field visits/meetings'),
('FIELD_VISIT', 'create', 'field_visit.create', 'Assign field visits')
on conflict (permission_key) do nothing;
