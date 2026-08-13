import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const clearedWebLegacyKeys = new Set<string>();

function clearLegacyWebValueOnce(key: string) {
  if (clearedWebLegacyKeys.has(key)) return;
  clearedWebLegacyKeys.add(key);
  // Supabase reads its persisted session while holding an auth lock. Waiting
  // for an IndexedDB/AsyncStorage delete on every read serialized unrelated
  // page requests and could exhaust the lock timeout. Legacy cleanup is safe
  // to perform once in the background because web reads only sessionStorage.
  void AsyncStorage.removeItem(key).catch(() => {
    clearedWebLegacyKeys.delete(key);
  });
}

/**
 * SecureStore on native. Web data is tab-scoped sessionStorage so a refresh
 * preserves an authenticated session without retaining it in localStorage.
 * Sensitive offline evidence remains prohibited on web.
 */
export const secureStorage = {
  async getItem(key: string) {
    if (Platform.OS === "web") {
      const value =
        typeof window !== "undefined"
          ? window.sessionStorage.getItem(key)
          : null;
      clearLegacyWebValueOnce(key);
      return value;
    }
    const nativeKey = key.replace(/[^A-Za-z0-9._-]/g, "_");
    const secureValue = await SecureStore.getItemAsync(nativeKey);
    if (secureValue != null) return secureValue;
    // One-time migration from older native builds.
    const legacyValue = await AsyncStorage.getItem(key);
    if (legacyValue != null) {
      await SecureStore.setItemAsync(nativeKey, legacyValue, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
      await AsyncStorage.removeItem(key);
    }
    return legacyValue;
  },
  async setItem(key: string, value: string) {
    const nativeKey = key.replace(/[^A-Za-z0-9._-]/g, "_");
    if (Platform.OS === "web") {
      if (typeof window !== "undefined")
        window.sessionStorage.setItem(key, value);
      clearLegacyWebValueOnce(key);
      return;
    }
    return SecureStore.setItemAsync(nativeKey, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  },
  async removeItem(key: string) {
    const nativeKey = key.replace(/[^A-Za-z0-9._-]/g, "_");
    if (Platform.OS === "web") {
      if (typeof window !== "undefined") window.sessionStorage.removeItem(key);
      clearLegacyWebValueOnce(key);
      return;
    }
    await Promise.all([
      SecureStore.deleteItemAsync(nativeKey),
      AsyncStorage.removeItem(key),
    ]);
  },
};

/**
 * Persistent storage reserved for the authenticated Supabase session and its
 * cached profile. Web sessions survive closing and reopening the browser;
 * sensitive offline queues continue using the tab-scoped secureStorage above.
 */
export const persistentAuthStorage = {
  async getItem(key: string) {
    if (Platform.OS !== "web") return secureStorage.getItem(key);
    if (typeof window === "undefined") return null;
    try {
      const persistentValue = window.localStorage.getItem(key);
      if (persistentValue != null) {
        window.sessionStorage.removeItem(key);
        return persistentValue;
      }

      // One-time migration for users already signed in with the previous
      // tab-scoped build. They should not need another OTP after updating.
      const tabValue = window.sessionStorage.getItem(key);
      if (tabValue != null) {
        window.localStorage.setItem(key, tabValue);
        window.sessionStorage.removeItem(key);
      }
      return tabValue;
    } catch {
      // Privacy modes may reject localStorage. Preserve refresh behavior for
      // the current tab instead of breaking authentication completely.
      return window.sessionStorage.getItem(key);
    }
  },
  async setItem(key: string, value: string) {
    if (Platform.OS !== "web") return secureStorage.setItem(key, value);
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(key, value);
      window.sessionStorage.removeItem(key);
    } catch {
      window.sessionStorage.setItem(key, value);
    }
  },
  async removeItem(key: string) {
    if (Platform.OS !== "web") return secureStorage.removeItem(key);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(key);
      } catch {
        // The tab-scoped copy is still cleared below.
      }
      window.sessionStorage.removeItem(key);
    }
  },
};
