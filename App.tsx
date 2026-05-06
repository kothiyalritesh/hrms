import React from "react";
import { StyleSheet } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import RootNavigator from "@/navigation/RootNavigator";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { AttendanceUpdateProvider } from "@/contexts/AttendanceUpdateContext";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useGlobalLocationMonitor } from "@/hooks/useGlobalLocationMonitor";

// Runs inside AuthProvider so it has access to the logged-in user
function GlobalMonitors() {
  const { user } = useAuth();
  useGlobalLocationMonitor(user?.id);
  return null;
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AttendanceUpdateProvider>
          <SafeAreaProvider>
            <GestureHandlerRootView style={styles.root}>
              <KeyboardProvider>
                <NavigationContainer>
                  <GlobalMonitors />
                  <RootNavigator />
                </NavigationContainer>
                <StatusBar style="auto" />
              </KeyboardProvider>
            </GestureHandlerRootView>
          </SafeAreaProvider>
        </AttendanceUpdateProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
