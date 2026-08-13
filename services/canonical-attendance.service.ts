import { supabase } from "@/lib/supabase";

export type AttendanceSource =
  | "APP"
  | "BIOMETRIC"
  | "FIELD_VISIT"
  | "EVENT"
  | "REGULARIZATION"
  | "ADMIN_CORRECTED"
  | "MULTIPLE"
  | "NO_DATA";

export interface CanonicalAttendanceDay {
  attendance_log_id?: string | null;
  user_id: string;
  work_date: string;
  employee_name: string;
  employee_number: string | null;
  office_id: string | null;
  office_name: string | null;
  team_id: string | null;
  team_name: string | null;
  team_head_id: string | null;
  team_head_name: string | null;
  role: string | null;
  app_first_in: string | null;
  biometric_first_in: string | null;
  field_visit_first_in: string | null;
  official_first_in: string | null;
  first_in_source: AttendanceSource;
  app_checkout: string | null;
  approved_regularization_checkout: string | null;
  admin_corrected_checkout: string | null;
  official_last_out: string | null;
  last_out_source: AttendanceSource;
  biometric_last_punch_evidence: string | null;
  field_visit_checkout: string | null;
  presence_source: AttendanceSource;
  attendance_status: string;
  is_late: boolean;
  working_minutes: number | null;
  warning: string | boolean | null;
  has_field_visit: boolean;
  history_verified: boolean;
  show_on_tv: boolean;
  latest_ping_at?: string | null;
  latest_accuracy_m?: number | null;
  latest_tracking_status?: string | null;
  tracking_health_reason?: string | null;
  ping_is_stale?: boolean;
  active_field_visit_id?: string | null;
  active_field_visit_name?: string | null;
  distance_from_destination_m?: number | null;
  distance_from_office_m?: number | null;
}

const PAGE_SIZE = 500;

export const CanonicalAttendanceService = {
  async list(start: string, end: string, maximum = 20_000) {
    const rows: CanonicalAttendanceDay[] = [];
    for (let offset = 0; offset < maximum; offset += PAGE_SIZE) {
      const { data, error } = await supabase.rpc(
        "rpc_admin_attendance_daily_v3",
        {
          p_start: start,
          p_end: end,
          p_offset: offset,
          p_limit: PAGE_SIZE,
        },
      );
      if (error) throw error;
      const page = (data ?? []) as CanonicalAttendanceDay[];
      rows.push(...page);
      if (page.length < PAGE_SIZE) return rows;
    }
    throw new Error("ATTENDANCE_REPORT_RESULT_LIMIT_EXCEEDED");
  },

  async listDay(workDate: string) {
    return this.list(workDate, workDate, 5_000);
  },
};

/** Compatibility projection while older cards are migrated to v3 field names. */
export function withAttendanceV2Aliases(row: CanonicalAttendanceDay) {
  return {
    ...row,
    date: row.work_date,
    name: row.employee_name,
    team: row.team_name,
    reports_to: row.team_head_id,
    app_in: row.app_first_in,
    app_out: row.app_checkout,
    bio_in: row.biometric_first_in,
    bio_out: row.biometric_last_punch_evidence,
    final_in: row.official_first_in,
    final_out: row.official_last_out,
    report_status: row.attendance_status,
    suggested_status:
      row.official_first_in && !row.official_last_out ? "NO_CHECKOUT" : null,
  };
}
