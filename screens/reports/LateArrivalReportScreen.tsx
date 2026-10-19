/**
 * LateArrivalReportScreen
 * Read-only report — shows employees who arrived late, with exact minutes late.
 */
import React, { useCallback, useRef, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useFocusEffect } from "@react-navigation/native";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, Spacing } from "@/constants/theme";
import { DEFAULT_LATE_CHECKIN_TIME } from "@/constants/attendancePolicy";
import { CanonicalAttendanceService } from "@/services/canonical-attendance.service";
import { ModuleErrorBoundary } from "@/components/ModuleErrorBoundary";
import { businessMonthStart, formatBusinessDate, getBusinessDateIST } from "@/utils/businessDate";
import { formatIstTime, minutesAfterIst } from "@/utils/exportWorkbook";
import {
  ReportChip,
  ReportChipRow,
  ReportDateRange,
  ReportFilterBar,
  ReportMeta,
  ReportSearch,
  ReportState,
  reportErrorMessage,
  type DateRange,
} from "@/components/reports/ReportUI";

interface LateRow {
  user_id: string;
  name: string;
  employee_number: string | null;
  office: string | null;
  work_date: string;
  first_in: string | null;
  minutes_late: number;
  late_threshold: string;
}

type SortKey = "date" | "name" | "minutes";

