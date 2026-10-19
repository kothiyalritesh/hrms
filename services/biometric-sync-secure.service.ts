import { supabase } from "@/lib/supabase";
import * as Crypto from "expo-crypto";
import { BusinessClockService } from "@/services/business-clock.service";
import {
  type ConfirmedBiometricSync,
  requireConfirmedBiometricSync,
} from "@/utils/biometricSyncResult";
import { validateBiometricSyncRange } from "@/utils/biometricSyncRequest";
import { secureStorage } from "@/utils/secureStorage";
import { Platform } from "react-native";

const PENDING_SYNC_KEY = "@hrms_pending_biometric_sync_v1";
const STALE_PENDING_MS = 24 * 60 * 60_000;

export type BiometricSyncStatus = {
  ok: boolean;
  message: string;
  lastAttempt: Date | null;
};

export type PendingBiometricSync = {
  requestId: string;
  fromDate: string;
  toDate: string;
  createdAt: string;
};

let status: BiometricSyncStatus = {
  ok: true,
  message: "Server-managed biometric sync",
  lastAttempt: null,
};
const listeners = new Set<(value: BiometricSyncStatus) => void>();

async function readPendingValue() {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    try {
      const durable = window.localStorage.getItem(PENDING_SYNC_KEY);
      if (durable) return durable;
      const legacy = await secureStorage.getItem(PENDING_SYNC_KEY);
      if (legacy) {
        // This record contains only an opaque UUID and date range—never an
        // access token, employee data, biometric data, or location evidence.
        window.localStorage.setItem(PENDING_SYNC_KEY, legacy);
      }
      return legacy;
    } catch {
      return secureStorage.getItem(PENDING_SYNC_KEY);
    }
  }
  return secureStorage.getItem(PENDING_SYNC_KEY);
}

async function writePendingValue(value: string) {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    try {
      window.localStorage.setItem(PENDING_SYNC_KEY, value);
      await secureStorage.removeItem(PENDING_SYNC_KEY);
      return;
    } catch {
      // Browser privacy mode can reject localStorage; session recovery remains.
    }
  }
  await secureStorage.setItem(PENDING_SYNC_KEY, value);
}

async function clearPendingValue() {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(PENDING_SYNC_KEY);
    } catch {
      // Continue with the secure/session fallback cleanup.
    }
  }
  await secureStorage.removeItem(PENDING_SYNC_KEY);
}

function publish(next: BiometricSyncStatus) {
  status = next;
  for (const listener of listeners) listener(next);
}

async function getPendingRequest(): Promise<PendingBiometricSync | null> {
  try {
    const raw = await readPendingValue();
    if (!raw) return null;
    const value = JSON.parse(raw) as PendingBiometricSync;
    if (
      !value?.requestId ||
      !value.fromDate ||
      !value.toDate ||
      !value.createdAt
    ) {
      await clearPendingValue();
      return null;
    }
    return value;
  } catch {
    await clearPendingValue();
    return null;
  }
}

async function savePendingRequest(value: PendingBiometricSync) {
  await writePendingValue(JSON.stringify(value));
}

async function confirmRequest(
  pending: PendingBiometricSync,
  statusOnly = false,
): Promise<ConfirmedBiometricSync> {
  const { data, error } = await supabase.functions.invoke(
    "biometric-attendance-sync",
    {
      body: {
        ...(statusOnly ? { action: "status" } : {}),
        requestId: pending.requestId,
        fromDate: pending.fromDate,
        toDate: pending.toDate,
      },
    },
  );
  if (error || data?.error) {
    throw new Error(
      `${data?.message || data?.error || error?.message || "Biometric sync status is unknown."} Request ID: ${pending.requestId}`,
    );
  }
  return requireConfirmedBiometricSync(data, {
    fromDate: pending.fromDate,
    toDate: pending.toDate,
    requestId: pending.requestId,
  });
}

async function runRange(
  fromDate: string,
  toDate: string,
  knownBusinessDate?: string,
) {
  const businessDate =
    knownBusinessDate || (await BusinessClockService.getDate(true));
  const range = validateBiometricSyncRange({
    fromDate,
    toDate,
    businessDate,
  });
  let existing = await getPendingRequest();
  // An unconfirmed request older than a day is no longer worth blocking on:
  // the import is transactional and duplicate punches are skipped, so running
  // a range again is safe.
  if (existing && Date.now() - Date.parse(existing.createdAt) > STALE_PENDING_MS) {
    await clearPendingValue();
    existing = null;
  }
  if (
    existing &&
    (existing.fromDate !== range.fromDate || existing.toDate !== range.toDate)
  ) {
    throw new Error(
      `Request ${existing.requestId} for ${existing.fromDate} to ${existing.toDate} still has an unknown result. Retry that request before starting another date range.`,
    );
  }
  const pending =
    existing?.fromDate === range.fromDate && existing.toDate === range.toDate
      ? existing
      : {
          requestId: Crypto.randomUUID(),
          fromDate: range.fromDate,
          toDate: range.toDate,
          createdAt: new Date().toISOString(),
        };
  await savePendingRequest(pending);

  try {
    let confirmed: ConfirmedBiometricSync;
    try {
      confirmed = await confirmRequest(pending);
    } catch {
      confirmed = await confirmRequest(pending, true);
    }
    await clearPendingValue();
    publish({
      ok: true,
      message: `Sync completed · ${pending.requestId}`,
      lastAttempt: new Date(),
    });
    return confirmed;
  } catch (error: any) {
    publish({
      ok: false,
      message:
        error?.message ||
        `Protected biometric sync status is unknown. Request ID: ${pending.requestId}`,
      lastAttempt: new Date(),
    });
    throw error;
  }
}

async function recoverPendingRequest() {
  const pending = await getPendingRequest();
  if (!pending) return { pending: null, result: null };
  try {
    const result = await confirmRequest(pending, true);
    await clearPendingValue();
    publish({
      ok: true,
      message: `Recovered sync · ${pending.requestId}`,
      lastAttempt: new Date(),
    });
    return { pending: null, result };
  } catch {
    return { pending, result: null };
  }
}

async function runNow() {
  const date = await BusinessClockService.getDate(true);
  return runRange(date, date, date);
}

export const biometricSyncService = {
  start() {
    // Production synchronization is scheduled on the server.
  },
  stop() {
    // No client timer is used.
  },
  runNow,
  runRange,
  getPendingRequest,
  recoverPendingRequest,
  /**
   * Forget an unconfirmed request on this device. Safe: each import is one
   * database transaction (fully applied or rolled back) and re-importing the
   * same dates only reports duplicates.
   */
  async discardPendingRequest() {
    await clearPendingValue();
    publish({ ok: true, message: "Pending sync cleared", lastAttempt: status.lastAttempt });
  },
  getStatus: () => status,
  subscribe(listener: (value: BiometricSyncStatus) => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
