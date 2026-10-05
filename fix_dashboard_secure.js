const fs = require("fs");
let code = fs.readFileSync("screens/admin/AdminDashboardScreen.tsx", "utf-8");

code = code.replace(/import \{ DashboardSummaryService \} from "@\/services\/dashboard-summary\.service";/, `import { DashboardSummaryService } from "@/services/dashboard-summary.service";\nimport { usePermissions } from "@/hooks/usePermissions";`);

code = code.replace(/const isHR = user\?\.role === "HR" \|\| user\?\.role === "SYSTEM_ADMIN";\n  const isHRD = user\?\.role === "HRD" \|\| user\?\.role === "SYSTEM_ADMIN";\n  const isAdmin = user\?\.role === "ADMIN" \|\| user\?\.role === "SYSTEM_ADMIN";/, `const isHR = user?.role === "HR" || user?.role === "SYSTEM_ADMIN";\n  const isHRD = user?.role === "HRD" || user?.role === "SYSTEM_ADMIN";\n  const isAdmin = user?.role === "ADMIN" || user?.role === "SYSTEM_ADMIN";\n  const { hasPermission } = usePermissions();`);

const replacements = [
  { match: /<ActionCard[^>]*?onPress=\{\(\) => navigation\.navigate\("UserManagement"\)\}\s*\/>/, perm: "screen.user_management" },
  { match: /<ActionCard[^>]*?onPress=\{\(\) => navigation\.navigate\("AttendanceControl"\)\}\s*\/>/, perm: "screen.attendance_control" },
  { match: /<ActionCard[^>]*?onPress=\{\(\) => navigation\.navigate\("FieldVisitAdmin"\)\}\s*\/>/, perm: "screen.field_visit_admin" },
  { match: /<ActionCard[^>]*?onPress=\{\(\) => navigation\.navigate\("TeamHierarchy"\)\}\s*\/>/, perm: "screen.team_hierarchy" },
  { match: /<ActionCard[^>]*?onPress=\{\(\) => navigation\.navigate\("CheckInLogs"\)\}\s*\/>/, perm: "screen.check_in_logs" },
  { match: /<ActionCard[^>]*?onPress=\{\(\) => navigation\.navigate\("SuspiciousAttendance"\)\}\s*\/>/, perm: "screen.suspicious_attendance" },
  { match: /<ActionCard[^>]*?onPress=\{\(\) => navigation\.navigate\("AttendanceCalendar"\)\}\s*\/>/, perm: "screen.attendance_control" },
  { match: /<ActionCard[^>]*?onPress=\{\(\) => navigation\.navigate\("AttendanceRegularization"\)\}\s*\/>/, perm: "screen.attendance_regularization" },
  { match: /<ActionCard[^>]*?onPress=\{\(\) => navigation\.navigate\("AdvancedAttendanceReport"\)\}\s*\/>/, perm: "screen.attendance_control" },
  { match: /<ActionCard[^>]*?onPress=\{\(\) => navigation\.navigate\("EventManagement"\)\}\s*\/>/, perm: "screen.event_management" },
  { match: /<ActionCard[^>]*?onPress=\{\(\) => navigation\.navigate\("LeaveBalance"\)\}\s*\/>/, perm: "screen.leave_balance" },
  { match: /<ActionCard[^>]*?onPress=\{\(\) => navigation\.navigate\("SmartOfficeIntegration"\)\}\s*\/>/, perm: "screen.smartoffice_integration" },
  { match: /<ActionCard[^>]*?onPress=\{\(\) => navigation\.navigate\("BiometricUserMatch"\)\}\s*\/>/, perm: "screen.smartoffice_integration" },
  { match: /<ActionCard[^>]*?onPress=\{\(\) => navigation\.navigate\("SmartOfficeEmployeeImport"\)\}\s*\/>/, perm: "screen.user_management" },
  { match: /<ActionCard[^>]*?onPress=\{\(\) => navigation\.navigate\("SmartOfficeImportedData"\)\}\s*\/>/, perm: "screen.smartoffice_integration" },
];

for (const rep of replacements) {
  code = code.replace(rep.match, `{hasPermission("${rep.perm}") ? ($&) : null}`);
}

