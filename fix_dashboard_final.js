const fs = require("fs");
let code = fs.readFileSync("screens/admin/AdminDashboardScreen.tsx", "utf-8");

code = code.replace(/import \{ DashboardSummaryService \} from "@\/services\/dashboard-summary\.service";/, `import { DashboardSummaryService } from "@/services/dashboard-summary.service";\nimport { usePermissions } from "@/hooks/usePermissions";`);
code = code.replace(/const isHR = user\?\.role === "HR" \|\| user\?\.role === "SYSTEM_ADMIN";\n  const isHRD = user\?\.role === "HRD" \|\| user\?\.role === "SYSTEM_ADMIN";\n  const isAdmin = user\?\.role === "ADMIN" \|\| user\?\.role === "SYSTEM_ADMIN";/, `const isHR = user?.role === "HR" || user?.role === "SYSTEM_ADMIN";\n  const isHRD = user?.role === "HRD" || user?.role === "SYSTEM_ADMIN";\n  const isAdmin = user?.role === "ADMIN" || user?.role === "SYSTEM_ADMIN";\n  const { hasPermission } = usePermissions();`);

// Array of exact replacements for the naked ActionCards
const plainCards = [
  { dest: `"UserManagement"`, perm: "screen.user_management" },
  { dest: `"AttendanceControl"`, perm: "screen.attendance_control" },
  { dest: `"FieldVisitAdmin"`, perm: "screen.field_visit_admin" },
  { dest: `"TeamHierarchy"`, perm: "screen.team_hierarchy" },
  { dest: `"CheckInLogs"`, perm: "screen.check_in_logs" },
  { dest: `"SuspiciousAttendance"`, perm: "screen.suspicious_attendance" },
  { dest: `"AttendanceCalendar"`, perm: "screen.attendance_control" },
  { dest: `"AttendanceRegularization"`, perm: "screen.attendance_regularization" },
  { dest: `"AdvancedAttendanceReport"`, perm: "screen.attendance_control" },
  { dest: `"EventManagement"`, perm: "screen.event_management" },
  { dest: `"LeaveBalance"`, perm: "screen.leave_balance" },
  { dest: `"SmartOfficeIntegration"`, perm: "screen.smartoffice_integration" },
  { dest: `"BiometricUserMatch"`, perm: "screen.smartoffice_integration" },
  { dest: `"SmartOfficeEmployeeImport"`, perm: "screen.user_management" },
  { dest: `"SmartOfficeImportedData"`, perm: "screen.smartoffice_integration" }
];

for (const p of plainCards) {
  const regex = new RegExp(`<ActionCard[^>]*?onPress=\{\\(\\) => navigation\\.navigate\\(${p.dest}\\)\\}\\s*\\/>`, "g");
  code = code.replace(regex, `{hasPermission("${p.perm}") && ($&)}`);
}

// Array of replacements for the ones wrapped in isHRD
const hrdCards = [
  { dest: `"PermissionsManager"`, perm: "SYSTEM_ADMIN" },
  { dest: `"SiteVisitObserver"`, perm: "screen.live_tracking" },
  { dest: `"InTransit"`, perm: "screen.live_tracking" },
  { dest: `"AdminDeviceSessions"`, perm: "screen.check_in_logs" },
  { dest: `"OfficeSettings"`, perm: "screen.office_settings" },
  { dest: `"SiteSettings"`, perm: "screen.site_settings" },
  { dest: `"ActivityAnalysis"`, perm: "screen.live_tracking" },
  { dest: `"NotificationManagement"`, perm: "screen.notification_management" },
  { dest: `"AuditLogs"`, perm: "screen.audit_logs" }
];

for (const p of hrdCards) {
  const regex = new RegExp(`\\{isHRD && \\(\\s*<ActionCard[^>]*?onPress=\{\\(\\) => navigation\\.navigate\\(${p.dest}\\)\\}\\s*\\/>\\s*\\)\\}`, "g");
  code = code.replace(regex, `{hasPermission("${p.perm}") && ($&)}`.replace("{isHRD && (", "").replace(")}", ""));
}

// Inject AnonymousFeedback after AuditLogs
const auditLogsInjection = `{hasPermission("screen.audit_logs") && (
            <ActionCard
              icon="file-text"
              label="Audit Logs"
              desc="System activity trail"
              onPress={() => navigation.navigate("AuditLogs")}
            />
          )}
          {hasPermission("screen.anonymous_feedback") && (
            <ActionCard
              icon="message-square"
              label="Anonymous Feedback"
              desc="View employee suggestions"
              color="#EC4899"
              onPress={() => navigation.navigate("AnonymousFeedback")}
            />
          )}`;
code = code.replace(/\{hasPermission\("screen\.audit_logs"\) && \(\s*<ActionCard[^>]*?onPress=\{\(\) => navigation\.navigate\("AuditLogs"\)\}\s*\/>\s*\)\}/g, auditLogsInjection);

fs.writeFileSync("screens/admin/AdminDashboardScreen.tsx", code);
console.log("Updated AdminDashboardScreen precisely");
