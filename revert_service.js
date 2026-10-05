const fs = require('fs');

const tsCode = `import { supabase } from "@/lib/supabase";

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
    return this.list(workDate, workDate);
  },
};
`;

fs.writeFileSync('services/canonical-attendance.service.ts', tsCode);
console.log('Reverted canonical-attendance.service.ts');
