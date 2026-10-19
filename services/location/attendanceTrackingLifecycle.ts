import { Platform } from "react-native";
import { nativeBridge } from "@/services/nativeBridge/client";
import { locationTrackingCoordinator } from "@/services/location/LocationTrackingCoordinator";

export async function startAttendanceTracking(attendanceId: string) {
  if (nativeBridge.isAvailable()) {
    const result = await nativeBridge.request<{ started?: boolean }>(
      "tracking.start",
      { attendanceId },
    );
    return result.started === true;
  }
  if (Platform.OS === "web") return false;
  return locationTrackingCoordinator.startForAttendance(attendanceId);
}

export async function stopAttendanceTracking(
  attendanceId: string,
  reason: string,
) {
  if (nativeBridge.isAvailable()) {
    const result = await nativeBridge.request<{ stopped?: boolean }>(
      "tracking.stop",
      { attendanceId, reason },
    );
    return result.stopped === true;
  }
  if (Platform.OS === "web") return false;
  return locationTrackingCoordinator.stopForAttendance(attendanceId, reason);
}

/**
 * After a server-confirmed checkout. If the local stop does not confirm (lost
 * response, bridge/owner mismatch), a restore shortly after re-reads the
 * server, finds the day closed and stops tracking.
 */
export async function stopAttendanceTrackingAfterCheckout(
  attendanceId: string,
  reason: string,
) {
  const stopped = await stopAttendanceTracking(attendanceId, reason).catch(() => false);
  if (!stopped) {
    for (const delayMs of [5_000, 30_000]) {
      setTimeout(() => void restoreAttendanceTracking().catch(() => undefined), delayMs);
    }
  }
  return stopped;
}

/**
 * A field visit was created / started / finished: switch the tracking mode
 * (office <-> visit) now instead of on the next periodic restore.
 */
export async function syncTrackingDestination(fieldVisitId: string | null) {
  try {
    if (nativeBridge.isAvailable()) {
      await nativeBridge.request("tracking.restore");
      return;
    }
    if (Platform.OS === "web") return;
    if (fieldVisitId) {
      await locationTrackingCoordinator.updateActiveDestination(fieldVisitId);
    } else {
      await locationTrackingCoordinator.clearActiveDestination();
    }
  } catch (error) {
    console.warn("[tracking] destination sync failed:", error);
  }
}

export async function restoreAttendanceTracking() {
  if (nativeBridge.isAvailable()) {
    const result = await nativeBridge.request<{ restored?: boolean }>(
      "tracking.restore",
    );
    return result.restored === true;
  }
  if (Platform.OS === "web") return false;
  return locationTrackingCoordinator.restoreIfRequired();
}
