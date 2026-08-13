export function addBusinessDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** A date-only deadline becomes overdue only after its full IST business day. */
export function isDueDateOverdue(
  dueDate: string | null | undefined,
  businessDate: string | null | undefined,
): boolean {
  const due = dueDate?.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  return !!due && !!businessDate && isBusinessDate(due) && due < businessDate;
}

export function businessMonthRange(date: string) {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    start: `${date.slice(0, 8)}01`,
    end: `${date.slice(0, 8)}${String(lastDay).padStart(2, "0")}`,
  };
}

export function businessMonthKey(date: string) {
  return date.slice(0, 7);
}

export function businessDateUtcRange(date: string) {
  if (!isBusinessDate(date)) throw new Error("INVALID_BUSINESS_DATE");
  const start = new Date(`${date}T00:00:00+05:30`);
  const next = addBusinessDays(date, 1);
  const end = new Date(`${next}T00:00:00+05:30`);
  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

export function isBusinessDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

export function formatBusinessDate(value: string): string {
  if (!isBusinessDate(value)) return "—";
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${Number(value.slice(8, 10))} ${months[Number(value.slice(5, 7)) - 1]} ${value.slice(0, 4)}`;
}

const IST_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/**
 * Official timestamps must carry their timezone. Guessing UTC for an
 * offset-less value can silently shift an IST timestamp by 5 hours 30 minutes.
 */
export function parseDatabaseTimestamp(value: string): Date {
  const normalized = value.trim().replace(" ", "T");
  const hasTimezone = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(normalized);
  if (!hasTimezone) {
    throw new Error("DATABASE_TIMESTAMP_TIMEZONE_REQUIRED");
  }
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("INVALID_DATABASE_TIMESTAMP");
  }
  return parsed;
}

export function businessTimestampParts(value: string) {
  const parts = IST_DATE_TIME_FORMATTER.formatToParts(
    parseDatabaseTimestamp(value),
  );
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const year = get("year");
  const month = get("month");
  const day = get("day");
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  const second = Number(get("second"));
  return {
    date: `${year}-${month}-${day}`,
    hour,
    minute,
    second,
    time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`,
  };
}

export function isTimestampAtOrAfterBusinessCutoff(
  value: string,
  cutoffHour: number,
  cutoffMinute: number,
): boolean {
  const parts = businessTimestampParts(value);
  const timestampSeconds =
    parts.hour * 60 * 60 + parts.minute * 60 + parts.second;
  const cutoffSeconds = (cutoffHour * 60 + cutoffMinute) * 60;
  return timestampSeconds >= cutoffSeconds;
}
