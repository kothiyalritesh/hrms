import React, { useState } from "react";
import {
  View, StyleSheet, ScrollView, Pressable,
  ActivityIndicator,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, Spacing } from "@/constants/theme";
import { supabase } from "@/lib/supabase";
import { fetchAllPages } from "@/utils/supabasePagination";
import { CanonicalAttendanceService, type CanonicalAttendanceDay } from "@/services/canonical-attendance.service";
import { DEFAULT_LATE_CHECKIN_TIME } from "@/constants/attendancePolicy";
import { getBusinessDateIST } from "@/utils/businessDate";
import { usePermissions } from "@/hooks/usePermissions";
import {
  ReportFilterBar,
  ReportMeta,
  ReportMonthStepper,
  ReportNotice,
  ReportState,
} from "@/components/reports/ReportUI";
import {
  exportSheets, formatIstDateTime, formatIstTime, formatMinutes, minutesAfterIst,
  type ExportSheet, type SheetCell,
} from "@/utils/exportWorkbook";

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

type ExportId =
  | "attendance_register" | "late_arrivals" | "leave_usage"
  | "comp_off" | "field_visits" | "geofence_events";

// `route` names the report whose permission (SCREEN_PERMISSIONS) an export
// needs, so nobody sees a download the server would refuse anyway.
const EXPORTS: Array<{ id: ExportId; title: string; description: string; icon: React.ComponentProps<typeof Feather>["name"]; category: string; route: string }> = [
  { id: "attendance_register", title: "Monthly attendance register", description: "Per-employee P/A/L/WO grid, totals and daily in/out times", icon: "calendar", category: "Attendance", route: "ReportsAttendanceRegister" },
  { id: "late_arrivals",       title: "Late arrivals",               description: "Every late check-in with expected time and minutes late", icon: "clock", category: "Attendance", route: "ReportsLateArrival" },
  { id: "leave_usage",         title: "Leave usage",                 description: "Leave requests overlapping the month, with days and status", icon: "briefcase", category: "Leave", route: "ReportsLeaveUsage" },
  { id: "comp_off",            title: "Comp-off & overtime",         description: "Weekend/holiday work and comp-off earned, used, expiring", icon: "award", category: "Leave", route: "ReportsOvertime" },
  { id: "field_visits",        title: "Field visit log",             description: "All field visits with times, duration and GPS evidence", icon: "map-pin", category: "Field & tracking", route: "ReportsFieldVisits" },
  { id: "geofence_events",     title: "Geofence events",             description: "Entry/exit and violation events with reasons and reviews", icon: "map", category: "Field & tracking", route: "ReportsGeofenceEvents" },
];

const pad = (n: number) => String(n).padStart(2, "0");

/** Register code for one day's canonical status. */
function registerCode(status: string | null | undefined): string {
  const s = (status || "").toUpperCase();
  if (s === "LATE") return "P(L)";
  if (["PRESENT", "CHECKED_IN", "CHECKED_OUT", "FIELD_VISIT", "COMPLETED"].includes(s)) return "P";
  if (s === "HALF_DAY") return "HD";
  if (s === "LEAVE" || s === "ON_LEAVE") return "L";
  if (s === "WFH") return "WFH";
  if (s === "WEEKLY_OFF") return "WO";
  if (s === "HOLIDAY") return "H";
  if (s === "ABSENT" || !s) return "A";
  return s;
}

function sourceLabel(source: string | null | undefined): string {
  switch ((source || "").toUpperCase()) {
    case "APP": return "App";
    case "BIOMETRIC": return "Biometric";
    case "COMBINED": return "App + Biometric";
    case "FIELD_VISIT": return "Field visit";
    case "EVENT": return "Event";
    case "REGULARIZATION": return "Regularization";
    case "ADMIN_CORRECTED": return "Admin corrected";
    default: return source ? String(source) : "";
  }
}

function coords(value: any): string {
  if (!value) return "";
  const lat = value.latitude ?? value.lat;
  const lng = value.longitude ?? value.lng ?? value.lon;
  if (lat == null || lng == null) return "";
  return `${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)}`;
}

function minutesBetween(a?: string | null, b?: string | null): number | null {
  if (!a || !b) return null;
  const diff = (new Date(b).getTime() - new Date(a).getTime()) / 60000;
  return Number.isFinite(diff) && diff >= 0 ? diff : null;
}

