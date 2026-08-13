/**
 * Compatibility facade for older imports.
 *
 * The only task definition and start/stop implementation now lives in the
 * singleton location coordinator under services/location. Keeping this file as
 * a facade prevents a second native task implementation from being introduced.
 */
import { locationTrackingCoordinator } from "@/services/location/LocationTrackingCoordinator";

export {
  LIVE_LOCATION_TASK,
  readActiveTrackingConfig,
} from "@/services/location/backgroundLocationTask";

export async function requestBackgroundPermission() {
  const health = await locationTrackingCoordinator.requestRequiredPermissions({
    backgroundEducationAccepted: true,
  });
  return health.backgroundLocationGranted;
}

export async function startLiveTracking() {
  return locationTrackingCoordinator.restoreIfRequired();
}

export async function stopLiveTracking() {
  const health = locationTrackingCoordinator.getTrackingHealth();
  if (!health.activeAttendanceId) return false;
  return locationTrackingCoordinator.stopForAttendance(
    health.activeAttendanceId,
    "LEGACY_COMPATIBILITY_STOP",
  );
}

export async function isLiveTrackingActive() {
  const health = await locationTrackingCoordinator.refreshHealth();
  return health.nativeTaskActive;
}

export async function restoreTrackingIfNeeded() {
  return locationTrackingCoordinator.restoreIfRequired();
}
