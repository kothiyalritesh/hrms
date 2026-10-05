import React from "react";
import { ActivityIndicator, View } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import AdminDashboardScreen from "@/screens/admin/AdminDashboardScreen";
import { HeaderTitle } from "@/components/HeaderTitle";
import { useTheme } from "@/hooks/useTheme";
import { getCommonScreenOptions } from "@/navigation/screenOptions";
import { deferredScreen } from "@/navigation/deferredScreen";
import { withPermissionGuard } from "@/components/PermissionGuard";

export type AdminStackParamList = {
  AnonymousFeedback: undefined;
  EmployeeBirthdayManagement: undefined;
  PermissionsManager: undefined;
  SiteVisitObserver: { visitId?: string } | undefined;
  InTransit: undefined;
  AdminDashboard: undefined;
  UserManagement: undefined;
  AttendanceControl: undefined;
  LeaveManagement: undefined;
  TaskProjectControl: undefined;
  NotificationManagement: undefined;
  AdminDeviceSessions: undefined;
  OfficeSettings: undefined;
  SiteSettings: undefined;
  AuditLogs: undefined;
  ActivityAnalysis: undefined;
  FieldVisitAdmin: undefined;
  LiveTracking: undefined;
  TeamHierarchy: undefined;
  TicketManagement: undefined;
  EventManagement: undefined;
  CheckInLogs: undefined;
  TVDisplay: undefined;
  LeaveBalance: undefined;
  SmartOfficeIntegration: undefined;
  SmartOfficeEmployeeImport: undefined;
  SmartOfficeImportedData: undefined;
  BiometricUserMatch: undefined;
  SuspiciousAttendance: undefined;
  AttendanceCalendar: undefined;
  AttendanceRegularization: undefined;
  AdvancedAttendanceReport: undefined;
};

const Stack = createNativeStackNavigator<AdminStackParamList>();

function lazyScreen<T extends React.ComponentType<any>>(
  loader: () => Promise<{ default: T }>,
  permission?: string | string[]
) {
  const Lazy = React.lazy(loader);
  const DeferredScreen = function (props: React.ComponentProps<T>) {
    return (
      <React.Suspense
        fallback={
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <ActivityIndicator />
          </View>
        }
      >
        <Lazy {...props} />
      </React.Suspense>
    );
  };
  return permission ? withPermissionGuard(DeferredScreen, permission) : DeferredScreen;
}

