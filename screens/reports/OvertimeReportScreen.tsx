/**
 * OvertimeReportScreen
 * Read-only comp-off earnings report — who worked on weekends/holidays, earned units, expiry.
 */
import React, { useCallback, useRef, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useFocusEffect } from "@react-navigation/native";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, Spacing } from "@/constants/theme";
import { supabase } from "@/lib/supabase";
import { businessMonthRange, businessMonthStart, formatBusinessDate, getBusinessDateIST } from "@/utils/businessDate";
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
  rangePresets,
  reportErrorMessage,
  type DateRange,
} from "@/components/reports/ReportUI";

type CompOffStatus = "PENDING" | "APPROVED" | "USED" | "EXPIRED" | "REJECTED";

const STATUS_LABEL: Record<CompOffStatus, string> = {
  PENDING: "Pending approval",
  APPROVED: "Approved",
  USED: "Used",
  EXPIRED: "Expired",
  REJECTED: "Rejected",
};

interface CompOffRow {
  id: string;
  user_id: string;
  employee_name: string;
  employee_number: string | null;
  eligible_work_date: string;
  units_earned: number;
  remaining_units: number;
  status: string;
  work_description: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  source_type: string | null;
  expires_at: string | null;
  created_at: string;
}

const ALL_STATUSES: CompOffStatus[] = ["PENDING", "APPROVED", "USED", "EXPIRED", "REJECTED"];

function formatDate(d: string | null) {
  if (!d) return "—";
  return formatBusinessDate(d.slice(0, 10));
}

function daysUntilExpiry(expiresAt: string | null): number | null {
  if (!expiresAt) return null;
  const diff = new Date(expiresAt).getTime() - Date.now();
  return Math.ceil(diff / 86400000);
}

