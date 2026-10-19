import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { OfflineLocationPing } from "@/services/location/types";
import { sortOfflinePings } from "@/services/location/offline";

const INDEX_KEY = "@hrms_location_queue_index_v1";
const ENTRY_PREFIX = "hrms.location.queue.";
// ~10 h of office tracking at the stationary rate (one fix / 2 min) or
// ~2.5 h of continuous driving at one fix / 15 s.
const MAX_QUEUE_SIZE = 600;

async function getIndex(): Promise<string[]> {
  if (Platform.OS === "web") {
    await AsyncStorage.removeItem(INDEX_KEY);
    return [];
  }
  const raw = await AsyncStorage.getItem(INDEX_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

async function setProtectedValue(key: string, value: string | null) {
  if (Platform.OS === "web") {
    await AsyncStorage.removeItem(key);
    return;
  }
  if (value == null) await SecureStore.deleteItemAsync(key);
  else {
    await SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
    });
  }
}

async function getProtectedValue(key: string) {
  if (Platform.OS === "web") {
    await AsyncStorage.removeItem(key);
    return null;
  }
  return SecureStore.getItemAsync(key);
}

export async function enqueueOfflinePing(ping: OfflineLocationPing) {
  if (Platform.OS === "web") {
    throw new Error("Background location queuing is not supported on web.");
  }
  let index = await getIndex();
  if (index.includes(ping.location.clientEventId)) return;
  await setProtectedValue(
    ENTRY_PREFIX + ping.location.clientEventId,
    JSON.stringify(ping),
  );
  index.push(ping.location.clientEventId);
  while (index.length > MAX_QUEUE_SIZE) {
    const removed = index.shift();
    if (removed) await setProtectedValue(ENTRY_PREFIX + removed, null);
  }
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(index));
}

export async function readOfflineQueue(): Promise<OfflineLocationPing[]> {
  const index = await getIndex();
  const items = await Promise.all(
    index.map(async (id) => {
      const raw = await getProtectedValue(ENTRY_PREFIX + id);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as OfflineLocationPing;
      } catch {
        return null;
      }
    }),
  );
  return sortOfflinePings(
    items.filter((item): item is OfflineLocationPing => item != null),
  );
}

export async function removeOfflinePing(clientEventId: string) {
  if (Platform.OS === "web") {
    await AsyncStorage.removeItem(INDEX_KEY);
    await AsyncStorage.removeItem(ENTRY_PREFIX + clientEventId);
    return;
  }
  const index = (await getIndex()).filter((id) => id !== clientEventId);
  await setProtectedValue(ENTRY_PREFIX + clientEventId, null);
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(index));
}

/** Number of points waiting to be uploaded (for tracking health). */
export async function offlineQueueSize() {
  return (await getIndex()).length;
}

/** Remove every encrypted ping for the signing-out employee/device. */
export async function clearOfflineLocationQueue() {
  const index = await getIndex();
  await Promise.all(index.map((id) => setProtectedValue(ENTRY_PREFIX + id, null)));
  await AsyncStorage.removeItem(INDEX_KEY);
}
