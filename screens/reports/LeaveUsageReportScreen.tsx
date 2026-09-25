/**
 * LeaveUsageReportScreen
 * Read-only leave report — per-employee totals across applied / approved / rejected / pending.
 */
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator, Alert, Pressable,
  RefreshControl, ScrollView, StyleSheet, TextInput, View,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useFocusEffect } from "@react-navigation/native";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, Colors, Spacing } from "@/constants/theme";
import { supabase } from "@/lib/supabase";

const LEAVE_TYPE_COLORS: Record<string, string> = {
  casual: "#6366F1", sick: "#EF4444", earned: "#10B981",
  wfh: "#F59E0B", comp_off: "#8B5CF6",
};
const STATUS_COLORS = {
  pending:   { bg: "#FEF3C7", text: "#92400E" },
  approved:  { bg: "#D1FAE5", text: "#065F46" },
  rejected:  { bg: "#FEE2E2", text: "#991B1B" },
  cancelled: { bg: "#F3F4F6", text: "#6B7280" },
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
  profiles?: { name?: string; employee_number?: string; office_id?: string; offices?: { name?: string } };
}

const toIso = (d: Date) => d.toISOString().slice(0, 10);
const TYPES = ["all", "casual", "sick", "earned", "wfh", "comp_off"];
const STATUSES = ["all", "pending", "approved", "rejected"];

