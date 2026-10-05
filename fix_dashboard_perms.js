const fs = require("fs");
let code = fs.readFileSync("screens/admin/AdminDashboardScreen.tsx", "utf-8");

code = code.replace(/import \{ DashboardSummaryService \} from "@\/services\/dashboard-summary\.service";/, `import { DashboardSummaryService } from "@/services/dashboard-summary.service";\nimport { usePermissions } from "@/hooks/usePermissions";`);

code = code.replace(/const isHR = user\?\.role === "HR" \|\| user\?\.role === "SYSTEM_ADMIN";\n  const isHRD = user\?\.role === "HRD" \|\| user\?\.role === "SYSTEM_ADMIN";\n  const isAdmin = user\?\.role === "ADMIN" \|\| user\?\.role === "SYSTEM_ADMIN";/, `const isHR = user?.role === "HR" || user?.role === "SYSTEM_ADMIN";\n  const isHRD = user?.role === "HRD" || user?.role === "SYSTEM_ADMIN";\n  const isAdmin = user?.role === "ADMIN" || user?.role === "SYSTEM_ADMIN";\n  const { hasPermission } = usePermissions();`);

const replacements = [
  { match: /<ActionCard\s*icon="user-plus"[\s\S]*?onPress=\{\(\) => navigation\.navigate\("UserManagement"\)\}\s*\/>/, perm: "screen.user_management" },
  { match: /<ActionCard\s*icon="clock"[\s\S]*?onPress=\{\(\) => navigation\.navigate\("AttendanceControl"\)\}\s*\/>/, perm: "screen.attendance_control" },
  { match: /<ActionCard\s*icon="map-pin"[\s\S]*?onPress=\{\(\) => navigation\.navigate\("FieldVisitAdmin"\)\}\s*\/>/, perm: "screen.field_visit_admin" },
  { match: /<ActionCard\s*icon="git-branch"[\s\S]*?onPress=\{\(\) => navigation\.navigate\("TeamHierarchy"\)\}\s*\/>/, perm: "screen.team_hierarchy" },
  { match: /<ActionCard\s*icon="map"[\s\S]*?onPress=\{\(\) => navigation\.navigate\("CheckInLogs"\)\}\s*\/>/, perm: "screen.check_in_logs" },
  { match: /<ActionCard\s*icon="alert-triangle"[\s\S]*?onPress=\{\(\) => navigation\.navigate\("SuspiciousAttendance"\)\}\s*\/>/, perm: "screen.suspicious_attendance" },
  { match: /<ActionCard\s*icon="calendar"[\s\S]*?onPress=\{\(\) => navigation\.navigate\("AttendanceCalendar"\)\}\s*\/>/, perm: "screen.attendance_control" },
  { match: /<ActionCard\s*icon="check-square"[\s\S]*?onPress=\{\(\) => navigation\.navigate\("AttendanceRegularization"\)\}\s*\/>/, perm: "screen.attendance_regularization" },
  { match: /<ActionCard\s*icon="bar-chart-2"[\s\S]*?onPress=\{\(\) => navigation\.navigate\("AdvancedAttendanceReport"\)\}\s*\/>/, perm: "screen.attendance_control" },
  { match: /<ActionCard\s*icon="calendar"[\s\S]*?onPress=\{\(\) => navigation\.navigate\("EventManagement"\)\}\s*\/>/, perm: "screen.event_management" },
  { match: /<ActionCard\s*icon="credit-card"[\s\S]*?onPress=\{\(\) => navigation\.navigate\("LeaveBalance"\)\}\s*\/>/, perm: "screen.leave_balance" },
  { match: /<ActionCard\s*icon="refresh-cw"[\s\S]*?onPress=\{\(\) => navigation\.navigate\("SmartOfficeIntegration"\)\}\s*\/>/, perm: "screen.smartoffice_integration" },
  { match: /<ActionCard\s*icon="users"[\s\S]*?onPress=\{\(\) => navigation\.navigate\("BiometricUserMatch"\)\}\s*\/>/, perm: "screen.smartoffice_integration" },
  { match: /<ActionCard\s*icon="upload-cloud"[\s\S]*?onPress=\{\(\) => navigation\.navigate\("SmartOfficeEmployeeImport"\)\}\s*\/>/, perm: "screen.user_management" },
  { match: /<ActionCard\s*icon="database"[\s\S]*?onPress=\{\(\) => navigation\.navigate\("SmartOfficeImportedData"\)\}\s*\/>/, perm: "screen.smartoffice_integration" },
];

for (const rep of replacements) {
  code = code.replace(rep.match, `{hasPermission("${rep.perm}") && ($&)}`);
}

// For the ones already wrapped in {isHRD && (...) } we replace the isHRD check with hasPermission check
code = code.replace(/\{isHRD && \(\s*<ActionCard\s*icon="shield"/, `{hasPermission("SYSTEM_ADMIN") && (\n            <ActionCard\n              icon="shield"`);
code = code.replace(/\{isHRD && \(\s*<ActionCard\s*icon="eye"/, `{hasPermission("screen.live_tracking") && (\n            <ActionCard\n              icon="eye"`);
code = code.replace(/\{isHRD && \(\s*<ActionCard\s*icon="map"\s*label="In Transit Monitor"/, `{hasPermission("screen.live_tracking") && (\n            <ActionCard\n              icon="map"\n              label="In Transit Monitor"`);
code = code.replace(/\{isHRD && \(\s*<ActionCard\s*icon="smartphone"\s*label="Duplicate Devices"/, `{hasPermission("screen.check_in_logs") && (\n            <ActionCard\n              icon="smartphone"\n              label="Duplicate Devices"`);
code = code.replace(/\{isHRD && \(\s*<ActionCard\s*icon="settings"\s*label="Office Settings"/, `{hasPermission("screen.office_settings") && (\n            <ActionCard\n              icon="settings"\n              label="Office Settings"`);
code = code.replace(/\{isHRD && \(\s*<ActionCard\s*icon="map-pin"\s*label="Site Settings"/, `{hasPermission("screen.site_settings") && (\n            <ActionCard\n              icon="map-pin"\n              label="Site Settings"`);
code = code.replace(/\{isHRD && \(\s*<ActionCard\s*icon="activity"\s*label="Activity Analysis"/, `{hasPermission("screen.live_tracking") && (\n            <ActionCard\n              icon="activity"\n              label="Activity Analysis"`);
code = code.replace(/\{isHRD && \(\s*<ActionCard\s*icon="bell"\s*label="Send Notification"/, `{hasPermission("screen.notification_management") && (\n            <ActionCard\n              icon="bell"\n              label="Send Notification"`);
code = code.replace(/\{isHRD && \(\s*<ActionCard\s*icon="file-text"\s*label="Audit Logs"/, `{hasPermission("screen.audit_logs") && (\n            <ActionCard\n              icon="file-text"\n              label="Audit Logs"`);

fs.writeFileSync("screens/admin/AdminDashboardScreen.tsx", code);
console.log("Updated AdminDashboardScreen with permissions");
