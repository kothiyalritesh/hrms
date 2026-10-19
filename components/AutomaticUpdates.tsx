import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import * as Updates from "expo-updates";

// Native (EAS Update) updates for the Android/iOS shell: tracking, push,
// bridge. The HRMS screens themselves come from the hosted web build and are
// announced by ReleaseUpdateNotice.
//
// An update is downloaded quietly in the background and applied on the NEXT
// app start (expo-updates launches the newest downloaded bundle). The app is
// never reloaded while someone is using it, and if the download fails the
// current version keeps running.
const RECHECK_AFTER_MS = 6 * 60 * 60_000; // at most every 6 h on resume

export default function AutomaticUpdates() {
  const lastCheck = useRef(0);

  useEffect(() => {
    if (__DEV__ || Platform.OS === "web" || !Updates.isEnabled) return;

    let active = true;
    const downloadInBackground = async () => {
      if (Date.now() - lastCheck.current < RECHECK_AFTER_MS) return;
      lastCheck.current = Date.now();
      try {
        const result = await Updates.checkForUpdateAsync();
        if (!result.isAvailable || !active) return;
        await Updates.fetchUpdateAsync();
      } catch (error) {
        // Offline or update server unavailable: keep the current version.
        console.warn("[Updates] Background update check failed", error);
      }
    };

    // Let HRMS render first; don't compete with the critical startup requests.
    const timer = setTimeout(() => void downloadInBackground(), 15_000);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void downloadInBackground();
    });
    return () => {
      active = false;
      clearTimeout(timer);
      subscription.remove();
    };
  }, []);

  return null;
}