code = code.replace(/\{isHRD && \(\s*<ActionCard\s*icon="shield"/, `{hasPermission("SYSTEM_ADMIN") ? (\n            <ActionCard\n              icon="shield"`);
code = code.replace(/\{isHRD && \(\s*<ActionCard\s*icon="eye"/, `{hasPermission("screen.live_tracking") ? (\n            <ActionCard\n              icon="eye"`);
code = code.replace(/\{isHRD && \(\s*<ActionCard\s*icon="map"\s*label="In Transit Monitor"/, `{hasPermission("screen.live_tracking") ? (\n            <ActionCard\n              icon="map"\n              label="In Transit Monitor"`);
code = code.replace(/\{isHRD && \(\s*<ActionCard\s*icon="smartphone"\s*label="Duplicate Devices"/, `{hasPermission("screen.check_in_logs") ? (\n            <ActionCard\n              icon="smartphone"\n              label="Duplicate Devices"`);
code = code.replace(/\{isHRD && \(\s*<ActionCard\s*icon="settings"\s*label="Office Settings"/, `{hasPermission("screen.office_settings") ? (\n            <ActionCard\n              icon="settings"\n              label="Office Settings"`);
code = code.replace(/\{isHRD && \(\s*<ActionCard\s*icon="map-pin"\s*label="Site Settings"/, `{hasPermission("screen.site_settings") ? (\n            <ActionCard\n              icon="map-pin"\n              label="Site Settings"`);
code = code.replace(/\{isHRD && \(\s*<ActionCard\s*icon="activity"\s*label="Activity Analysis"/, `{hasPermission("screen.live_tracking") ? (\n            <ActionCard\n              icon="activity"\n              label="Activity Analysis"`);
code = code.replace(/\{isHRD && \(\s*<ActionCard\s*icon="bell"\s*label="Send Notification"/, `{hasPermission("screen.notification_management") ? (\n            <ActionCard\n              icon="bell"\n              label="Send Notification"`);

// For Audit Logs, we also inject the AnonymousFeedback right after it!
const auditLogsInjection = `{hasPermission("screen.audit_logs") ? (
            <ActionCard
              icon="file-text"
              label="Audit Logs"
              desc="System activity trail"
              onPress={() => navigation.navigate("AuditLogs")}
            />
          ) : null}
          {hasPermission("screen.anonymous_feedback") ? (
            <ActionCard
              icon="message-square"
              label="Anonymous Feedback"
              desc="View employee suggestions"
              color="#EC4899"
              onPress={() => navigation.navigate("AnonymousFeedback")}
            />
          ) : null}`;
code = code.replace(/\{isHRD && \(\s*<ActionCard\s*icon="file-text"\s*label="Audit Logs"\s*desc="System activity trail"\s*onPress=\{\(\) => navigation\.navigate\("AuditLogs"\)\}\s*\/>\s*\)\}/, auditLogsInjection);

// Close the ternary replacements! 
code = code.replace(/desc="Role-based access control"\s*\/>\s*\)\}/g, `desc="Role-based access control"\n            />\n          ) : null}`);
code = code.replace(/desc="Monitor field visits"\s*\/>\s*\)\}/g, `desc="Monitor field visits"\n            />\n          ) : null}`);
code = code.replace(/desc="Track employee commutes"\s*\/>\s*\)\}/g, `desc="Track employee commutes"\n            />\n          ) : null}`);
code = code.replace(/desc="Detect buddy punching"\s*\/>\s*\)\}/g, `desc="Detect buddy punching"\n            />\n          ) : null}`);
code = code.replace(/desc="Offices, geofences and attendance rules"\s*\/>\s*\)\}/g, `desc="Offices, geofences and attendance rules"\n            />\n          ) : null}`);
code = code.replace(/desc="Projects, saved sites and geofences"\s*\/>\s*\)\}/g, `desc="Projects, saved sites and geofences"\n            />\n          ) : null}`);
code = code.replace(/desc="Employee activity deep dive"\s*\/>\s*\)\}/g, `desc="Employee activity deep dive"\n            />\n          ) : null}`);
code = code.replace(/desc="Push to all or specific users"\s*\/>\s*\)\}/g, `desc="Push to all or specific users"\n            />\n          ) : null}`);

fs.writeFileSync("screens/admin/AdminDashboardScreen.tsx", code);
console.log("Updated AdminDashboardScreen properly this time!");
