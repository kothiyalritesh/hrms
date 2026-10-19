import React from "react";
import { ActivityIndicator, View } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import ReportsHubScreen from "@/screens/admin/ReportsHubScreen";
import { useTheme } from "@/hooks/useTheme";
import { getCommonScreenOptions } from "@/navigation/screenOptions";
import { withPermissionGuard } from "@/components/PermissionGuard";
import { SCREEN_PERMISSIONS } from "@/constants/permissionCatalog";
// Dedicated report screens (screens/reports/)
import AttendanceRegisterReportScreen from "@/screens/reports/AttendanceRegisterReportScreen";
import LateArrivalReportScreen from "@/screens/reports/LateArrivalReportScreen";
import GeofenceEventsReportScreen from "@/screens/reports/GeofenceEventsReportScreen";
import LeaveUsageReportScreen from "@/screens/reports/LeaveUsageReportScreen";
import OvertimeReportScreen from "@/screens/reports/OvertimeReportScreen";
import DownloadCentreScreen from "@/screens/reports/DownloadCentreScreen";

export type ReportsStackParamList = {
  ReportsHub: undefined;
  ReportsAttendance: undefined;
  ReportsAdvancedAttendance: { initialSection?: string } | undefined;
  ReportsFieldVisits: undefined;
  ReportsLeaves: undefined;
  ReportsRegularization: undefined;
  ReportsBiometric: undefined;
  ReportsActivity: undefined;
  ReportsTracking: undefined;
  ReportsGps: undefined;
  ReportsIntelligence: undefined;
  ReportsCheckInLogs: undefined;
  ReportsLeaveBalance: undefined;
  ReportsTeamHierarchy: undefined;
  ReportsAuditLogs: undefined;
  ReportsDownloads: { initialSection?: string } | undefined;
  ReportsAttendanceRegister: undefined;
  ReportsLateArrival: undefined;
  ReportsGeofenceEvents: undefined;
  ReportsLeaveUsage: undefined;
  ReportsOvertime: undefined;
  ReportsDownloadCentre: undefined;
};

const Stack = createNativeStackNavigator<ReportsStackParamList>();

