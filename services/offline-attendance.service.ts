import * as Crypto from "expo-crypto";
import { Platform } from "react-native";
import { supabase } from "@/lib/supabase";
import { AttendanceService, effectiveOfficeRadius } from "@/services/attendance.service";
import { BusinessClockService } from "@/services/business-clock.service";
import { DurableWriteOutbox, type OutboxItem } from "@/services/outbox/DurableWriteOutbox";
import { stopNativeTracking } from "@/services/location/backgroundLocationTask";
import { startAttendanceTracking } from "@/services/location/attendanceTrackingLifecycle";
import type { GPSCoords } from "@/utils/gps";

/*
 * Offline check-in / check-out.
 *   QUEUED (saved on the phone) -> SYNCING -> SYNCED (server applied it)
 *   FAILED (retrying with backoff) / DEAD_LETTER (server rejected it, shown to the user)
 * The server keeps the original GPS capture time and is idempotent per
 * operation id, so retries can never create a second record.
 */

export type OfflineAttendanceAction = "ATTENDANCE_CHECKIN" | "ATTENDANCE_CHECKOUT";

type OfflineLocation = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  mocked: boolean;
  capturedAt: string;
  provider: string;
};

export type OfflineCheckInPayload = {
  userId: string;
  officeId: string;
  officeName: string;
  location: OfflineLocation;
};

export type OfflineCheckOutPayload = {
  userId: string;
  location: OfflineLocation;
};

class OfflineSyncError extends Error {
  constructor(message: string, readonly terminal: boolean) {
    super(message);
    this.name = "OfflineSyncError";
  }
  get retryable() {
    return !this.terminal;
  }
}

function toOfflineLocation(gps: GPSCoords): OfflineLocation {
  return {
    latitude: gps.latitude,
    longitude: gps.longitude,
    accuracy: gps.accuracy ?? null,
    mocked: gps.mocked === true,
    capturedAt: gps.capturedAt || new Date().toISOString(),
    provider: gps.provider || "gps",
  };
}

function istDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

const isAttendanceAction = (item: OutboxItem) =>
  item.operationType === "ATTENDANCE_CHECKIN" || item.operationType === "ATTENDANCE_CHECKOUT";

async function currentUserId() {
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}

/** Throws a retryable error unless the item belongs to the signed-in employee. */
async function assertOwner(item: OutboxItem) {
  const uid = await currentUserId();
  if (!uid || uid !== item.userId) {
    throw new OfflineSyncError("Waiting for the employee who saved this action to sign in.", false);
  }
}

function rpcFailure(error: { message?: string; code?: string }) {
  // Network, auth and "check-in not synced yet" problems are retried; nothing
  // here is a business rejection (those come back as success:false).
  return new OfflineSyncError(error.message || "Server unavailable", false);
}

