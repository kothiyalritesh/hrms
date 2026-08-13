import React from "react";
import { ActivityIndicator, View } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import ReportsHubScreen from "@/screens/admin/ReportsHubScreen";
import { useTheme } from "@/hooks/useTheme";
import { getCommonScreenOptions } from "@/navigation/screenOptions";

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
  ReportsDownloads: { initialSection?: string } | undefined;
};

const Stack = createNativeStackNavigator<ReportsStackParamList>();
function deferred(loader: () => Promise<{ default: React.ComponentType<any> }>) {
  const Lazy = React.lazy(loader);
  return (props: any) => <React.Suspense fallback={<View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator /></View>}><Lazy {...props} /></React.Suspense>;
}

const Attendance = deferred(() => import("@/screens/admin/AttendanceControlScreenNew"));
const Advanced = deferred(() => import("@/screens/admin/AdvancedAttendanceReportScreen"));
const FieldVisits = deferred(() => import("@/screens/admin/FieldVisitAdminScreen"));
const Leaves = deferred(() => import("@/screens/admin/LeaveManagementScreen"));
const Regularization = deferred(() => import("@/screens/admin/AttendanceRegularizationScreen"));
const Biometric = deferred(() => import("@/screens/admin/BiometricUserMatchScreen"));
const Activity = deferred(() => import("@/screens/admin/ActivityAnalysisScreen"));
const Tracking = deferred(() => import("@/screens/admin/LiveTrackingScreen"));
const Gps = deferred(() => import("@/screens/admin/SuspiciousAttendanceScreen"));

export default function ReportsStackNavigator() {
  const { theme, isDark } = useTheme();
  const screenOptions = getCommonScreenOptions({ theme, isDark });
  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen name="ReportsHub" component={ReportsHubScreen} options={{ headerTitle: "Reports" }} />
      <Stack.Screen name="ReportsAttendance" component={Attendance} options={{ headerTitle: "Attendance Summary" }} />
      <Stack.Screen name="ReportsAdvancedAttendance" component={Advanced} options={{ headerTitle: "Advanced Attendance" }} />
      <Stack.Screen name="ReportsFieldVisits" component={FieldVisits} options={{ headerTitle: "Field Visit Report" }} />
      <Stack.Screen name="ReportsLeaves" component={Leaves} options={{ headerTitle: "Leave Report" }} />
      <Stack.Screen name="ReportsRegularization" component={Regularization} options={{ headerTitle: "Regularization Report" }} />
      <Stack.Screen name="ReportsBiometric" component={Biometric} options={{ headerTitle: "Biometric Reconciliation" }} />
      <Stack.Screen name="ReportsActivity" component={Activity} options={{ headerTitle: "Activity Analysis" }} />
      <Stack.Screen name="ReportsTracking" component={Tracking} options={{ headerTitle: "Live Tracking Report" }} />
      <Stack.Screen name="ReportsGps" component={Gps} options={{ headerTitle: "GPS and Suspicious Attendance" }} />
      <Stack.Screen name="ReportsDownloads" component={Advanced} initialParams={{ initialSection: "Exports" }} options={{ headerTitle: "Download Centre" }} />
    </Stack.Navigator>
  );
}