function deferred(loader: () => Promise<{ default: React.ComponentType<any> }>) {
  const Lazy = React.lazy(loader);
  return (props: any) => (
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
}

// Every report route is guarded with the same keys the server checks.
const guard = (route: keyof typeof SCREEN_PERMISSIONS, Component: React.ComponentType<any>) =>
  withPermissionGuard(Component, SCREEN_PERMISSIONS[route]);

const Attendance    = deferred(() => import("@/screens/admin/AttendanceControlScreenNew"));
const Advanced      = deferred(() => import("@/screens/admin/AdvancedAttendanceReportScreen"));
const FieldVisits   = deferred(() => import("@/screens/admin/FieldVisitAdminScreen"));
const Leaves        = deferred(() => import("@/screens/admin/LeaveManagementScreen"));
const Regularization = deferred(() => import("@/screens/admin/AttendanceRegularizationScreen"));
const Biometric     = deferred(() => import("@/screens/admin/BiometricUserMatchScreen"));
const Activity      = deferred(() => import("@/screens/admin/ActivityAnalysisScreen"));
const Tracking      = deferred(() => import("@/screens/admin/LiveTrackingScreen"));
const Gps           = deferred(() => import("@/screens/admin/SuspiciousAttendanceScreen"));
const Intelligence  = deferred(() => import("@/screens/admin/AttendanceIntelligenceScreen"));
const CheckInLogs   = deferred(() => import("@/screens/admin/CheckInLogsScreen"));
// Read-only balance table (same rpc_admin_leave_balance_summary query as the
// Admin tab's LeaveBalanceScreen, without its add / remove / reset actions).
const LeaveBalance  = deferred(() => import("@/screens/reports/LeaveBalanceSummaryReportScreen"));
const TeamHierarchy = deferred(() => import("@/screens/admin/TeamHierarchyScreen"));
const AuditLogs     = deferred(() => import("@/screens/admin/AuditLogsScreen"));

const GuardedReportsAttendance = guard("ReportsAttendance", Attendance);
const GuardedReportsAdvancedAttendance = guard("ReportsAdvancedAttendance", Advanced);
const GuardedReportsFieldVisits = guard("ReportsFieldVisits", FieldVisits);
const GuardedReportsLeaves = guard("ReportsLeaves", Leaves);
const GuardedReportsRegularization = guard("ReportsRegularization", Regularization);
const GuardedReportsBiometric = guard("ReportsBiometric", Biometric);
const GuardedReportsActivity = guard("ReportsActivity", Activity);
const GuardedReportsTracking = guard("ReportsTracking", Tracking);
const GuardedReportsGps = guard("ReportsGps", Gps);
const GuardedReportsIntelligence = guard("ReportsIntelligence", Intelligence);
const GuardedReportsCheckInLogs = guard("ReportsCheckInLogs", CheckInLogs);
const GuardedReportsLeaveBalance = guard("ReportsLeaveBalance", LeaveBalance);
const GuardedReportsTeamHierarchy = guard("ReportsTeamHierarchy", TeamHierarchy);
const GuardedReportsAuditLogs = guard("ReportsAuditLogs", AuditLogs);
const GuardedReportsDownloads = guard("ReportsDownloads", Advanced);
const GuardedReportsAttendanceRegister = guard("ReportsAttendanceRegister", AttendanceRegisterReportScreen);
const GuardedReportsLateArrival = guard("ReportsLateArrival", LateArrivalReportScreen);
const GuardedReportsGeofenceEvents = guard("ReportsGeofenceEvents", GeofenceEventsReportScreen);
const GuardedReportsLeaveUsage = guard("ReportsLeaveUsage", LeaveUsageReportScreen);
const GuardedReportsOvertime = guard("ReportsOvertime", OvertimeReportScreen);
const GuardedReportsDownloadCentre = guard("ReportsDownloadCentre", DownloadCentreScreen);

export default function ReportsStackNavigator() {
  const { theme, isDark } = useTheme();
  const screenOptions = getCommonScreenOptions({ theme, isDark });

  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen name="ReportsHub"                component={ReportsHubScreen} options={{ headerTitle: "Reports" }} />
      <Stack.Screen name="ReportsAttendance"         component={GuardedReportsAttendance}       options={{ headerTitle: "Attendance Summary" }} />
      <Stack.Screen name="ReportsAdvancedAttendance" component={GuardedReportsAdvancedAttendance}         options={{ headerTitle: "Attendance Report" }} />
      <Stack.Screen name="ReportsFieldVisits"        component={GuardedReportsFieldVisits}      options={{ headerTitle: "Field Visit Report" }} />
      <Stack.Screen name="ReportsLeaves"             component={GuardedReportsLeaves}           options={{ headerTitle: "Leave Report" }} />
      <Stack.Screen name="ReportsRegularization"     component={GuardedReportsRegularization}   options={{ headerTitle: "Regularization Report" }} />
      <Stack.Screen name="ReportsBiometric"          component={GuardedReportsBiometric}        options={{ headerTitle: "Biometric Reconciliation" }} />
      <Stack.Screen name="ReportsActivity"           component={GuardedReportsActivity}         options={{ headerTitle: "Activity Analysis" }} />
      <Stack.Screen name="ReportsTracking"           component={GuardedReportsTracking}         options={{ headerTitle: "Live Tracking" }} />
      <Stack.Screen name="ReportsGps"                component={GuardedReportsGps}              options={{ headerTitle: "Suspicious Attendance" }} />
      <Stack.Screen name="ReportsIntelligence"       component={GuardedReportsIntelligence}     options={{ headerTitle: "Attendance Intelligence" }} />
      <Stack.Screen name="ReportsCheckInLogs"        component={GuardedReportsCheckInLogs}      options={{ headerTitle: "Today's Check-In Log" }} />
      <Stack.Screen name="ReportsLeaveBalance"       component={GuardedReportsLeaveBalance}     options={{ headerTitle: "Leave Balances" }} />
      <Stack.Screen name="ReportsTeamHierarchy"      component={GuardedReportsTeamHierarchy}    options={{ headerTitle: "Team Hierarchy" }} />
      <Stack.Screen name="ReportsAuditLogs"          component={GuardedReportsAuditLogs}        options={{ headerTitle: "Audit Trail" }} />
      {/* Legacy deep link (/reports/downloads): the Exports tab of the attendance report. */}
      <Stack.Screen name="ReportsDownloads"          component={GuardedReportsDownloads}         initialParams={{ initialSection: "Exports" }} options={{ headerTitle: "Attendance Exports" }} />
      {/* Dedicated report screens */}
      <Stack.Screen name="ReportsAttendanceRegister" component={GuardedReportsAttendanceRegister} options={{ headerTitle: "Monthly Register" }} />
      <Stack.Screen name="ReportsLateArrival"        component={GuardedReportsLateArrival}        options={{ headerTitle: "Late Arrivals" }} />
      <Stack.Screen name="ReportsGeofenceEvents"     component={GuardedReportsGeofenceEvents}     options={{ headerTitle: "Geofence Events" }} />
      <Stack.Screen name="ReportsLeaveUsage"         component={GuardedReportsLeaveUsage}         options={{ headerTitle: "Leave Usage" }} />
      <Stack.Screen name="ReportsOvertime"           component={GuardedReportsOvertime}           options={{ headerTitle: "Overtime & Comp-Off" }} />
      <Stack.Screen name="ReportsDownloadCentre"     component={GuardedReportsDownloadCentre}           options={{ headerTitle: "Download Centre" }} />
    </Stack.Navigator>
  );
}