const AttendanceControlScreen = lazyScreen(() => import("@/screens/admin/AttendanceControlScreenNew"), ["screen.attendance_control", "attendance.view", "attendance.edit", "attendance.approve"]);
const UserManagementScreen = lazyScreen(() => import("@/screens/admin/UserManagementScreen"), ["screen.user_management", "employee.view", "employee.create", "employee.edit"]);
const LeaveManagementScreen = lazyScreen(() => import("@/screens/admin/LeaveManagementScreen"), ["screen.leave_balance", "leave.view", "leave.approve", "manage_leave"]);
const TaskProjectControlScreen = lazyScreen(() => import("@/screens/admin/TaskProjectControlScreen"), "screen.task_project_control");
const NotificationManagementScreen = lazyScreen(() => import("@/screens/admin/NotificationManagementScreen"), "screen.notification_management"); 
const AnonymousFeedbackScreen = withPermissionGuard(deferredScreen(() => import("@/screens/admin/AnonymousFeedbackScreen")), "screen.anonymous_feedback");
const AdminDeviceSessionsScreen = lazyScreen(() => import("@/screens/admin/AdminDeviceSessionsScreen"), "screen.duplicate_devices");
const OfficeSettingsScreen = lazyScreen(() => import("@/screens/admin/OfficeSettingsScreen"), "screen.office_settings");
const SiteSettingsScreen = lazyScreen(() => import("@/screens/admin/SiteSettingsScreen"), "screen.site_settings");
const AuditLogsScreen = lazyScreen(() => import("@/screens/admin/AuditLogsScreen"), "screen.audit_logs");
const BiometricDeviceManagementScreen = lazyScreen(() => import("@/screens/admin/BiometricDeviceManagementScreen"), ["screen.smartoffice_integration", "biometric.manage", "biometric.sync"]);
const ActivityAnalysisScreen = lazyScreen(() => import("@/screens/admin/ActivityAnalysisScreen"), ["screen.live_tracking", "location.view_live"]);
const FieldVisitAdminScreen = lazyScreen(() => import("@/screens/admin/FieldVisitAdminScreen"), "screen.field_visit_admin");
const LiveTrackingScreen = lazyScreen(() => import("@/screens/admin/LiveTrackingScreen"), ["screen.live_tracking", "location.view_live"]);
const TicketManagementScreen = lazyScreen(() => import("@/screens/admin/TicketManagementScreen"), "screen.ticket_management");
const EventManagementScreen = lazyScreen(() => import("@/screens/admin/EventManagementScreen"), "screen.event_management");
const CheckInLogsScreen = lazyScreen(() => import("@/screens/admin/CheckInLogsScreen"), "screen.check_in_logs");
const TVDisplayScreen = lazyScreen(() => import("@/screens/admin/TVDisplayScreen"));
const LeaveBalanceScreen = lazyScreen(() => import("@/screens/admin/LeaveBalanceScreen"), ["screen.leave_balance", "leave.view", "leave.approve", "manage_leave"]);
const BiometricUserMatchScreen = lazyScreen(() => import("@/screens/admin/BiometricUserMatchScreen"), "screen.smartoffice_integration");
const SuspiciousAttendanceScreen = lazyScreen(() => import("@/screens/admin/SuspiciousAttendanceScreen"), "screen.suspicious_attendance");
const AttendanceCalendarScreen = lazyScreen(() => import("@/screens/admin/AttendanceCalendarScreen"), ["screen.attendance_control", "attendance.view", "attendance.edit", "attendance.approve"]);
const AttendanceRegularizationScreen = lazyScreen(() => import("@/screens/admin/AttendanceRegularizationScreen"), "screen.attendance_regularization");
const AdvancedAttendanceReportScreen = lazyScreen(() => import("@/screens/admin/AdvancedAttendanceReportScreen"), ["screen.attendance_control", "attendance.view", "attendance.edit", "attendance.approve"]);
const TeamHierarchyScreen = lazyScreen(() => import("@/screens/admin/TeamHierarchyScreen"), "screen.team_hierarchy");
const SmartOfficeIntegrationScreen = lazyScreen(() => import("@/screens/admin/SmartOfficeSecureSyncScreen").then(m => ({ default: m.SmartOfficeSecureSyncScreen })), "screen.smartoffice_integration");
const PermissionsManagerScreen = lazyScreen(() => import("@/screens/admin/PermissionsManagerScreen"), "screen.permissions_manager");
const EmployeeBirthdayManagementScreen = lazyScreen(() => import("@/screens/admin/EmployeeBirthdayManagementScreen"), "screen.birthday_management");
const SiteVisitObserverScreen = lazyScreen(() => import("@/screens/admin/SiteVisitObserverScreen"), ["screen.site_visit_observer", "screen.live_tracking", "location.view_live"]);
const InTransitScreen = lazyScreen(() => import("@/screens/admin/InTransitScreen"), ["screen.in_transit", "screen.live_tracking", "location.view_live"]);

const SmartOfficeEmployeeImport = lazyScreen(() => import("@/screens/admin/SmartOfficeEmployeeImport").then(m => ({ default: m.SmartOfficeEmployeeImport })), ["screen.user_management", "employee.view", "employee.create", "employee.edit"]);
const SmartOfficeImportedData = lazyScreen(() => import("@/screens/admin/SmartOfficeImportedData").then(m => ({ default: m.SmartOfficeImportedData })), "screen.smartoffice_integration");

