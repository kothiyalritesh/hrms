import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import AdminDashboardScreen from "@/screens/admin/AdminDashboardScreen";
import UserManagementScreen from "@/screens/admin/UserManagementScreen";
import AttendanceControlScreen from "@/screens/admin/AttendanceControlScreenNew";
import LeaveManagementScreen from "@/screens/admin/LeaveManagementScreen";
import TaskProjectControlScreen from "@/screens/admin/TaskProjectControlScreen";
import DocumentManagementScreen from "@/screens/admin/DocumentManagementScreen";
import NotificationManagementScreen from "@/screens/admin/NotificationManagementScreen";
import OfficeSettingsScreen from "@/screens/admin/OfficeSettingsScreen";
import AuditLogsScreen from "@/screens/admin/AuditLogsScreen";
import ActivityAnalysisScreen from "@/screens/admin/ActivityAnalysisScreen";
import FieldVisitAdminScreen from "@/screens/admin/FieldVisitAdminScreen";
import LocationComplianceScreen from "@/screens/admin/LocationComplianceScreen";
import LiveTrackingScreen from "@/screens/admin/LiveTrackingScreen";
import SiteVisitApprovalsScreen from "@/screens/SiteVisitApprovalsScreen";
import OnboardingScreen from "@/screens/admin/OnboardingScreen";
import PayrollAdminScreen from "@/screens/admin/PayrollAdminScreen";
import OrganizationSettingsScreen from "@/screens/admin/OrganizationSettingsScreen";
import PerformanceAdminScreen from "@/screens/admin/PerformanceAdminScreen";
import OnDutyApprovalScreen from "@/screens/admin/OnDutyApprovalScreen";
import AdminAttendanceEditScreen from "@/screens/admin/AdminAttendanceEditScreen";
import GeofenceComplianceScreen from "@/screens/admin/GeofenceComplianceScreen";
import { HeaderTitle } from "@/components/HeaderTitle";
import { useTheme } from "@/hooks/useTheme";
import { getCommonScreenOptions } from "@/navigation/screenOptions";

export type AdminStackParamList = {
  AdminDashboard: undefined;
  UserManagement: undefined;
  AttendanceControl: undefined;
  LeaveManagement: undefined;
  TaskProjectControl: undefined;
  DocumentManagement: undefined;
  NotificationManagement: undefined;
  OfficeSettings: undefined;
  AuditLogs: undefined;
  ActivityAnalysis: undefined;
  FieldVisitAdmin: undefined;
  LocationCompliance: undefined;
  LiveTracking: undefined;
  SiteVisitApprovals: undefined;
  Onboarding: undefined;
  PayrollAdmin: undefined;
  OrganizationSettings: undefined;
  PerformanceAdmin: undefined;
  OnDutyApproval: undefined;
  AdminAttendanceEdit: undefined;
  GeofenceCompliance: undefined;
};

const Stack = createNativeStackNavigator<AdminStackParamList>();

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
          headerTitle: () => <HeaderTitle title="Admin Panel" />,
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
        name="DocumentManagement"
        component={DocumentManagementScreen}
        options={{ headerTitle: "Document Management" }}
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
        name="LocationCompliance"
        component={LocationComplianceScreen}
        options={{ headerTitle: "Location Compliance" }}
      />
      <Stack.Screen
        name="LiveTracking"
        component={LiveTrackingScreen}
        options={{ headerTitle: "Live Tracking" }}
      />
      <Stack.Screen
        name="SiteVisitApprovals"
        component={SiteVisitApprovalsScreen}
        options={{ headerTitle: "Site Visit Approvals" }}
      />
      <Stack.Screen
        name="Onboarding"
        component={OnboardingScreen}
        options={{ headerTitle: "Employee Lifecycle" }}
      />
      <Stack.Screen
        name="PayrollAdmin"
        component={PayrollAdminScreen}
        options={{ headerTitle: "Payroll Management" }}
      />
      <Stack.Screen
        name="OrganizationSettings"
        component={OrganizationSettingsScreen}
        options={{ headerTitle: "Organization Settings" }}
      />
      <Stack.Screen
        name="PerformanceAdmin"
        component={PerformanceAdminScreen}
        options={{ headerTitle: "Performance & Goals" }}
      />
      <Stack.Screen
        name="OnDutyApproval"
        component={OnDutyApprovalScreen}
        options={{ headerTitle: "On-Duty Approvals" }}
      />
      <Stack.Screen
        name="AdminAttendanceEdit"
        component={AdminAttendanceEditScreen}
        options={{ headerTitle: "Attendance Editor" }}
      />
      <Stack.Screen
        name="GeofenceCompliance"
        component={GeofenceComplianceScreen}
        options={{ headerTitle: "Geofence Compliance" }}
      />
    </Stack.Navigator>
  );
}
