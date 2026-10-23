import React from "react";
import { ActivityIndicator, View } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import AdminDashboardScreen from "@/screens/admin/AdminDashboardScreen";
import { HeaderTitle } from "@/components/HeaderTitle";
import { useTheme } from "@/hooks/useTheme";
import { getCommonScreenOptions } from "@/navigation/screenOptions";
import { deferredScreen } from "@/navigation/deferredScreen";
import { withPermissionGuard } from "@/components/PermissionGuard";
import { SCREEN_PERMISSIONS } from "@/constants/permissionCatalog";

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
  OfficeExitReviews: undefined;
  LocationMonitor: undefined;
  BiometricDevices: undefined;
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
  ComplianceScores: undefined;
  AttendanceCalendar: undefined;
  AttendanceRegularization: undefined;
  BackdatedAttendance: { userId?: string; userName?: string; date?: string } | undefined;
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

const AttendanceControlScreen = lazyScreen(() => import("@/screens/admin/AttendanceControlScreenNew"), SCREEN_PERMISSIONS.AttendanceControl);
const UserManagementScreen = lazyScreen(() => import("@/screens/admin/UserManagementScreen"), SCREEN_PERMISSIONS.UserManagement);
const LeaveManagementScreen = lazyScreen(() => import("@/screens/admin/LeaveManagementScreen"), SCREEN_PERMISSIONS.LeaveManagement);
const TaskProjectControlScreen = lazyScreen(() => import("@/screens/admin/TaskProjectControlScreen"), SCREEN_PERMISSIONS.TaskProjectControl);
const NotificationManagementScreen = lazyScreen(() => import("@/screens/admin/NotificationManagementScreen"), SCREEN_PERMISSIONS.NotificationManagement);
const AnonymousFeedbackScreen = withPermissionGuard(deferredScreen(() => import("@/screens/admin/AnonymousFeedbackScreen")), SCREEN_PERMISSIONS.AnonymousFeedback);
const AdminDeviceSessionsScreen = lazyScreen(() => import("@/screens/admin/AdminDeviceSessionsScreen"), SCREEN_PERMISSIONS.AdminDeviceSessions);
const OfficeSettingsScreen = lazyScreen(() => import("@/screens/admin/OfficeSettingsScreen"), SCREEN_PERMISSIONS.OfficeSettings);
const SiteSettingsScreen = lazyScreen(() => import("@/screens/admin/SiteSettingsScreen"), SCREEN_PERMISSIONS.SiteSettings);
const AuditLogsScreen = lazyScreen(() => import("@/screens/admin/AuditLogsScreen"), SCREEN_PERMISSIONS.AuditLogs);
const BiometricDeviceManagementScreen = lazyScreen(() => import("@/screens/admin/BiometricDeviceManagementScreen"), SCREEN_PERMISSIONS.SmartOfficeIntegration);
const ActivityAnalysisScreen = lazyScreen(() => import("@/screens/admin/ActivityAnalysisScreen"), SCREEN_PERMISSIONS.ActivityAnalysis);
const FieldVisitAdminScreen = lazyScreen(() => import("@/screens/admin/FieldVisitAdminScreen"), SCREEN_PERMISSIONS.FieldVisitAdmin);
const LiveTrackingScreen = lazyScreen(() => import("@/screens/admin/LiveTrackingScreen"), SCREEN_PERMISSIONS.LiveTracking);
const BiometricDevicesScreen = lazyScreen(() => import("@/screens/admin/BiometricDevicesScreen"), SCREEN_PERMISSIONS.BiometricDevices);
const LocationMonitorScreen = lazyScreen(() => import("@/screens/admin/LocationMonitorScreen"), SCREEN_PERMISSIONS.LocationMonitor);
const OfficeExitReviewsScreen = lazyScreen(() => import("@/screens/admin/OfficeExitReviewsScreen"), SCREEN_PERMISSIONS.OfficeExitReviews);
const TicketManagementScreen = lazyScreen(() => import("@/screens/admin/TicketManagementScreen"), SCREEN_PERMISSIONS.TicketManagement);
const EventManagementScreen = lazyScreen(() => import("@/screens/admin/EventManagementScreen"), SCREEN_PERMISSIONS.EventManagement);
const CheckInLogsScreen = lazyScreen(() => import("@/screens/admin/CheckInLogsScreen"), SCREEN_PERMISSIONS.CheckInLogs);
const TVDisplayScreen = lazyScreen(() => import("@/screens/admin/TVDisplayScreen"), SCREEN_PERMISSIONS.TVDisplay);
const LeaveBalanceScreen = lazyScreen(() => import("@/screens/admin/LeaveBalanceScreen"), SCREEN_PERMISSIONS.LeaveBalance);
const BiometricUserMatchScreen = lazyScreen(() => import("@/screens/admin/BiometricUserMatchScreen"), SCREEN_PERMISSIONS.BiometricUserMatch);
const SuspiciousAttendanceScreen = lazyScreen(() => import("@/screens/admin/SuspiciousAttendanceScreen"), SCREEN_PERMISSIONS.SuspiciousAttendance);
const ComplianceScoresScreen = lazyScreen(() => import("@/screens/admin/ComplianceScoresScreen"), SCREEN_PERMISSIONS.ComplianceScores);
const AttendanceCalendarScreen = lazyScreen(() => import("@/screens/admin/AttendanceCalendarScreen"), SCREEN_PERMISSIONS.AttendanceCalendar);
const AttendanceRegularizationScreen = lazyScreen(() => import("@/screens/admin/AttendanceRegularizationScreen"), SCREEN_PERMISSIONS.AttendanceRegularization);
const BackdatedAttendanceScreen = lazyScreen(() => import("@/screens/admin/BackdatedAttendanceScreen"), SCREEN_PERMISSIONS.BackdatedAttendance);
const AdvancedAttendanceReportScreen = lazyScreen(() => import("@/screens/admin/AdvancedAttendanceReportScreen"), SCREEN_PERMISSIONS.AdvancedAttendanceReport);
const TeamHierarchyScreen = lazyScreen(() => import("@/screens/admin/TeamHierarchyScreen"), SCREEN_PERMISSIONS.TeamHierarchy);
const SmartOfficeIntegrationScreen = lazyScreen(() => import("@/screens/admin/SmartOfficeSecureSyncScreen").then(m => ({ default: m.SmartOfficeSecureSyncScreen })), SCREEN_PERMISSIONS.SmartOfficeIntegration);
const PermissionsManagerScreen = lazyScreen(() => import("@/screens/admin/PermissionsManagerScreen"), SCREEN_PERMISSIONS.PermissionsManager);
const EmployeeBirthdayManagementScreen = lazyScreen(() => import("@/screens/admin/EmployeeBirthdayManagementScreen"), SCREEN_PERMISSIONS.EmployeeBirthdayManagement);
const SiteVisitObserverScreen = lazyScreen(() => import("@/screens/admin/SiteVisitObserverScreen"), SCREEN_PERMISSIONS.SiteVisitObserver);
const InTransitScreen = lazyScreen(() => import("@/screens/admin/InTransitScreen"), SCREEN_PERMISSIONS.InTransit);

