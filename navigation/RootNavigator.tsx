import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useAuth } from "@/contexts/AuthContext";
import MainTabNavigator from "@/navigation/MainTabNavigator";
import LoginScreen from "@/screens/LoginScreen";
import { useTheme } from "@/hooks/useTheme";
import { ActivityIndicator, Image, View, StyleSheet } from "react-native";

export type RootStackParamList = {
  Login: undefined;
  Main: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

function LoadingScreen() {
  const { theme } = useTheme();
  return (
    <View style={[styles.loading, { backgroundColor: theme.backgroundRoot }]}>
      <Image source={require("@/assets/images/logo.png")} style={styles.logo} resizeMode="contain" />
      <ActivityIndicator size="large" color={theme.primary} />
    </View>
  );
}

export default function RootNavigator() {
  const { authState } = useAuth();
  const { theme } = useTheme();

  if (authState === "loading") {
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
      {authState === "authenticated" ? (
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
  logo: { width: 150, height: 72, marginBottom: 20 },
});
