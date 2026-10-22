import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { useAuth } from "@/contexts/AuthContext";
import {
  initializeNotificationInfrastructure,
  isNotificationPermissionGranted,
  registerDevicePushToken,
  requestNotificationPermission,
} from "@/services/location/notification.service";
import { reportNonFatalError } from "@/utils/operationalErrors";

const RETRY_MS = 60_000;

/**
 * Registers this phone for HRMS push notifications for every signed-in user.
 * Previously registration only ran inside location tracking setup, so a phone
 * could stay without a push token and miss every broadcast. Runs on sign-in,
 * whenever the app comes back to the foreground, and when Android rotates
 * the token.
 */
export default function PushRegistration() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const askedRef = useRef(false);

  // Channels (with their sounds) must exist before the first push arrives,
  // even before sign-in, or Android files it under a silent default channel.
  useEffect(() => {
    if (Platform.OS === "web") return;
    void initializeNotificationInfrastructure().catch((error) =>
      reportNonFatalError("push.channels", error),
    );
  }, []);

  useEffect(() => {
    if (Platform.OS === "web" || !userId) return;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const register = async () => {
      if (retry) {
        clearTimeout(retry);
        retry = null;
      }
      try {
        let granted = await isNotificationPermissionGranted();
        // Ask once per app start (Android 13+ shows nothing without it).
        if (!granted && !askedRef.current) {
          askedRef.current = true;
          granted = await requestNotificationPermission().catch(() => false);
        }
        if (!granted || cancelled) return;
        await registerDevicePushToken(userId);
      } catch (error) {
        void reportNonFatalError("push.register", error);
        if (!cancelled) retry = setTimeout(() => void register(), RETRY_MS);
      }
    };

    void register();
    const appState = AppState.addEventListener("change", (next) => {
      if (next === "active") void register();
    });
    const tokenChange = Notifications.addPushTokenListener(() => {
      void register();
    });
    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      appState.remove();
      tokenChange.remove();
    };
  }, [userId]);

  return null;
}
