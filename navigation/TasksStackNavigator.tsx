import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { deferredScreen } from "@/navigation/deferredScreen";
import { useTheme } from "@/hooks/useTheme";
import { getCommonScreenOptions } from "@/navigation/screenOptions";

export type TasksStackParamList = {
  Tasks: { taskId?: string; eventId?: string } | undefined;
};

const Stack = createNativeStackNavigator<TasksStackParamList>();
const TasksScreen = deferredScreen(() => import("@/screens/TasksScreen"));

export default function TasksStackNavigator() {
  const { theme, isDark } = useTheme();

  return (
    <Stack.Navigator screenOptions={getCommonScreenOptions({ theme, isDark })}>
      <Stack.Screen
        name="Tasks"
        component={TasksScreen}
        options={{
          title: "Tasks",
        }}
      />
    </Stack.Navigator>
  );
}