async function buildAttendanceSheets(start: string, end: string, lateOnly: boolean): Promise<ExportSheet[]> {
  const rows: CanonicalAttendanceDay[] = await CanonicalAttendanceService.list(start, end);
  const thresholdOf = (r: any) => String(r.late_checkin_time || DEFAULT_LATE_CHECKIN_TIME).slice(0, 5);

  if (lateOnly) {
    const late = rows
      .filter((r) => r.is_late && r.official_first_in)
      .sort((a, b) => a.work_date.localeCompare(b.work_date) || a.employee_name.localeCompare(b.employee_name));
    return [{
      name: "Late arrivals",
      columns: ["Date", "Employee No", "Employee", "Office", "Team", "Expected by", "First in", "Minutes late", "Check-in source", "Last out"],
      widths: [12, 12, 26, 22, 18, 11, 10, 12, 16, 10],
      rows: late.map((r) => [
        r.work_date, r.employee_number ?? "", r.employee_name, r.office_name ?? "", r.team_name ?? "",
        thresholdOf(r), formatIstTime(r.official_first_in),
        minutesAfterIst(r.official_first_in, thresholdOf(r)),
        sourceLabel(r.first_in_source), formatIstTime(r.official_last_out),
      ]),
    }];
  }

  const year = Number(start.slice(0, 4));
  const month = Number(start.slice(5, 7));
  const daysInMonth = new Date(year, month, 0).getDate();
  const today = getBusinessDateIST();
  const lastDay = end >= today && today.slice(0, 7) === start.slice(0, 7) ? Number(today.slice(8, 10)) : daysInMonth;

  type Emp = { no: string; name: string; office: string; team: string; days: Record<number, string>; t: Record<string, number>; minutes: number };
  const byEmp = new Map<string, Emp>();
  for (const r of rows) {
    if (!byEmp.has(r.user_id)) {
      byEmp.set(r.user_id, {
        no: r.employee_number ?? "", name: r.employee_name, office: r.office_name ?? "", team: r.team_name ?? "",
        days: {}, t: { P: 0, LATE: 0, A: 0, L: 0, HD: 0, WFH: 0, WO: 0, H: 0 }, minutes: 0,
      });
    }
    const emp = byEmp.get(r.user_id)!;
    const base = registerCode(r.attendance_status);
    const code = base === "P" && r.is_late ? "P(L)" : base;
    emp.days[Number(r.work_date.slice(8, 10))] = code;
    if (r.working_minutes) emp.minutes += Number(r.working_minutes) || 0;
  }
  for (const emp of byEmp.values()) {
    for (let d = 1; d <= lastDay; d++) if (!emp.days[d]) emp.days[d] = "A";
    for (const code of Object.values(emp.days)) {
      if (code === "P") emp.t.P++;
      else if (code === "P(L)") { emp.t.P++; emp.t.LATE++; }
      else if (code in emp.t) emp.t[code]++;
    }
  }
  const emps = [...byEmp.values()].sort((a, b) => a.name.localeCompare(b.name));
  const dayCols = Array.from({ length: daysInMonth }, (_, i) => String(i + 1));

  const register: ExportSheet = {
    name: "Register",
    columns: ["Employee No", "Employee", "Office", "Team", ...dayCols,
      "Present", "Late", "Absent", "Leave", "Half day", "WFH", "Weekly off", "Holiday", "Total hours"],
    widths: [12, 26, 20, 16, ...dayCols.map(() => 5), 8, 6, 7, 6, 8, 6, 10, 8, 11],
    rows: emps.map((e) => [
      e.no, e.name, e.office, e.team,
      ...dayCols.map((d) => e.days[Number(d)] ?? ""),
      e.t.P, e.t.LATE, e.t.A, e.t.L, e.t.HD, e.t.WFH, e.t.WO, e.t.H,
      Math.round((e.minutes / 60) * 10) / 10,
    ]),
  };

  const detail: ExportSheet = {
    name: "Daily detail",
    columns: ["Date", "Employee No", "Employee", "Office", "Status", "First in", "Check-in source",
      "Last out", "Check-out source", "Working time", "Late", "Minutes late", "Field visit"],
    widths: [12, 12, 26, 20, 12, 10, 16, 10, 16, 12, 6, 12, 10],
    rows: [...rows]
      .sort((a, b) => a.work_date.localeCompare(b.work_date) || a.employee_name.localeCompare(b.employee_name))
      .map((r) => [
        r.work_date, r.employee_number ?? "", r.employee_name, r.office_name ?? "",
        (r.attendance_status || "").replace(/_/g, " "),
        formatIstTime(r.official_first_in), sourceLabel(r.first_in_source),
        formatIstTime(r.official_last_out), sourceLabel(r.last_out_source),
        formatMinutes(r.working_minutes), r.is_late ? "Yes" : "No",
        r.is_late ? minutesAfterIst(r.official_first_in, thresholdOf(r)) : "",
        r.has_field_visit ? "Yes" : "",
      ]),
  };

  const legend: ExportSheet = {
    name: "Legend",
    columns: ["Code", "Meaning"],
    widths: [8, 40],
    rows: [["P", "Present"], ["P(L)", "Present, late check-in"], ["A", "Absent (no attendance)"],
      ["L", "On leave"], ["HD", "Half day"], ["WFH", "Work from home"], ["WO", "Weekly off"], ["H", "Holiday"]],
  };
  return [register, detail, legend];
}

