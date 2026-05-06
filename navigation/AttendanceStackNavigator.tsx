import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import DashboardScreen from "@/screens/DashboardScreen";
import SiteVisitApprovalsScreen from "@/screens/SiteVisitApprovalsScreen";
import OnDutyRequestScreen from "@/screens/OnDutyRequestScreen";
import EmployeeMonthlyReportScreen from "@/screens/EmployeeMonthlyReportScreen";
import { useTheme } from "@/hooks/useTheme";
import { getCommonScreenOptions } from "@/navigation/screenOptions";

export type AttendanceStackParamList = {
  Attendance: undefined;
  SiteVisitApprovals: undefined;
  OnDutyRequest: undefined;
  EmployeeMonthlyReport: undefined;
};

const Stack = createNativeStackNavigator<AttendanceStackParamList>();

export default function AttendanceStackNavigator() {
  const { theme, isDark } = useTheme();

  return (
    <Stack.Navigator screenOptions={getCommonScreenOptions({ theme, isDark })}>
      <Stack.Screen
        name="Attendance"
        component={DashboardScreen}
        options={{ title: "Attendance" }}
      />
      <Stack.Screen
        name="SiteVisitApprovals"
        component={SiteVisitApprovalsScreen}
        options={{ title: "Site Visit Approvals" }}
      />
      <Stack.Screen
        name="OnDutyRequest"
        component={OnDutyRequestScreen}
        options={{ title: "On-Duty Requests" }}
      />
      <Stack.Screen
        name="EmployeeMonthlyReport"
        component={EmployeeMonthlyReportScreen}
        options={{ title: "Monthly Report" }}
      />
    </Stack.Navigator>
  );
}
