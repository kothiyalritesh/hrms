/**
 * AttendanceRegisterReportScreen
 * Read-only monthly attendance register — P / A / L / WFH / WO per employee.
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
import { supabase } from "@/lib/supabase";

const STATUS_COLORS: Record<string, string> = {
    PRESENT:      "#10B981",
    CHECKED_OUT:  "#10B981",
    FIELD_VISIT:  "#06B6D4",
    LATE:         "#F59E0B",
    ABSENT:       "#EF4444",
    LEAVE:        "#F59E0B",
    ON_LEAVE:     "#F59E0B",
    WFH:          "#6366F1",
    WEEKLY_OFF:   "#6B7280",
    HOLIDAY:      "#8B5CF6",
    HALF_DAY:     "#F97316",
  };
  const STATUS_SHORT: Record<string, string> = {
    PRESENT:      "P",
    CHECKED_OUT:  "P",
    FIELD_VISIT:  "FV",
    LATE:         "La",
    ABSENT:       "A",
    LEAVE:        "L",
    ON_LEAVE:     "L",
    WFH:          "WFH",
    WEEKLY_OFF:   "WO",
    HOLIDAY:      "H",
    HALF_DAY:     "HD",
  };

function monthRange(year: number, month: number): [string, string] {
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0);
    const end = `${lastDay.getFullYear()}-${String(lastDay.getMonth()+1).padStart(2,"0")}-${String(lastDay.getDate()).padStart(2,"0")}`;
  return [start, end];
}

interface EmployeeSummary {
  id: string;
  name: string;
  employee_number: string | null;
  office: string | null;
  days: Record<string, string>; // date -> status
  sources: Record<string, string | null>; // date -> source
  present: number; absent: number; late: number; leave: number; wfh: number; wo: number;
}

export default function AttendanceRegisterReportScreen() {
  const { theme } = useTheme();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<EmployeeSummary[]>([]);
  const [daysInMonth, setDaysInMonth] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [start, endRaw] = monthRange(year, month);
      const today = new Date(new Date().getTime() + 5.5 * 3600000).toISOString().slice(0, 10); // naive IST for clamping
      const end = endRaw > today ? today : endRaw;
      // removed log
      const {data:d2} = await supabase.from("biometric_device_punches").select("id").limit(1);
      
      const data = await CanonicalAttendanceService.list(start, end);
      console.log("FIRST ROW SOURCE:", data[0]?.first_in_source, "NAME:", data[0]?.employee_name, data[0]?.attendance_status);
      const dim = new Date(year, month, 0).getDate();
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
          if (["PRESENT","CHECKED_OUT","LATE","FIELD_VISIT"].includes(status)) emp.present++;
          if (status === "LATE") emp.late++;
          else if (status === "ABSENT") emp.absent++;
          else if (status === "LEAVE" || status === "ON_LEAVE") emp.leave++;
          else if (status === "WFH") emp.wfh++;
          else if (status === "WEEKLY_OFF" || status === "HOLIDAY") emp.wo++;
      }
      setRows(Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name)));
    } catch (e: any) {
      Alert.alert("Error", e.message);
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const prevMonth = () => { if (month === 1) { setYear(y => y - 1); setMonth(12); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 12) { setYear(y => y + 1); setMonth(1); } else setMonth(m => m + 1); };

  const filtered = search.trim()
    ? rows.filter(r => r.name.toLowerCase().includes(search.toLowerCase()) || (r.employee_number || "").includes(search))
    : rows;

  const monthLabel = new Date(year, month - 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });

  return (
    <View style={[styles.root, { backgroundColor: theme.backgroundSecondary }]}>
      {/* Month Picker */}
      <View style={[styles.header, { backgroundColor: theme.backgroundDefault, borderBottomColor: theme.border }]}>
        <View style={styles.monthRow}>
          <Pressable onPress={prevMonth} style={styles.chevron}><Feather name="chevron-left" size={20} color={theme.primary} /></Pressable>
          <ThemedText type="h4" style={{ color: theme.text }}>{monthLabel}</ThemedText>
          <Pressable onPress={nextMonth} style={styles.chevron}><Feather name="chevron-right" size={20} color={theme.primary} /></Pressable>
        </View>
        <View style={[styles.searchBar, { backgroundColor: theme.backgroundSecondary, borderColor: theme.border }]}>
          <Feather name="search" size={14} color={theme.textSecondary} />
          <TextInput
            style={{ flex: 1, color: theme.text, fontSize: 13, marginLeft: 6 }}
            placeholder="Search employee…"
            placeholderTextColor={theme.textSecondary}
            value={search}
            onChangeText={setSearch}
          />
        </View>
        {/* Legend */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
          <View style={{ flexDirection: "row", gap: 10 }}>
            {Object.entries(STATUS_SHORT).map(([k, v]) => (
              <View key={k} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <View style={{ width: 14, height: 14, borderRadius: 3, backgroundColor: STATUS_COLORS[k] || "#999" }} />
                <ThemedText type="caption" style={{ color: theme.textSecondary }}>{v} = {k.replace("_", " ")}</ThemedText>
              </View>
            ))}
          </View>
        </ScrollView>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={theme.primary} size="large" /></View>
      ) : (
        <ScrollView
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={theme.primary} />}
        >
          <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ paddingHorizontal: Spacing.md }}>
            <View>
              {/* Table Header */}
              <View style={[styles.tableRow, { backgroundColor: theme.primary }]}>
                <View style={styles.nameCell}><ThemedText style={styles.headerText}>Employee</ThemedText></View>
                {daysInMonth.map(d => (
                  <View key={d} style={styles.dayCell}>
                    <ThemedText style={styles.headerText}>{d}</ThemedText>
                  </View>
                ))}
                <View style={styles.summCell}><ThemedText style={styles.headerText}>P</ThemedText></View>
                <View style={styles.summCell}><ThemedText style={styles.headerText}>La</ThemedText></View>
                <View style={styles.summCell}><ThemedText style={styles.headerText}>A</ThemedText></View>
                <View style={styles.summCell}><ThemedText style={styles.headerText}>L</ThemedText></View>
                <View style={styles.summCell}><ThemedText style={styles.headerText}>WFH</ThemedText></View>
                <View style={styles.summCell}><ThemedText style={styles.headerText}>WO</ThemedText></View>
              </View>

              {filtered.length === 0 ? (
                <View style={styles.center}>
                  <ThemedText style={{ color: theme.textSecondary, marginTop: 40 }}>No data for this month</ThemedText>
                </View>
              ) : filtered.map((emp, idx) => (
                <View key={emp.id} style={[styles.tableRow, { backgroundColor: idx % 2 === 0 ? theme.backgroundDefault : theme.backgroundSecondary }]}>
                  <View style={styles.nameCell}>
                    <ThemedText style={{ fontWeight: "700", fontSize: 12, color: theme.text }}>{emp.name}</ThemedText>
                    {emp.employee_number && <ThemedText style={{ fontSize: 10, color: theme.textSecondary }}>#{emp.employee_number}</ThemedText>}
                  </View>
                  {daysInMonth.map(d => {
                    const status = emp.days[d];
                    const color = STATUS_COLORS[status || ""] || "transparent";
                    let label = STATUS_SHORT[status || ""] || "—";
                      if (label === "P") {
                        if (emp.sources?.[d] === "BIOMETRIC") label = "Pb";
                        if (emp.sources?.[d] === "APP") label = "Pa";
                        if (emp.sources?.[d] === "FIELD_VISIT") label = "Pv";
                      }
                    return (
                      <View key={d} style={[styles.dayCell, { backgroundColor: color + "22" }]}>
                        <ThemedText style={{ fontSize: 10, fontWeight: "700", color: color || theme.textSecondary }}>{label}</ThemedText>
                      </View>
                    );
                  })}
                  <View style={styles.summCell}><ThemedText style={[styles.summText, { color: Colors.light.success }]}>{emp.present}</ThemedText></View>
                  <View style={styles.summCell}><ThemedText style={[styles.summText, { color: "#F97316" }]}>{emp.late}</ThemedText></View>
                  <View style={styles.summCell}><ThemedText style={[styles.summText, { color: Colors.light.error }]}>{emp.absent}</ThemedText></View>
                  <View style={styles.summCell}><ThemedText style={[styles.summText, { color: Colors.light.warning }]}>{emp.leave}</ThemedText></View>
                  <View style={styles.summCell}><ThemedText style={[styles.summText, { color: "#6366F1" }]}>{emp.wfh}</ThemedText></View>
                  <View style={styles.summCell}><ThemedText style={[styles.summText, { color: theme.textSecondary }]}>{emp.wo}</ThemedText></View>
                </View>
              ))}
            </View>
          </ScrollView>
          <View style={{ height: 60 }} />
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root:       { flex: 1 },
  header:     { padding: Spacing.md, borderBottomWidth: 1 },
  monthRow:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: Spacing.sm },
  chevron:    { padding: Spacing.sm },
  searchBar:  { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: BorderRadius.full, paddingHorizontal: Spacing.md, paddingVertical: 6 },
  center:     { flex: 1, alignItems: "center", justifyContent: "center", padding: 40 },
  tableRow:   { flexDirection: "row", alignItems: "center", borderBottomWidth: 0.5, borderBottomColor: "rgba(128,128,128,0.1)" },
  nameCell:   { width: 120, padding: 8, justifyContent: "center" },
  dayCell:    { width: 28, height: 36, alignItems: "center", justifyContent: "center" },
  summCell:   { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerText: { color: "#fff", fontWeight: "700", fontSize: 11 },
  summText:   { fontWeight: "800", fontSize: 12 },
});

