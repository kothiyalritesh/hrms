export interface TvAttendanceEvidence {
  official_first_in?: string | null;
  official_last_out?: string | null;
  attendance_status?: string | null;
  active_field_visit_id?: string | null;
}

export interface TvAttendanceClassification {
  isActivelyWorking: boolean;
  isInOffice: boolean;
  isAbsent: boolean;
  isNonWorkingDay: boolean;
}

/**
 * TV occupancy must be evidence based. Calendar/config rows exist for every
 * employee-day, so the absence of a checkout alone can never mean "present".
 */
export function classifyTvAttendance(
  row: TvAttendanceEvidence,
): TvAttendanceClassification {
  const status = String(row.attendance_status ?? "NO_DATA").toUpperCase();
  const isActivelyWorking = Boolean(
    row.official_first_in && !row.official_last_out,
  );
  const isNonWorkingDay = ["HOLIDAY", "WEEKLY_OFF", "ON_LEAVE"].includes(
    status,
  );

  return {
    isActivelyWorking,
    isInOffice: isActivelyWorking && !row.active_field_visit_id,
    isAbsent: status === "ABSENT",
    isNonWorkingDay,
  };
}
