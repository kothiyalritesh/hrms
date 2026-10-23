/**
 * Single source of truth for HRMS permissions on the client.
 *
 * Each capability has ONE canonical key (resource.action). Older keys that are
 * already granted in production (screen.*, employee.*, location.view_live, ...)
 * are listed as aliases, so existing grants keep working and the server
 * (public.hrms_has_permission) resolves the same aliases.
 *
 * `scoped`: the grant is limited by a data scope (office / team / reports-to /
 * department / all). Unscoped permissions are company-wide settings (offices,
 * events, notifications, ...) and are always granted with scope GLOBAL.
 *
 * Roles with full data access (SYSTEM_ADMIN, ADMIN; HR and HRD unless switched
 * off in the Permission Manager) hold every permission
 * except permission management, which is SYSTEM_ADMIN / ADMIN only. The server
 * (get_my_access) is authoritative; the role lists below are only a fallback.
 */

export type PermissionDef = {
  key: string;
  module: string;
  label: string;
  description: string;
  scoped: boolean;
  risk: "LOW" | "MEDIUM" | "HIGH";
  aliases?: string[];
};

export const PERMISSION_CATALOG: PermissionDef[] = [
  // Employees
  { key: "employees.view", module: "Employees", label: "View employees", description: "Open employee profiles in scope", scoped: true, risk: "MEDIUM", aliases: ["screen.user_management", "employee.view", "employee.export"] },
  { key: "employees.manage", module: "Employees", label: "Add / edit employees", description: "Create, edit and deactivate employees in scope", scoped: true, risk: "HIGH", aliases: ["employee.create", "employee.edit", "employee.update", "employee.deactivate", "employee.delete", "employees.create", "employees.edit", "employees.update", "manage_employee_details"] },
  { key: "teams.manage", module: "Employees", label: "Team hierarchy", description: "Edit teams and reporting lines", scoped: false, risk: "HIGH", aliases: ["screen.team_hierarchy", "team.hierarchy"] },
  { key: "birthdays.view", module: "Employees", label: "View birthdays", description: "Upcoming birthdays and the birthday-day notification for employees in scope", scoped: true, risk: "MEDIUM" },
  { key: "birthdays.manage", module: "Employees", label: "Birthdays", description: "Set and import birthdays (includes View birthdays)", scoped: false, risk: "LOW", aliases: ["screen.birthday_management"] },

  // Attendance
  { key: "attendance.view", module: "Attendance", label: "View attendance", description: "Attendance logs and reports in scope", scoped: true, risk: "MEDIUM", aliases: ["screen.attendance_control", "attendance.advanced", "attendance.view_logs"] },
  { key: "attendance.export", module: "Attendance", label: "Export attendance", description: "Download attendance reports in scope", scoped: true, risk: "MEDIUM" },
  { key: "attendance.regularize", module: "Attendance", label: "Correct attendance", description: "Fix check-in / checkout times in scope", scoped: true, risk: "HIGH", aliases: ["attendance.edit", "manage_attendance"] },
  { key: "attendance.backdate_correct", module: "Attendance", label: "Backdated attendance correction", description: "Record attendance for a past day of an employee in scope, with evidence", scoped: true, risk: "HIGH" },
  { key: "attendance.backdate_approve", module: "Attendance", label: "Approve backdated corrections", description: "Approve or reject high-risk backdated corrections in scope", scoped: true, risk: "HIGH" },
  // One toggle each since 2026-10-20 (the server expands them into the keys above).
  { key: "attendance.correct", module: "Attendance", label: "Correct attendance", description: "Fix check-in / check-out and record missed days in scope", scoped: true, risk: "HIGH" },
  { key: "attendance.requests.approve", module: "Attendance", label: "Approve requests", description: "Approve or reject regularization and correction requests in scope", scoped: true, risk: "HIGH" },
  { key: "tracking.view", module: "Field & tracking", label: "Tracking & activity", description: "Live location, In Transit and activity analysis in scope", scoped: true, risk: "HIGH" },
  { key: "regularization.view", module: "Attendance", label: "View regularization requests", description: "See requests in scope", scoped: true, risk: "LOW", aliases: ["screen.attendance_regularization"] },
  { key: "regularization.approve", module: "Attendance", label: "Approve regularization", description: "Approve or reject requests in scope", scoped: true, risk: "HIGH", aliases: ["attendance.approve"] },
  { key: "attendance.calendar.manage", module: "Attendance", label: "Holidays & weekly offs", description: "Edit the holiday calendar and weekly-off rules", scoped: false, risk: "MEDIUM", aliases: ["attendance.weekly_offs"] },
  { key: "checkin_logs.view", module: "Attendance", label: "Check-in logs", description: "GPS check-in attempts and blocked check-ins in scope", scoped: true, risk: "MEDIUM", aliases: ["screen.check_in_logs", "attendance.checkin_logs"] },
  { key: "suspicious.view", module: "Attendance", label: "Suspicious attendance", description: "Fraud scores and GPS evidence in scope", scoped: true, risk: "MEDIUM", aliases: ["screen.suspicious_attendance", "attendance.view_suspicious"] },
  { key: "devices.manage", module: "Attendance", label: "Duplicate devices", description: "Device sessions and buddy-punching checks", scoped: false, risk: "HIGH", aliases: ["screen.duplicate_devices", "admin.duplicate_devices"] },
  { key: "biometric.manage", module: "Attendance", label: "Biometric sync", description: "SmartOffice sync, employee-code mapping and imported data", scoped: false, risk: "HIGH", aliases: ["screen.smartoffice_integration", "biometric.sync", "biometric.employee_match", "biometric.bulk_import", "biometric.imported_data"] },

  // Leave
  { key: "leave.view", module: "Leave", label: "View leave", description: "Leave requests and balances in scope", scoped: true, risk: "LOW", aliases: ["screen.leave_balance"] },
  { key: "leave.approve", module: "Leave", label: "Approve leave", description: "Approve or reject leave in scope", scoped: true, risk: "HIGH", aliases: ["manage_leave"] },
  { key: "leave.balance.manage", module: "Leave", label: "Adjust leave balances", description: "Add or remove leave balance in scope", scoped: true, risk: "HIGH", aliases: ["leave.balance"] },

  // Field & tracking
  { key: "live_tracking.view", module: "Field & tracking", label: "Live tracking", description: "Live location of employees in scope", scoped: true, risk: "HIGH", aliases: ["screen.live_tracking", "location.view_live", "screen.in_transit", "view_live_tracking", "view_location_history", "team.in_transit"] },
  { key: "activity_analysis.view", module: "Field & tracking", label: "Activity analysis", description: "Daily activity log and attendance of employees in scope", scoped: true, risk: "MEDIUM", aliases: ["reports.activity_analysis", "screen.activity_analysis"] },
  { key: "field_visits.view", module: "Field & tracking", label: "Field visits", description: "Field / site visits in scope", scoped: true, risk: "MEDIUM", aliases: ["screen.field_visit_admin", "field_visit.view", "screen.site_visit_observer", "view_site_visit_observer", "field_visit.observer", "field_visit.view_site"] },
  { key: "sites.manage", module: "Field & tracking", label: "Sites & geofences", description: "Projects, saved sites and geofences", scoped: false, risk: "MEDIUM", aliases: ["screen.site_settings", "admin.site_settings"] },
  { key: "offices.manage", module: "Field & tracking", label: "Offices & policies", description: "Offices, radius and attendance policies", scoped: false, risk: "HIGH", aliases: ["screen.office_settings", "admin.office_settings"] },

  // Work
  { key: "tasks.view", module: "Work", label: "View tasks", description: "Tasks of employees in scope", scoped: true, risk: "LOW", aliases: ["screen.task_project_control"] },
  { key: "tasks.manage", module: "Work", label: "Assign tasks", description: "Create and assign tasks in scope", scoped: true, risk: "MEDIUM" },
  { key: "events.manage", module: "Work", label: "Events", description: "Create and manage events", scoped: false, risk: "MEDIUM", aliases: ["screen.event_management"] },

  // Communication & support
  { key: "notifications.send", module: "Communication", label: "Send notifications", description: "Push notifications to employees", scoped: false, risk: "MEDIUM", aliases: ["screen.notification_management", "admin.send_notification"] },
  { key: "tickets.manage", module: "Communication", label: "Support tickets", description: "View and resolve support tickets", scoped: false, risk: "LOW", aliases: ["screen.ticket_management"] },
  { key: "feedback.view", module: "Communication", label: "Anonymous feedback", description: "Read anonymous feedback", scoped: false, risk: "MEDIUM", aliases: ["screen.anonymous_feedback", "admin.anonymous_feedback"] },

  // Reports & audit
  { key: "reports.view", module: "Reports & audit", label: "Reports", description: "Reports hub for employees in scope", scoped: true, risk: "MEDIUM", aliases: ["view_reports", "view_location_reports"] },
  { key: "audit.view", module: "Reports & audit", label: "Audit logs", description: "System activity trail", scoped: false, risk: "HIGH", aliases: ["screen.audit_logs", "admin.audit_logs"] },

  // Permission management (SYSTEM_ADMIN / ADMIN by default)
  { key: "permissions.view", module: "Permissions", label: "View permissions", description: "Open the Permission Manager and simulator", scoped: false, risk: "MEDIUM", aliases: ["screen.permissions_manager", "admin.permissions"] },
  { key: "permissions.assign", module: "Permissions", label: "Grant permissions", description: "Grant permissions to other users", scoped: false, risk: "HIGH" },
  { key: "permissions.revoke", module: "Permissions", label: "Revoke permissions", description: "Revoke permissions from other users", scoped: false, risk: "HIGH" },
];

