import { supabase } from "@/lib/supabase";

export type AttendanceSource =
  | "APP"
  | "BIOMETRIC"
  | "COMBINED"
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
  check_in_office_id?: string | null;
  check_in_office_name?: string | null;
  attendance_source?: string | null;
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
  active_site_name?: string | null;
  distance_from_destination_m?: number | null;
  distance_from_office_m?: number | null;
}

const PAGE_SIZE = 500;

export const CanonicalAttendanceService = {
  async list(start: string, end: string, maximum = 20_000, scopeFilters?: any) {
    // Attempt high-performance bounded RPC first (avoids Cartesian 6-year series and 500 timeout)
    try {
      const officeId = scopeFilters?.office_id ?? null;
      const teamId = scopeFilters?.team_id ?? null;
      const userId = scopeFilters?.user_id ?? null;

      const { data: rpcData, error: rpcError } = await supabase.rpc(
        "rpc_attendance_canonical_range",
        {
          p_start_date: start,
          p_end_date: end,
          p_office_id: officeId,
          p_team_id: teamId,
          p_user_id: userId,
        },
      );

      if (rpcError) {
        if (rpcError.code === '57014' || rpcError.message.includes('timeout')) {
          throw new Error("The date range is too large. Please select a shorter date range to prevent timeouts.");
        }
        console.warn("[canonical-attendance] RPC fallback:", rpcError.message);
      }
      if (!rpcError && Array.isArray(rpcData) && (rpcData.length > 0 || rpcData.length === 0)) {
        return rpcData.map((c: any) => ({
          ...c,
          official_first_in: c.effective_checkin,
          official_last_out: c.effective_checkout,
          attendance_status: c.effective_status,
          is_late:
            c.app_first_in && c.late_checkin_time
              ? c.app_first_in >= c.late_checkin_time
              : false,
          check_in_office_id: c.check_in_office_id ?? c.office_id,
          check_in_office_name: c.check_in_office_name ?? c.office_name,
          attendance_source:
            c.attendance_source ?? (c.biometric_first_in ? "BIOMETRIC" : "APP"),
          first_in_source:
            c.app_first_in && c.biometric_first_in
              ? "COMBINED"
              : c.biometric_first_in
                ? "BIOMETRIC"
                : c.app_first_in
                  ? "APP"
                  : c.field_visit_first_in
                    ? "FIELD_VISIT"
                    : "NONE",
        })) as CanonicalAttendanceDay[];
      }
    } catch {
      // Fall through to paginated view query on older schema or fallback
    }

    const rows: CanonicalAttendanceDay[] = [];
    for (let offset = 0; offset < maximum; offset += PAGE_SIZE) {
      // Direct query fallback for environments without range RPC
      const { data, error } = await supabase
        .from("v_attendance_daily_canonical")
        .select("*")
        .gte("work_date", start)
        .lte("work_date", end)
        .match(scopeFilters || {})
        .order("work_date", { ascending: false })
        .order("employee_name", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);

      if (error) {
        if (error.code === '57014' || error.message.includes('timeout')) {
          throw new Error("The date range is too large. Please select a shorter date range.");
        }
        throw new Error(error.message);
      }
      const page = (data ?? []).map((c: any) => ({
        ...c,
        official_first_in: c.effective_checkin,
        official_last_out: c.effective_checkout,
        attendance_status: c.effective_status,
        is_late: c.app_first_in && c.late_checkin_time ? c.app_first_in >= c.late_checkin_time : false,
        check_in_office_id: c.check_in_office_id ?? c.office_id,
        check_in_office_name: c.check_in_office_name ?? c.office_name,
        attendance_source: c.attendance_source ?? (c.biometric_first_in ? 'BIOMETRIC' : 'APP'),
        first_in_source: c.app_first_in && c.biometric_first_in ? 'COMBINED' : (c.biometric_first_in ? 'BIOMETRIC' : (c.app_first_in ? 'APP' : (c.field_visit_first_in ? 'FIELD_VISIT' : 'NONE')))
      })) as CanonicalAttendanceDay[];

      rows.push(...page);
      if (page.length < PAGE_SIZE) return rows;
    }
    return rows;
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