export default function AdminStackNavigator() {
  const { theme, isDark } = useTheme();

  return (
    <Stack.Navigator
      screenOptions={{
        ...getCommonScreenOptions({ theme, isDark }),
      }}
    >
      <Stack.Screen
        name="AdminDashboard"
        component={AdminDashboardScreen}
        options={{
          headerTitle: () => <HeaderTitle title="HR Panel" />,
        }}
      />
      <Stack.Screen
        name="UserManagement"
        component={UserManagementScreen}
        options={{ headerTitle: "User Management" }}
      />
      <Stack.Screen
        name="AttendanceControl"
        component={AttendanceControlScreen}
        options={{ headerTitle: "Attendance Control" }}
      />
      <Stack.Screen
        name="LeaveManagement"
        component={LeaveManagementScreen}
        options={{ headerTitle: "Leave Management" }}
      />
      <Stack.Screen
        name="TaskProjectControl"
        component={TaskProjectControlScreen}
        options={{ headerTitle: "Tasks & Projects" }}
      />
      
      <Stack.Screen
        name="AdminDeviceSessions"
        component={AdminDeviceSessionsScreen}
        options={{ headerTitle: "Duplicate Devices & Sessions" }}
      />

      <Stack.Screen
        name="NotificationManagement"
        component={NotificationManagementScreen}
        options={{ headerTitle: "Notifications" }}
      />
      <Stack.Screen
        name="OfficeSettings"
        component={OfficeSettingsScreen}
        options={{ headerTitle: "Offices & Settings" }}
      />
      <Stack.Screen
        name="SiteSettings"
        component={SiteSettingsScreen}
        options={{ headerTitle: "Sites & Geofences" }}
      />
      <Stack.Screen
        name="AuditLogs"
        component={AuditLogsScreen}
        options={{ headerTitle: "Audit & Logs" }}
      />
      <Stack.Screen
        name="ActivityAnalysis"
        component={ActivityAnalysisScreen}
        options={{ headerTitle: "Activity Analysis" }}
      />
      <Stack.Screen
        name="FieldVisitAdmin"
        component={FieldVisitAdminScreen}
        options={{ headerTitle: "Field Visits" }}
      />
      <Stack.Screen
        name="LiveTracking"
        component={LiveTrackingScreen}
        options={{ headerTitle: "Live Tracking" }}
      />
      <Stack.Screen
        name="TeamHierarchy"
        component={TeamHierarchyScreen}
        options={{ headerTitle: "Team Hierarchy" }}
      />
      <Stack.Screen
        name="TicketManagement"
        component={TicketManagementScreen}
        options={{ headerTitle: "Support Tickets" }}
      />
      <Stack.Screen
        name="EventManagement"
        component={EventManagementScreen}
        options={{ headerTitle: "Event Management" }}
      />
      <Stack.Screen
        name="CheckInLogs"
        component={CheckInLogsScreen}
        options={{ headerTitle: "Check-In Logs" }}
      />
      <Stack.Screen
        name="TVDisplay"
        component={TVDisplayScreen}
        options={{
          headerShown: false,
          headerTitle: "TV Display",
        }}
      />
      <Stack.Screen
        name="LeaveBalance"
        component={LeaveBalanceScreen}
        options={{ headerTitle: "Leave Balance" }}
      />
      <Stack.Screen
        name="SmartOfficeIntegration"
        component={SmartOfficeIntegrationScreen}
        options={{ headerTitle: "SmartOffice Integration" }}
      />
      <Stack.Screen
        name="SmartOfficeEmployeeImport"
        component={SmartOfficeEmployeeImport}
        options={{ headerTitle: "Employee Import" }}
      />
      <Stack.Screen
        name="SmartOfficeImportedData"
        component={SmartOfficeImportedData}
        options={{ headerTitle: "Imported Data" }}
      />
      <Stack.Screen
        name="BiometricUserMatch"
        component={BiometricUserMatchScreen}
        options={{ headerTitle: "Biometric User Matching" }}
      />
      <Stack.Screen
        name="SuspiciousAttendance"
        component={SuspiciousAttendanceScreen}
        options={{ headerTitle: "Suspicious Attendance" }}
      />
      <Stack.Screen name="AttendanceCalendar" component={AttendanceCalendarScreen} options={{ headerTitle: "Weekly Offs & Holidays" }} />
      <Stack.Screen name="AttendanceRegularization" component={AttendanceRegularizationScreen} options={{ headerTitle: "Attendance Regularization" }} />
      <Stack.Screen name="AdvancedAttendanceReport" component={AdvancedAttendanceReportScreen} options={{ headerTitle: "Advanced Attendance Report" }} />
      <Stack.Screen name="PermissionsManager" component={PermissionsManagerScreen} options={{ headerTitle: "Permissions Manager" }} />
      <Stack.Screen name="EmployeeBirthdayManagement" component={EmployeeBirthdayManagementScreen} options={{ headerTitle: "Manage Birthdays" }} />
      <Stack.Screen name="SiteVisitObserver" component={SiteVisitObserverScreen} options={{ headerTitle: "Site Visit Observer" }} />
      <Stack.Screen name="InTransit" component={InTransitScreen} options={{ headerTitle: "In Transit Monitor" }} />
        <Stack.Screen name="AnonymousFeedback" component={AnonymousFeedbackScreen} options={{ headerTitle: "Anonymous Feedback" }} />
    </Stack.Navigator>
  );
}