const SmartOfficeEmployeeImport = lazyScreen(() => import("@/screens/admin/SmartOfficeEmployeeImport").then(m => ({ default: m.SmartOfficeEmployeeImport })), SCREEN_PERMISSIONS.SmartOfficeEmployeeImport);
const SmartOfficeImportedData = lazyScreen(() => import("@/screens/admin/SmartOfficeImportedData").then(m => ({ default: m.SmartOfficeImportedData })), SCREEN_PERMISSIONS.SmartOfficeImportedData);

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
        name="OfficeExitReviews"
        component={OfficeExitReviewsScreen}
        options={{ headerTitle: "Office Exits" }}
      />
      <Stack.Screen
        name="LocationMonitor"
        component={LocationMonitorScreen}
        options={{ headerTitle: "Location Monitor" }}
      />
      <Stack.Screen
        name="BiometricDevices"
        component={BiometricDevicesScreen}
        options={{ headerTitle: "Biometric Devices" }}
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
      <Stack.Screen name="ComplianceScores" component={ComplianceScoresScreen} options={{ headerTitle: "Compliance Scores" }} />
      <Stack.Screen name="AttendanceCalendar" component={AttendanceCalendarScreen} options={{ headerTitle: "Weekly Offs & Holidays" }} />
      <Stack.Screen name="AttendanceRegularization" component={AttendanceRegularizationScreen} options={{ headerTitle: "Attendance Regularization" }} />
      <Stack.Screen name="BackdatedAttendance" component={BackdatedAttendanceScreen} options={{ headerTitle: "Regularization Requests" }} />
      <Stack.Screen name="AdvancedAttendanceReport" component={AdvancedAttendanceReportScreen} options={{ headerTitle: "Advanced Attendance Report" }} />
      <Stack.Screen name="PermissionsManager" component={PermissionsManagerScreen} options={{ headerTitle: "Permissions Manager" }} />
      <Stack.Screen name="EmployeeBirthdayManagement" component={EmployeeBirthdayManagementScreen} options={{ headerTitle: "Manage Birthdays" }} />
      <Stack.Screen name="SiteVisitObserver" component={SiteVisitObserverScreen} options={{ headerTitle: "Site Visit Observer" }} />
      <Stack.Screen name="InTransit" component={InTransitScreen} options={{ headerTitle: "In Transit Monitor" }} />
        <Stack.Screen name="AnonymousFeedback" component={AnonymousFeedbackScreen} options={{ headerTitle: "Anonymous Feedback" }} />
    </Stack.Navigator>
  );
}







