/**
 * LateArrivalReportScreen
 * Read-only report — shows employees who arrived late, with exact minutes late.
 */
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator, Alert, Platform, Pressable,
  RefreshControl, ScrollView, StyleSheet, TextInput, View,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useFocusEffect } from "@react-navigation/native";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, Colors, Spacing } from "@/constants/theme";
import { CanonicalAttendanceService, CanonicalAttendanceDay } from "@/services/canonical-attendance.service";

const toIso = (d: Date) => d.toISOString().slice(0, 10);

interface LateRow {
  user_id: string;
  name: string;
  employee_number: string | null;
  office: string | null;
  work_date: string;
  first_in: string | null;
  minutes_late: number;
}

function minutesLate(firstIn: string | null): number {
  if (!firstIn) return 0;
  // Expected check-in is 09:30 IST — adjust if needed
  const expected = new Date(firstIn);
  expected.setHours(9, 30, 0, 0);
  const actual = new Date(firstIn);
  const diff = Math.floor((actual.getTime() - expected.getTime()) / 60000);
  return diff > 0 ? diff : 0;
}

function formatTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });
}

function formatDate(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export default function LateArrivalReportScreen() {
  const { theme } = useTheme();
  const now = new Date();
  const [fromDate, setFromDate] = useState(toIso(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [toDate, setToDate] = useState(toIso(now));
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<LateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sortBy, setSortBy] = useState<"date" | "name" | "minutes">("date");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const endRaw = toDate;
      const today = new Date(new Date().getTime() + 5.5 * 3600000).toISOString().slice(0, 10);
      const end = endRaw > today ? today : endRaw;
      const data = await CanonicalAttendanceService.list(fromDate, end);
      const late: LateRow[] = data
        .filter(r => r.is_late && r.official_first_in)
        .map(r => ({
          user_id: r.user_id,
          name: r.employee_name,
          employee_number: r.employee_number,
          office: r.office_name,
          work_date: r.work_date,
          first_in: r.official_first_in,
          minutes_late: minutesLate(r.official_first_in),
        }));
      setRows(late);
    } catch (e: any) {
      Alert.alert("Error", e.message);
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const filtered = (search.trim()
    ? rows.filter(r => r.name.toLowerCase().includes(search.toLowerCase()))
    : rows
  ).sort((a, b) => {
    if (sortBy === "name") return a.name.localeCompare(b.name);
    if (sortBy === "minutes") return b.minutes_late - a.minutes_late;
    return b.work_date.localeCompare(a.work_date);
  });

  // Aggregate per employee
  const employeeCounts = new Map<string, { name: string; count: number; totalMins: number }>();
  for (const r of rows) {
    const e = employeeCounts.get(r.user_id) ?? { name: r.name, count: 0, totalMins: 0 };
    e.count++;
    e.totalMins += r.minutes_late;
    employeeCounts.set(r.user_id, e);
  }
  const topOffenders = Array.from(employeeCounts.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const SortBtn = ({ label, val }: { label: string; val: typeof sortBy }) => (
    <Pressable
      onPress={() => setSortBy(val)}
      style={[styles.sortBtn, { backgroundColor: sortBy === val ? theme.primary : theme.backgroundSecondary, borderColor: theme.border }]}
    >
      <ThemedText type="caption" style={{ color: sortBy === val ? "#fff" : theme.text, fontWeight: "600" }}>{label}</ThemedText>
    </Pressable>
  );

  return (
    <View style={[styles.root, { backgroundColor: theme.backgroundSecondary }]}>
      {/* Filters */}
      <View style={[styles.header, { backgroundColor: theme.backgroundDefault, borderBottomColor: theme.border }]}>
        <View style={styles.dateRow}>
          <View style={styles.dateField}>
            <ThemedText type="caption" style={{ color: theme.textSecondary, marginBottom: 4 }}>From</ThemedText>
            <TextInput
              style={[styles.dateInput, { backgroundColor: theme.backgroundSecondary, color: theme.text, borderColor: theme.border }]}
              value={fromDate}
              onChangeText={setFromDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={theme.textSecondary}
            />
          </View>
          <View style={styles.dateField}>
            <ThemedText type="caption" style={{ color: theme.textSecondary, marginBottom: 4 }}>To</ThemedText>
            <TextInput
              style={[styles.dateInput, { backgroundColor: theme.backgroundSecondary, color: theme.text, borderColor: theme.border }]}
              value={toDate}
              onChangeText={setToDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={theme.textSecondary}
            />
          </View>
          <Pressable onPress={load} style={[styles.goBtn, { backgroundColor: theme.primary }]}>
            <Feather name="search" size={16} color="#fff" />
          </Pressable>
        </View>

        <View style={[styles.searchBar, { backgroundColor: theme.backgroundSecondary, borderColor: theme.border, marginTop: Spacing.sm }]}>
          <Feather name="search" size={14} color={theme.textSecondary} />
          <TextInput
            style={{ flex: 1, color: theme.text, fontSize: 13, marginLeft: 6 }}
            placeholder="Search employee…"
            placeholderTextColor={theme.textSecondary}
            value={search}
            onChangeText={setSearch}
          />
        </View>

        <View style={{ flexDirection: "row", gap: Spacing.sm, marginTop: Spacing.sm }}>
          <SortBtn label="By Date" val="date" />
          <SortBtn label="By Name" val="name" />
          <SortBtn label="Most Late" val="minutes" />
        </View>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={theme.primary} size="large" /></View>
      ) : (
        <ScrollView
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={theme.primary} />}
          contentContainerStyle={{ padding: Spacing.md, gap: Spacing.sm }}
        >
          {/* Summary Banner */}
          <View style={[styles.summaryCard, { backgroundColor: Colors.light.errorBg }]}>
            <Feather name="clock" size={20} color={Colors.light.error} />
            <View style={{ flex: 1 }}>
              <ThemedText style={{ fontWeight: "800", color: Colors.light.error }}>{rows.length} Late Arrivals</ThemedText>
              <ThemedText type="caption" style={{ color: Colors.light.errorText }}>{fromDate} → {toDate}</ThemedText>
            </View>
          </View>

          {/* Top Repeat Offenders */}
          {topOffenders.length > 0 && (
            <View style={[styles.card, { backgroundColor: theme.backgroundDefault }]}>
              <ThemedText type="small" style={{ fontWeight: "700", marginBottom: Spacing.sm }}>Most Frequent Late Arrivals</ThemedText>
              {topOffenders.map((e, i) => (
                <View key={e.name} style={{ flexDirection: "row", alignItems: "center", marginBottom: 6 }}>
                  <View style={[styles.rank, { backgroundColor: theme.primary }]}><ThemedText style={{ color: "#fff", fontSize: 11, fontWeight: "800" }}>{i + 1}</ThemedText></View>
                  <ThemedText style={{ flex: 1, fontWeight: "600" }}>{e.name}</ThemedText>
                  <ThemedText type="caption" style={{ color: Colors.light.error, fontWeight: "700" }}>{e.count}x · avg {Math.round(e.totalMins / e.count)}min late</ThemedText>
                </View>
              ))}
            </View>
          )}

          {/* Detail Rows */}
          {filtered.length === 0 ? (
            <View style={styles.center}>
              <Feather name="check-circle" size={36} color={Colors.light.success} />
              <ThemedText style={{ color: theme.textSecondary, marginTop: 12 }}>No late arrivals in this period</ThemedText>
            </View>
          ) : filtered.map((r, idx) => (
            <View key={`${r.user_id}-${r.work_date}`} style={[styles.card, { backgroundColor: theme.backgroundDefault }]}>
              <View style={styles.cardRow}>
                <View style={{ flex: 1 }}>
                  <ThemedText style={{ fontWeight: "700" }}>{r.name}</ThemedText>
                  <ThemedText type="caption" style={{ color: theme.textSecondary }}>{formatDate(r.work_date)} · {r.office || "—"}</ThemedText>
                </View>
                <View style={[styles.lateBadge, { backgroundColor: Colors.light.errorBg }]}>
                  <ThemedText style={{ color: Colors.light.error, fontWeight: "800", fontSize: 13 }}>+{r.minutes_late}min</ThemedText>
                </View>
              </View>
              <View style={{ flexDirection: "row", gap: Spacing.lg, marginTop: 4 }}>
                <ThemedText type="caption" style={{ color: theme.textSecondary }}>Check-in: <ThemedText style={{ color: Colors.light.error, fontWeight: "700" }}>{formatTime(r.first_in)}</ThemedText></ThemedText>
                <ThemedText type="caption" style={{ color: theme.textSecondary }}>Expected: <ThemedText style={{ fontWeight: "700" }}>09:30 AM</ThemedText></ThemedText>
              </View>
            </View>
          ))}
          <View style={{ height: 60 }} />
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root:        { flex: 1 },
  header:      { padding: Spacing.md, borderBottomWidth: 1 },
  dateRow:     { flexDirection: "row", gap: Spacing.sm, alignItems: "flex-end" },
  dateField:   { flex: 1 },
  dateInput:   { borderWidth: 1, borderRadius: BorderRadius.sm, paddingHorizontal: Spacing.md, paddingVertical: 8, fontSize: 13 },
  goBtn:       { width: 40, height: 40, borderRadius: BorderRadius.sm, alignItems: "center", justifyContent: "center" },
  searchBar:   { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: BorderRadius.full, paddingHorizontal: Spacing.md, paddingVertical: 6 },
  sortBtn:     { paddingHorizontal: Spacing.md, paddingVertical: 6, borderRadius: BorderRadius.full, borderWidth: 1 },
  center:      { alignItems: "center", justifyContent: "center", padding: 40 },
  summaryCard: { flexDirection: "row", alignItems: "center", gap: Spacing.md, padding: Spacing.md, borderRadius: BorderRadius.lg },
  card:        { borderRadius: BorderRadius.lg, padding: Spacing.md },
  cardRow:     { flexDirection: "row", alignItems: "center" },
  lateBadge:   { paddingHorizontal: Spacing.md, paddingVertical: 4, borderRadius: BorderRadius.full },
  rank:        { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", marginRight: Spacing.sm },
});

