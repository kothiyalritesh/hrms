export type AttendanceEvidenceGroup =
  | "BOTH"
  | "APP_ONLY"
  | "BIOMETRIC_ONLY"
  | "OTHER_ATTENDANCE"
  | "NO_ATTENDANCE";

export interface AttendanceEvidenceRow {
  app_checkin_time?: string | null;
  biometric_first_in?: string | null;
  checkin_time?: string | null;
}

/**
 * Attendance Control compares evidence, so classification must be based on
 * evidence timestamps rather than treating every non-biometric employee-day
 * as an app attendance row.
 */
export function classifyAttendanceEvidence(
  row: AttendanceEvidenceRow,
  rawBiometricPunchCount = 0,
): AttendanceEvidenceGroup {
  const hasApp = Boolean(row.app_checkin_time);
  const hasBiometric =
    Boolean(row.biometric_first_in) || rawBiometricPunchCount > 0;
  if (hasApp && hasBiometric) return "BOTH";
  if (hasApp) return "APP_ONLY";
  if (hasBiometric) return "BIOMETRIC_ONLY";
  if (row.checkin_time) return "OTHER_ATTENDANCE";
  return "NO_ATTENDANCE";
}

export function attendanceEmptyStateCopy(status: string | null | undefined) {
  switch (String(status ?? "NO_DATA").toUpperCase()) {
    case "ABSENT":
      return { label: "Absent", detail: "No verified check-in was recorded." };
    case "CONFIG_REQUIRED":
      return {
        label: "Configuration required",
        detail: "Assign an active office and attendance policy.",
      };
    case "ON_LEAVE":
      return { label: "On leave", detail: "Approved leave covers this day." };
    case "HOLIDAY":
      return { label: "Holiday", detail: "This is a configured holiday." };
    case "WEEKLY_OFF":
      return { label: "Weekly off", detail: "This is a configured weekly off." };
    default:
      return {
        label: "No attendance",
        detail: "No app, biometric, or field-visit check-in was found.",
      };
  }
}
