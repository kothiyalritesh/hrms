import { supabase } from "@/lib/supabase";
import {
  readOfflineQueue,
  removeOfflinePing,
} from "@/services/location/secureQueue";

/**
 * Sends queued (offline) location points in GPS-time order, one drain at a
 * time. A point the server refuses for good (validation error) is dropped so it
 * can never block the points behind it; a network / auth / server outage stops
 * the drain and the rest stays queued for the next attempt.
 *
 * Returns the attendance ids the server reported as closed.
 */
let running: Promise<string[]> | null = null;

/** Attendance id, or "visit:<id>" for points sent before any check-in. */
export function trackingOwnerKey(attendanceId: string | null, fieldVisitId: string | null) {
  return attendanceId ?? `visit:${fieldVisitId ?? "none"}`;
}

const PERMANENT_ERRORS = [
  "INVALID_TIMESTAMP_SKEW",
  "CLIENT_EVENT_ID_REQUIRED",
  "INVALID_COORDINATES",
  "TRACKING_SESSION_MISMATCH",
];

function isPermanentFailure(error: { code?: string; message?: string }) {
  // P0001 = RAISE EXCEPTION in the RPC; 22xxx / 23xxx = bad data / duplicate.
  const code = error.code ?? "";
  // Signed-out / expired token after a long offline spell: keep the pings and
  // retry once the session is refreshed instead of dropping them.
  if (error.message?.includes("AUTHENTICATION_REQUIRED")) return false;
  return (
    code === "P0001" ||
    code.startsWith("22") ||
    code.startsWith("23") ||
    PERMANENT_ERRORS.some((value) => error.message?.includes(value))
  );
}

async function drain(): Promise<string[]> {
  const closedAttendanceIds = new Set<string>();
  const queue = await readOfflineQueue();
  for (const item of queue) {
    const owner = trackingOwnerKey(item.config.attendanceId, item.config.fieldVisitId);
    if (closedAttendanceIds.has(owner)) {
      await removeOfflinePing(item.location.clientEventId);
      continue;
    }
    const { data, error } = await supabase.rpc("record_location_ping", {
      p_attendance_log_id: item.config.attendanceId,
      p_tracking_session_id: item.config.trackingSessionId,
      p_field_visit_id: item.config.fieldVisitId,
      p_client_event_id: item.location.clientEventId,
      p_latitude: item.location.latitude,
      p_longitude: item.location.longitude,
      p_accuracy_m: item.location.accuracy,
      p_altitude_m: item.location.altitude,
      p_heading: item.location.heading,
      p_speed_mps: item.location.speed,
      p_mocked: item.location.mocked,
      p_recorded_at: item.location.capturedAt,
      p_provider: "expo-location-offline",
      p_client_quality_status: item.qualityStatus,
    });
    if (error) {
      if (isPermanentFailure(error)) {
        await removeOfflinePing(item.location.clientEventId);
        continue;
      }
      break;
    }
    await removeOfflinePing(item.location.clientEventId);
    const result = Array.isArray(data) ? data[0] : data;
    if (result?.tracking_session_status === "STOPPED") {
      closedAttendanceIds.add(owner);
    }
  }
  return [...closedAttendanceIds];
}

export function drainOfflineQueue(): Promise<string[]> {
  if (!running) {
    running = drain().finally(() => {
      running = null;
    });
  }
  return running;
}
