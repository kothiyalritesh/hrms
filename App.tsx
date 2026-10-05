import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { NavigationContainer } from "@react-navigation/native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import Constants from "expo-constants";
import Feather from "@expo/vector-icons/Feather";

import RootNavigator from "@/navigation/RootNavigator";
import { AuthProvider } from "@/contexts/AuthContext";
import { LocationTrackingProvider } from "@/contexts/LocationTrackingContext";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import AutomaticUpdates from "@/components/AutomaticUpdates";
import { useAuth } from "@/contexts/AuthContext";
import { CurrentLocationVisitService } from "@/services/current-location-visit.service";
import { AttendanceService } from "@/services/attendance.service";
import { scheduleAttendanceReminders } from "@/services/location/notification.service";
import { reportNonFatalError } from "@/utils/operationalErrors";
import { webBasePath } from "@/utils/webRouting";
import AndroidHrmsShell from "@/components/AndroidHrmsShell";
import NativeShellConnector from "@/components/NativeShellConnector";
import { nativeBridge } from "@/services/nativeBridge/client";

const WEB_BUILD_ID = String(Constants.expoConfig?.extra?.buildId ?? "current");

function EscalationWatchdog() {
  return null;
}

function OfflineEvidenceSync() {
  const { user } = useAuth();
  useEffect(() => {
    if (!user?.id) return;
    void CurrentLocationVisitService.retryQueue();
    return NetInfo.addEventListener((state) => {
      if (state.isConnected && state.isInternetReachable !== false) {
        void CurrentLocationVisitService.retryQueue();
      }
    });
  }, [user?.id]);
  return null;
}

function OfflineBanner() {
  const [offline, setOffline] = useState(false);
  useEffect(
    () =>
      NetInfo.addEventListener((state) => {
        setOffline(
          state.isConnected === false || state.isInternetReachable === false,
        );
      }),
    [],
  );
  if (!offline) return null;
  return (
    <View style={styles.offlineBanner}>
      <Feather name="wifi-off" size={14} color="#FFFFFF" />
      <Text style={styles.offlineBannerText}>
        Offline · Attendance actions require server confirmation
      </Text>
    </View>
  );
}

function AttendanceReminderScheduler() {
  const { user } = useAuth();
  useEffect(() => {
    if (!user?.id || Platform.OS === "web") return;
    void AttendanceService.getReminderSchedule()
      .then(scheduleAttendanceReminders)
      .catch((error) => {
        console.warn("Attendance reminders were not scheduled", error);
      });
  }, [user?.id]);
  return null;
}

