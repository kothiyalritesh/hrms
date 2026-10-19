/**
 * AttendanceRegisterReportScreen
 * Read-only monthly attendance register — P / A / L / WFH / WO per employee.
 */
import React, { useCallback, useRef, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing } from "@/constants/theme";
import { CanonicalAttendanceService } from "@/services/canonical-attendance.service";
import { ModuleErrorBoundary } from "@/components/ModuleErrorBoundary";
import { getBusinessDateIST } from "@/utils/businessDate";
import {
  ReportFilterBar,
  ReportMeta,
  ReportMonthStepper,
  ReportSearch,
  ReportState,
  reportErrorMessage,
} from "@/components/reports/ReportUI";

const STATUS_COLORS: Record<string, string> = {
  PRESENT: "#10B981",
  CHECKED_OUT: "#10B981",
  CHECKED_IN: "#10B981",
  FIELD_VISIT: "#06B6D4",
  LATE: "#F59E0B",
  ABSENT: "#EF4444",
  LEAVE: "#F59E0B",
  ON_LEAVE: "#F59E0B",
  WFH: "#6366F1",
  WEEKLY_OFF: "#6B7280",
  HOLIDAY: "#8B5CF6",
  HALF_DAY: "#F97316",
};
const STATUS_SHORT: Record<string, string> = {
  PRESENT: "P",
  CHECKED_OUT: "P",
  CHECKED_IN: "P",
  FIELD_VISIT: "FV",
  LATE: "La",
  ABSENT: "A",
  LEAVE: "L",
  ON_LEAVE: "L",
  WFH: "WFH",
  WEEKLY_OFF: "WO",
  HOLIDAY: "H",
  HALF_DAY: "HD",
};
// One legend entry per code (the maps above have aliases).
const LEGEND: Array<{ code: string; label: string; color: string }> = [
  { code: "P", label: "Present", color: STATUS_COLORS.PRESENT },
  { code: "La", label: "Late", color: STATUS_COLORS.LATE },
  { code: "A", label: "Absent", color: STATUS_COLORS.ABSENT },
  { code: "L", label: "Leave", color: STATUS_COLORS.LEAVE },
  { code: "HD", label: "Half day", color: STATUS_COLORS.HALF_DAY },
  { code: "FV", label: "Field visit", color: STATUS_COLORS.FIELD_VISIT },
  { code: "WFH", label: "Work from home", color: STATUS_COLORS.WFH },
  { code: "WO", label: "Weekly off", color: STATUS_COLORS.WEEKLY_OFF },
  { code: "H", label: "Holiday", color: STATUS_COLORS.HOLIDAY },
];

function monthRange(year: number, month: number): [string, string] {
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const end = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return [start, end];
}

interface EmployeeSummary {
  id: string;
  name: string;
  employee_number: string | null;
  office: string | null;
  days: Record<string, string>; // day number -> status
  sources: Record<string, string | null>; // day number -> source
  present: number; absent: number; late: number; leave: number; wfh: number; wo: number;
}