const BY_KEY = new Map(PERMISSION_CATALOG.map((p) => [p.key, p]));
const ALIAS_TO_KEY = new Map<string, string>();
for (const p of PERMISSION_CATALOG) for (const alias of p.aliases ?? []) ALIAS_TO_KEY.set(alias, p.key);

/** Canonical key for a key or legacy alias (unknown keys are returned as-is). */
export function canonicalPermission(key: string) {
  return BY_KEY.has(key) ? key : ALIAS_TO_KEY.get(key) ?? key;
}

export function permissionDef(key: string) {
  return BY_KEY.get(canonicalPermission(key)) ?? null;
}

export const DATA_ADMIN_ROLES = ["SYSTEM_ADMIN", "SUPER_ADMIN", "ADMIN", "HR", "HRD"];
export const PERMISSION_ADMIN_ROLES = ["SYSTEM_ADMIN", "SUPER_ADMIN", "ADMIN"];

/**
 * HR-panel screens and the permission(s) that open them (any of).
 * Used by the route guards, the HR-panel menu and the tab bar.
 */
export const SCREEN_PERMISSIONS: Record<string, string[]> = {
  UserManagement: ["employees.view", "employees.manage"],
  SmartOfficeEmployeeImport: ["employees.manage"],
  TeamHierarchy: ["teams.manage"],
  EmployeeBirthdayManagement: ["birthdays.manage"],
  // Home → Birthdays: only people allowed to see others' birthdays.
  UpcomingBirthdays: ["birthdays.view", "birthdays.manage"],
  AttendanceControl: ["attendance.view", "attendance.regularize"],
  AdvancedAttendanceReport: ["attendance.view", "attendance.export"],
  AttendanceCalendar: ["attendance.calendar.manage"],
  AttendanceRegularization: ["regularization.view", "regularization.approve"],
  BackdatedAttendance: ["attendance.backdate_correct", "attendance.backdate_approve", "regularization.view", "regularization.approve"],
  CheckInLogs: ["checkin_logs.view"],
  SuspiciousAttendance: ["suspicious.view"],
  ComplianceScores: ["employees.view", "suspicious.view"],
  AdminDeviceSessions: ["devices.manage"],
  SmartOfficeIntegration: ["biometric.manage"],
  BiometricUserMatch: ["biometric.manage"],
  // Which office each biometric machine is in (office return needs it).
  BiometricDevices: ["biometric.manage"],
  SmartOfficeImportedData: ["biometric.manage"],
  LeaveManagement: ["leave.view", "leave.approve"],
  LeaveBalance: ["leave.view", "leave.balance.manage"],
  LiveTracking: ["live_tracking.view"],
  // Review reasons for leaving the office (same key the review RPCs check).
  OfficeExitReviews: ["live_tracking.view"],
  // Inside / outside the office or site radius, with call and last location.
  LocationMonitor: ["live_tracking.view"],
  InTransit: ["live_tracking.view"],
  // live_tracking.view still opens it so existing access is not lost; grant
  // activity_analysis.view to give Activity Analysis alone.
  ActivityAnalysis: ["activity_analysis.view", "live_tracking.view"],
  FieldVisitAdmin: ["field_visits.view"],
  SiteVisitObserver: ["field_visits.view"],
  SiteSettings: ["sites.manage"],
  OfficeSettings: ["offices.manage"],
  TaskProjectControl: ["tasks.view", "tasks.manage"],
  EventManagement: ["events.manage"],
  NotificationManagement: ["notifications.send"],
  TicketManagement: ["tickets.manage"],
  AnonymousFeedback: ["feedback.view"],
  AuditLogs: ["audit.view"],
  PermissionsManager: ["permissions.view", "permissions.assign"],
  TVDisplay: ["attendance.view"],

  // Reports tab (data is scoped by the server; reports.view opens the tab)
  ReportsAttendance: ["attendance.view"],
  ReportsAdvancedAttendance: ["attendance.view", "attendance.export"],
  ReportsDownloads: ["attendance.export", "attendance.view"],
  ReportsAttendanceRegister: ["attendance.view"],
  ReportsLateArrival: ["attendance.view"],
  ReportsIntelligence: ["attendance.view"],
  ReportsRegularization: ["regularization.view", "regularization.approve"],
  ReportsCheckInLogs: ["checkin_logs.view"],
  ReportsGps: ["suspicious.view"],
  ReportsBiometric: ["biometric.manage"],
  ReportsActivity: ["activity_analysis.view", "live_tracking.view"],
  ReportsTracking: ["live_tracking.view"],
  ReportsGeofenceEvents: ["live_tracking.view", "attendance.view"],
  ReportsFieldVisits: ["field_visits.view"],
  ReportsLeaves: ["leave.view", "leave.approve"],
  ReportsLeaveBalance: ["leave.view", "leave.balance.manage"],
  ReportsLeaveUsage: ["leave.view"],
  ReportsOvertime: ["leave.view"],
  ReportsTeamHierarchy: ["teams.manage", "employees.view"],
  ReportsAuditLogs: ["audit.view"],
  ReportsDownloadCentre: ["attendance.export", "attendance.view"],
};
