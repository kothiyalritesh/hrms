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
      !value.createdAt ||
      // Older than a day: the import is transactional and duplicates are
      // skipped, so those dates can simply be synced again.
      !(Date.now() - Date.parse(value.createdAt) <= STALE_PENDING_MS)
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

// The server runs one sync at a time and also syncs today every minute, so a
// manual sync often meets a busy server: wait and retry the same request.
const BUSY_CODES = new Set(["SYNC_BUSY", "SYNC_IN_PROGRESS"]);
const BUSY_RETRIES = 6;
const BUSY_WAIT_MS = 10_000;

const FRIENDLY: Record<string, string> = {
  SYNC_BUSY: "The server is already syncing biometric punches (it does this every minute). Try again in a minute.",
  SYNC_IN_PROGRESS: "This sync is still running on the server. Try again in a minute.",
  ADMIN_PERMISSION_REQUIRED: "Only admin and HR can run a manual biometric sync.",
  INVALID_DATE_RANGE: "Choose up to 31 days, ending today or earlier.",
  SMARTOFFICE_UNAVAILABLE: "The SmartOffice biometric server did not answer. Check that it is online.",
};

/**
 * The SmartOffice failures in words. The server reports them as
 * "SMARTOFFICE_FETCH: SMARTOFFICE_HTTP_502 (SMARTOFFICE_TIMEOUT)".
 */
export function friendlySyncMessage(raw: string | null | undefined): string | null {
  const text = String(raw ?? "");
  if (!/SMARTOFFICE_|SERVER_NOT_CONFIGURED/.test(text)) return null;
  if (text.includes("SERVER_NOT_CONFIGURED")) {
    return "The server could not read the SmartOffice connection settings. Check the SmartOffice URL and API key in Supabase.";
  }
  const status = Number(text.match(/SMARTOFFICE_HTTP_(\d+)/)?.[1] ?? NaN);
  if (status === 401 || status === 403) {
    return "SmartOffice refused the API key. Check the API key in the SmartOffice settings.";
  }
  if (/SMARTOFFICE_(TIMEOUT|UNREACHABLE|UNAVAILABLE|PROXY_UNREACHABLE)/.test(text) || status >= 500 || status === 0) {
    return (
      "The SmartOffice biometric server at the office is not answering" +
      (text.includes("TIMEOUT") ? " (no reply within 20 seconds)" : "") +
      ". HRMS keeps trying every minute by itself; punches stay on the machines and come in once it answers."
    );
  }
  return null;
}

export class BiometricSyncError extends Error {
  constructor(message: string, readonly code: string | null) {
    super(message);
  }
}

/**
 * On a non-2xx answer supabase-js returns only "Edge Function returned a
 * non-2xx status code"; the server's own reason is in the response body.
 */
async function readFunctionError(error: any, data: any) {
  let body = data && typeof data === "object" ? data : null;
  const response = error?.context;
  if (!body && response && typeof response.json === "function") {
    body = await (typeof response.clone === "function" ? response.clone() : response).json().catch(() => null);
  }
  const code = body?.error ? String(body.error) : null;
  const serverMessage = body?.message ? String(body.message) : null;
  const message =
    (code && FRIENDLY[code]) ||
    friendlySyncMessage(serverMessage) ||
    serverMessage ||
    (response?.status === 401 ? "The server did not accept your sign-in. Sign out and sign in again." : null) ||
    code ||
    error?.message ||
    "Biometric sync status is unknown.";
  return new BiometricSyncError(message, code);
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
    throw await readFunctionError(error, data);
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
  // An unconfirmed request for other dates must not block this one: ask the
  // server once how it ended, then forget it either way. Each import is one
  // transaction and duplicates are skipped, so those dates can simply be
  // synced again (and the server job re-syncs today every minute).
  if (
    existing &&
    (existing.fromDate !== range.fromDate || existing.toDate !== range.toDate)
  ) {
    await confirmRequest(existing, true).catch(() => undefined);
    await clearPendingValue();
    existing = null;
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
    let confirmed: ConfirmedBiometricSync | null = null;
    for (let attempt = 0; !confirmed; attempt += 1) {
      try {
        confirmed = await confirmRequest(pending);
      } catch (error) {
        const code = error instanceof BiometricSyncError ? error.code : null;
        if (code && BUSY_CODES.has(code) && attempt < BUSY_RETRIES) {
          publish({
            ok: true,
            message: "Server is busy syncing; retrying…",
            lastAttempt: new Date(),
          });
          await wait(BUSY_WAIT_MS);
          continue;
        }
        // The request may have finished although the answer was lost.
        confirmed = await confirmRequest(pending, true).catch(() => {
          throw error;
        });
      }
    }
    await clearPendingValue();
    publish({
      ok: true,
      message: `Sync completed · ${pending.requestId}`,
      lastAttempt: new Date(),
    });
    return confirmed;
  } catch (error: any) {
    // The server answered how it ended (failed, refused, ...): nothing is
    // unfinished. Only a lost answer or a still-running sync stays pending.
    const code = error instanceof BiometricSyncError ? error.code : null;
    if (code && code !== "SYNC_IN_PROGRESS") await clearPendingValue();
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
  } catch (error) {
    const code = error instanceof BiometricSyncError ? error.code : null;
    if (code && code !== "SYNC_IN_PROGRESS") {
      // It failed on the server (or the server never got it): not unfinished.
      await clearPendingValue();
      return { pending: null, result: null };
    }
    return { pending, result: null };
  }
}

export type BiometricSyncHealth = {
  now: string;
  last_success_at: string | null;
  last_attempt_at: string | null;
  last_status: string | null;
  failing_since: string | null;
  consecutive_failures: number;
  last_failure: string | null;
};

/** The server's every-minute sync: last success and since when it fails. */
async function getHealth(): Promise<BiometricSyncHealth | null> {
  const { data, error } = await supabase.rpc("rpc_biometric_sync_health");
  if (error || !data) return null;
  return data as BiometricSyncHealth;
}

/** Synced within this time = up to date; the server syncs every minute. */
export const SYNC_FRESH_MS = 5 * 60_000;

const istTime = (iso: string) => {
  const d = new Date(Date.parse(iso) + 330 * 60_000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};

const ago = (ms: number) => {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  return `${h} h ${min % 60} min ago`;
};

/** One line for the Attendance Control banner. */
export function describeSyncHealth(health: BiometricSyncHealth, nowMs = Date.now()) {
  const lastMs = health.last_success_at ? Date.parse(health.last_success_at) : NaN;
  const age = nowMs - lastMs;
  const fresh = age <= SYNC_FRESH_MS;
  const last = Number.isFinite(lastMs)
    ? `last synced ${istTime(health.last_success_at!)} (${ago(age)})`
    : "never synced yet";
  if (fresh) {
    return { tone: "ok" as const, fresh, text: `Biometric up to date · synced ${istTime(health.last_success_at!)} (${ago(age)}), automatic every minute` };
  }
  const tone = !Number.isFinite(lastMs) || age > 30 * 60_000 ? ("error" as const) : ("warn" as const);
  if (health.failing_since) {
    return {
      tone,
      fresh,
      text: `SmartOffice server not answering since ${istTime(health.failing_since)} · ${last}. HRMS keeps retrying every minute.`,
    };
  }
  return { tone, fresh, text: `Biometric ${last}.` };
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
  getHealth,
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
