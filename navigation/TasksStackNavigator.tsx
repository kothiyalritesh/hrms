import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import TasksScreen from "@/screens/TasksScreen";
import { useTheme } from "@/hooks/useTheme";
import { getCommonScreenOptions } from "@/navigation/screenOptions";

export type TasksStackParamList = {
  Tasks: { taskId?: string } | undefined;
};

const Stack = createNativeStackNavigator<TasksStackParamList>();

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