function AttendanceRegisterReportScreenInner() {
  const { theme } = useTheme();
  const todayIST = getBusinessDateIST();
  const [year, setYear] = useState(Number(todayIST.slice(0, 4)));
  const [month, setMonth] = useState(Number(todayIST.slice(5, 7)));
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<EmployeeSummary[]>([]);
  const [daysInMonth, setDaysInMonth] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const [start, endRaw] = monthRange(year, month);
      const today = getBusinessDateIST();
      const end = endRaw > today ? today : endRaw;
      const data = await CanonicalAttendanceService.list(start, end);
      if (id !== requestId.current) return; // a newer month was requested
      const dim = Number(endRaw.slice(8, 10));
      setDaysInMonth(Array.from({ length: dim }, (_, i) => i + 1));

      // Group by employee
      const map = new Map<string, EmployeeSummary>();
      for (const row of data) {
        if (!map.has(row.user_id)) {
          map.set(row.user_id, {
            id: row.user_id,
            name: row.employee_name,
            employee_number: row.employee_number,
            office: row.office_name,
            days: {}, sources: {},
            present: 0, absent: 0, late: 0, leave: 0, wfh: 0, wo: 0,
          });
        }
        const emp = map.get(row.user_id)!;
        const dayNum = parseInt(row.work_date.slice(8), 10);
        const status = row.attendance_status?.toUpperCase() || "ABSENT";
        emp.days[dayNum] = status;
        emp.sources[dayNum] = row.first_in_source;
        if (["PRESENT", "CHECKED_OUT", "CHECKED_IN", "LATE", "FIELD_VISIT"].includes(status)) emp.present++;
        if (status === "LATE") emp.late++;
        else if (status === "ABSENT") emp.absent++;
        else if (status === "LEAVE" || status === "ON_LEAVE") emp.leave++;
        else if (status === "WFH") emp.wfh++;
        else if (status === "WEEKLY_OFF" || status === "HOLIDAY") emp.wo++;
      }

      const todayDay = end === today ? parseInt(today.slice(8), 10) : dim;
      for (const emp of map.values()) {
        for (let d = 1; d <= todayDay; d++) {
          if (!emp.days[d]) {
            emp.days[d] = "ABSENT";
            emp.absent++;
          }
        }
      }

      setRows(Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name)));
    } catch (e: any) {
      if (id !== requestId.current) return;
      setRows([]);
      setError(reportErrorMessage(e));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [year, month]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const q = search.trim().toLowerCase();
  const filtered = q
    ? rows.filter((r) => r.name.toLowerCase().includes(q) || (r.employee_number || "").toLowerCase().includes(q))
    : rows;

  return (
    <View style={[styles.root, { backgroundColor: theme.backgroundRoot }]}>
      <ReportFilterBar>
        <ReportMonthStepper
          year={year}
          month={month}
          maxMonth={todayIST.slice(0, 7)}
          onChange={(y, m) => { setYear(y); setMonth(m); }}
        />
        <ReportSearch value={search} onChangeText={setSearch} placeholder="Search name or employee no." />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.legend}>
          {LEGEND.map((l) => (
            <View key={l.code} style={styles.legendItem}>
              <View style={[styles.legendSwatch, { backgroundColor: l.color + "26" }]}>
                <ThemedText style={[styles.legendCode, { color: l.color }]}>{l.code}</ThemedText>
              </View>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>{l.label}</ThemedText>
            </View>
          ))}
          <View style={[styles.legendItem, styles.legendDivider, { borderLeftColor: theme.border }]}>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              Pa app · Pb biometric · Pab both · Pv field visit
            </ThemedText>
          </View>
        </ScrollView>
        {!loading && !error ? (
          <ReportMeta>
            {filtered.length} employee{filtered.length === 1 ? "" : "s"}
            {q ? ` matching "${search.trim()}"` : ""}
          </ReportMeta>
        ) : null}
      </ReportFilterBar>

      {loading && !refreshing ? (
        <ReportState kind="loading" title="Loading register…" />
      ) : (
        <ScrollView
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}
              tintColor={theme.primary}
            />
          }
        >
          {error ? (
            <ReportState kind="error" message={error} onRetry={() => void load()} />
          ) : filtered.length === 0 ? (
            <ReportState
              kind="empty"
              icon="calendar"
              title={q ? "No matching employees" : "No attendance for this month"}
              message={q ? "Try a different name or employee number." : "Pick another month with the arrows above."}
            />
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ padding: Spacing.md }}>
              <View style={[styles.table, { borderColor: theme.border }]}>
                {/* Table Header */}
                <View style={[styles.tableRow, { backgroundColor: theme.primary }]}>
                  <View style={styles.nameCell}><ThemedText style={styles.headerText}>Employee</ThemedText></View>
                  {daysInMonth.map((d) => (
                    <View key={d} style={styles.dayCell}>
                      <ThemedText style={styles.headerText}>{d}</ThemedText>
                    </View>
                  ))}
                  {["P", "La", "A", "L", "WFH", "WO"].map((h) => (
                    <View key={h} style={styles.summCell}><ThemedText style={styles.headerText}>{h}</ThemedText></View>
                  ))}
                </View>

                {filtered.map((emp, idx) => (
                  <View
                    key={emp.id}
                    style={[
                      styles.tableRow,
                      {
                        backgroundColor: idx % 2 === 0 ? theme.backgroundDefault : theme.backgroundSecondary,
                        borderBottomColor: theme.border,
                      },
                    ]}
                  >
                    <View style={styles.nameCell}>
                      <ThemedText style={styles.nameText} numberOfLines={1}>{emp.name}</ThemedText>
                      {emp.employee_number ? (
                        <ThemedText style={{ fontSize: 10, color: theme.textSecondary }}>#{emp.employee_number}</ThemedText>
                      ) : null}
                    </View>
                    {daysInMonth.map((d) => {
                      const status = emp.days[d];
                      const color = status ? STATUS_COLORS[status] : undefined;
                      let label = (status && STATUS_SHORT[status]) || "—";
                      if (label === "P") {
                        const source = emp.sources?.[d];
                        if (source === "BIOMETRIC") label = "Pb";
                        else if (source === "APP") label = "Pa";
                        else if (source === "FIELD_VISIT") label = "Pv";
                        else if (source === "COMBINED") label = "Pab";
                      }
                      return (
                        <View key={d} style={[styles.dayCell, color ? { backgroundColor: color + "22" } : null]}>
                          <ThemedText style={[styles.dayText, { color: color ?? theme.textTertiary }]}>{label}</ThemedText>
                        </View>
                      );
                    })}
                    <View style={styles.summCell}><ThemedText style={[styles.summText, { color: theme.success }]}>{emp.present}</ThemedText></View>
                    <View style={styles.summCell}><ThemedText style={[styles.summText, { color: "#F97316" }]}>{emp.late}</ThemedText></View>
                    <View style={styles.summCell}><ThemedText style={[styles.summText, { color: theme.error }]}>{emp.absent}</ThemedText></View>
                    <View style={styles.summCell}><ThemedText style={[styles.summText, { color: theme.warning }]}>{emp.leave}</ThemedText></View>
                    <View style={styles.summCell}><ThemedText style={[styles.summText, { color: "#6366F1" }]}>{emp.wfh}</ThemedText></View>
                    <View style={styles.summCell}><ThemedText style={[styles.summText, { color: theme.textSecondary }]}>{emp.wo}</ThemedText></View>
                  </View>
                ))}
              </View>
            </ScrollView>
          )}
          <View style={{ height: 60 }} />
        </ScrollView>
      )}
    </View>
  );
}

export default function AttendanceRegisterReportScreen() {
  return (
    <ModuleErrorBoundary moduleName="Attendance Register">
      <AttendanceRegisterReportScreenInner />
    </ModuleErrorBoundary>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  legend: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 2 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendSwatch: { minWidth: 22, height: 18, borderRadius: 4, alignItems: "center", justifyContent: "center", paddingHorizontal: 3 },
  legendCode: { fontSize: 10, fontWeight: "800" },
  legendDivider: { borderLeftWidth: 1, paddingLeft: 12 },
  table: { borderWidth: 1, borderRadius: 8, overflow: "hidden" },
  tableRow: { flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth },
  nameCell: { width: 140, paddingHorizontal: 8, paddingVertical: 6, justifyContent: "center" },
  nameText: { fontWeight: "700", fontSize: 12 },
  dayCell: { width: 32, height: 38, alignItems: "center", justifyContent: "center" },
  dayText: { fontSize: 10, fontWeight: "700" },
  summCell: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  headerText: { color: "#fff", fontWeight: "700", fontSize: 11 },
  summText: { fontWeight: "800", fontSize: 12 },
});
