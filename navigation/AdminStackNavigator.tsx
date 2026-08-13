import React from "react";
import { ActivityIndicator, View } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import AdminDashboardScreen from "@/screens/admin/AdminDashboardScreen";
import { HeaderTitle } from "@/components/HeaderTitle";
import { useTheme } from "@/hooks/useTheme";
import { getCommonScreenOptions } from "@/navigation/screenOptions";

export type AdminStackParamList = {
  AdminDashboard: undefined;
  UserManagement: undefined;
  AttendanceControl: undefined;
  LeaveManagement: undefined;
  TaskProjectControl: undefined;
  NotificationManagement: undefined;
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
) {
  const Lazy = React.lazy(loader);
  return function DeferredScreen(props: React.ComponentProps<T>) {
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
}

const AttendanceControlScreen = lazyScreen(() =>
  import("@/screens/admin/AttendanceControlScreenNew"),
);
const UserManagementScreen = lazyScreen(() => import("@/screens/admin/UserManagementScreen"));
const LeaveManagementScreen = lazyScreen(() => import("@/screens/admin/LeaveManagementScreen"));
const TaskProjectControlScreen = lazyScreen(() => import("@/screens/admin/TaskProjectControlScreen"));
const NotificationManagementScreen = lazyScreen(() => import("@/screens/admin/NotificationManagementScreen"));
const OfficeSettingsScreen = lazyScreen(() => import("@/screens/admin/OfficeSettingsScreen"));
const SiteSettingsScreen = lazyScreen(() => import("@/screens/admin/SiteSettingsScreen"));
const AuditLogsScreen = lazyScreen(() => import("@/screens/admin/AuditLogsScreen"));
const ActivityAnalysisScreen = lazyScreen(() => import("@/screens/admin/ActivityAnalysisScreen"));
const FieldVisitAdminScreen = lazyScreen(() => import("@/screens/admin/FieldVisitAdminScreen"));
const LiveTrackingScreen = lazyScreen(() => import("@/screens/admin/LiveTrackingScreen"));
const TicketManagementScreen = lazyScreen(() => import("@/screens/admin/TicketManagementScreen"));
const EventManagementScreen = lazyScreen(() => import("@/screens/admin/EventManagementScreen"));
const CheckInLogsScreen = lazyScreen(() => import("@/screens/admin/CheckInLogsScreen"));
const TVDisplayScreen = lazyScreen(() => import("@/screens/admin/TVDisplayScreen"));
const LeaveBalanceScreen = lazyScreen(() => import("@/screens/admin/LeaveBalanceScreen"));
const BiometricUserMatchScreen = lazyScreen(() => import("@/screens/admin/BiometricUserMatchScreen"));
const SuspiciousAttendanceScreen = lazyScreen(() => import("@/screens/admin/SuspiciousAttendanceScreen"));
const AttendanceCalendarScreen = lazyScreen(() => import("@/screens/admin/AttendanceCalendarScreen"));
const AttendanceRegularizationScreen = lazyScreen(() => import("@/screens/admin/AttendanceRegularizationScreen"));
const AdvancedAttendanceReportScreen = lazyScreen(() => import("@/screens/admin/AdvancedAttendanceReportScreen"));
const TeamHierarchyScreen = lazyScreen(() =>
  import("@/screens/admin/TeamHierarchyScreen"),
);
const SmartOfficeIntegrationScreen = lazyScreen(() =>
  import("@/screens/admin/SmartOfficeSecureSyncScreen").then((module) => ({
    default: module.SmartOfficeSecureSyncScreen,
  })),
);
const SmartOfficeEmployeeImport = lazyScreen(() =>
  import("@/screens/admin/SmartOfficeEmployeeImport").then((module) => ({
    default: module.SmartOfficeEmployeeImport,
  })),
);
const SmartOfficeImportedData = lazyScreen(() =>
  import("@/screens/admin/SmartOfficeImportedData").then((module) => ({
    default: module.SmartOfficeImportedData,
  })),
);

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
    </Stack.Navigator>
  );
}
