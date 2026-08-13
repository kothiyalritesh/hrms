import { supabase } from "@/lib/supabase";

export type BusinessClock = {
  now: string;
  date: string;
  timezone: "Asia/Kolkata";
};

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
      throw cachedClockFailure.error;
    }
    if (pendingClockRequest) return pendingClockRequest;
    pendingClockRequest = (async () => {
      const { data, error } = await supabase.rpc("get_business_clock");
      if (error) {
        throw new Error(`Business clock unavailable: ${error.message}`);
      }
      const row = Array.isArray(data) ? data[0] : data;
      if (!row?.now || !row?.date || row?.timezone !== "Asia/Kolkata") {
        throw new Error("Business clock returned an invalid response");
      }
      const value: BusinessClock = {
        now: String(row.now),
        date: String(row.date),
        timezone: "Asia/Kolkata",
      };
      cachedClock = { value, fetchedAt: Date.now() };
      cachedClockFailure = null;
      return value;
    })();
    try {
      return await pendingClockRequest;
    } catch (error: any) {
      const normalized =
        error instanceof Error ? error : new Error(String(error));
      cachedClockFailure = { error: normalized, failedAt: Date.now() };
      throw normalized;
    } finally {
      pendingClockRequest = null;
    }
  },

  async getDate(force = false): Promise<string> {
    return (await this.get(force)).date;
  },
};
