// utils/format.ts
// App-wide formatting helpers. One date format, one name casing — used everywhere
// so the UI stays consistent (per UI audit, 12 Jun 2026).

import { isBusinessDate, parseDatabaseTimestamp } from "@/utils/businessDate";

const INDIA_TIME_ZONE = "Asia/Kolkata";

function toDate(input: string | number | Date | null | undefined): Date | null {
  if (input == null) return null;
  if (input instanceof Date) return isNaN(input.getTime()) ? null : input;
  // Date-only values are calendar dates; timestamp values require an offset.
  if (typeof input === "string") {
    if (isBusinessDate(input)) {
      return new Date(`${input}T12:00:00+05:30`);
    }
    try {
      return parseDatabaseTimestamp(input);
    } catch {
      // Offset-less official timestamps are ambiguous. Never guess UTC or the
      // employee device timezone because that can silently shift attendance.
      return null;
    }
  }
  const d = new Date(input);
  return isNaN(d.getTime()) ? null : d;
}

/** Standard app date: "5 Jun 2026". Returns fallback if unparseable. */
export function formatDate(input: string | number | Date | null | undefined, fallback = "—"): string {
  const d = toDate(input);
  if (!d) return fallback;
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: INDIA_TIME_ZONE,
  });
}

/** Standard date + time: "5 Jun 2026, 10:32 AM". */
export function formatDateTime(input: string | number | Date | null | undefined, fallback = "—"): string {
  const d = toDate(input);
  if (!d) return fallback;
  const time = d.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: INDIA_TIME_ZONE,
  });
  return `${formatDate(d)}, ${time}`;
}

/** Time only: "10:32 AM". */
export function formatTime(input: string | number | Date | null | undefined, fallback = "—"): string {
  const d = toDate(input);
  if (!d) return fallback;
  return d.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: INDIA_TIME_ZONE,
  });
}

/**
 * Title Case a person's name: "TUSHAR SHARMA" / "kiranpal singh" → "Tushar Sharma".
 * Keeps hyphenated parts (e.g. "Channel-Partner") and common particles lowercase
 * only when they are not the first word.
 */
export function toTitleCase(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((word) =>
      word
        .split("-")
        .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
        .join("-")
    )
    .join(" ");
}

/**
 * Attendance card status based only on server-confirmed attendance state.
 * Returns { color, bgColor, text } for the attendance stat card.
 */
export function getAttendanceCardStyle(
  isCheckedIn: boolean,
  isCheckedOut: boolean,
  serverStatus?: string | null,
): {
  color: string; bgColor: string; statusText: string;
} {
  const status = String(serverStatus ?? "").trim().toUpperCase();
  if (status === "LATE") {
    return { color: "#D97706", bgColor: "#D9770618", statusText: "Late" };
  }
  if (isCheckedIn) {
    return { color: "#12966E", bgColor: "#12966E18", statusText: isCheckedOut ? "Completed" : "Checked in" };
  }
  if (["ABSENT", "A"].includes(status)) {
    return { color: "#C8252D", bgColor: "#C8252D18", statusText: "Absent" };
  }
  return { color: "#8A8594", bgColor: "#8A859418", statusText: "No check-in recorded" };
}
