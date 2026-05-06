import React, { useState, useCallback } from "react";
import {
  StyleSheet, View, FlatList, Pressable,
  Alert, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, Platform,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, Colors } from "@/constants/theme";
import Spacer from "@/components/Spacer";
import { supabase } from "@/lib/supabase";

interface AttendanceRecord {
  id: string;
  user_id: string;
  employee_name: string;
  employee_number?: string;
  office_name: string;
  date: string;
  checkin_time: string;
  checkout_time?: string;
  status: string;
  distance_from_office?: number;
  warning: boolean;
}

function fmt(iso?: string) {
  if (!iso) return "—";
  return iso.substring(11, 16);
}

function calcDuration(inTime?: string, outTime?: string): string {
  if (!inTime || !outTime) return "—";
  const mins = Math.round((new Date(outTime).getTime() - new Date(inTime).getTime()) / 60000);
  if (mins < 0) return "—";
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function fmtDate(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

function isoDate(d: Date) {
  return d.toISOString().split("T")[0];
}

const PRESETS = [
  { label: "Today",      getRange: () => { const t = isoDate(new Date()); return { s: t, e: t }; } },
  { label: "Yesterday",  getRange: () => { const d = new Date(); d.setDate(d.getDate()-1); const t = isoDate(d); return { s: t, e: t }; } },
  { label: "This Week",  getRange: () => { const d = new Date(); const day = d.getDay(); const mon = new Date(d); mon.setDate(d.getDate() - (day === 0 ? 6 : day - 1)); return { s: isoDate(mon), e: isoDate(new Date()) }; } },
  { label: "Last Week",  getRange: () => { const d = new Date(); const day = d.getDay(); const mon = new Date(d); mon.setDate(d.getDate() - (day === 0 ? 6 : day - 1) - 7); const sun = new Date(mon); sun.setDate(mon.getDate() + 6); return { s: isoDate(mon), e: isoDate(sun) }; } },
  { label: "This Month", getRange: () => { const d = new Date(); return { s: isoDate(new Date(d.getFullYear(), d.getMonth(), 1)), e: isoDate(new Date()) }; } },
  { label: "Last Month", getRange: () => { const d = new Date(); const f = new Date(d.getFullYear(), d.getMonth()-1, 1); const l = new Date(d.getFullYear(), d.getMonth(), 0); return { s: isoDate(f), e: isoDate(l) }; } },
];

export default function AttendanceControlScreenNew() {
  const { theme } = useTheme();
  const today = isoDate(new Date());
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [offices, setOffices] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [activePreset, setActivePreset] = useState("Today");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [officeFilter, setOfficeFilter] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set([today]));

  const loadData = useCallback(async (s = startDate, e = endDate) => {
    setLoading(true);
    const [recRes, offRes, empRes] = await Promise.all([
      supabase.from("admin_attendance_export").select("*").gte("date", s).lte("date", e).order("date", { ascending: false }).order("checkin_time", { ascending: false }),
      supabase.from("offices").select("id, name").eq("is_active", true),
      supabase.from("profiles").select("id, name").eq("is_active", true).order("name"),
    ]);
    let data = recRes.data || [];
    if (officeFilter) data = data.filter((r: any) => r.office_id === officeFilter);
    if (employeeFilter) data = data.filter((r: any) => r.user_id === employeeFilter);
    setRecords(data);
    setOffices(offRes.data || []);
    setEmployees(empRes.data || []);
    setLoading(false);
  }, [startDate, endDate, officeFilter, employeeFilter]);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const applyPreset = (preset: typeof PRESETS[0]) => {
    const { s, e } = preset.getRange();
    setStartDate(s);
    setEndDate(e);
    setActivePreset(preset.label);
    const dates = new Set<string>();
    const cur = new Date(s);
    const end = new Date(e);
    while (cur <= end) { dates.add(isoDate(cur)); cur.setDate(cur.getDate() + 1); }
    setExpandedDates(dates);
    loadData(s, e);
  };

  const toggleDate = (date: string) => {
    setExpandedDates((prev) => {
      const next = new Set(prev);
      next.has(date) ? next.delete(date) : next.add(date);
      return next;
    });
  };

  const grouped: { date: string; rows: AttendanceRecord[] }[] = [];
  const seen = new Set<string>();
  for (const r of records) {
    if (!seen.has(r.date)) { seen.add(r.date); grouped.push({ date: r.date, rows: [] }); }
    grouped.find((g) => g.date === r.date)!.rows.push(r);
  }

  const downloadCSV = async () => {
    if (records.length === 0) { Alert.alert("No Data", "No records to export for the selected period."); return; }
    setExporting(true);
    try {
      const userIds = [...new Set(records.map((r) => r.user_id))];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, employee_number")
        .in("id", userIds);
      const empNumMap: Record<string, string> = {};
      (profiles || []).forEach((p: any) => { empNumMap[p.id] = p.employee_number || ""; });

      const headers = [
        "Date",
        "Employee Name",
        "Employee ID",
        "Office",
        "Check In",
        "Check Out",
        "Duration",
        "Status",
        "Late",
        "Distance from Office (m)",
        "Warning",
      ];

      const rows = records.map((r) => {
        const isLate = r.checkin_time
          ? r.checkin_time.substring(11, 16) >= "10:30" ? "Yes" : "No"
          : "No";
        return [
          r.date,
          r.employee_name,
          empNumMap[r.user_id] || r.employee_number || "",
          r.office_name,
          r.checkin_time ? r.checkin_time.substring(0, 19).replace("T", " ") : "",
          r.checkout_time ? r.checkout_time.substring(0, 19).replace("T", " ") : "",
          calcDuration(r.checkin_time, r.checkout_time),
          r.status,
          isLate,
          r.distance_from_office ?? "",
          r.warning ? "Yes" : "No",
        ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",");
      });

      const csv = [headers.map((h) => `"${h}"`).join(","), ...rows].join("\n");
      const filename = `attendance_${startDate}_to_${endDate}.csv`;

      if (Platform.OS === "web") {
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        Alert.alert("✅ Downloaded", `${records.length} records exported to ${filename}`);
      } else {
        const { cacheDirectory, writeAsStringAsync } = await import("expo-file-system/legacy");
        const { shareAsync } = await import("expo-sharing");
        const path = (cacheDirectory ?? "") + filename;
        await writeAsStringAsync(path, csv);
        await shareAsync(path, { mimeType: "text/csv", dialogTitle: "Save Attendance Report" });
      }
    } catch (e: any) {
      Alert.alert("Error", "Export failed: " + (e?.message || "Unknown error"));
    } finally {
      setExporting(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.backgroundRoot }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={s.container} showsVerticalScrollIndicator={false}>

        <View style={s.headerRow}>
          <View>
            <ThemedText type="h3">Attendance Control</ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>{records.length} records loaded</ThemedText>
          </View>
        </View>

        <Spacer height={10} />

        <TouchableOpacity
          style={[s.downloadBanner, exporting && { opacity: 0.6 }]}
          onPress={downloadCSV}
          disabled={exporting}
          activeOpacity={0.85}
        >
          <View style={s.downloadBannerLeft}>
            {exporting
              ? <ActivityIndicator size="small" color="#fff" style={{ marginRight: 10 }} />
              : <View style={s.downloadIconCircle}>
                  <Feather name="download" size={18} color="#fff" />
                </View>
            }
            <View>
              <ThemedText style={s.downloadBannerTitle}>
                {exporting ? "Generating Report..." : "Download Attendance Report"}
              </ThemedText>
              <ThemedText style={s.downloadBannerSub}>
                {exporting ? "Please wait" : `${records.length} records · CSV with Name, ID, Time, Duration`}
              </ThemedText>
            </View>
          </View>
          {!exporting && <Feather name="chevron-right" size={20} color="rgba(255,255,255,0.8)" />}
        </TouchableOpacity>

        <Spacer height={12} />

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
          <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 2 }}>
            {PRESETS.map((p) => (
              <TouchableOpacity
                key={p.label}
                style={[s.preset, activePreset === p.label && { backgroundColor: theme.primary, borderColor: theme.primary }]}
                onPress={() => applyPreset(p)}
              >
                <ThemedText style={[s.presetText, activePreset === p.label && { color: "#fff" }]}>{p.label}</ThemedText>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>

        <View style={[s.filterCard, { backgroundColor: theme.backgroundDefault }]}>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1 }}>
              <ThemedText type="caption" style={{ color: theme.textSecondary, marginBottom: 4 }}>From</ThemedText>
              <TextInput
                style={[s.input, { backgroundColor: theme.backgroundRoot, color: theme.text }]}
                value={startDate} onChangeText={setStartDate}
                placeholder="YYYY-MM-DD" placeholderTextColor={theme.textSecondary}
              />
            </View>
            <View style={{ flex: 1 }}>
              <ThemedText type="caption" style={{ color: theme.textSecondary, marginBottom: 4 }}>To</ThemedText>
              <TextInput
                style={[s.input, { backgroundColor: theme.backgroundRoot, color: theme.text }]}
                value={endDate} onChangeText={setEndDate}
                placeholder="YYYY-MM-DD" placeholderTextColor={theme.textSecondary}
              />
            </View>
          </View>

          <Spacer height={10} />

          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            {[{ id: "", name: "All Offices" }, ...offices].map((o) => (
              <TouchableOpacity
                key={o.id}
                style={[s.chip, officeFilter === o.id && { backgroundColor: theme.primary, borderColor: theme.primary }]}
                onPress={() => setOfficeFilter(o.id)}
              >
                <ThemedText style={[s.chipText, officeFilter === o.id && { color: "#fff" }]}>{o.name}</ThemedText>
              </TouchableOpacity>
            ))}
          </View>

          <Spacer height={10} />

          <TouchableOpacity
            style={[s.applyBtn, { backgroundColor: theme.primary }]}
            onPress={() => { setActivePreset(""); loadData(); }}
          >
            <Feather name="search" size={14} color="#fff" />
            <ThemedText style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>Search</ThemedText>
          </TouchableOpacity>
        </View>

        <Spacer height={16} />

        {loading ? (
          <ThemedText style={{ textAlign: "center", color: theme.textSecondary, marginTop: 40 }}>Loading...</ThemedText>
        ) : grouped.length === 0 ? (
          <View style={s.empty}>
            <Feather name="calendar" size={40} color={theme.textSecondary} />
            <Spacer height={12} />
            <ThemedText style={{ color: theme.textSecondary }}>No records for this period</ThemedText>
          </View>
        ) : (
          grouped.map(({ date, rows }) => {
            const expanded = expandedDates.has(date);
            const presentCount = rows.filter((r) => r.status === "CHECKED_IN" || r.status === "CHECKED_OUT").length;
            const absentCount = employees.length - presentCount;
            return (
              <View key={date} style={{ marginBottom: 12 }}>
                <TouchableOpacity
                  style={[s.dateHeader, { backgroundColor: theme.primary }]}
                  onPress={() => toggleDate(date)}
                >
                  <View>
                    <ThemedText style={s.dateHeaderText}>{fmtDate(date)}</ThemedText>
                    <ThemedText style={s.dateHeaderSub}>
                      {rows.length} checked in · {absentCount > 0 ? `${absentCount} absent` : "all present"}
                    </ThemedText>
                  </View>
                  <Feather name={expanded ? "chevron-up" : "chevron-down"} size={18} color="#fff" />
                </TouchableOpacity>

                {expanded && rows.map((item) => {
                  const isLate = item.checkin_time && item.checkin_time.substring(11, 16) >= "10:30";
                  const statusColor = item.status === "CHECKED_OUT" ? Colors.light.success
                    : item.status === "CHECKED_IN" ? Colors.light.info
                    : Colors.light.error;
                  return (
                    <View key={item.id} style={[s.recordCard, { backgroundColor: theme.backgroundDefault }]}>
                      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <View style={{ flex: 1 }}>
                          <ThemedText style={s.empName}>{item.employee_name}</ThemedText>
                          <ThemedText style={[s.meta, { color: theme.textSecondary }]}>
                            {item.employee_number ? `#${item.employee_number} · ` : ""}{item.office_name}
                          </ThemedText>
                          <View style={{ flexDirection: "row", gap: 12, marginTop: 6 }}>
                            <View style={s.timeChip}>
                              <Feather name="log-in" size={11} color="#10B981" />
                              <ThemedText style={s.timeText}>{fmt(item.checkin_time)}</ThemedText>
                            </View>
                            {item.checkout_time ? (
                              <View style={s.timeChip}>
                                <Feather name="log-out" size={11} color="#EF4444" />
                                <ThemedText style={s.timeText}>{fmt(item.checkout_time)}</ThemedText>
                              </View>
                            ) : null}
                            {item.checkin_time && item.checkout_time ? (
                              <View style={s.timeChip}>
                                <Feather name="clock" size={11} color="#8B5CF6" />
                                <ThemedText style={[s.timeText, { color: "#8B5CF6" }]}>
                                  {calcDuration(item.checkin_time, item.checkout_time)}
                                </ThemedText>
                              </View>
                            ) : null}
                            {item.distance_from_office ? (
                              <View style={s.timeChip}>
                                <Feather name="map-pin" size={11} color="#6B7280" />
                                <ThemedText style={s.timeText}>{item.distance_from_office}m</ThemedText>
                              </View>
                            ) : null}
                          </View>
                        </View>
                        <View style={{ alignItems: "flex-end", gap: 4 }}>
                          <View style={[s.statusBadge, { backgroundColor: statusColor + "20" }]}>
                            <ThemedText style={[s.statusText, { color: statusColor }]}>
                              {item.status === "CHECKED_OUT" ? "Done" : item.status === "CHECKED_IN" ? "Active" : item.status}
                            </ThemedText>
                          </View>
                          {isLate && (
                            <View style={[s.statusBadge, { backgroundColor: Colors.light.warning + "20" }]}>
                              <ThemedText style={[s.statusText, { color: Colors.light.warning }]}>Late</ThemedText>
                            </View>
                          )}
                          {item.warning && <Feather name="alert-triangle" size={14} color={Colors.light.warning} />}
                        </View>
                      </View>
                    </View>
                  );
                })}
              </View>
            );
          })
        )}

        <Spacer height={80} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { padding: 16 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  downloadBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#059669",
    borderRadius: 14,
    padding: 16,
    marginBottom: 4,
    shadowColor: "#059669",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  downloadBannerLeft: { flexDirection: "row", alignItems: "center", flex: 1 },
  downloadIconCircle: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center", justifyContent: "center",
    marginRight: 12,
  },
  downloadBannerTitle: { color: "#fff", fontWeight: "800", fontSize: 15 },
  downloadBannerSub: { color: "rgba(255,255,255,0.8)", fontSize: 11, marginTop: 2 },
  preset: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: "#E5E7EB", backgroundColor: "#F9FAFB" },
  presetText: { fontSize: 13, fontWeight: "600", color: "#374151" },
  filterCard: { borderRadius: 12, padding: 14 },
  input: { padding: 10, borderRadius: 8, fontSize: 14 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1.5, borderColor: "#E5E7EB", backgroundColor: "#F9FAFB" },
  chipText: { fontSize: 12, fontWeight: "600", color: "#374151" },
  applyBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 8 },
  dateHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 14, borderRadius: 10, marginBottom: 2 },
  dateHeaderText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  dateHeaderSub: { color: "rgba(255,255,255,0.75)", fontSize: 11, marginTop: 2 },
  recordCard: { padding: 14, borderRadius: 10, marginBottom: 2, borderLeftWidth: 3, borderLeftColor: "#E5E7EB" },
  empName: { fontSize: 14, fontWeight: "700", color: "#111" },
  meta: { fontSize: 12, marginTop: 2 },
  timeChip: { flexDirection: "row", alignItems: "center", gap: 4 },
  timeText: { fontSize: 12, color: "#374151", fontWeight: "600" },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  statusText: { fontSize: 11, fontWeight: "700" },
  empty: { alignItems: "center", paddingTop: 60 },
});
