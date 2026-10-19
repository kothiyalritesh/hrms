/**
 * LeaveUsageReportScreen
 * Read-only leave report — per-employee totals across applied / approved / rejected / pending.
 */
import React, { useCallback, useRef, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, Spacing } from "@/constants/theme";
import { supabase } from "@/lib/supabase";
import { businessMonthStart, formatBusinessDate, getBusinessDateIST } from "@/utils/businessDate";
import { fetchAllPages } from "@/utils/supabasePagination";
import { exportSheets, formatIstDateTime } from "@/utils/exportWorkbook";
import {
  ReportChip,
  ReportChipRow,
  ReportDateRange,
  ReportFilterBar,
  ReportIconButton,
  ReportMeta,
  ReportNotice,
  ReportSearch,
  ReportState,
  reportErrorMessage,
  type DateRange,
} from "@/components/reports/ReportUI";

const LEAVE_TYPE_COLORS: Record<string, string> = {
  casual: "#6366F1", sick: "#EF4444", earned: "#10B981",
  wfh: "#F59E0B", comp_off: "#8B5CF6",
};

interface EmployeeLeave {
  id: string;
  name: string;
  employee_number: string | null;
  office: string | null;
  total: number;
  approved: number;
  pending: number;
  rejected: number;
  by_type: Record<string, number>;
}

interface LeaveRow {
  id: string;
  user_id: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  status: string;
  requested_days: number;
  reason: string;
  applied_on?: string;
  created_at: string;
  employee?: { name?: string; employee_number?: string; office_id?: string; office?: { name?: string } };
}

const TYPES = ["all", "casual", "sick", "earned", "wfh", "comp_off"];
const STATUSES = ["all", "pending", "approved", "rejected"];

const typeLabel = (t: string) =>
  t === "all" ? "All types" : t === "wfh" ? "WFH" : t === "comp_off" ? "Comp-off" : t[0].toUpperCase() + t.slice(1);
const statusLabel = (s: string) => (s === "all" ? "Any status" : s[0].toUpperCase() + s.slice(1));