async function buildLeaveSheet(start: string, end: string): Promise<ExportSheet[]> {
  const { data, error } = await fetchAllPages<any>((from, to) =>
    supabase.from("leave_requests")
      .select("id, leave_type, start_date, end_date, requested_days, is_half_day, half_day_period, status, reason, rejection_reason, review_notes, reviewed_at, applied_on, created_at, employee:profiles!user_id(name, employee_number)")
      .lte("start_date", end)
      .gte("end_date", start)
      .order("start_date")
      .order("id")
      .range(from, to));
  if (error) throw error;
  return [{
    name: "Leave usage",
    columns: ["Employee No", "Employee", "Leave type", "From", "To", "Days", "Half day", "Status", "Reason", "Applied on", "Reviewed at", "Review note"],
    widths: [12, 26, 14, 12, 12, 6, 10, 11, 36, 20, 20, 30],
    rows: (data ?? []).map((r: any) => [
      r.employee?.employee_number ?? "", r.employee?.name ?? "",
      String(r.leave_type ?? "").replace(/_/g, " "), r.start_date, r.end_date,
      r.requested_days ?? "", r.is_half_day ? (r.half_day_period || "Yes") : "",
      String(r.status ?? "").toUpperCase(), r.reason ?? "",
      formatIstDateTime(r.applied_on || r.created_at), formatIstDateTime(r.reviewed_at),
      r.review_notes || r.rejection_reason || "",
    ]),
  }];
}

async function buildCompOffSheet(start: string, end: string): Promise<ExportSheet[]> {
  const { data, error } = await fetchAllPages<any>((from, to) =>
    supabase.from("comp_off_earnings")
      .select("id, eligible_work_date, units, remaining_units, source_type, reason, status, approved_at, expires_at, created_at, employee:profiles!user_id(name, employee_number), approver:profiles!approved_by(name)")
      .gte("eligible_work_date", start)
      .lte("eligible_work_date", end)
      .order("eligible_work_date")
      .order("id")
      .range(from, to));
  if (error) throw error;
  const SOURCE: Record<string, string> = {
    HOLIDAY_ATTENDANCE: "Holiday work", WEEKLY_OFF_ATTENDANCE: "Weekly-off work",
    EVENT_ATTENDANCE: "Event", HR_MANUAL: "Added by HR",
  };
  return [{
    name: "Comp-off",
    columns: ["Employee No", "Employee", "Work date", "Source", "Reason", "Days earned", "Days remaining", "Status", "Approved by", "Approved at", "Expires"],
    widths: [12, 26, 12, 16, 36, 11, 13, 10, 22, 20, 12],
    rows: (data ?? []).map((r: any) => [
      r.employee?.employee_number ?? "", r.employee?.name ?? "", r.eligible_work_date,
      SOURCE[r.source_type] ?? r.source_type ?? "", r.reason ?? "",
      Number(r.units ?? 0), Number(r.remaining_units ?? 0), r.status ?? "",
      r.approver?.name ?? "", formatIstDateTime(r.approved_at),
      r.expires_at ? String(r.expires_at).slice(0, 10) : "",
    ]),
  }];
}

