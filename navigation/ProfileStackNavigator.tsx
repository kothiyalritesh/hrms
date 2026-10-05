import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import ProfileScreen from "@/screens/ProfileScreen";
import { deferredScreen } from "@/navigation/deferredScreen";
import { useTheme } from "@/hooks/useTheme";
import { getCommonScreenOptions } from "@/navigation/screenOptions";

export type ProfileStackParamList = {
  Profile: undefined;
  LeaveScreen: undefined;
  Notifications: undefined;
  MyTeam: undefined;
  HelpSupport: undefined;
};

const Stack = createNativeStackNavigator<ProfileStackParamList>();
const LeaveScreen = deferredScreen(() => import("@/screens/LeaveScreen"));
const NotificationsScreen = deferredScreen(() => import("@/screens/NotificationsScreen"));
const MyTeamScreen = deferredScreen(() => import("@/screens/MyTeamScreen")); 
const HelpSupportScreen = deferredScreen(() => import("@/screens/HelpSupportScreen"));

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
        options={{ headerTitle: "Leave History" }}
      />
      <Stack.Screen
        name="Notifications"
        component={NotificationsScreen}
        options={{ headerTitle: "Notifications" }}
      />
      <Stack.Screen
        name="MyTeam"
        component={MyTeamScreen}
        options={{ headerTitle: "Team Reports" }}
      />
      <Stack.Screen name="HelpSupport" component={HelpSupportScreen} options={{ headerTitle: "Help & Support" }} />
    </Stack.Navigator>
  );
}
