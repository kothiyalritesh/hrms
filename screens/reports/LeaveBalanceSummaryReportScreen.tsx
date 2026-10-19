/**
 * LeaveBalanceSummaryReportScreen
 * Read-only leave balance table — no add/remove actions.
 */
import React, { useCallback, useState } from "react";
import {
  Pressable,
  RefreshControl, ScrollView, StyleSheet, View,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useFocusEffect } from "@react-navigation/native";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, Spacing } from "@/constants/theme";
import { supabase } from "@/lib/supabase";
import {
  ReportFilterBar,
  ReportMeta,
  ReportSearch,
  ReportState,
  reportErrorMessage,
} from "@/components/reports/ReportUI";

interface BalanceRow {
  user_id: string;
  employee_name: string;
  role: string;
  sick: number;
  casual: number;
  earned: number;
  comp_off: number;
  total: number;
  opening_balance: number;
  monthly_credited: number;
  manually_adjusted: number;
  used: number;
}

type SortKey = "name" | "casual" | "comp_off" | "total";

export default function LeaveBalanceSummaryReportScreen() {
  const { theme } = useTheme();
  const [rows, setRows] = useState<BalanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortAsc, setSortAsc] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase.rpc("rpc_admin_leave_balance_summary");
      if (error) throw error;
      setRows(
        (data || []).map((r: any) => ({
          user_id: r.user_id,
          employee_name: r.employee_name || "Unknown",
          role: r.role || "",
          sick: Number(r.sick) || 0,
          casual: Number(r.casual) || 0,
          earned: Number(r.earned) || 0,
          comp_off: Number(r.comp_off) || 0,
          total: (Number(r.sick) || 0) + (Number(r.casual) || 0) + (Number(r.earned) || 0) + (Number(r.comp_off) || 0),
          opening_balance: Number(r.opening_balance) || 0,
          monthly_credited: Number(r.monthly_credited) || 0,
          manually_adjusted: Number(r.manually_adjusted) || 0,
          used: Number(r.used) || 0,
        }))
      );
    } catch (e: any) {
      // Inline (Alert.alert does nothing on web).
      setRows([]);
      setError(reportErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(a => !a);
    else { setSortKey(key); setSortAsc(true); }
  };

  const sorted = (search.trim()
    ? rows.filter(r => r.employee_name.toLowerCase().includes(search.toLowerCase()) || r.role.toLowerCase().includes(search.toLowerCase()))
    : [...rows]
  ).sort((a, b) => {
    let diff = 0;
    if (sortKey === "name") diff = a.employee_name.localeCompare(b.employee_name);
    else diff = (a[sortKey] as number) - (b[sortKey] as number);
    return sortAsc ? diff : -diff;
  });

  const totalCasual = rows.reduce((s, r) => s + r.casual, 0);
  const totalComp = rows.reduce((s, r) => s + r.comp_off, 0);
  const totalUsed = rows.reduce((s, r) => s + r.used, 0);

  const SortHeader = ({ label, k, width }: { label: string; k: SortKey; width: number }) => (
    <Pressable onPress={() => toggleSort(k)} style={[styles.thCell, { width }]}>
      <ThemedText style={styles.thText}>{label}</ThemedText>
      {sortKey === k && <Feather name={sortAsc ? "chevron-up" : "chevron-down"} size={10} color="#fff" />}
    </Pressable>
  );

  return (
    <View style={[styles.root, { backgroundColor: theme.backgroundRoot }]}>
      <ReportFilterBar>
        <ReportSearch value={search} onChangeText={setSearch} placeholder="Search by name or role" />

        {/* Summary strip */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{ flexDirection: "row", gap: Spacing.sm }}>
            {[
              { label: "Employees", val: rows.length, color: theme.primary },
              { label: "Total casual", val: totalCasual.toFixed(1), color: "#6366F1" },
              { label: "Total comp-off", val: totalComp.toFixed(1), color: "#8B5CF6" },
              { label: "Total used", val: totalUsed.toFixed(1), color: theme.error },
            ].map(({ label, val, color }) => (
              <View key={label} style={[styles.summChip, { backgroundColor: color + "18" }]}>
                <ThemedText type="caption" style={{ color, fontWeight: "700" }}>{val}</ThemedText>
                <ThemedText type="caption" style={{ color: theme.textSecondary }}>{label}</ThemedText>
              </View>
            ))}
          </View>
        </ScrollView>
        <ReportMeta>Read-only. Balances are adjusted from Admin › Leave Balance.</ReportMeta>
      </ReportFilterBar>

      {loading && !refreshing ? (
        <ReportState kind="loading" title="Loading balances…" />
      ) : (
        <ScrollView
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={theme.primary} />}
        >
          {error ? (
            <ReportState kind="error" title="Could not load leave balances" message={error} onRetry={() => void load()} />
          ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ padding: Spacing.md }}>
            <View style={[styles.table, { borderColor: theme.border }]}>
              {/* Table Header */}
              <View style={[styles.trHeader, { backgroundColor: theme.primary }]}>
                <SortHeader label="Employee" k="name" width={160} />
                <View style={[styles.thCell, { width: 60 }]}><ThemedText style={styles.thText}>Sick</ThemedText></View>
                <SortHeader label="Casual" k="casual" width={60} />
                <View style={[styles.thCell, { width: 60 }]}><ThemedText style={styles.thText}>Earned</ThemedText></View>
                <SortHeader label="Comp Off" k="comp_off" width={70} />
                <SortHeader label="Total" k="total" width={60} />
                <View style={[styles.thCell, { width: 100 }]}><ThemedText style={styles.thText}>Ledger Breakdown</ThemedText></View>
              </View>

              {sorted.length === 0 ? (
                <View style={styles.center}>
                  <ThemedText style={{ color: theme.textSecondary }}>
                    {search.trim() ? "No matching employees" : "No leave balances found"}
                  </ThemedText>
                </View>
              ) : sorted.map((r, idx) => (
                <View key={r.user_id} style={[styles.tr, { backgroundColor: idx % 2 === 0 ? theme.backgroundDefault : theme.backgroundSecondary, borderBottomColor: theme.border }]}>
                  <View style={{ width: 160, padding: 8 }}>
                    <ThemedText style={{ fontWeight: "700", fontSize: 12 }}>{r.employee_name}</ThemedText>
                    <ThemedText type="caption" style={{ color: theme.textSecondary }}>{r.role}</ThemedText>
                  </View>
                  <BalCell val={r.sick} color="#EF4444" />
                  <BalCell val={r.casual} color="#6366F1" />
                  <BalCell val={r.earned} color="#10B981" />
                  <BalCell val={r.comp_off} color="#8B5CF6" w={70} />
                  <View style={{ width: 60, alignItems: "center", justifyContent: "center" }}>
                    <ThemedText style={{ fontWeight: "800", fontSize: 14, color: theme.text }}>{r.total.toFixed(1)}</ThemedText>
                  </View>
                  <View style={{ width: 100, padding: 6 }}>
                    <ThemedText style={{ fontSize: 10, color: theme.textSecondary }}>+{r.monthly_credited.toFixed(1)} month</ThemedText>
                    <ThemedText style={{ fontSize: 10, color: theme.textSecondary }}>{r.manually_adjusted >= 0 ? "+" : ""}{r.manually_adjusted.toFixed(1)} manual</ThemedText>
                    <ThemedText style={{ fontSize: 10, color: theme.error }}>−{r.used.toFixed(1)} used</ThemedText>
                  </View>
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

function BalCell({ val, color, w = 60 }: { val: number; color: string; w?: number }) {
  return (
    <View style={{ width: w, alignItems: "center", justifyContent: "center" }}>
      <ThemedText style={{ fontWeight: "700", fontSize: 14, color: val > 0 ? color : "#9CA3AF" }}>{val.toFixed(1)}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  root:     { flex: 1 },
  summChip: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: BorderRadius.md, alignItems: "center" },
  center:   { alignItems: "center", justifyContent: "center", padding: 40 },
  table:    { borderWidth: 1, borderRadius: 8, overflow: "hidden" },
  trHeader: { flexDirection: "row", alignItems: "center" },
  tr:       { flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth },
  thCell:   { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 3, padding: 8, height: 40 },
  thText:   { color: "#fff", fontWeight: "700", fontSize: 11 },
});

