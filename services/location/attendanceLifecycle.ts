export interface AttendanceLifecycleRecord {
  id: string;
  checkin_time: string | null;
  checkout_time: string | null;
  checkout_source?: string | null;
  date?: string | null;
  status?: string | null;
}

export function isOpenAttendance(record: AttendanceLifecycleRecord | null) {
  return !!record?.checkin_time && !record.checkout_time;
}

export function isAuthoritativeCheckoutTransition(
  previous: AttendanceLifecycleRecord,
  next: AttendanceLifecycleRecord,
) {
  if (previous.checkout_time || !next.checkout_time) return false;
  return ["APP", "APP_EARLY", "ADMIN"].includes(
    String(next.checkout_source ?? "APP").toUpperCase(),
  );
}
