/**
 * OvertimeReportScreen
 * Read-only comp-off earnings report — who worked on weekends/holidays, earned units, expiry.
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
import { getBusinessDateIST } from "@/utils/businessDate";

type CompOffStatus = "PENDING" | "APPROVED" | "USED" | "EXPIRED" | "REJECTED";

const STATUS_META: Record<CompOffStatus | string, { color: string; bg: string; label: string }> = {
  PENDING:  { color: "#92400E", bg: "#FEF3C7", label: "Pending Approval" },
  APPROVED: { color: "#065F46", bg: "#D1FAE5", label: "Approved" },
  USED:     { color: "#1E40AF", bg: "#DBEAFE", label: "Used" },
  EXPIRED:  { color: "#6B7280", bg: "#F3F4F6", label: "Expired" },
  REJECTED: { color: "#991B1B", bg: "#FEE2E2", label: "Rejected" },
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
  expires_at: string | null;
  created_at: string;
}

const toIso = (d: Date) => getBusinessDateIST(d);
const ALL_STATUSES: CompOffStatus[] = ["PENDING", "APPROVED", "USED", "EXPIRED", "REJECTED"];

function formatDate(d: string | null) {
  if (!d) return "—";
  return new Date(d.includes("T") ? d : d + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function daysUntilExpiry(expiresAt: string | null): number | null {
  if (!expiresAt) return null;
  const diff = new Date(expiresAt).getTime() - Date.now();
  return Math.ceil(diff / 86400000);
}

export default function OvertimeReportScreen() {
  const { theme } = useTheme();
  const now = new Date();
  const [fromDate, setFromDate] = useState(toIso(new Date(now.getFullYear(), now.getMonth() - 2, 1)));
  const [toDate, setToDate] = useState(toIso(new Date(now.getFullYear(), now.getMonth() + 1, 0)));
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | CompOffStatus>("ALL");
  const [rows, setRows] = useState<CompOffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("comp_off_earnings")
        .select(`
          id, user_id, eligible_work_date, units, remaining_units,
          status, reason, expires_at, created_at,
          employee:profiles!user_id ( name ),
          approver:profiles!approved_by ( name )
        `)
        .gte("eligible_work_date", fromDate)
        .lte("eligible_work_date", toDate)
        .order("eligible_work_date", { ascending: false });

      if (error) throw error;

      setRows(
        (data || []).map((r: any) => ({
          id: r.id,
          user_id: r.user_id,
          employee_name: r.employee?.name || "Unknown",
          employee_number: r.employee?.employee_number || null,
          eligible_work_date: r.eligible_work_date,
          units_earned: Number(r.units_earned) || 0,
          remaining_units: Number(r.remaining_units) || 0,
          status: r.status || "PENDING",
          work_description: r.work_description || null,
          approved_by_name: r.approved_by?.name || null,
          expires_at: r.expires_at || null,
          created_at: r.created_at,
        }))
      );
    } catch (e: any) {
      Alert.alert("Error", e.message);
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const filtered = rows.filter(r => {
    if (statusFilter !== "ALL" && r.status !== statusFilter) return false;
    if (search && !r.employee_name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // Aggregates
  const totalEarned = rows.reduce((s, r) => s + r.units_earned, 0);
  const pendingCount = rows.filter(r => r.status === "PENDING").length;
  const expiringCount = rows.filter(r => {
    const days = daysUntilExpiry(r.expires_at);
    return r.status === "APPROVED" && days !== null && days <= 7 && days > 0;
  }).length;

  const Chip = ({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) => (
    <Pressable
      onPress={onPress}
      style={[styles.chip, { backgroundColor: active ? theme.primary : theme.backgroundSecondary, borderColor: active ? theme.primary : theme.border }]}
    >
      <ThemedText type="caption" style={{ color: active ? "#fff" : theme.text, fontWeight: "600" }}>{label}</ThemedText>
    </Pressable>
  );

  return (
    <View style={[styles.root, { backgroundColor: theme.backgroundSecondary }]}>
      <View style={[styles.header, { backgroundColor: theme.backgroundDefault, borderBottomColor: theme.border }]}>
        <View style={styles.dateRow}>
          <TextInput style={[styles.dateInput, { backgroundColor: theme.backgroundSecondary, color: theme.text, borderColor: theme.border }]} value={fromDate} onChangeText={setFromDate} placeholder="From YYYY-MM-DD" placeholderTextColor={theme.textSecondary} />
          <TextInput style={[styles.dateInput, { backgroundColor: theme.backgroundSecondary, color: theme.text, borderColor: theme.border }]} value={toDate} onChangeText={setToDate} placeholder="To YYYY-MM-DD" placeholderTextColor={theme.textSecondary} />
          <Pressable onPress={load} style={[styles.goBtn, { backgroundColor: theme.primary }]}><Feather name="search" size={16} color="#fff" /></Pressable>
        </View>
        <View style={[styles.searchBar, { backgroundColor: theme.backgroundSecondary, borderColor: theme.border, marginTop: 8 }]}>
          <Feather name="search" size={14} color={theme.textSecondary} />
          <TextInput style={{ flex: 1, color: theme.text, fontSize: 13, marginLeft: 6 }} placeholder="Search employee…" placeholderTextColor={theme.textSecondary} value={search} onChangeText={setSearch} />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
          <View style={{ flexDirection: "row", gap: 6 }}>
            <Chip label="All" active={statusFilter === "ALL"} onPress={() => setStatusFilter("ALL")} />
            {ALL_STATUSES.map(s => <Chip key={s} label={STATUS_META[s].label} active={statusFilter === s} onPress={() => setStatusFilter(s)} />)}
          </View>
        </ScrollView>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={theme.primary} size="large" /></View>
      ) : (
        <ScrollView
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={theme.primary} />}
          contentContainerStyle={{ padding: Spacing.md, gap: Spacing.sm }}
        >
          {/* Summary cards */}
          <View style={{ flexDirection: "row", gap: Spacing.sm }}>
            <View style={[styles.sumCard, { backgroundColor: theme.primary + "18" }]}>
              <ThemedText style={{ fontWeight: "800", fontSize: 20, color: theme.primary }}>{totalEarned.toFixed(1)}</ThemedText>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>Days Earned</ThemedText>
            </View>
            {pendingCount > 0 && (
              <View style={[styles.sumCard, { backgroundColor: "#FEF3C7" }]}>
                <ThemedText style={{ fontWeight: "800", fontSize: 20, color: "#92400E" }}>{pendingCount}</ThemedText>
                <ThemedText type="caption" style={{ color: "#92400E" }}>Pending</ThemedText>
              </View>
            )}
            {expiringCount > 0 && (
              <View style={[styles.sumCard, { backgroundColor: Colors.light.errorBg }]}>
                <ThemedText style={{ fontWeight: "800", fontSize: 20, color: Colors.light.error }}>{expiringCount}</ThemedText>
                <ThemedText type="caption" style={{ color: Colors.light.errorText }}>Expiring Soon</ThemedText>
              </View>
            )}
          </View>

          {filtered.length === 0 ? (
            <View style={styles.center}>
              <Feather name="inbox" size={32} color={theme.textSecondary} />
              <ThemedText style={{ color: theme.textSecondary, marginTop: 12 }}>No comp-off records in this period</ThemedText>
            </View>
          ) : filtered.map(r => {
            const meta = STATUS_META[r.status] || STATUS_META.PENDING;
            const daysLeft = daysUntilExpiry(r.expires_at);
            const isExpiringSoon = daysLeft !== null && daysLeft <= 7 && daysLeft > 0 && r.status === "APPROVED";
            return (
              <View key={r.id} style={[styles.card, { backgroundColor: theme.backgroundDefault, borderLeftColor: meta.color, borderLeftWidth: 3 }]}>
                <View style={styles.cardRow}>
                  <View style={{ flex: 1 }}>
                    <ThemedText style={{ fontWeight: "700" }}>{r.employee_name}</ThemedText>
                    <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                      Worked: {formatDate(r.eligible_work_date)}{r.employee_number ? ` · #${r.employee_number}` : ""}
                    </ThemedText>
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 4 }}>
                    <View style={[styles.badge, { backgroundColor: meta.bg }]}>
                      <ThemedText type="caption" style={{ color: meta.color, fontWeight: "700" }}>{meta.label}</ThemedText>
                    </View>
                    <ThemedText style={{ fontWeight: "800", color: theme.primary }}>{r.units_earned}d</ThemedText>
                  </View>
                </View>

                {r.work_description && (
                  <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: 4 }} numberOfLines={2}>{r.work_description}</ThemedText>
                )}

                <View style={{ flexDirection: "row", gap: Spacing.lg, marginTop: 6, flexWrap: "wrap" }}>
                  {r.expires_at && (
                    <ThemedText type="caption" style={{ color: isExpiringSoon ? Colors.light.error : theme.textSecondary }}>
                      {isExpiringSoon ? "⚠️ " : ""}Expires: {formatDate(r.expires_at)}{daysLeft !== null ? ` (${daysLeft}d)` : ""}
                    </ThemedText>
                  )}
                  {r.remaining_units < r.units_earned && r.status === "APPROVED" && (
                    <ThemedText type="caption" style={{ color: "#6366F1" }}>Remaining: {r.remaining_units}d</ThemedText>
                  )}
                  {r.approved_by_name && (
                    <ThemedText type="caption" style={{ color: theme.textSecondary }}>Approved by: {r.approved_by_name}</ThemedText>
                  )}
                </View>
              </View>
            );
          })}
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
  sumCard:   { flex: 1, borderRadius: BorderRadius.lg, padding: Spacing.md, alignItems: "center" },
  card:      { borderRadius: BorderRadius.lg, padding: Spacing.md },
  cardRow:   { flexDirection: "row", alignItems: "flex-start" },
  badge:     { paddingHorizontal: Spacing.sm, paddingVertical: 3, borderRadius: BorderRadius.full },
});