export default function LeaveUsageReportScreen() {
  const { theme } = useTheme();
  const todayIST = getBusinessDateIST();
  // Queries run for the applied range only, not on every keystroke.
  const [range, setRange] = useState<DateRange>(() => ({ from: businessMonthStart(todayIST), to: todayIST }));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [view, setView] = useState<"summary" | "detail">("summary");
  const [employees, setEmployees] = useState<EmployeeLeave[]>([]);
  const [allRows, setAllRows] = useState<LeaveRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const requestId = useRef(0);

  const statusColors: Record<string, { bg: string; text: string }> = {
    pending: { bg: theme.warningBg, text: theme.warningText },
    approved: { bg: theme.successBg, text: theme.successText },
    rejected: { bg: theme.errorBg, text: theme.errorText },
    cancelled: { bg: theme.backgroundSecondary, text: theme.textSecondary },
  };

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    try {
      setLoadError(null);
      // Every leave that overlaps the range (one starting before it counts too).
      const { data, error } = await fetchAllPages<any>((from, to) => supabase
        .from("leave_requests")
        .select("id,user_id,leave_type,start_date,end_date,status,requested_days,reason,applied_on,created_at,employee:profiles!user_id(name,employee_number,office:offices!office_id(name))")
        .lte("start_date", range.to)
        .gte("end_date", range.from)
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to));
      if (error) throw error;
      if (id !== requestId.current) return;
      const rows = ((data ?? []) as LeaveRow[]).map((r) => ({
        ...r,
        status: String(r.status || "").toLowerCase(),
        leave_type: String(r.leave_type || "").toLowerCase(),
        requested_days: Number(r.requested_days) || 0,
      }));
      setAllRows(rows);

      // Aggregate by employee
      const map = new Map<string, EmployeeLeave>();
      for (const r of rows) {
        if (!map.has(r.user_id)) {
          map.set(r.user_id, {
            id: r.user_id,
            name: r.employee?.name || "Unknown",
            employee_number: r.employee?.employee_number || null,
            office: (r.employee?.office as any)?.name || null,
            total: 0, approved: 0, pending: 0, rejected: 0, by_type: {},
          });
        }
        const emp = map.get(r.user_id)!;
        if (r.status === "cancelled") continue;
        emp.total += r.requested_days;
        if (r.status === "approved") emp.approved += r.requested_days;
        else if (r.status === "pending") emp.pending += r.requested_days;
        else if (r.status === "rejected") emp.rejected += r.requested_days;
        emp.by_type[r.leave_type] = (emp.by_type[r.leave_type] || 0) + r.requested_days;
      }
      setEmployees(Array.from(map.values()).sort((a, b) => b.total - a.total));
    } catch (e: any) {
      if (id !== requestId.current) return;
      setAllRows([]);
      setEmployees([]);
      setLoadError(reportErrorMessage(e, "Could not load leave records."));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [range]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const q = search.trim().toLowerCase();
  const filteredRows = allRows.filter((r) => {
    if (typeFilter !== "all" && r.leave_type !== typeFilter) return false;
    if (statusFilter !== "all" && r.status !== statusFilter) return false;
    if (q && !((r.employee?.name || "").toLowerCase().includes(q))) return false;
    return true;
  });

  const filteredEmps = employees.filter((e) => !q || e.name.toLowerCase().includes(q));

  const exportExcel = async () => {
    if (exporting) return;
    setExporting(true);
    setNotice(null);
    try {
      await exportSheets(`leave_usage_${range.from}_to_${range.to}.xlsx`, [
        {
          name: "Summary",
          columns: ["Employee No", "Employee", "Office", "Total days", "Approved", "Pending", "Rejected", ...TYPES.filter((t) => t !== "all")],
          widths: [12, 26, 20, 10, 9, 8, 9, 8, 8, 8, 8, 9],
          rows: filteredEmps.map((e) => [
            e.employee_number ?? "", e.name, e.office ?? "", e.total, e.approved, e.pending, e.rejected,
            ...TYPES.filter((t) => t !== "all").map((t) => e.by_type[t] ?? 0),
          ]),
        },
        {
          name: "Requests",
          columns: ["Employee No", "Employee", "Leave type", "From", "To", "Days", "Status", "Reason", "Applied on"],
          widths: [12, 26, 12, 12, 12, 6, 10, 40, 20],
          rows: filteredRows.map((r) => [
            r.employee?.employee_number ?? "", r.employee?.name ?? "", r.leave_type.replace(/_/g, " "),
            r.start_date, r.end_date, r.requested_days, r.status, r.reason ?? "",
            formatIstDateTime(r.applied_on || r.created_at),
          ]),
        },
      ]);
    } catch (e: any) {
      setNotice(`Export failed: ${e?.message || "please try again."}`);
    } finally {
      setExporting(false);
    }
  };

  const shortDate = (d: string) => formatBusinessDate(d).replace(/ \d{4}$/, "");

  return (
    <View style={[styles.root, { backgroundColor: theme.backgroundRoot }]}>
      <ReportFilterBar>
        <ReportDateRange
          applied={range}
          onApply={setRange}
          trailing={
            <ReportIconButton
              icon="download"
              label="Excel"
              tone="neutral"
              onPress={exportExcel}
              busy={exporting}
              disabled={loading || allRows.length === 0}
            />
          }
        />
        <ReportSearch value={search} onChangeText={setSearch} />
        <ReportChipRow>
          <ReportChip label="Per employee" active={view === "summary"} onPress={() => setView("summary")} />
          <ReportChip label="All requests" active={view === "detail"} onPress={() => setView("detail")} />
        </ReportChipRow>
        {view === "detail" && (
          <>
            <ReportChipRow>
              {TYPES.map((t) => <ReportChip key={t} label={typeLabel(t)} active={typeFilter === t} onPress={() => setTypeFilter(t)} />)}
            </ReportChipRow>
            <ReportChipRow>
              {STATUSES.map((s) => <ReportChip key={s} label={statusLabel(s)} active={statusFilter === s} onPress={() => setStatusFilter(s)} />)}
            </ReportChipRow>
          </>
        )}
        {!loading && !loadError ? (
          <ReportMeta>
            {formatBusinessDate(range.from)} – {formatBusinessDate(range.to)} ·{" "}
            {view === "summary"
              ? `${filteredEmps.length} employee${filteredEmps.length === 1 ? "" : "s"}`
              : `${filteredRows.length} request${filteredRows.length === 1 ? "" : "s"}`}
          </ReportMeta>
        ) : null}
        {notice ? <ReportNotice kind="error" text={notice} onDismiss={() => setNotice(null)} /> : null}
      </ReportFilterBar>

      {loading && !refreshing ? (
        <ReportState kind="loading" title="Loading leave records…" />
      ) : (
        <ScrollView
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}
              tintColor={theme.primary}
            />
          }
          contentContainerStyle={styles.body}
        >
          {loadError ? (
            <ReportState kind="error" title="Could not load leave records" message={loadError} onRetry={() => void load()} />
          ) : view === "summary" ? (
            filteredEmps.length === 0 ? (
              <ReportState
                kind="empty"
                icon="briefcase"
                title={q ? "No matching employees" : "No leave in this period"}
                message={q ? "Try a different name." : "No leave requests overlap the selected dates."}
              />
            ) : filteredEmps.map((emp) => (
              <View key={emp.id} style={[styles.card, { backgroundColor: theme.backgroundDefault, borderColor: theme.border }]}>
                <View style={styles.cardRow}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <ThemedText style={{ fontWeight: "700" }} numberOfLines={1}>{emp.name}</ThemedText>
                    <ThemedText type="caption" style={{ color: theme.textSecondary }} numberOfLines={1}>
                      {emp.office || "No office"}{emp.employee_number ? ` · #${emp.employee_number}` : ""}
                    </ThemedText>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <ThemedText style={{ fontWeight: "800", fontSize: 18, color: theme.primary }}>{emp.total}</ThemedText>
                    <ThemedText type="caption" style={{ color: theme.textSecondary }}>days</ThemedText>
                  </View>
                </View>
                <View style={styles.statRow}>
                  <View style={[styles.statBadge, { backgroundColor: statusColors.approved.bg }]}>
                    <ThemedText type="caption" style={{ color: statusColors.approved.text, fontWeight: "700" }}>{emp.approved} approved</ThemedText>
                  </View>
                  <View style={[styles.statBadge, { backgroundColor: statusColors.pending.bg }]}>
                    <ThemedText type="caption" style={{ color: statusColors.pending.text, fontWeight: "700" }}>{emp.pending} pending</ThemedText>
                  </View>
                  <View style={[styles.statBadge, { backgroundColor: statusColors.rejected.bg }]}>
                    <ThemedText type="caption" style={{ color: statusColors.rejected.text, fontWeight: "700" }}>{emp.rejected} rejected</ThemedText>
                  </View>
                </View>
                {Object.keys(emp.by_type).length > 0 ? (
                  <View style={styles.statRow}>
                    {Object.entries(emp.by_type).map(([t, d]) => (
                      <View key={t} style={[styles.typeChip, { backgroundColor: (LEAVE_TYPE_COLORS[t] || "#999999") + "20" }]}>
                        <ThemedText type="caption" style={{ color: LEAVE_TYPE_COLORS[t] || theme.textSecondary, fontWeight: "700" }}>
                          {typeLabel(t)}: {d}d
                        </ThemedText>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            ))
          ) : (
            filteredRows.length === 0 ? (
              <ReportState kind="empty" icon="filter" title="No matching requests" message="Change the type, status or search filters." />
            ) : filteredRows.map((r) => {
              const sc = statusColors[r.status] || statusColors.pending;
              const tc = LEAVE_TYPE_COLORS[r.leave_type] || "#999999";
              return (
                <View key={r.id} style={[styles.card, { backgroundColor: theme.backgroundDefault, borderColor: theme.border }]}>
                  <View style={styles.cardRow}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <ThemedText style={{ fontWeight: "700" }} numberOfLines={1}>{r.employee?.name || "—"}</ThemedText>
                      <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                        {shortDate(r.start_date)} – {shortDate(r.end_date)} · {r.requested_days}d
                      </ThemedText>
                    </View>
                    <View style={[styles.statBadge, { backgroundColor: sc.bg }]}>
                      <ThemedText type="caption" style={{ color: sc.text, fontWeight: "700", textTransform: "capitalize" }}>{r.status}</ThemedText>
                    </View>
                  </View>
                  <View style={[styles.cardRow, { marginTop: 6 }]}>
                    <View style={[styles.typeChip, { backgroundColor: tc + "20" }]}>
                      <ThemedText type="caption" style={{ color: tc, fontWeight: "700" }}>{typeLabel(r.leave_type)}</ThemedText>
                    </View>
                    <ThemedText type="caption" style={{ color: theme.textSecondary, flex: 1 }} numberOfLines={1}>{r.reason}</ThemedText>
                  </View>
                </View>
              );
            })
          )}
          <View style={{ height: 60 }} />
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { padding: Spacing.md, gap: Spacing.sm },
  card: { borderRadius: BorderRadius.md, padding: Spacing.md, borderWidth: 1 },
  cardRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  statRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  statBadge: { paddingHorizontal: Spacing.sm, paddingVertical: 3, borderRadius: BorderRadius.full },
  typeChip: { paddingHorizontal: Spacing.sm, paddingVertical: 3, borderRadius: BorderRadius.sm },
});
