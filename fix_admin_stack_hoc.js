const fs = require("fs");
let code = fs.readFileSync("navigation/AdminStackNavigator.tsx", "utf-8");

code = code.replace(/import \{ getCommonScreenOptions \} from "@\/navigation\/screenOptions";/, `import { getCommonScreenOptions } from "@/navigation/screenOptions";\nimport { withPermissionGuard } from "@/components/PermissionGuard";`);

code = code.replace(/function lazyScreen<T extends React\.ComponentType<any>>\(\s*loader: \(\) => Promise<\{ default: T \}>,\s*\) \{/, `function lazyScreen<T extends React.ComponentType<any>>(\n  loader: () => Promise<{ default: T }>,\n  permission?: string\n) {`);

code = code.replace(/return function LazyWrapper\(props: React\.ComponentProps<T>\) \{/, `const LazyWrapper = function LazyWrapper(props: React.ComponentProps<T>) {`);

code = code.replace(/return <Component \{\.\.\.props\} \/>;\s*\};/, `return <Component {...props} />;\n  };\n  if (permission) return withPermissionGuard(LazyWrapper, permission);\n  return LazyWrapper;`);

const replacements = [
  { match: /const AttendanceControlScreen = lazyScreen\(\(\) =>\s*import\("@\/screens\/admin\/AttendanceControlScreenNew"\),\s*\);/, replace: `const AttendanceControlScreen = lazyScreen(() => import("@/screens/admin/AttendanceControlScreenNew"), "screen.attendance_control");` },
  { match: /const UserManagementScreen = lazyScreen\(\(\) => import\("@\/screens\/admin\/UserManagementScreen"\)\);/, replace: `const UserManagementScreen = lazyScreen(() => import("@/screens/admin/UserManagementScreen"), "screen.user_management");` },
  { match: /const LeaveManagementScreen = lazyScreen\(\(\) => import\("@\/screens\/admin\/LeaveManagementScreen"\)\);/, replace: `const LeaveManagementScreen = lazyScreen(() => import("@/screens/admin/LeaveManagementScreen"), "screen.leave_balance");` },
  { match: /const TaskProjectControlScreen = lazyScreen\(\(\) => import\("@\/screens\/admin\/TaskProjectControlScreen"\)\);/, replace: `const TaskProjectControlScreen = lazyScreen(() => import("@/screens/admin/TaskProjectControlScreen"), "screen.task_project_control");` },
  { match: /const NotificationManagementScreen = lazyScreen\(\(\) => import\("@\/screens\/admin\/NotificationManagementScreen"\)\);/, replace: `const NotificationManagementScreen = lazyScreen(() => import("@/screens/admin/NotificationManagementScreen"), "screen.notification_management");` },
  { match: /const AdminDeviceSessionsScreen = lazyScreen\(\(\) => import\("@\/screens\/admin\/AdminDeviceSessionsScreen"\)\);/, replace: `const AdminDeviceSessionsScreen = lazyScreen(() => import("@/screens/admin/AdminDeviceSessionsScreen"), "SYSTEM_ADMIN");` },
  { match: /const OfficeSettingsScreen = lazyScreen\(\(\) => import\("@\/screens\/admin\/OfficeSettingsScreen"\)\);/, replace: `const OfficeSettingsScreen = lazyScreen(() => import("@/screens/admin/OfficeSettingsScreen"), "screen.office_settings");` },
  { match: /const SiteSettingsScreen = lazyScreen\(\(\) => import\("@\/screens\/admin\/SiteSettingsScreen"\)\);/, replace: `const SiteSettingsScreen = lazyScreen(() => import("@/screens/admin/SiteSettingsScreen"), "screen.site_settings");` },
  { match: /const AuditLogsScreen = lazyScreen\(\(\) => import\("@\/screens\/admin\/AuditLogsScreen"\)\);/, replace: `const AuditLogsScreen = lazyScreen(() => import("@/screens/admin/AuditLogsScreen"), "screen.audit_logs");` },
  { match: /const ActivityAnalysisScreen = lazyScreen\(\(\) => import\("@\/screens\/admin\/ActivityAnalysisScreen"\)\);/, replace: `const ActivityAnalysisScreen = lazyScreen(() => import("@/screens/admin/ActivityAnalysisScreen"), "screen.live_tracking");` },
  { match: /const FieldVisitAdminScreen = lazyScreen\(\(\) => import\("@\/screens\/admin\/FieldVisitAdminScreen"\)\);/, replace: `const FieldVisitAdminScreen = lazyScreen(() => import("@/screens/admin/FieldVisitAdminScreen"), "screen.field_visit_admin");` },
  { match: /const LiveTrackingScreen = lazyScreen\(\(\) => import\("@\/screens\/admin\/LiveTrackingScreen"\)\);/, replace: `const LiveTrackingScreen = lazyScreen(() => import("@/screens/admin/LiveTrackingScreen"), "screen.live_tracking");` },
  { match: /const TicketManagementScreen = lazyScreen\(\(\) => import\("@\/screens\/admin\/TicketManagementScreen"\)\);/, replace: `const TicketManagementScreen = lazyScreen(() => import("@/screens/admin/TicketManagementScreen"), "screen.ticket_management");` },
  { match: /const EventManagementScreen = lazyScreen\(\(\) => import\("@\/screens\/admin\/EventManagementScreen"\)\);/, replace: `const EventManagementScreen = lazyScreen(() => import("@/screens/admin/EventManagementScreen"), "screen.event_management");` },
  { match: /const CheckInLogsScreen = lazyScreen\(\(\) => import\("@\/screens\/admin\/CheckInLogsScreen"\)\);/, replace: `const CheckInLogsScreen = lazyScreen(() => import("@/screens/admin/CheckInLogsScreen"), "screen.check_in_logs");` },
  { match: /const LeaveBalanceScreen = lazyScreen\(\(\) => import\("@\/screens\/admin\/LeaveBalanceScreen"\)\);/, replace: `const LeaveBalanceScreen = lazyScreen(() => import("@/screens/admin/LeaveBalanceScreen"), "screen.leave_balance");` },
  { match: /const BiometricUserMatchScreen = lazyScreen\(\(\) => import\("@\/screens\/admin\/BiometricUserMatchScreen"\)\);/, replace: `const BiometricUserMatchScreen = lazyScreen(() => import("@/screens/admin/BiometricUserMatchScreen"), "screen.smartoffice_integration");` },
  { match: /const SuspiciousAttendanceScreen = lazyScreen\(\(\) => import\("@\/screens\/admin\/SuspiciousAttendanceScreen"\)\);/, replace: `const SuspiciousAttendanceScreen = lazyScreen(() => import("@/screens/admin/SuspiciousAttendanceScreen"), "screen.suspicious_attendance");` },
  { match: /const AttendanceCalendarScreen = lazyScreen\(\(\) => import\("@\/screens\/admin\/AttendanceCalendarScreen"\)\);/, replace: `const AttendanceCalendarScreen = lazyScreen(() => import("@/screens/admin/AttendanceCalendarScreen"), "screen.attendance_control");` },
  { match: /const AttendanceRegularizationScreen = lazyScreen\(\(\) => import\("@\/screens\/admin\/AttendanceRegularizationScreen"\)\);/, replace: `const AttendanceRegularizationScreen = lazyScreen(() => import("@/screens/admin/AttendanceRegularizationScreen"), "screen.attendance_regularization");` },
  { match: /const AdvancedAttendanceReportScreen = lazyScreen\(\(\) => import\("@\/screens\/admin\/AdvancedAttendanceReportScreen"\)\);/, replace: `const AdvancedAttendanceReportScreen = lazyScreen(() => import("@/screens/admin/AdvancedAttendanceReportScreen"), "screen.attendance_control");` },
  { match: /const TeamHierarchyScreen = lazyScreen\(\(\) =>\s*import\("@\/screens\/admin\/TeamHierarchyScreen"\),\s*\);/, replace: `const TeamHierarchyScreen = lazyScreen(() => import("@/screens/admin/TeamHierarchyScreen"), "screen.team_hierarchy");` },
  { match: /const PermissionsManagerScreen = lazyScreen\(\(\) =>\s*import\('@\/screens\/admin\/PermissionsManagerScreen'\)\s*\);/, replace: `const PermissionsManagerScreen = lazyScreen(() => import("@/screens/admin/PermissionsManagerScreen"), "SYSTEM_ADMIN");` },
  { match: /const EmployeeBirthdayManagementScreen = lazyScreen\(\(\) => \s*import\('@\/screens\/admin\/EmployeeBirthdayManagementScreen'\)\);/, replace: `const EmployeeBirthdayManagementScreen = lazyScreen(() => import("@/screens/admin/EmployeeBirthdayManagementScreen"), "screen.birthday_management");` },
  { match: /const SiteVisitObserverScreen = lazyScreen\(\(\) =>\s*import\('@\/screens\/admin\/SiteVisitObserverScreen'\)\s*\);/, replace: `const SiteVisitObserverScreen = lazyScreen(() => import("@/screens/admin/SiteVisitObserverScreen"), "screen.live_tracking");` },
  { match: /const InTransitScreen = lazyScreen\(\(\) =>\s*import\('@\/screens\/admin\/InTransitScreen'\)\s*\);/, replace: `const InTransitScreen = lazyScreen(() => import("@/screens/admin/InTransitScreen"), "screen.live_tracking");` },
  { match: /const AnonymousFeedbackScreen = deferredScreen\(\(\) => import\("@\/screens\/admin\/AnonymousFeedbackScreen"\)\);/, replace: `const AnonymousFeedbackScreen = withPermissionGuard(deferredScreen(() => import("@/screens/admin/AnonymousFeedbackScreen")), "screen.anonymous_feedback");` },
  { match: /const SmartOfficeIntegrationScreen = lazyScreen\(\(\) =>\s*import\("@\/screens\/admin\/SmartOfficeSecureSyncScreen"\)\.then\(\(module\) => \(\{\s*default: module\.SmartOfficeSecureSyncScreen,\s*\}\)\),\s*\);/, replace: `const SmartOfficeIntegrationScreen = lazyScreen(() => import("@/screens/admin/SmartOfficeSecureSyncScreen").then(m => ({ default: m.SmartOfficeSecureSyncScreen })), "screen.smartoffice_integration");` },
  { match: /const SmartOfficeEmployeeImport = lazyScreen\(\(\) =>\s*import\("@\/screens\/admin\/SmartOfficeEmployeeImport"\)\.then\(\(module\) => \(\{\s*default: module\.SmartOfficeEmployeeImport,\s*\}\)\),\s*\);/, replace: `const SmartOfficeEmployeeImport = lazyScreen(() => import("@/screens/admin/SmartOfficeEmployeeImport").then(m => ({ default: m.SmartOfficeEmployeeImport })), "screen.user_management");` },
  { match: /const SmartOfficeImportedData = lazyScreen\(\(\) =>\s*import\("@\/screens\/admin\/SmartOfficeImportedData"\)\.then\(\(module\) => \(\{\s*default: module\.SmartOfficeImportedData,\s*\}\)\),\s*\);/, replace: `const SmartOfficeImportedData = lazyScreen(() => import("@/screens/admin/SmartOfficeImportedData").then(m => ({ default: m.SmartOfficeImportedData })), "screen.smartoffice_integration");` },
];

for (const rep of replacements) {
  code = code.replace(rep.match, rep.replace);
}

fs.writeFileSync("navigation/AdminStackNavigator.tsx", code);
console.log("Updated AdminStackNavigator with HOC");