async function buildFieldVisitSheet(start: string, end: string): Promise<ExportSheet[]> {
  const { data, error } = await fetchAllPages<any>((from, to) =>
    supabase.from("field_visits")
      .select("*, employee:profiles!user_id(name, employee_number)")
      .gte("date", start)
      .lte("date", end)
      .order("date")
      .order("created_at")
      .order("id")
      .range(from, to));
  if (error) throw error;
  const TYPE: Record<string, string> = { site: "Site", meeting: "Meeting", office: "Office", others: "Other" };
  return [{
    name: "Field visits",
    columns: ["Date", "Employee No", "Employee", "Type", "Place", "Address", "Status", "Check-in", "Check-in GPS",
      "Check-out", "Check-out GPS", "Duration", "Check-out distance (m)", "Check-out accuracy (m)",
      "Location match", "Location evidence", "Auto closed", "Check-out note"],
    widths: [12, 12, 24, 9, 26, 32, 11, 20, 24, 20, 24, 10, 12, 12, 16, 14, 10, 36],
    rows: (data ?? []).map((r: any) => {
      const evidence = r.location_evidence && typeof r.location_evidence === "object" ? r.location_evidence.level : "";
      return [
        r.date, r.employee?.employee_number ?? "", r.employee?.name ?? "",
        TYPE[r.visit_type] ?? r.visit_type ?? "", r.location_name ?? "", r.location_address ?? "",
        String(r.status ?? "").replace(/_/g, " "),
        formatIstDateTime(r.checkin_time), coords(r.checkin_location),
        formatIstDateTime(r.checkout_time), coords(r.checkout_location),
        formatMinutes(minutesBetween(r.checkin_time, r.checkout_time)),
        r.checkout_distance_m != null ? Math.round(Number(r.checkout_distance_m)) : "",
        r.checkout_accuracy_m != null ? Math.round(Number(r.checkout_accuracy_m)) : "",
        String(r.location_match_status ?? "").replace(/_/g, " "), evidence ?? "",
        r.auto_closed ? "Yes" : "", r.checkout_notes ?? "",
      ] as SheetCell[];
    }),
  }];
}

async function buildGeofenceSheet(start: string, end: string): Promise<ExportSheet[]> {
  const { data, error } = await supabase.rpc("rpc_geofence_report", { p_start_date: start, p_end_date: end });
  if (error) throw error;
  const rows: any[] = Array.isArray(data) ? data : [];
  return [{
    name: "Geofence events",
    columns: ["Detected at", "Employee No", "Employee", "Event", "Office", "Distance (m)", "Latitude", "Longitude", "Status", "Reason given", "Review", "Reviewed by"],
    widths: [20, 12, 24, 16, 20, 11, 11, 11, 12, 36, 12, 22],
    rows: rows.map((r) => {
      const distance = r.distance_from_reference ?? r.calculated_distance_m;
      return [
        formatIstDateTime(r.detected_at), r.employee_id ?? "", r.employee_name ?? "",
        String(r.event_type ?? "").replace(/_/g, " "), r.office_name ?? "",
        distance != null ? Math.round(Number(distance)) : "",
        r.latitude ?? "", r.longitude ?? "", r.status ?? "",
        r.submitted_reason ?? "", r.review_status ?? "", r.reviewed_by_name ?? "",
      ];
    }),
  }];
}

function friendlyError(e: any): string {
  const msg = String(e?.message ?? e ?? "");
  if (/PERMISSION_REQUIRED|42501|permission denied/i.test(msg)) {
    return "You do not have permission to export this report. Ask HR to grant access.";
  }
  if (/Range too large/i.test(msg)) return msg;
  return msg || "An unexpected error occurred.";
}

