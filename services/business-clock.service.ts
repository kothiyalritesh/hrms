import { supabase } from "@/lib/supabase";
import { getBusinessDateIST } from "@/utils/businessDate";

export type BusinessClock = {
  now: string;
  date: string;
  timezone: "Asia/Kolkata";
  /** "server" normally; "device" when the server could not be reached. */
  source?: "server" | "device";
};

const REQUEST_TIMEOUT_MS = 8_000;
const RETRY_DELAY_MS = 800;

/**
 * Used when the clock RPC can't be reached (mobile network drop, server busy).
 * The business date is derived from the device clock in IST. Safe for reads:
 * check-in/out timestamps are always set by the server, never from this value.
 */
function deviceClock(): BusinessClock {
  const now = new Date();
  return {
    now: now.toISOString(),
    date: getBusinessDateIST(now),
    timezone: "Asia/Kolkata",
    source: "device",
  };
}

async function fetchServerClock(): Promise<BusinessClock> {
  const request = supabase.rpc("get_business_clock") as unknown as Promise<{ data: any; error: any }>;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), REQUEST_TIMEOUT_MS);
  });
  try {
    const { data, error } = await Promise.race([request, timeout]);
    if (error) {
      throw new Error(`Business clock unavailable: ${error.message}`);
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.now || !row?.date || row?.timezone !== "Asia/Kolkata") {
      throw new Error("Business clock returned an invalid response");
    }
    return { now: String(row.now), date: String(row.date), timezone: "Asia/Kolkata", source: "server" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

let cachedClock: { value: BusinessClock; fetchedAt: number } | null = null;
const CACHE_MS = 30_000;
const FAILURE_CACHE_MS = 10_000;
let pendingClockRequest: Promise<BusinessClock> | null = null;
let cachedClockFailure: { error: Error; failedAt: number } | null = null;

export const BusinessClockService = {
  async get(force = false): Promise<BusinessClock> {
    if (
      !force &&
      cachedClock &&
      Date.now() - cachedClock.fetchedAt < CACHE_MS
    ) {
      return cachedClock.value;
    }
    if (
      !force &&
      cachedClockFailure &&
      Date.now() - cachedClockFailure.failedAt < FAILURE_CACHE_MS
    ) {
      return deviceClock();
    }
    if (pendingClockRequest) return pendingClockRequest;
    pendingClockRequest = (async () => {
      try {
        return await fetchServerClock();
      } catch {
        // One quick retry: most failures on phones are a momentary network drop.
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        return await fetchServerClock();
      }
    })();
    try {
      const value = await pendingClockRequest;
      cachedClock = { value, fetchedAt: Date.now() };
      cachedClockFailure = null;
      return value;
    } catch (error: any) {
      // Never block the screen on the clock: fall back to the device's IST date.
      const normalized = error instanceof Error ? error : new Error(String(error));
      cachedClockFailure = { error: normalized, failedAt: Date.now() };
      console.warn("[BusinessClock] server clock unreachable, using device IST date:", normalized.message);
      return deviceClock();
    } finally {
      pendingClockRequest = null;
    }
  },

  async getDate(force = false): Promise<string> {
    return (await this.get(force)).date;
  },
};
