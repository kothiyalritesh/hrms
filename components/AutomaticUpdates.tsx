import { useEffect } from "react";
import { Platform } from "react-native";
import * as Updates from "expo-updates";

export default function AutomaticUpdates() {
  useEffect(() => {
    if (__DEV__ || Platform.OS === "web" || !Updates.isEnabled) return;

    let active = true;
    const installAvailableUpdate = async () => {
      try {
        const result = await Updates.checkForUpdateAsync();
        if (!result.isAvailable || !active) return;
        await Updates.fetchUpdateAsync();
        if (active) await Updates.reloadAsync();
      } catch (error) {
        // Keep the embedded version running when the device is offline or the
        // update service is temporarily unavailable.
        console.warn("[Updates] Automatic update check failed", error);
      }
    };

    // Let the HRMS render before using the same mobile connection to check and
    // download an optional shell update. Updates remain automatic, but no
    // longer compete with the critical startup request.
    const timer = setTimeout(() => {
      void installAvailableUpdate();
    }, 8_000);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);

  return null;
}