export default function OvertimeReportScreen() {
  const { theme } = useTheme();
  const todayIST = getBusinessDateIST();
  const defaultRange: DateRange = { from: businessMonthStart(todayIST, -2), to: businessMonthRange(todayIST).end };
  // The query runs for the applied range only, not on every keystroke.
  const [range, setRange] = useState<DateRange>(defaultRange);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | CompOffStatus>("ALL");
  const [rows, setRows] = useState<CompOffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const requestId = useRef(0);

  const statusMeta = (status: string) => {
    switch (status) {
      case "APPROVED": return { color: theme.successText, bg: theme.successBg, accent: theme.success };
      case "USED": return { color: theme.infoText, bg: theme.infoBg, accent: theme.info };
      case "EXPIRED": return { color: theme.textSecondary, bg: theme.backgroundSecondary, accent: theme.textSecondary };
      case "REJECTED": return { color: theme.errorText, bg: theme.errorBg, accent: theme.error };
      default: return { color: theme.warningText, bg: theme.warningBg, accent: theme.warning };
    }
  };

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    try {
      setLoadError(null);
      const { data, error } = await fetchAllPages<any>((from, to) => supabase
        .from("comp_off_earnings")
        .select(`
          id, user_id, eligible_work_date, units, remaining_units,
          status, reason, source_type, approved_at, expires_at, created_at,
          employee:profiles!user_id ( name, employee_number ),
          approver:profiles!approved_by ( name )
        `)
        .gte("eligible_work_date", range.from)
        .lte("eligible_work_date", range.to)
        .order("eligible_work_date", { ascending: false })
        .order("id")
        .range(from, to));

      if (error) throw error;
      if (id !== requestId.current) return;

      setRows(
        (data || []).map((r: any) => ({
          id: r.id,
          user_id: r.user_id,
          employee_name: r.employee?.name || "Unknown",
          employee_number: r.employee?.employee_number || null,
          eligible_work_date: r.eligible_work_date,
          units_earned: Number(r.units) || 0,
          remaining_units: Number(r.remaining_units) || 0,
          status: r.status || "PENDING",
          work_description: r.reason || null,
          approved_by_name: r.approver?.name || null,
          approved_at: r.approved_at || null,
          source_type: r.source_type || null,
          expires_at: r.expires_at || null,
          created_at: r.created_at,
        }))
      );
    } catch (e: any) {
      if (id !== requestId.current) return;
      setRows([]);
      setLoadError(reportErrorMessage(e, "Could not load comp-off records."));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [range]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const q = search.trim().toLowerCase();
  const filtered = rows.filter((r) => {
    if (statusFilter !== "ALL" && r.status !== statusFilter) return false;
    if (q && !r.employee_name.toLowerCase().includes(q)) return false;
    return true;
  });

  const exportExcel = async () => {
    if (exporting) return;
    setExporting(true);
    setNotice(null);
    try {
      await exportSheets(`comp_off_${range.from}_to_${range.to}.xlsx`, [{
        name: "Comp-off",
        columns: ["Employee No", "Employee", "Work date", "Source", "Reason", "Days earned", "Days remaining", "Status", "Approved by", "Approved at", "Expires"],
        widths: [12, 26, 12, 22, 36, 11, 13, 10, 22, 20, 12],
        rows: filtered.map((r) => [
          r.employee_number ?? "", r.employee_name, r.eligible_work_date,
          (r.source_type ?? "").replace(/_/g, " "), r.work_description ?? "",
          r.units_earned, r.remaining_units, r.status, r.approved_by_name ?? "",
          formatIstDateTime(r.approved_at), r.expires_at ? r.expires_at.slice(0, 10) : "",
        ]),
      }]);
    } catch (e: any) {
      setNotice(`Export failed: ${e?.message || "please try again."}`);
    } finally {
      setExporting(false);
    }
  };

  // Aggregates
  const totalEarned = rows
    .filter((r) => r.status !== "REJECTED")
    .reduce((s, r) => s + r.units_earned, 0);
  const pendingCount = rows.filter((r) => r.status === "PENDING").length;
  const expiringCount = rows.filter((r) => {
    const days = daysUntilExpiry(r.expires_at);
    return r.status === "APPROVED" && days !== null && days <= 7 && days > 0;
  }).length;

  const presets = [
    { key: "last_3_months", label: "Last 3 months", range: defaultRange },
    ...rangePresets(todayIST).filter((p) => p.key !== "last_30"),
  ];

  const stats = [
    { label: "Days earned", value: totalEarned.toFixed(1), color: theme.primary, bg: theme.primary + "14" },
    { label: "Pending", value: String(pendingCount), color: theme.warningText, bg: theme.warningBg },
    { label: "Expiring in 7 days", value: String(expiringCount), color: theme.errorText, bg: theme.errorBg },
  ];

  return (
    <View style={[styles.root, { backgroundColor: theme.backgroundRoot }]}>
      <ReportFilterBar>
        <ReportDateRange
          applied={range}
          onApply={setRange}
          presets={presets}
          trailing={
            <ReportIconButton
              icon="download"
              label="Excel"
              tone="neutral"
              onPress={exportExcel}
              busy={exporting}
              disabled={loading || filtered.length === 0}
            />
          }
        />
        <ReportSearch value={search} onChangeText={setSearch} />
        <ReportChipRow>
          <ReportChip label="All" active={statusFilter === "ALL"} onPress={() => setStatusFilter("ALL")} />
          {ALL_STATUSES.map((s) => (
            <ReportChip key={s} label={STATUS_LABEL[s]} active={statusFilter === s} onPress={() => setStatusFilter(s)} />
          ))}
        </ReportChipRow>
        {notice ? <ReportNotice kind="error" text={notice} onDismiss={() => setNotice(null)} /> : null}
      </ReportFilterBar>

      {loading && !refreshing ? (
        <ReportState kind="loading" title="Loading comp-off records…" />
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
            <ReportState kind="error" title="Could not load comp-off records" message={loadError} onRetry={() => void load()} />
          ) : (
            <>
              <View style={styles.statRow}>
                {stats.map((s) => (
                  <View key={s.label} style={[styles.sumCard, { backgroundColor: s.bg }]}>
                    <ThemedText style={[styles.sumValue, { color: s.color }]}>{s.value}</ThemedText>
                    <ThemedText type="caption" style={{ color: s.color, textAlign: "center" }}>{s.label}</ThemedText>
                  </View>
                ))}
              </View>
              <ReportMeta>
                {formatBusinessDate(range.from)} – {formatBusinessDate(range.to)} · {filtered.length} record{filtered.length === 1 ? "" : "s"}
              </ReportMeta>

              {filtered.length === 0 ? (
                <ReportState
                  kind="empty"
                  icon="award"
                  title={q || statusFilter !== "ALL" ? "No matching records" : "No comp-off in this period"}
                  message={q || statusFilter !== "ALL" ? "Change the status or search filters." : "Nobody earned comp-off for work in these dates."}
                />
              ) : filtered.map((r) => {
                const meta = statusMeta(r.status);
                const label = STATUS_LABEL[r.status as CompOffStatus] ?? r.status;
                const daysLeft = daysUntilExpiry(r.expires_at);
                const isExpiringSoon = daysLeft !== null && daysLeft <= 7 && daysLeft > 0 && r.status === "APPROVED";
                return (
                  <View key={r.id} style={[styles.card, { backgroundColor: theme.backgroundDefault, borderColor: theme.border, borderLeftColor: meta.accent }]}>
                    <View style={styles.cardRow}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <ThemedText style={{ fontWeight: "700" }} numberOfLines={1}>{r.employee_name}</ThemedText>
                        <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                          Worked {formatDate(r.eligible_work_date)}{r.employee_number ? ` · #${r.employee_number}` : ""}
                        </ThemedText>
                      </View>
                      <View style={{ alignItems: "flex-end", gap: 4 }}>
                        <View style={[styles.badge, { backgroundColor: meta.bg }]}>
                          <ThemedText type="caption" style={{ color: meta.color, fontWeight: "700" }}>{label}</ThemedText>
                        </View>
                        <ThemedText style={{ fontWeight: "800", color: theme.primary }}>{r.units_earned}d</ThemedText>
                      </View>
                    </View>

                    {r.work_description ? (
                      <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: 4 }} numberOfLines={2}>{r.work_description}</ThemedText>
                    ) : null}

                    <View style={styles.metaRow}>
                      {r.expires_at ? (
                        <View style={styles.inline}>
                          {isExpiringSoon ? <Feather name="alert-triangle" size={12} color={theme.error} /> : null}
                          <ThemedText type="caption" style={{ color: isExpiringSoon ? theme.error : theme.textSecondary }}>
                            Expires {formatDate(r.expires_at)}{daysLeft !== null && daysLeft > 0 ? ` (${daysLeft}d)` : ""}
                          </ThemedText>
                        </View>
                      ) : null}
                      {r.remaining_units < r.units_earned && r.status === "APPROVED" ? (
                        <ThemedText type="caption" style={{ color: theme.info }}>Remaining {r.remaining_units}d</ThemedText>
                      ) : null}
                      {r.approved_by_name ? (
                        <ThemedText type="caption" style={{ color: theme.textSecondary }}>Approved by {r.approved_by_name}</ThemedText>
                      ) : null}
                    </View>
                  </View>
                );
              })}
            </>
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
  statRow: { flexDirection: "row", gap: Spacing.sm },
  sumCard: { flex: 1, borderRadius: BorderRadius.md, paddingVertical: Spacing.md, paddingHorizontal: Spacing.sm, alignItems: "center", gap: 2 },
  sumValue: { fontWeight: "800", fontSize: 20 },
  card: { borderRadius: BorderRadius.md, padding: Spacing.md, borderWidth: 1, borderLeftWidth: 3 },
  cardRow: { flexDirection: "row", alignItems: "flex-start", gap: Spacing.sm },
  badge: { paddingHorizontal: Spacing.sm, paddingVertical: 3, borderRadius: BorderRadius.full },
  metaRow: { flexDirection: "row", columnGap: Spacing.lg, rowGap: 2, marginTop: 6, flexWrap: "wrap" },
  inline: { flexDirection: "row", alignItems: "center", gap: 4 },
});
