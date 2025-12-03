import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import ProfileScreen from "@/screens/ProfileScreen";
import LeaveScreen from "@/screens/LeaveScreen";
import PayrollScreen from "@/screens/PayrollScreen";
import DocumentsScreen from "@/screens/DocumentsScreen";
import NotificationsScreen from "@/screens/NotificationsScreen";
import { useTheme } from "@/hooks/useTheme";
import { getCommonScreenOptions } from "@/navigation/screenOptions";

export type ProfileStackParamList = {
  Profile: undefined;
  LeaveScreen: undefined;
  PayrollScreen: undefined;
  DocumentsScreen: undefined;
  Notifications: undefined;
};

const Stack = createNativeStackNavigator<ProfileStackParamList>();

export default function ProfileStackNavigator() {
  const { theme, isDark } = useTheme();

  return (
    <Stack.Navigator screenOptions={getCommonScreenOptions({ theme, isDark })}>
      <Stack.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          title: "Profile",
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
        name="Notifications"
        component={NotificationsScreen}
        options={{ headerTitle: "Notifications" }}
      />
    </Stack.Navigator>
  );
}
