import React, { useState } from "react";
import {
  View, StyleSheet, ScrollView, Pressable,
  Alert, ActivityIndicator,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, Spacing } from "@/constants/theme";
import { supabase } from "@/lib/supabase";

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

const EXPORTS = [
  { id: "attendance_register", title: "Monthly Attendance Register", description: "Full P/A/L/WO grid for all employees", icon: "calendar", category: "Attendance", type: "rpc", target: "rpc_admin_attendance_daily_v3" },
  { id: "late_arrivals",       title: "Late Arrival Report",         description: "Late check-ins with delay minutes",     icon: "clock",    category: "Attendance", type: "rpc", target: "rpc_admin_attendance_daily_v3" },
  { id: "leave_usage",         title: "Leave Usage Report",          description: "Leaves taken per employee by type",     icon: "briefcase", category: "Leave & HR", type: "table", target: "leave_requests", select: "*, profiles(name, employee_number)", dateField: "start_date" },
  { id: "comp_off",            title: "Comp-Off & Overtime Report",  description: "Weekend/holiday work, comp-off earned", icon: "award",    category: "Leave & HR", type: "table", target: "comp_off_earnings", select: "*, profiles(name, employee_number)", dateField: "eligible_work_date" },
  { id: "field_visits",        title: "Field Visit Log",             description: "All field visits with GPS coordinates", icon: "map-pin",  category: "Field Activity", type: "table", target: "field_visits", select: "*, profiles(name, employee_number)", dateField: "date" },
  { id: "geofence_events",     title: "Geofence Events",             description: "Violations and entry/exit audit trail", icon: "map",      category: "Tracking",      type: "rpc", target: "rpc_geofence_report" },
];

export default function DownloadCentreScreen() {
  const { theme } = useTheme();
  const now = new Date();
  const [year, setYear]  = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [downloading, setDownloading] = useState<string | null>(null);

  const prevMonth = () => { if (month === 1) { setYear(y => y - 1); setMonth(12); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 12) { setYear(y => y + 1); setMonth(1); } else setMonth(m => m + 1); };

  const handleExport = async (opt: typeof EXPORTS[0]) => {
    if (typeof window === "undefined") {
      Alert.alert("Web Only", "CSV export is only available on the web version.");
      return;
    }
    setDownloading(opt.id);
    try {
      const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
      const endDay = new Date(year, month, 0).getDate();
      const endDate = `${year}-${String(month).padStart(2, "0")}-${String(endDay).padStart(2, "0")}`;
      
      let data, error;
      
      if (opt.type === "rpc") {
        const res = await (supabase.rpc as any)(opt.target, { p_start_date: startDate, p_end_date: endDate });
        data = res.data; error = res.error;
      } else {
        const res = await supabase.from(opt.target).select(opt.select!).gte(opt.dateField!, startDate).lte(opt.dateField!, endDate);
        data = res.data; error = res.error;
      }
      
      if (error) throw error;
      const rows = Array.isArray(data) ? data : (data ? [data] : []);
      if (rows.length === 0) { Alert.alert("No Data", "No records found for the selected period."); return; }
      
      // Flatten profiles object
      const flatRows = rows.map(r => {
        const flat = { ...r };
        if (flat.profiles) {
          flat.employee_name = flat.profiles.name;
          flat.employee_number = flat.profiles.employee_number;
          delete flat.profiles;
        }
        return flat;
      });
      
      const headers = Object.keys(flatRows[0]).join(",");
      const csvRows = flatRows.map((r: any) => Object.values(r).map((v: any) => {
        if (v === null || v === undefined) return '""';
        if (typeof v === 'object') return `"${JSON.stringify(v).replace(/"/g, '""')}"`;
        return `"${String(v).replace(/"/g, '""')}"`;
      }).join(","));
      
      const csv = [headers, ...csvRows].join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${opt.id}_${year}_${String(month).padStart(2, "0")}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: any) {
      Alert.alert("Export Failed", e?.message ?? "An unexpected error occurred.");
    } finally {
      setDownloading(null);
    }
  };

  const categories = [...new Set(EXPORTS.map(e => e.category))];

  return (
    <ScrollView style={[styles.root, { backgroundColor: theme.backgroundSecondary }]}>
      <View style={[styles.monthBar, { backgroundColor: theme.backgroundDefault, borderBottomColor: theme.border }]}>
        <Pressable onPress={prevMonth} style={styles.chevron}><Feather name="chevron-left" size={22} color={theme.primary} /></Pressable>
        <ThemedText type="h4" style={{ color: theme.text }}>{MONTH_NAMES[month - 1]} {year}</ThemedText>
        <Pressable onPress={nextMonth} style={styles.chevron}><Feather name="chevron-right" size={22} color={theme.primary} /></Pressable>
      </View>
      <View style={styles.body}>
        <ThemedText type="caption" style={[styles.hint, { color: theme.textSecondary }]}>
          Select a report to export as CSV for the selected month.
        </ThemedText>
        {categories.map(cat => (
          <View key={cat} style={styles.section}>
            <ThemedText style={[styles.catLabel, { color: theme.textSecondary }]}>{cat.toUpperCase()}</ThemedText>
            {EXPORTS.filter(e => e.category === cat).map(opt => {
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
                    <Feather name={opt.icon as any} size={20} color={theme.primary} />
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
  monthBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: Spacing.md, borderBottomWidth: 1 },
  chevron: { padding: Spacing.sm },
  body: { padding: Spacing.md, gap: 20 },
  hint: { marginBottom: 4 },
  section: { gap: 10 },
  catLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.6, marginLeft: 2, marginBottom: 2 },
  card: { flexDirection: "row", alignItems: "center", gap: 14, padding: 14, borderRadius: BorderRadius.lg, borderWidth: 1 },
  iconBox: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  cardText: { flex: 1 },
  cardTitle: { fontWeight: "700", marginBottom: 2 },
});
