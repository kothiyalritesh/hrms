import { parseDatabaseTimestamp } from "@/utils/businessDate";

/**
 * One freshness rule for every location screen (same as the server's
 * hrms_location_freshness): age of the newest good GPS fix.
 *   LIVE <= 5 min · RECENT <= 15 min · STALE > 15 min · NONE = no fix.
 * The Android app sends a fix every minute (15 s on a visit), moving or not.
 */
export const LIVE_MAX_MINUTES = 5;
export const STALE_AFTER_MINUTES = 15;

export type Freshness = "LIVE" | "RECENT" | "STALE" | "NONE";

export const FRESHNESS_UI: Record<Freshness, { label: string; color: string; bg: string }> = {
  LIVE: { label: "Live", color: "#059669", bg: "#ECFDF5" },
  RECENT: { label: "Recent", color: "#0284C7", bg: "#F0F9FF" },
  STALE: { label: "Last known", color: "#D97706", bg: "#FFFBEB" },
  NONE: { label: "No location", color: "#DC2626", bg: "#FEF2F2" },
};

/** Minutes since a database timestamp (must carry a time zone); null if unknown. */
export function minutesAgo(iso: string | null | undefined, nowMs: number = Date.now()): number | null {
  if (!iso) return null;
  try {
    return Math.max(0, (nowMs - parseDatabaseTimestamp(iso).getTime()) / 60000);
  } catch {
    const parsed = Date.parse(iso);
    return Number.isFinite(parsed) && /(?:Z|[+-]\d{2}:?\d{2})$/i.test(iso.trim())
      ? Math.max(0, (nowMs - parsed) / 60000)
      : null;
  }
}

export function freshnessOf(ageMinutes: number | null | undefined): Freshness {
  if (ageMinutes == null || !Number.isFinite(ageMinutes)) return "NONE";
  if (ageMinutes <= LIVE_MAX_MINUTES) return "LIVE";
  if (ageMinutes <= STALE_AFTER_MINUTES) return "RECENT";
  return "STALE";
}

export function freshnessOfTimestamp(iso: string | null | undefined, nowMs: number = Date.now()): Freshness {
  return freshnessOf(minutesAgo(iso, nowMs));
}

export function describeAge(ageMinutes: number | null | undefined): string {
  if (ageMinutes == null || !Number.isFinite(ageMinutes)) return "—";
  if (ageMinutes < 1) return "just now";
  if (ageMinutes < 60) return `${Math.floor(ageMinutes)} min ago`;
  const h = Math.floor(ageMinutes / 60);
  const m = Math.floor(ageMinutes % 60);
  return m ? `${h}h ${m}m ago` : `${h}h ago`;
}

/** "Moving · 24 km/h" / "Not moving" from the fix speed (m/s); null when unknown. */
export function movementText(speedMps: number | null | undefined): string | null {
  if (speedMps == null || !Number.isFinite(speedMps) || speedMps < 0) return null;
  if (speedMps < 0.7) return "Not moving";
  return `Moving · ${Math.round(speedMps * 3.6)} km/h`;
}

export function fmtDistance(metres: number | null | undefined): string {
  if (metres == null || !Number.isFinite(metres)) return "";
  return metres < 1000 ? `${Math.round(metres)} m` : `${(metres / 1000).toFixed(1)} km`;
}

export function istClock(iso: string | null | undefined): string {
  if (!iso) return "—";
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return "—";
  return new Date(parsed).toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}
