import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import DashboardScreen from "@/screens/DashboardScreen";
import LeaveScreen from "@/screens/LeaveScreen";
import PayrollScreen from "@/screens/PayrollScreen";
import DocumentsScreen from "@/screens/DocumentsScreen";
import ProjectsScreen from "@/screens/ProjectsScreen";
import NotificationsScreen from "@/screens/NotificationsScreen";
import { HeaderTitle } from "@/components/HeaderTitle";
import { useTheme } from "@/hooks/useTheme";
import { getCommonScreenOptions } from "@/navigation/screenOptions";

export type HomeStackParamList = {
  Dashboard: undefined;
  LeaveScreen: undefined;
  PayrollScreen: undefined;
  DocumentsScreen: undefined;
  ProjectsScreen: undefined;
  Notifications: undefined;
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
        name="PayrollScreen"
        component={PayrollScreen}
        options={{ headerTitle: "Payroll" }}
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
    </Stack.Navigator>
  );
}