function LateArrivalReportScreenInner() {
  const { theme } = useTheme();
  const todayIST = getBusinessDateIST();
  // Queries run for the applied range only, never on half-typed dates.
  const [range, setRange] = useState<DateRange>(() => ({ from: businessMonthStart(todayIST), to: todayIST }));
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<LateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>("date");
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const today = getBusinessDateIST();
      const end = range.to > today ? today : range.to;
      const data = await CanonicalAttendanceService.list(range.from, end);
      if (id !== requestId.current) return;
      const late: LateRow[] = data
        .filter((r) => r.is_late && r.official_first_in)
        .map((r) => {
          const threshold = String((r as any).late_checkin_time || DEFAULT_LATE_CHECKIN_TIME).slice(0, 5);
          return {
            user_id: r.user_id,
            name: r.employee_name,
            employee_number: r.employee_number,
            office: r.office_name,
            work_date: r.work_date,
            first_in: r.official_first_in,
            minutes_late: minutesAfterIst(r.official_first_in, threshold),
            late_threshold: threshold,
          };
        });
      setRows(late);
    } catch (e: any) {
      if (id !== requestId.current) return;
      setRows([]);
      setError(reportErrorMessage(e));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [range]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const q = search.trim().toLowerCase();
  const filtered = (q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : [...rows]).sort((a, b) => {
    if (sortBy === "name") return a.name.localeCompare(b.name);
    if (sortBy === "minutes") return b.minutes_late - a.minutes_late;
    return b.work_date.localeCompare(a.work_date);
  });

  // Aggregate per employee
  const employeeCounts = new Map<string, { id: string; name: string; count: number; totalMins: number }>();
  for (const r of rows) {
    const e = employeeCounts.get(r.user_id) ?? { id: r.user_id, name: r.name, count: 0, totalMins: 0 };
    e.count++;
    e.totalMins += r.minutes_late;
    employeeCounts.set(r.user_id, e);
  }
  const topOffenders = Array.from(employeeCounts.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return (
    <View style={[styles.root, { backgroundColor: theme.backgroundRoot }]}>
      <ReportFilterBar>
        <ReportDateRange applied={range} onApply={setRange} />
        <ReportSearch value={search} onChangeText={setSearch} />
        <ReportChipRow>
          <ReportChip label="Newest first" active={sortBy === "date"} onPress={() => setSortBy("date")} />
          <ReportChip label="By name" active={sortBy === "name"} onPress={() => setSortBy("name")} />
          <ReportChip label="Most minutes late" active={sortBy === "minutes"} onPress={() => setSortBy("minutes")} />
        </ReportChipRow>
      </ReportFilterBar>

      {loading && !refreshing ? (
        <ReportState kind="loading" title="Loading late arrivals…" />
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
          {error ? (
            <ReportState kind="error" message={error} onRetry={() => void load()} />
          ) : (
            <>
              <View style={[styles.summaryCard, { backgroundColor: theme.backgroundDefault, borderColor: theme.border }]}>
                <View style={[styles.summaryIcon, { backgroundColor: theme.errorBg }]}>
                  <Feather name="clock" size={18} color={theme.error} />
                </View>
                <View style={{ flex: 1 }}>
                  <ThemedText type="h3">{rows.length} late arrival{rows.length === 1 ? "" : "s"}</ThemedText>
                  <ReportMeta>
                    {formatBusinessDate(range.from)} – {formatBusinessDate(range.to)} · {employeeCounts.size} employee{employeeCounts.size === 1 ? "" : "s"}
                  </ReportMeta>
                </View>
              </View>

              {topOffenders.length > 0 && (
                <View style={[styles.card, { backgroundColor: theme.backgroundDefault, borderColor: theme.border }]}>
                  <ThemedText type="small" style={styles.cardHeading}>Most frequently late</ThemedText>
                  {topOffenders.map((e, i) => (
                    <View key={e.id} style={styles.rankRow}>
                      <View style={[styles.rank, { backgroundColor: theme.primary }]}>
                        <ThemedText style={styles.rankText}>{i + 1}</ThemedText>
                      </View>
                      <ThemedText style={{ flex: 1, fontWeight: "600" }} numberOfLines={1}>{e.name}</ThemedText>
                      <ThemedText type="caption" style={{ color: theme.error, fontWeight: "700" }}>
                        {e.count}× · avg {Math.round(e.totalMins / e.count)} min
                      </ThemedText>
                    </View>
                  ))}
                </View>
              )}

              {filtered.length === 0 ? (
                <ReportState
                  kind="empty"
                  icon={q ? "search" : "check-circle"}
                  title={q ? "No matching employees" : "No late arrivals"}
                  message={q ? "Try a different name." : "Nobody checked in late in this period."}
                />
              ) : (
                filtered.map((r) => (
                  <View key={`${r.user_id}-${r.work_date}`} style={[styles.card, { backgroundColor: theme.backgroundDefault, borderColor: theme.border }]}>
                    <View style={styles.cardRow}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <ThemedText style={{ fontWeight: "700" }} numberOfLines={1}>{r.name}</ThemedText>
                        <ThemedText type="caption" style={{ color: theme.textSecondary }} numberOfLines={1}>
                          {formatBusinessDate(r.work_date)} · {r.office || "No office"}
                        </ThemedText>
                      </View>
                      <View style={[styles.lateBadge, { backgroundColor: theme.errorBg }]}>
                        <ThemedText style={{ color: theme.error, fontWeight: "800", fontSize: 13 }}>+{r.minutes_late} min</ThemedText>
                      </View>
                    </View>
                    <View style={styles.timesRow}>
                      <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                        Checked in <ThemedText type="caption" style={{ color: theme.text, fontWeight: "700" }}>{formatIstTime(r.first_in) || "—"}</ThemedText>
                      </ThemedText>
                      <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                        Expected by <ThemedText type="caption" style={{ color: theme.text, fontWeight: "700" }}>{r.late_threshold}</ThemedText>
                      </ThemedText>
                    </View>
                  </View>
                ))
              )}
            </>
          )}
          <View style={{ height: 60 }} />
        </ScrollView>
      )}
    </View>
  );
}

export default function LateArrivalReportScreen() {
  return (
    <ModuleErrorBoundary moduleName="Late Arrival Report">
      <LateArrivalReportScreenInner />
    </ModuleErrorBoundary>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { padding: Spacing.md, gap: Spacing.sm },
  summaryCard: { flexDirection: "row", alignItems: "center", gap: Spacing.md, padding: Spacing.md, borderRadius: BorderRadius.md, borderWidth: 1 },
  summaryIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  card: { borderRadius: BorderRadius.md, padding: Spacing.md, borderWidth: 1 },
  cardHeading: { fontWeight: "700", marginBottom: Spacing.sm },
  cardRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  timesRow: { flexDirection: "row", flexWrap: "wrap", columnGap: Spacing.lg, rowGap: 2, marginTop: 6 },
  lateBadge: { paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: BorderRadius.full },
  rankRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, marginBottom: 6 },
  rank: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  rankText: { color: "#fff", fontSize: 11, fontWeight: "800" },
});
