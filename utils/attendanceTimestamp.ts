import { parseDatabaseTimestamp } from "@/utils/businessDate";

const TIMEZONE_SUFFIX = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i;
const LEGACY_ATTENDANCE_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?$/;
const IST_TIMESTAMP_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const IST_TIME_DISPLAY = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
});

const IST_DATE_TIME_DISPLAY = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
});

/**
 * Attendance and field-visit tables contain legacy `timestamp without time
 * zone` values written as India local time. Convert only that known legacy
 * representation to an explicit IST instant. All already-zoned values retain
 * the strict database timestamp contract.
 */
export function parseAttendanceTimestamp(value: string): Date {
  const normalized = value.trim().replace(" ", "T");
  if (TIMEZONE_SUFFIX.test(normalized)) {
    return parseDatabaseTimestamp(normalized);
  }
  if (!LEGACY_ATTENDANCE_TIMESTAMP.test(normalized)) {
    throw new Error("INVALID_ATTENDANCE_TIMESTAMP");
  }
  const parsed = new Date(`${normalized}+05:30`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("INVALID_ATTENDANCE_TIMESTAMP");
  }
  return parsed;
}

/** Parse an HRMS timestamp without ever guessing that an offset-less value is UTC. */
export function parseHrmsTimestamp(value: string | Date): Date {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error("INVALID_HRMS_TIMESTAMP");
    return new Date(value.getTime());
  }
  return parseAttendanceTimestamp(value);
}

export function formatHrmsTime(
  value: string | Date | null | undefined,
  fallback = "No time recorded",
): string {
  if (!value) return fallback;
  try {
    return IST_TIME_DISPLAY.format(parseHrmsTimestamp(value));
  } catch {
    return "Invalid timestamp";
  }
}

export function formatHrmsDateTime(
  value: string | Date | null | undefined,
  fallback = "No date recorded",
): string {
  if (!value) return fallback;
  try {
    return IST_DATE_TIME_DISPLAY.format(parseHrmsTimestamp(value));
  } catch {
    return "Invalid timestamp";
  }
}

export function getBusinessDateIST(value: string | Date = new Date()): string {
  const parts = IST_TIMESTAMP_FORMATTER.formatToParts(parseHrmsTimestamp(value));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function attendanceTimestampParts(value: string) {
  const parts = IST_TIMESTAMP_FORMATTER.formatToParts(
    parseAttendanceTimestamp(value),
  );
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  const second = Number(get("second"));
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour,
    minute,
    second,
    time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`,
  };
}