export default function DownloadCentreScreen() {
  const { theme } = useTheme();
  const { canOpenScreen, loading: permissionsLoading } = usePermissions();
  const todayIST = getBusinessDateIST();
  const [year, setYear]  = useState(Number(todayIST.slice(0, 4)));
  const [month, setMonth] = useState(Number(todayIST.slice(5, 7)));
  const [downloading, setDownloading] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "info" | "error"; text: string } | null>(null);

  const handleExport = async (opt: typeof EXPORTS[0]) => {
    setDownloading(opt.id);
    setMessage(null);
    try {
      const startDate = `${year}-${pad(month)}-01`;
      const endDate = `${year}-${pad(month)}-${pad(new Date(year, month, 0).getDate())}`;
      let sheets: ExportSheet[];
      switch (opt.id) {
        case "attendance_register": sheets = await buildAttendanceSheets(startDate, endDate, false); break;
        case "late_arrivals": sheets = await buildAttendanceSheets(startDate, endDate, true); break;
        case "leave_usage": sheets = await buildLeaveSheet(startDate, endDate); break;
        case "comp_off": sheets = await buildCompOffSheet(startDate, endDate); break;
        case "field_visits": sheets = await buildFieldVisitSheet(startDate, endDate); break;
        case "geofence_events": sheets = await buildGeofenceSheet(startDate, endDate); break;
      }
      if (!sheets[0] || sheets[0].rows.length === 0) {
        setMessage({ kind: "info", text: `${opt.title}: no records for ${MONTH_NAMES[month - 1]} ${year}.` });
        return;
      }
      await exportSheets(`${opt.id}_${year}_${pad(month)}.xlsx`, sheets);
      setMessage({ kind: "ok", text: `${opt.title} downloaded (${sheets[0].rows.length} rows).` });
    } catch (e: any) {
      setMessage({ kind: "error", text: `${opt.title} failed: ${friendlyError(e)}` });
    } finally {
      setDownloading(null);
    }
  };

  const available = EXPORTS.filter((e) => canOpenScreen(e.route));
  const categories = [...new Set(available.map(e => e.category))];

  return (
    <ScrollView style={[styles.root, { backgroundColor: theme.backgroundRoot }]}>
      <ReportFilterBar>
        <ReportMonthStepper
          year={year}
          month={month}
          maxMonth={todayIST.slice(0, 7)}
          onChange={(y, m) => { setYear(y); setMonth(m); setMessage(null); }}
        />
        <ReportMeta>
          Tap a report to download it as an Excel file (.xlsx) for {MONTH_NAMES[month - 1]} {year}. Times are in IST.
        </ReportMeta>
        {message ? (
          <ReportNotice kind={message.kind} text={message.text} onDismiss={() => setMessage(null)} />
        ) : null}
      </ReportFilterBar>
      <View style={styles.body}>
        {available.length === 0 ? (
          permissionsLoading ? (
            <ReportState kind="loading" />
          ) : (
            <ReportState
              kind="empty"
              icon="lock"
              title="No downloads available"
              message="Your role does not include access to any exportable report."
            />
          )
        ) : null}
        {categories.map(cat => (
          <View key={cat} style={styles.section}>
            <ThemedText type="caption" style={[styles.catLabel, { color: theme.textSecondary }]}>{cat.toUpperCase()}</ThemedText>
            {available.filter(e => e.category === cat).map(opt => {
              const isLoading = downloading === opt.id;
              return (
                <Pressable
                  key={opt.id}
                  onPress={() => handleExport(opt)}
                  disabled={!!downloading}
                  style={({ pressed }) => [
                    styles.card,
                    { backgroundColor: theme.backgroundDefault, borderColor: theme.border, opacity: pressed || (!!downloading && !isLoading) ? 0.6 : 1 },
                  ]}
                >
                  <View style={[styles.iconBox, { backgroundColor: theme.primary + "18" }]}>
                    <Feather name={opt.icon} size={18} color={theme.primary} />
                  </View>
                  <View style={styles.cardText}>
                    <ThemedText style={styles.cardTitle}>{opt.title}</ThemedText>
                    <ThemedText type="caption" style={{ color: theme.textSecondary }}>{opt.description}</ThemedText>
                  </View>
                  {isLoading ? <ActivityIndicator size="small" color={theme.primary} /> : <Feather name="download" size={18} color={theme.primary} />}
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
      <View style={{ height: 80 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { padding: Spacing.md, gap: Spacing.xl },
  section: { gap: Spacing.sm },
  catLabel: { fontWeight: "700", letterSpacing: 0.6, marginLeft: 2 },
  card: { flexDirection: "row", alignItems: "center", gap: Spacing.md, padding: Spacing.md, borderRadius: BorderRadius.md, borderWidth: 1 },
  iconBox: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  cardText: { flex: 1 },
  cardTitle: { fontWeight: "700", marginBottom: 2 },
});