function WebAppShell() {
  const [waitingRegistration, setWaitingRegistration] =
    useState<ServiceWorkerRegistration | null>(null);
  const [pwaError, setPwaError] = useState<string | null>(null);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const isUnderWebBasePath =
      webBasePath !== "/" && window.location.pathname.startsWith(webBasePath);
    const applicationRoot = new URL(
      isUnderWebBasePath ? webBasePath : "/",
      window.location.origin,
    );
    const manifestUrl = new URL("manifest.webmanifest", applicationRoot).href;
    let manifest = document.querySelector(
      'link[rel="manifest"]',
    ) as HTMLLinkElement | null;
    if (!manifest) {
      manifest = document.createElement("link");
      manifest.rel = "manifest";
      document.head.appendChild(manifest);
    }
    manifest.href = manifestUrl;

    // The Android shell has native offline/update handling and must follow the
    // hosted HRMS immediately. A PWA service worker inside its WebView could
    // otherwise keep an older JavaScript bundle after a root deployment.
    if (nativeBridge.isAvailable()) {
      if ("serviceWorker" in navigator) {
        void navigator.serviceWorker
          .getRegistrations()
          .then((registrations) =>
            Promise.all(
              registrations
                .filter((registration) =>
                  registration.scope.startsWith(applicationRoot.href),
                )
                .map((registration) => registration.unregister()),
            ),
          );
      }
      if ("caches" in window) {
        void window.caches
          .keys()
          .then((keys) =>
            Promise.all(
              keys
                .filter((key) => key.startsWith("bop-hrms-"))
                .map((key) => window.caches.delete(key)),
            ),
          );
      }
      return;
    }

    // A service worker installed by a previous production preview can keep
    // controlling localhost and serve old bundles while Metro is running.
    // Development must always use the current source, so remove only this
    // application's registrations and caches in the background.
    if (__DEV__ && typeof navigator !== "undefined") {
      if ("serviceWorker" in navigator) {
        void navigator.serviceWorker
          .getRegistrations()
          .then((registrations) =>
            Promise.all(
              registrations
                .filter((registration) =>
                  registration.scope.startsWith(applicationRoot.href),
                )
                .map((registration) => registration.unregister()),
            ),
          );
      }
      if ("caches" in window) {
        void window.caches
          .keys()
          .then((keys) =>
            Promise.all(
              keys
                .filter((key) => key.startsWith("bop-hrms-"))
                .map((key) => window.caches.delete(key)),
            ),
          );
      }
    }
    if (
      typeof navigator !== "undefined" &&
      "serviceWorker" in navigator &&
      !__DEV__
    ) {
      const workerUrl = new URL("sw.js", applicationRoot);
      workerUrl.searchParams.set("build", WEB_BUILD_ID);
      let reloading = false;
      const onControllerChange = () => {
        if (reloading) return;
        reloading = true;
        window.location.reload();
      };
      navigator.serviceWorker.addEventListener(
        "controllerchange",
        onControllerChange,
      );
      void navigator.serviceWorker
        .register(workerUrl.href, {
          scope: isUnderWebBasePath ? webBasePath : "/",
          updateViaCache: "none",
        })
        .then((registration) => {
          // Some restricted browsers expose the API but do not return a
          // registration. The HRMS remains fully usable in online-only mode.
          if (!registration) return;
          // A worker that was already waiting when the application opened is
          // safe to activate immediately: the user has not started editing a
          // form in this new page lifecycle. Updates discovered later still
          // use the visible confirmation banner below.
          if (registration.waiting) {
            registration.waiting.postMessage({ type: "SKIP_WAITING" });
          }
          void registration.update().catch((error) => {
            console.warn("[PWA] Service worker update check failed", error);
          });
          registration.addEventListener("updatefound", () => {
            const installing = registration.installing;
            installing?.addEventListener("statechange", () => {
              if (
                installing.state === "installed" &&
                navigator.serviceWorker.controller
              ) {
                setWaitingRegistration(registration);
              }
            });
          });
        })
        .catch((error) => {
          console.error("[PWA] Service worker registration failed", error);
          void reportNonFatalError("pwa.service_worker_registration", error);
          setPwaError(
            "Offline support is unavailable. HRMS is running in online-only mode.",
          );
        });
      return () => {
        navigator.serviceWorker.removeEventListener(
          "controllerchange",
          onControllerChange,
        );
      };
    }
  }, []);

  if (Platform.OS !== "web" || (!waitingRegistration && !pwaError)) return null;

  const applyUpdate = () => {
    if (!waitingRegistration) return;
    
    waitingRegistration.waiting?.postMessage({ type: "SKIP_WAITING" });
  };

  return (
    <View style={styles.updateBanner}>
      <Text style={styles.updateText}>
        {pwaError
          ? pwaError
          : "HRMS update ready. Save your work before reloading."}
      </Text>
      {waitingRegistration ? (
        <Pressable style={styles.updatePrimary} onPress={applyUpdate}>
          <Text style={styles.updatePrimaryText}>Reload update</Text>
        </Pressable>
      ) : null}
      <Pressable
        style={styles.updateSecondary}
        onPress={() => {
          setWaitingRegistration(null);
          setPwaError(null);
        }}
      >
        <Text style={styles.updateSecondaryText}>Later</Text>
      </Pressable>
    </View>
  );
}

