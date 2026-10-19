import React from "react";
import { Pressable } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import DashboardScreen from "@/screens/DashboardScreen";
import { deferredScreen } from "@/navigation/deferredScreen";
import { HeaderTitle } from "@/components/HeaderTitle";
import { useTheme } from "@/hooks/useTheme";
import { getCommonScreenOptions } from "@/navigation/screenOptions";

export type HomeStackParamList = {
  Dashboard: undefined;
  LeaveScreen: { openApply?: boolean } | undefined;
  Notifications: undefined;
  UpcomingBirthdays: undefined;
  ActivityLogging: undefined;
  MyActivityLogs: undefined;
  FieldVisits:
    | {
        startVisitIntent?: "site" | "meeting" | "office";
        fieldVisitId?: string;
        arrival?: string;
      }
    | undefined;
  RaiseTicket: undefined;
  MyTeam: undefined;
  AttendanceDetails: undefined;
  LocationTrackingSetup: undefined;
};

const Stack = createNativeStackNavigator<HomeStackParamList>();
const LeaveScreen = deferredScreen(() => import("@/screens/LeaveScreen"));
const NotificationsScreen = deferredScreen(() => import("@/screens/NotificationsScreen"));
const UpcomingBirthdaysScreen = deferredScreen(() => import("@/screens/UpcomingBirthdaysScreen"));
const ActivityLoggingScreen = deferredScreen(() => import("@/screens/ActivityLoggingScreen"));
const MyActivityLogsScreen = deferredScreen(() => import("@/screens/MyActivityLogsScreen"));
const FieldVisitScreen = deferredScreen(() => import("@/screens/FieldVisitScreen"));
const RaiseTicketScreen = deferredScreen(() => import("@/screens/RaiseTicketScreen"));
const MyTeamScreen = deferredScreen(() => import("@/screens/MyTeamScreen"));
const AttendanceScreen = deferredScreen(() => import("@/screens/AttendanceScreen"));
const LocationTrackingSetupScreen = deferredScreen(() => import("@/screens/LocationTrackingSetupScreen"));

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
        options={{ headerTitle: "Leave History" }}
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
        name="RaiseTicket"
        component={RaiseTicketScreen}
        options={{ headerTitle: "Support Tickets" }}
      />
      <Stack.Screen
        name="MyTeam"
        component={MyTeamScreen}
        options={{ headerTitle: "My Team" }}
      />
      <Stack.Screen
        name="AttendanceDetails"
        component={AttendanceScreen}
        options={{ headerTitle: "Attendance & Regularization" }}
      />
      <Stack.Screen
        name="LocationTrackingSetup"
        component={LocationTrackingSetupScreen}
        options={({ navigation }) => ({
          headerTitle: "Location Tracking Setup",
          // Opened from a notification there may be nothing to go back to;
          // always offer a way out to Home.
          headerLeft: navigation.canGoBack()
            ? undefined
            : () => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Back to Home"
                  hitSlop={12}
                  onPress={() => navigation.navigate("Dashboard")}
                  style={{ paddingHorizontal: 6, paddingVertical: 4 }}
                >
                  <Feather name="arrow-left" size={24} color={theme.text} />
                </Pressable>
              ),
        })}
      />
    </Stack.Navigator>
  );
}