export const OfflineAttendanceService = {
  /** Pending (not yet confirmed) attendance actions of this employee. */
  async pending(userId: string): Promise<OutboxItem[]> {
    const queue = await DurableWriteOutbox.getQueue();
    return queue.filter(
      (item) =>
        isAttendanceAction(item) &&
        item.userId === userId &&
        (item.status === "PENDING" || item.status === "PROCESSING" || item.status === "FAILED"),
    );
  },

  /** Actions the server finished (synced or rejected) that the user has not dismissed yet. */
  async finished(userId: string): Promise<OutboxItem[]> {
    const queue = await DurableWriteOutbox.getQueue();
    return queue.filter(
      (item) =>
        isAttendanceAction(item) &&
        item.userId === userId &&
        (item.status === "DEAD_LETTER" || item.status === "SYNCED"),
    );
  },

  /** A check-in saved offline today that the server has not confirmed yet. */
  async pendingCheckInToday(userId: string): Promise<OutboxItem<OfflineCheckInPayload> | null> {
    const today = await BusinessClockService.getDate().catch(() => istDate(new Date().toISOString()));
    const items = await this.pending(userId);
    return (
      (items.find(
        (item) =>
          item.operationType === "ATTENDANCE_CHECKIN" &&
          istDate((item.payload as OfflineCheckInPayload).location.capturedAt) === today,
      ) as OutboxItem<OfflineCheckInPayload> | undefined) ?? null
    );
  },

  /**
   * Saves a check-in on the phone. Uses the office list downloaded the last
   * time the phone was online; the server re-checks everything on sync.
   */
  async queueCheckIn(userId: string, gps: GPSCoords) {
    if (gps.mocked) throw new Error("Disable mock-location apps before checking in.");
    const accuracy = Math.max(0, Number(gps.accuracy) || 0);
    if (accuracy > 100) {
      throw new Error(`GPS accuracy is too low (±${Math.round(accuracy)} m). Move outdoors and try again.`);
    }
    const offices = await AttendanceService.getCachedActiveOffices();
    if (!offices.length) {
      throw new Error(
        "The office list is not on this phone yet. Connect to the internet once, then offline check-in will work.",
      );
    }
    const nearest = AttendanceService.findNearestOffice(offices, gps);
    if (!nearest) throw new Error("No office location found. Please contact admin.");
    const radius = effectiveOfficeRadius(nearest.office);
    if (nearest.distanceMetres + accuracy > radius) {
      throw new Error(
        `You are ${Math.ceil(nearest.distanceMetres + accuracy)} m from ${nearest.office.name} (allowed ${Math.ceil(radius)} m).`,
      );
    }
    const operationId = Crypto.randomUUID();
    const payload: OfflineCheckInPayload = {
      userId,
      officeId: nearest.office.id,
      officeName: nearest.office.name,
      location: toOfflineLocation(gps),
    };
    return DurableWriteOutbox.enqueue("ATTENDANCE_CHECKIN", payload, {
      idempotencyKey: operationId,
      userId,
    });
  },

  /**
   * Saves a Going Home check-out on the phone and stops location tracking
   * right away (the day is over for the employee); the server applies the
   * check-out at its original time when the phone is back online.
   */
  async queueCheckOut(userId: string, gps: GPSCoords) {
    if (gps.mocked) throw new Error("Disable mock-location apps before checking out.");
    const pendingCheckIn = await this.pendingCheckInToday(userId);
    const operationId = Crypto.randomUUID();
    const item = await DurableWriteOutbox.enqueue(
      "ATTENDANCE_CHECKOUT",
      { userId, location: toOfflineLocation(gps) } satisfies OfflineCheckOutPayload,
      { idempotencyKey: operationId, userId, dependsOnKey: pendingCheckIn?.idempotencyKey },
    );
    if (Platform.OS !== "web") await stopNativeTracking().catch(() => undefined);
    return item;
  },

  async markSeen(item: OutboxItem) {
    await DurableWriteOutbox.dismiss(item.id);
  },

  /** Outbox handler: send a saved check-in. */
  async sendCheckIn(item: OutboxItem<OfflineCheckInPayload>) {
    await assertOwner(item);
    const { officeId, location } = item.payload;
    const { data, error } = await supabase.rpc("rpc_attendance_offline_checkin", {
      p_office_id: officeId,
      p_location: location,
      p_operation_id: item.idempotencyKey,
    });
    if (error) throw rpcFailure(error);
    const result = Array.isArray(data) ? data[0] : data;
    if (!result?.success) {
      throw new OfflineSyncError(result?.message || result?.error || "The server did not apply this check-in.", true);
    }
    const attendanceId = result.attendance_id ?? result.id;
    const today = await BusinessClockService.getDate(true).catch(() => null);
    if (attendanceId && today && istDate(location.capturedAt) === today) {
      // Synced while the employee is still at work: start tracking now.
      const queue = await DurableWriteOutbox.getQueue();
      const checkoutWaiting = queue.some(
        (it) => it.dependsOnKey === item.idempotencyKey && it.status !== "DEAD_LETTER",
      );
      if (!checkoutWaiting) void startAttendanceTracking(attendanceId).catch(() => undefined);
    }
    return result;
  },

  /** Outbox handler: send a saved check-out. */
  async sendCheckOut(item: OutboxItem<OfflineCheckOutPayload>) {
    await assertOwner(item);
    const { data, error } = await supabase.rpc("rpc_attendance_offline_checkout", {
      p_location: item.payload.location,
      p_operation_id: item.idempotencyKey,
    });
    if (error) throw rpcFailure(error);
    const result = Array.isArray(data) ? data[0] : data;
    if (!result?.success) {
      throw new OfflineSyncError(result?.message || result?.error || "The server did not apply this check-out.", true);
    }
    return result;
  },
};
