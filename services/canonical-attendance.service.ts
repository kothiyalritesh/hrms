import { supabase } from "@/lib/supabase";
import { addBusinessDays } from "@/utils/businessDate";
import { DEFAULT_LATE_CHECKIN_TIME } from "@/constants/attendancePolicy";

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

// One request is capped by PostgREST "max rows" (Supabase default 1000), so a
// month for ~250 employees used to come back as only the newest ~4 days
// (the RPC orders work_date DESC). We fetch the range in small date windows and
// page inside each window until a short page arrives. PAGE_SIZE must stay at or
// below the project's max-rows setting.
const PAGE_SIZE = 500;
// One day per request. The server builds the WHOLE window for every page it
// returns (LIMIT/OFFSET are applied after the function), so a 3-day window
// that needed 2 pages was computed twice. One-day windows fit in one page.
const WINDOW_DAYS = 1;
const WINDOW_CONCURRENCY = 4;
// Same day requested by several screens / every live refresh: reuse it briefly.
const DAY_CACHE_MS = 30_000;
const dayCache = new Map<string, { at: number; rows: Promise<CanonicalAttendanceDay[]> }>();

class CanonicalRpcMissingError extends Error {}

function dateWindows(start: string, end: string): Array<[string, string]> {
  // Newest window first, matching the RPC's work_date DESC order.
  const windows: Array<[string, string]> = [];
  let windowEnd = end;
  while (windowEnd >= start) {
    const candidate = addBusinessDays(windowEnd, -(WINDOW_DAYS - 1));
    const windowStart = candidate < start ? start : candidate;
    windows.push([windowStart, windowEnd]);
    windowEnd = addBusinessDays(windowStart, -1);
  }
  return windows;
}

const istClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/**
 * Late = first check-in (IST) at or after the office policy time
 * (late_checkin_time from the server, 10:33:00 if no policy). The canonical
 * RPC has no is_late column, so this is the single place it is derived.
 */
export function isLateCheckin(firstIn: string | null | undefined, lateTime: string | null | undefined): boolean {
  if (!firstIn) return false;
  const instant = new Date(firstIn);
  if (Number.isNaN(instant.getTime())) return false;
  const threshold = String(lateTime || DEFAULT_LATE_CHECKIN_TIME);
  const normalized = threshold.length === 5 ? `${threshold}:00` : threshold.slice(0, 8);
  return istClock.format(instant) >= normalized;
}

export function mapRow(c: any): CanonicalAttendanceDay {
  return {
    ...c,
    official_first_in: c.effective_checkin,
    official_last_out: c.effective_checkout,
    attendance_status: c.effective_status,
    is_late: c.is_late ?? isLateCheckin(c.effective_checkin ?? c.official_first_in, c.late_checkin_time),
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
  } as CanonicalAttendanceDay;
}

export const CanonicalAttendanceService = {
  /**
   * Fetch every row for the date range. Never returns a silently truncated
   * result: throws if more than `maximum` rows would be loaded.
   * Authorization is enforced by the RPC; scopeFilters can only narrow it.
   */
  async list(
    start: string,
    end: string,
    maximum = 20_000,
    scopeFilters?: any,
  ): Promise<CanonicalAttendanceDay[]> {
    if (end < start) return [];
    const windows = dateWindows(start, end);
    const results: CanonicalAttendanceDay[][] = new Array(windows.length);
    let loaded = 0;

    try {
      for (let i = 0; i < windows.length; i += WINDOW_CONCURRENCY) {
        const batch = windows.slice(i, i + WINDOW_CONCURRENCY);
        const pages = await Promise.all(
          batch.map(([ws, we]) => this._listWindow(ws, we, scopeFilters)),
        );
        pages.forEach((rows, j) => {
          results[i + j] = rows;
          loaded += rows.length;
        });
        if (loaded > maximum) {
          throw new Error(
            "Range too large: narrow the date range or office filter to load attendance data.",
          );
        }
      }
    } catch (error) {
      if (error instanceof CanonicalRpcMissingError) {
        return this._listFromView(start, end, maximum, scopeFilters);
      }
      throw error;
    }

    return results.flat();
  },

  /** One date window from the RPC, paged until a short page. */
  async _listWindow(
    start: string,
    end: string,
    scopeFilters?: any,
  ): Promise<CanonicalAttendanceDay[]> {
    const rows: CanonicalAttendanceDay[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await supabase
        .rpc("rpc_attendance_canonical_range", {
          p_start_date: start,
          p_end_date: end,
          p_office_id: scopeFilters?.office_id ?? null,
          p_team_id: scopeFilters?.team_id ?? null,
          p_user_id: scopeFilters?.user_id ?? null,
        })
        .range(offset, offset + PAGE_SIZE - 1);

      if (error) {
        if (error.code === "PGRST202" || error.code === "42883") {
          throw new CanonicalRpcMissingError(error.message);
        }
        if (error.code === "57014" || error.message?.includes("timeout")) {
          throw new Error(
            "The date range is too large. Please select a shorter date range to prevent timeouts.",
          );
        }
        throw new Error(error.message);
      }

      const page = (data ?? []).map(mapRow);
      rows.push(...page);
      if (page.length < PAGE_SIZE) return rows;
    }
  },

  /** Fallback: paginate directly against the canonical view. */
  async _listFromView(
    start: string,
    end: string,
    maximum: number,
    scopeFilters?: any,
  ): Promise<CanonicalAttendanceDay[]> {
    const rows: CanonicalAttendanceDay[] = [];
    for (let offset = 0; offset <= maximum; offset += PAGE_SIZE) {
      const { data, error } = await supabase
        .from("v_attendance_daily_canonical")
        .select("*")
        .gte("work_date", start)
        .lte("work_date", end)
        .match(scopeFilters || {})
        .order("work_date", { ascending: false })
        .order("employee_name", { ascending: true })
        .order("user_id", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);

      if (error) {
        if (error.code === "57014" || error.message?.includes("timeout")) {
          throw new Error(
            "The date range is too large. Please select a shorter date range.",
          );
        }
        throw new Error(error.message);
      }

      const page = (data ?? []).map(mapRow);
      rows.push(...page);
      if (page.length < PAGE_SIZE) return rows;
    }
    throw new Error(
      "Range too large: narrow the date range or office filter to load attendance data.",
    );
  },

  /**
   * One business day. Calls made within 30 s of each other (Live Tracking
   * refreshes, dashboards) share one server request instead of each running
   * the expensive attendance calculation again.
   */
  async listDay(workDate: string, options?: { fresh?: boolean }) {
    const cached = dayCache.get(workDate);
    if (!options?.fresh && cached && Date.now() - cached.at < DAY_CACHE_MS) {
      return cached.rows;
    }
    const rows = this.list(workDate, workDate, 5_000);
    dayCache.set(workDate, { at: Date.now(), rows });
    rows.catch(() => {
      if (dayCache.get(workDate)?.rows === rows) dayCache.delete(workDate);
    });
    return rows;
  },

  /** Forget cached days (after an attendance correction or a manual refresh). */
  invalidateDayCache() {
    dayCache.clear();
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
