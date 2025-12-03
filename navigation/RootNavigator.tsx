import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useAuth } from "@/contexts/AuthContext";
import MainTabNavigator from "@/navigation/MainTabNavigator";
import LoginScreen from "@/screens/LoginScreen";
import { useTheme } from "@/hooks/useTheme";
import { ActivityIndicator, View, StyleSheet } from "react-native";

export type RootStackParamList = {
  Login: undefined;
  Main: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

function LoadingScreen() {
  const { theme } = useTheme();
  return (
    <View style={[styles.loading, { backgroundColor: theme.backgroundRoot }]}>
      <ActivityIndicator size="large" color={theme.primary} />
    </View>
  );
}

export default function RootNavigator() {
  const { isAuthenticated, isLoading } = useAuth();
  const { theme } = useTheme();

  if (isLoading) {
    return <LoadingScreen />;
  }

  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.backgroundRoot },
        animation: "fade",
      }}
    >
      {isAuthenticated ? (
        <Stack.Screen name="Main" component={MainTabNavigator} />
      ) : (
        <Stack.Screen name="Login" component={LoginScreen} />
      )}
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