const linking = {
  prefixes: [
    "re-hrms://",
    ...(Platform.OS === "web" && typeof window !== "undefined"
      ? [new URL(webBasePath, window.location.origin).href]
      : []),
  ],
  config: {
    ...(Platform.OS === "web" && webBasePath !== "/"
      ? { path: webBasePath.replace(/^\/+|\/+$/g, "") }
      : {}),
    screens: {
      Main: {
        screens: {
          HomeTab: {
            screens: {
              Dashboard: "",
              LeaveScreen: "leave",
              Notifications: "notifications",
              UpcomingBirthdays: "birthdays",
              ActivityLogging: "activity/new",
              MyActivityLogs: "activity",
              FieldVisits: "field-visits/:fieldVisitId?",
              RaiseTicket: "support/new",
              MyTeam: "my-team",
              AttendanceDetails: "attendance",
              LocationTrackingSetup: "tracking-setup",
            },
          },
          TasksTab: {
            path: "tasks",
            screens: {
              Tasks: ":eventId?",
            },
          },
          ProfileTab: {
            path: "account",
            screens: {
              Profile: "profile",
              LeaveScreen: "leave",
              Notifications: "notifications",
              MyTeam: "team",
            },
          },
          AdminTab: {
            path: "admin",
            screens: {
              AdminDashboard: "",
              UserManagement: "employees",
              AttendanceControl: "attendance",
              LeaveManagement: "leaves",
              TaskProjectControl: "tasks-projects",
              NotificationManagement: "notifications",
                AdminDeviceSessions: "duplicate-devices",
              OfficeSettings: "offices",
              SiteSettings: "sites",
              AuditLogs: "audit",
              ActivityAnalysis: "activity-analysis",
              FieldVisitAdmin: "field-visits",
              LiveTracking: "live-tracking",
              TeamHierarchy: "teams",
              TicketManagement: "tickets",
              EventManagement: "events",
              CheckInLogs: "check-in-logs",
              TVDisplay: "tv",
              LeaveBalance: "leave-balance",
              SmartOfficeIntegration: "biometric-sync",
              SmartOfficeEmployeeImport: "employee-import",
              SmartOfficeImportedData: "imported-data",
              BiometricUserMatch: "employee-match",
              SuspiciousAttendance: "suspicious-attendance",
              AttendanceCalendar: "attendance-calendar",
              AttendanceRegularization: "regularization",
              AdvancedAttendanceReport: "attendance-report",
            },
          },
          ReportsTab: {
            path: "reports",
            screens: {
              ReportsHub: "",
              ReportsAttendance: "attendance",
              ReportsAdvancedAttendance: "advanced-attendance",
              ReportsFieldVisits: "field-visits",
              ReportsLeaves: "leaves",
              ReportsRegularization: "regularization",
              ReportsBiometric: "biometric",
              ReportsActivity: "activity",
              ReportsTracking: "tracking",
              ReportsGps: "gps-suspicious",
              ReportsDownloads: "downloads",
            },
          },
          MyTeamTab: "team",
        },
      },
    },
  },
};

function FullHrmsApp() {
  return (
    <ErrorBoundary
      onError={(error) => {
        void reportNonFatalError("app.render_boundary", error);
      }}
    >
      <AuthProvider>
        <LocationTrackingProvider>
          <SafeAreaProvider>
            <GestureHandlerRootView style={styles.root}>
              <KeyboardProvider>
                <AutomaticUpdates />
                <OfflineBanner />
                <OfflineEvidenceSync />
                <AttendanceReminderScheduler />
                <NativeShellConnector />
                <WebAppShell />
                <NavigationContainer
                  linking={linking as any}
                  documentTitle={{
                    formatter: () => "Bop Realty",
                  }}
                >
                  <EscalationWatchdog />
                  <RootNavigator />
                </NavigationContainer>
                <StatusBar style="auto" />
              </KeyboardProvider>
            </GestureHandlerRootView>
          </SafeAreaProvider>
        </LocationTrackingProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}

export default function App() {
  useEffect(() => { SplashScreen.hideAsync().catch(() => {}); }, []);
  const [useBundledAndroidApp, setUseBundledAndroidApp] = useState(false);
  // Android is intentionally a small native capability host. The browser and
  // iOS builds retain the full bundled application. Android follows the
  // independently deployed HRMS root, but falls back to the bundled HRMS if a
  // carrier, DNS resolver, firewall, or hosting outage prevents WebView access.
  if (Platform.OS === "android" && !useBundledAndroidApp) {
    return (
      <AndroidHrmsShell
        onUseBundledApp={(reason) => {
          void reportNonFatalError(
            "android_shell.hosted_hrms_unreachable",
            new Error(reason),
          );
          setUseBundledAndroidApp(true);
        }}
      />
    );
  }
  return <FullHrmsApp />;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  offlineBanner: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 12000,
    minHeight: 30,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    backgroundColor: "#B45309",
  },
  offlineBannerText: { color: "#FFFFFF", fontSize: 12, fontWeight: "700" },
  updateBanner: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 16,
    zIndex: 10000,
    padding: 12,
    borderRadius: 10,
    backgroundColor: "#111827",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  updateText: {
    color: "#FFFFFF",
    flex: 1,
    fontSize: 13,
  },
  updatePrimary: {
    backgroundColor: "#FFFFFF",
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  updatePrimaryText: {
    color: "#111827",
    fontWeight: "700",
    fontSize: 12,
  },
  updateSecondary: {
    paddingHorizontal: 6,
    paddingVertical: 7,
  },
  updateSecondaryText: {
    color: "#D1D5DB",
    fontWeight: "600",
    fontSize: 12,
  },
});




