import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import DashboardScreen from "@/screens/DashboardScreen";
import LeaveScreen from "@/screens/LeaveScreen";
import DocumentsScreen from "@/screens/DocumentsScreen";
import ProjectsScreen from "@/screens/ProjectsScreen";
import NotificationsScreen from "@/screens/NotificationsScreen";
import UpcomingBirthdaysScreen from "@/screens/UpcomingBirthdaysScreen";
import ActivityLoggingScreen from "@/screens/ActivityLoggingScreen";
import MyActivityLogsScreen from "@/screens/MyActivityLogsScreen";
import FieldVisitScreen from "@/screens/FieldVisitScreen";
import OnDutyRequestScreen from "@/screens/OnDutyRequestScreen";
import EmployeeMonthlyReportScreen from "@/screens/EmployeeMonthlyReportScreen";
import DiagnosticScreen from "@/screens/DiagnosticScreen";
import { HeaderTitle } from "@/components/HeaderTitle";
import { useTheme } from "@/hooks/useTheme";
import { getCommonScreenOptions } from "@/navigation/screenOptions";

export type HomeStackParamList = {
  Dashboard: undefined;
  LeaveScreen: undefined;
  DocumentsScreen: undefined;
  ProjectsScreen: undefined;
  Notifications: undefined;
  UpcomingBirthdays: undefined;
  ActivityLogging: undefined;
  MyActivityLogs: undefined;
  FieldVisits: undefined;
  OnDutyRequest: undefined;
  EmployeeMonthlyReport: undefined;
  Diagnostic: undefined;
};

const Stack = createNativeStackNavigator<HomeStackParamList>();

export default function HomeStackNavigator() {
  const { theme, isDark } = useTheme();

  return (
    <Stack.Navigator
      screenOptions={{
        ...getCommonScreenOptions({ theme, isDark }),
      }}
    >
      <Stack.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{
          headerTitle: () => <HeaderTitle title="RE HRMS" />,
        }}
      />
      <Stack.Screen
        name="LeaveScreen"
        component={LeaveScreen}
        options={{ headerTitle: "Leave Management" }}
      />
      <Stack.Screen
        name="DocumentsScreen"
        component={DocumentsScreen}
        options={{ headerTitle: "Documents" }}
      />
      <Stack.Screen
        name="ProjectsScreen"
        component={ProjectsScreen}
        options={{ headerTitle: "Projects" }}
      />
      <Stack.Screen
        name="Notifications"
        component={NotificationsScreen}
        options={{ headerTitle: "Notifications" }}
      />
      <Stack.Screen
        name="UpcomingBirthdays"
        component={UpcomingBirthdaysScreen}
        options={{ title: "Upcoming Birthdays 🎂" }}
      />
      <Stack.Screen
        name="ActivityLogging"
        component={ActivityLoggingScreen}
        options={{ headerTitle: "Log Activity" }}
      />
      <Stack.Screen
        name="MyActivityLogs"
        component={MyActivityLogsScreen}
        options={{ headerTitle: "My Activity Logs" }}
      />
      <Stack.Screen
        name="FieldVisits"
        component={FieldVisitScreen}
        options={{ headerTitle: "Field Visits" }}
      />
      <Stack.Screen
        name="OnDutyRequest"
        component={OnDutyRequestScreen}
        options={{ headerTitle: "On-Duty Requests" }}
      />
      <Stack.Screen
        name="EmployeeMonthlyReport"
        component={EmployeeMonthlyReportScreen}
        options={{ headerTitle: "Monthly Report" }}
      />
      <Stack.Screen
        name="Diagnostic"
        component={DiagnosticScreen}
        options={{ headerTitle: "Database Diagnostics" }}
      />
    </Stack.Navigator>
  );
}