export default function LeaveUsageReportScreen() {
  const { theme } = useTheme();
  const now = new Date();
  const [fromDate, setFromDate] = useState(toIso(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [toDate, setToDate] = useState(toIso(now));
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [view, setView] = useState<"summary" | "detail">("summary");
  const [employees, setEmployees] = useState<EmployeeLeave[]>([]);
  const [allRows, setAllRows] = useState<LeaveRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("leave_requests")
        .select("id,user_id,leave_type,start_date,end_date,status,requested_days,reason,applied_on,created_at,profiles:user_id(name,employee_number,offices:office_id(name))")
        .gte("start_date", fromDate)
        .lte("start_date", toDate)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const rows = (data ?? []) as LeaveRow[];
      setAllRows(rows);

      // Aggregate by employee
      const map = new Map<string, EmployeeLeave>();
      for (const r of rows) {
        if (!map.has(r.user_id)) {
          map.set(r.user_id, {
            id: r.user_id,
            name: r.profiles?.name || "Unknown",
            employee_number: r.profiles?.employee_number || null,
            office: (r.profiles?.offices as any)?.name || null,
            total: 0, approved: 0, pending: 0, rejected: 0, by_type: {},
          });
        }
        const emp = map.get(r.user_id)!;
        emp.total += r.requested_days;
        if (r.status === "approved") emp.approved += r.requested_days;
        else if (r.status === "pending") emp.pending += r.requested_days;
        else if (r.status === "rejected") emp.rejected += r.requested_days;
        emp.by_type[r.leave_type] = (emp.by_type[r.leave_type] || 0) + r.requested_days;
      }
      setEmployees(Array.from(map.values()).sort((a, b) => b.total - a.total));
    } catch (e: any) {
      Alert.alert("Error", e.message);
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const filteredRows = allRows.filter(r => {
    if (typeFilter !== "all" && r.leave_type !== typeFilter) return false;
    if (statusFilter !== "all" && r.status !== statusFilter) return false;
    if (search && !((r.profiles?.name || "").toLowerCase().includes(search.toLowerCase()))) return false;
    return true;
  });

  const filteredEmps = employees.filter(e =>
    !search || e.name.toLowerCase().includes(search.toLowerCase())
  );

  const Chip = ({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) => (
    <Pressable onPress={onPress} style={[styles.chip, { backgroundColor: active ? theme.primary : theme.backgroundSecondary, borderColor: active ? theme.primary : theme.border }]}>
      <ThemedText type="caption" style={{ color: active ? "#fff" : theme.text, fontWeight: "600", textTransform: "capitalize" }}>{label}</ThemedText>
    </Pressable>
  );

  const formatDate = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short" });

  return (
    <View style={[styles.root, { backgroundColor: theme.backgroundSecondary }]}>
      <View style={[styles.header, { backgroundColor: theme.backgroundDefault, borderBottomColor: theme.border }]}>
        {/* Date range */}
        <View style={styles.dateRow}>
          <TextInput style={[styles.dateInput, { backgroundColor: theme.backgroundSecondary, color: theme.text, borderColor: theme.border }]} value={fromDate} onChangeText={setFromDate} placeholder="From YYYY-MM-DD" placeholderTextColor={theme.textSecondary} />
          <TextInput style={[styles.dateInput, { backgroundColor: theme.backgroundSecondary, color: theme.text, borderColor: theme.border }]} value={toDate} onChangeText={setToDate} placeholder="To YYYY-MM-DD" placeholderTextColor={theme.textSecondary} />
          <Pressable onPress={load} style={[styles.goBtn, { backgroundColor: theme.primary }]}><Feather name="search" size={16} color="#fff" /></Pressable>
        </View>
        {/* Search */}
        <View style={[styles.searchBar, { backgroundColor: theme.backgroundSecondary, borderColor: theme.border, marginTop: 8 }]}>
          <Feather name="search" size={14} color={theme.textSecondary} />
          <TextInput style={{ flex: 1, color: theme.text, fontSize: 13, marginLeft: 6 }} placeholder="Search employee…" placeholderTextColor={theme.textSecondary} value={search} onChangeText={setSearch} />
        </View>
        {/* View toggle */}
        <View style={{ flexDirection: "row", gap: Spacing.sm, marginTop: 8 }}>
          <Chip label="Summary" active={view === "summary"} onPress={() => setView("summary")} />
          <Chip label="Detail" active={view === "detail"} onPress={() => setView("detail")} />
        </View>
        {/* Type filter (detail only) */}
        {view === "detail" && (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
              <View style={{ flexDirection: "row", gap: 6 }}>
                {TYPES.map(t => <Chip key={t} label={t === "comp_off" ? "Comp Off" : t} active={typeFilter === t} onPress={() => setTypeFilter(t)} />)}
              </View>
            </ScrollView>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 6 }}>
              <View style={{ flexDirection: "row", gap: 6 }}>
                {STATUSES.map(s => <Chip key={s} label={s} active={statusFilter === s} onPress={() => setStatusFilter(s)} />)}
              </View>
            </ScrollView>
          </>
        )}
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={theme.primary} size="large" /></View>
      ) : (
        <ScrollView
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={theme.primary} />}
          contentContainerStyle={{ padding: Spacing.md, gap: Spacing.sm }}
        >
          {view === "summary" ? (
            filteredEmps.length === 0 ? (
              <View style={styles.center}><ThemedText style={{ color: theme.textSecondary }}>No leave data in this period</ThemedText></View>
            ) : filteredEmps.map(emp => (
              <View key={emp.id} style={[styles.card, { backgroundColor: theme.backgroundDefault }]}>
                <View style={styles.cardRow}>
                  <View style={{ flex: 1 }}>
                    <ThemedText style={{ fontWeight: "700" }}>{emp.name}</ThemedText>
                    <ThemedText type="caption" style={{ color: theme.textSecondary }}>{emp.office || "—"}{emp.employee_number ? ` · #${emp.employee_number}` : ""}</ThemedText>
                  </View>
                  <ThemedText style={{ fontWeight: "800", fontSize: 18, color: theme.primary }}>{emp.total}d</ThemedText>
                </View>
                <View style={styles.statRow}>
                  <View style={[styles.statBadge, { backgroundColor: Colors.light.successBg }]}>
                    <ThemedText type="caption" style={{ color: Colors.light.successText, fontWeight: "700" }}>✓ {emp.approved}d approved</ThemedText>
                  </View>
                  <View style={[styles.statBadge, { backgroundColor: "#FEF3C7" }]}>
                    <ThemedText type="caption" style={{ color: "#92400E", fontWeight: "700" }}>⏳ {emp.pending}d pending</ThemedText>
                  </View>
                  <View style={[styles.statBadge, { backgroundColor: Colors.light.errorBg }]}>
                    <ThemedText type="caption" style={{ color: Colors.light.errorText, fontWeight: "700" }}>✗ {emp.rejected}d rejected</ThemedText>
                  </View>
                </View>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                  {Object.entries(emp.by_type).map(([t, d]) => (
                    <View key={t} style={[styles.typeChip, { backgroundColor: (LEAVE_TYPE_COLORS[t] || "#999") + "20" }]}>
                      <ThemedText type="caption" style={{ color: LEAVE_TYPE_COLORS[t] || "#999", fontWeight: "700", textTransform: "capitalize" }}>{t.replace("_", " ")}: {d}d</ThemedText>
                    </View>
                  ))}
                </View>
              </View>
            ))
          ) : (
            filteredRows.length === 0 ? (
              <View style={styles.center}><ThemedText style={{ color: theme.textSecondary }}>No matching records</ThemedText></View>
            ) : filteredRows.map(r => {
              const sc = STATUS_COLORS[r.status as keyof typeof STATUS_COLORS] || STATUS_COLORS.pending;
              const tc = LEAVE_TYPE_COLORS[r.leave_type] || "#999";
              return (
                <View key={r.id} style={[styles.card, { backgroundColor: theme.backgroundDefault }]}>
                  <View style={styles.cardRow}>
                    <View style={{ flex: 1 }}>
                      <ThemedText style={{ fontWeight: "700" }}>{r.profiles?.name || "—"}</ThemedText>
                      <ThemedText type="caption" style={{ color: theme.textSecondary }}>{formatDate(r.start_date)} → {formatDate(r.end_date)} · {r.requested_days}d</ThemedText>
                    </View>
                    <View style={[styles.statBadge, { backgroundColor: sc.bg }]}>
                      <ThemedText type="caption" style={{ color: sc.text, fontWeight: "700", textTransform: "capitalize" }}>{r.status}</ThemedText>
                    </View>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 }}>
                    <View style={[styles.typeChip, { backgroundColor: tc + "20" }]}>
                      <ThemedText type="caption" style={{ color: tc, fontWeight: "700", textTransform: "capitalize" }}>{r.leave_type.replace("_", " ")}</ThemedText>
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
  root:      { flex: 1 },
  header:    { padding: Spacing.md, borderBottomWidth: 1 },
  dateRow:   { flexDirection: "row", gap: Spacing.sm, alignItems: "center" },
  dateInput: { flex: 1, borderWidth: 1, borderRadius: BorderRadius.sm, paddingHorizontal: Spacing.sm, paddingVertical: 8, fontSize: 12 },
  goBtn:     { width: 40, height: 40, borderRadius: BorderRadius.sm, alignItems: "center", justifyContent: "center" },
  searchBar: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: BorderRadius.full, paddingHorizontal: Spacing.md, paddingVertical: 6 },
  chip:      { paddingHorizontal: Spacing.md, paddingVertical: 6, borderRadius: BorderRadius.full, borderWidth: 1 },
  center:    { alignItems: "center", justifyContent: "center", padding: 40 },
  card:      { borderRadius: BorderRadius.lg, padding: Spacing.md },
  cardRow:   { flexDirection: "row", alignItems: "center" },
  statRow:   { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  statBadge: { paddingHorizontal: Spacing.sm, paddingVertical: 3, borderRadius: BorderRadius.full },
  typeChip:  { paddingHorizontal: Spacing.sm, paddingVertical: 3, borderRadius: BorderRadius.sm },
});

