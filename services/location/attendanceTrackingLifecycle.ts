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
