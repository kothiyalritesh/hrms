import React, { useState, useCallback } from "react";
import {
  View, StyleSheet, ScrollView, TouchableOpacity,
  Modal, Platform, TextInput, ActivityIndicator, RefreshControl, Alert,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { supabase } from "@/lib/supabase";

// ── helpers ──────────────────────────────────────────────────────────────────
function isoDate(d: Date) { return d.toISOString().split("T")[0]; }
function fmtTime(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true });
}
function fmtDate(s: string) {
  return new Date(s + "T00:00:00").toLocaleDateString("en-IN", {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
  });
}

const STATUS_COLOR: Record<string, { bg: string; text: string; label: string }> = {
  PENDING:    { bg: "#FEF3C7", text: "#D97706", label: "En Route" },
  CHECKED_IN: { bg: "#DBEAFE", text: "#2563EB", label: "At Location" },
  COMPLETED:  { bg: "#D1FAE5", text: "#059669", label: "Completed" },
  MISSED:     { bg: "#FEE2E2", text: "#DC2626", label: "Missed" },
};

const PRESETS = [
  { label: "Today",      range: () => { const t = isoDate(new Date()); return [t, t]; } },
  { label: "Yesterday",  range: () => { const d = new Date(); d.setDate(d.getDate()-1); const t = isoDate(d); return [t, t]; } },
  { label: "This Week",  range: () => { const d = new Date(); const mon = new Date(d); mon.setDate(d.getDate() - (d.getDay()||7) + 1); return [isoDate(mon), isoDate(new Date())]; } },
  { label: "This Month", range: () => { const d = new Date(); return [isoDate(new Date(d.getFullYear(), d.getMonth(), 1)), isoDate(d)]; } },
  { label: "Last Month", range: () => { const d = new Date(); const f = new Date(d.getFullYear(), d.getMonth()-1, 1); const l = new Date(d.getFullYear(), d.getMonth(), 0); return [isoDate(f), isoDate(l)]; } },
  { label: "Sundays",    range: () => { const d = new Date(); return [isoDate(new Date(d.getFullYear(), d.getMonth(), 1)), isoDate(d)]; } },
];

// ── Detail Modal ──────────────────────────────────────────────────────────────
function DetailModal({ visit, onClose }: { visit: any; onClose: () => void }) {
  if (!visit) return null;
  const sc = STATUS_COLOR[visit.status] || STATUS_COLOR.PENDING;
  const lat = visit.checkin_location?.latitude ?? visit.destination_coords?.latitude;
  const lng = visit.checkin_location?.longitude ?? visit.destination_coords?.longitude;
  const hasMap = lat != null && lng != null;

  return (
    <Modal visible animationType="slide" transparent presentationStyle="overFullScreen">
      <View style={d.overlay}>
        <View style={d.sheet}>
          {/* header */}
          <View style={d.header}>
            <View style={d.handle} />
            <View style={d.headerRow}>
              <ThemedText style={d.title} numberOfLines={1}>{visit.location_name}</ThemedText>
              <TouchableOpacity onPress={onClose} style={{ padding: 4 }}>
                <Feather name="x" size={20} color="#6B7280" />
              </TouchableOpacity>
            </View>
            <View style={[d.badge, { backgroundColor: sc.bg }]}>
              <ThemedText style={[d.badgeTxt, { color: sc.text }]}>{sc.label}</ThemedText>
            </View>
          </View>

          <ScrollView style={d.body} showsVerticalScrollIndicator={false}>
            {/* employee */}
            <View style={d.section}>
              <Row icon="user" label="Employee" value={visit.profiles?.name || "—"} />
              <Row icon="hash" label="Emp No." value={visit.profiles?.employee_number || "—"} />
              <Row icon="tag" label="Type" value={`${visit.visit_type === "site" ? "🏗️ Site" : visit.visit_type === "office" ? "🏢 Office" : "🤝 Meeting"}${visit.meeting_type === "client" ? " · 👤 Client" : visit.meeting_type === "channel_partner" ? " · 🏘️ CP" : ""}`} />
              {visit.contact_name ? <Row icon="phone" label="Contact" value={`${visit.contact_name}${visit.contact_phone ? " · " + visit.contact_phone : ""}`} /> : null}
              {visit.project_name ? <Row icon="home" label="Project" value={visit.project_name} /> : null}
              {visit.location_address ? <Row icon="map-pin" label="Address" value={visit.location_address} /> : null}
            </View>

            {/* journey */}
            {visit.from_location_name ? (
              <View style={d.section}>
                <Row icon="navigation" label="From" value={visit.from_location_name} color="#6B7280" />
                <Row icon="map-pin" label="To" value={visit.location_name} color="#60045d" />
                <Row
                  icon="check-circle"
                  label="Arrived"
                  value={visit.arrived ? "✅ Yes — Checked In" : visit.status === "MISSED" ? "❌ No — Missed" : "⏳ Pending"}
                  color={visit.arrived ? "#059669" : visit.status === "MISSED" ? "#DC2626" : "#D97706"}
                />
                {visit.from_coords?.latitude ? (
                  <Row icon="crosshair" label="From GPS" value={`${visit.from_coords.latitude.toFixed(5)}, ${visit.from_coords.longitude.toFixed(5)}`} color="#6B7280" />
                ) : null}
              </View>
            ) : null}

            {/* times */}
            <View style={d.section}>
              <Row icon="calendar" label="Date" value={fmtDate(visit.date)} />
              <Row icon="log-in" label="Check In" value={fmtTime(visit.checkin_time)} color="#059669" />
              <Row icon="log-out" label="Check Out" value={fmtTime(visit.checkout_time)} color="#DC2626" />
              {visit.checkin_location?.latitude
                ? <Row icon="crosshair" label="GPS" value={`${visit.checkin_location.latitude.toFixed(5)}, ${visit.checkin_location.longitude.toFixed(5)}`} color="#059669" />
                : null}
            </View>

            {/* map */}
            {hasMap && Platform.OS === "web" && (
              <View style={d.mapWrap}>
                <ThemedText style={d.mapLabel}>📍 Check-in Location</ThemedText>
                {/* @ts-ignore */}
                <iframe
                  title="map"
                  src={`https://www.openstreetmap.org/export/embed.html?bbox=${lng-0.006},${lat-0.006},${lng+0.006},${lat+0.006}&layer=mapnik&marker=${lat},${lng}`}
                  style={{ width: "100%", height: 220, border: "none", borderRadius: 12 }}
                />
              </View>
            )}
            {hasMap && Platform.OS !== "web" && (
              <View style={d.mapWrap}>
                <ThemedText style={d.mapLabel}>📍 Check-in Location</ThemedText>
                <View style={d.mapNative}>
                  <Feather name="map-pin" size={28} color="#60045d" />
                  <ThemedText style={{ fontSize: 13, color: "#1E40AF", fontWeight: "600", marginTop: 6 }}>{lat?.toFixed(5)}, {lng?.toFixed(5)}</ThemedText>
                </View>
              </View>
            )}

            {/* notes */}
            {visit.checkout_notes ? (
              <View style={d.notesBox}>
                <ThemedText style={d.notesLabel}>📝 Notes</ThemedText>
                <ThemedText style={d.notesText}>{visit.checkout_notes}</ThemedText>
              </View>
            ) : null}

            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function Row({ icon, label, value, color }: { icon: any; label: string; value: string; color?: string }) {
  return (
    <View style={d.row}>
      <Feather name={icon} size={13} color={color || "#9CA3AF"} style={{ marginTop: 1 }} />
      <ThemedText style={d.rowLabel}>{label}</ThemedText>
      <ThemedText style={[d.rowValue, color ? { color } : {}]} numberOfLines={3}>{value}</ThemedText>
    </View>
  );
}

const d = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "92%" },
  header: { padding: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#E5E7EB", alignSelf: "center", marginBottom: 14 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { flex: 1, fontSize: 17, fontWeight: "800", color: "#111", marginRight: 8 },
  badge: { alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, marginTop: 8 },
  badgeTxt: { fontSize: 12, fontWeight: "700" },
  body: { paddingHorizontal: 20 },
  section: { marginTop: 16, borderBottomWidth: 1, borderBottomColor: "#F3F4F6", paddingBottom: 8 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: "#F9FAFB" },
  rowLabel: { fontSize: 12, color: "#9CA3AF", width: 72 },
  rowValue: { flex: 1, fontSize: 13, fontWeight: "600", color: "#111" },
  mapWrap: { marginTop: 16 },
  mapLabel: { fontSize: 12, fontWeight: "700", color: "#6B7280", marginBottom: 8 },
  mapNative: { height: 120, backgroundColor: "#EFF6FF", borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#BFDBFE" },
  notesBox: { backgroundColor: "#F0F9FF", borderRadius: 10, padding: 12, marginTop: 14, borderLeftWidth: 3, borderLeftColor: "#3B82F6" },
  notesLabel: { fontSize: 12, fontWeight: "700", color: "#1E40AF", marginBottom: 6 },
  notesText: { fontSize: 13, color: "#1E3A8A", lineHeight: 19 },
});

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function FieldVisitAdminScreen() {
  const today = isoDate(new Date());
  const [visits, setVisits] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [activePreset, setActivePreset] = useState("Today");
  const [empFilter, setEmpFilter] = useState("");
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set([today]));
  const [selected, setSelected] = useState<any>(null);
  const [downloading, setDownloading] = useState(false);
  const [showDownloadSheet, setShowDownloadSheet] = useState(false);

  // ── Download helpers ─────────────────────────────────────────────────────
  function fmtDuration(inTime?: string | null, outTime?: string | null) {
    if (!inTime || !outTime) return "—";
    const mins = Math.round((new Date(outTime).getTime() - new Date(inTime).getTime()) / 60000);
    if (mins < 0) return "—";
    if (mins < 60) return `${mins}m`;
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  }

  function isSunday(dateStr: string) {
    return new Date(dateStr + "T00:00:00").getDay() === 0;
  }

  const buildCSV = (data: any[], label: string) => {
    const headers = [
      "Day", "Date", "Employee", "Emp No.", "Role",
      "From Location", "From GPS Lat", "From GPS Lng",
      "To Location", "Address", "Visit Type", "Meeting Type",
      "Contact", "Contact Phone", "Project",
      "Check-in Time", "Check-out Time", "Duration",
      "GPS Lat (In)", "GPS Lng (In)", "GPS Lat (Out)", "GPS Lng (Out)",
      "Arrived", "Status", "Notes",
    ];
    const rows = data.map((v: any) => [
      new Date(v.date + "T00:00:00").toLocaleDateString("en-IN", { weekday: "long" }),
      v.date,
      v.profiles?.name || "",
      v.profiles?.employee_number || "",
      v.profiles?.role || "",
      v.from_location_name || "",
      v.from_coords?.latitude ?? "",
      v.from_coords?.longitude ?? "",
      v.location_name || "",
      v.location_address || "",
      v.visit_type || "",
      v.meeting_type || "",
      v.contact_name || "",
      v.contact_phone || "",
      v.project_name || "",
      v.checkin_time ? new Date(v.checkin_time).toLocaleString("en-IN") : "",
      v.checkout_time ? new Date(v.checkout_time).toLocaleString("en-IN") : "",
      fmtDuration(v.checkin_time, v.checkout_time),
      v.checkin_location?.latitude ?? "",
      v.checkin_location?.longitude ?? "",
      v.checkout_location?.latitude ?? "",
      v.checkout_location?.longitude ?? "",
      v.arrived ? "Yes" : (v.status === "MISSED" ? "No" : "Pending"),
      v.status || "",
      (v.checkout_notes || v.notes || "").replace(/\n/g, " "),
    ]);
    return [
      headers.map(h => `"${h}"`).join(","),
      ...rows.map(r => r.map((c: any) => `"${String(c).replace(/"/g, '""')}"`).join(",")),
    ].join("\n");
  };

  const saveCSV = async (csv: string, filename: string) => {
    if (Platform.OS === "web") {
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    } else {
      const { cacheDirectory, writeAsStringAsync } = await import("expo-file-system/legacy");
      const { shareAsync } = await import("expo-sharing");
      const path = (cacheDirectory ?? "") + filename;
      await writeAsStringAsync(path, csv);
      await shareAsync(path, { mimeType: "text/csv", dialogTitle: "Save Report" });
    }
  };

  const downloadReport = async (mode: "overall" | "per_person" | "sundays" | "day_wise") => {
    setShowDownloadSheet(false);
    setDownloading(true);
    try {
      let q = supabase
        .from("field_visits")
        .select("*, profiles:user_id(name, employee_number, role)")
        .gte("date", startDate)
        .lte("date", endDate)
        .order("date", { ascending: true })
        .order("checkin_time", { ascending: true });
      if (empFilter) q = q.eq("user_id", empFilter);
      const { data, error } = await q;
      if (error) throw error;
      if (!data || data.length === 0) {
        Alert.alert("No Data", "No visits found for the selected period.");
        return;
      }

      if (mode === "overall") {
        // Single CSV — all visits sorted by date then employee
        const csv = buildCSV(data, "overall");
        await saveCSV(csv, `site_visits_overall_${startDate}_to_${endDate}.csv`);

      } else if (mode === "per_person") {
        // One CSV per employee — group and download each
        const byEmp: Record<string, any[]> = {};
        data.forEach((v: any) => {
          const key = v.user_id;
          if (!byEmp[key]) byEmp[key] = [];
          byEmp[key].push(v);
        });
        for (const [, rows] of Object.entries(byEmp)) {
          const name = (rows[0].profiles?.name || "unknown").replace(/[^a-zA-Z0-9]/g, "_");
          const empNo = rows[0].profiles?.employee_number || "";
          const csv = buildCSV(rows, name);
          await saveCSV(csv, `site_visits_${name}${empNo ? "_" + empNo : ""}_${startDate}_to_${endDate}.csv`);
        }
        Alert.alert("✅ Done", `Downloaded ${Object.keys(byEmp).length} employee report(s).`);
        return;

      } else if (mode === "sundays") {
        // Only Sunday visits
        const sundayData = data.filter((v: any) => isSunday(v.date));
        if (sundayData.length === 0) {
          Alert.alert("No Sunday Visits", "No visits found on Sundays in this period.");
          return;
        }
        const csv = buildCSV(sundayData, "sundays");
        await saveCSV(csv, `site_visits_sundays_${startDate}_to_${endDate}.csv`);

      } else if (mode === "day_wise") {
        // One CSV per day
        const byDate: Record<string, any[]> = {};
        data.forEach((v: any) => {
          if (!byDate[v.date]) byDate[v.date] = [];
          byDate[v.date].push(v);
        });
        for (const [date, rows] of Object.entries(byDate)) {
          const dayName = new Date(date + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short" });
          const csv = buildCSV(rows, date);
          await saveCSV(csv, `site_visits_${date}_${dayName}.csv`);
        }
        Alert.alert("✅ Done", `Downloaded ${Object.keys(byDate).length} day-wise report(s).`);
        return;
      }

      Alert.alert("✅ Downloaded", "Report saved successfully.");
    } catch (e: any) {
      Alert.alert("Error", "Failed to generate report: " + e.message);
    } finally {
      setDownloading(false);
    }
  };

  const load = useCallback(async (s = startDate, e = endDate, emp = empFilter) => {
    setLoading(true);
    let q = supabase
      .from("field_visits")
      .select("*, profiles:user_id(name, employee_number, role)")
      .gte("date", s)
      .lte("date", e)
      .order("date", { ascending: false })
      .order("created_at", { ascending: true });
    if (emp) q = q.eq("user_id", emp);
    const { data, error } = await q;
    if (error) {
      setLoading(false);
      return;
    }
    setVisits(data || []);
    const { data: emps } = await supabase.from("profiles").select("id, name").eq("is_active", true).order("name");
    setEmployees(emps || []);
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const applyPreset = (p: typeof PRESETS[0]) => {
    const [s, e] = p.range();
    setStartDate(s); setEndDate(e); setActivePreset(p.label);
    const dates = new Set<string>();
    const cur = new Date(s); const end = new Date(e);
    while (cur <= end) { dates.add(isoDate(cur)); cur.setDate(cur.getDate() + 1); }
    setExpandedDates(dates);
    load(s, e, empFilter);
  };

  const toggleDate = (date: string) =>
    setExpandedDates(prev => { const n = new Set(prev); n.has(date) ? n.delete(date) : n.add(date); return n; });

  // group by date
  const grouped: { date: string; rows: any[] }[] = [];
  const seen = new Set<string>();
  for (const v of visits) {
    if (!seen.has(v.date)) { seen.add(v.date); grouped.push({ date: v.date, rows: [] }); }
    grouped.find(g => g.date === v.date)!.rows.push(v);
  }

  const totalToday = visits.filter(v => v.date === today).length;
  const completedToday = visits.filter(v => v.date === today && v.status === "COMPLETED").length;

  return (
    <ThemedView style={s.root}>
      <DetailModal visit={selected} onClose={() => setSelected(null)} />

      <ScrollView
        contentContainerStyle={s.container}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor="#60045d" />}
      >
        {/* summary strip */}
        <View style={s.summaryRow}>
          {[
            { label: "Total", val: visits.length, color: "#60045d" },
            { label: "Completed", val: visits.filter(v => v.status === "COMPLETED").length, color: "#059669" },
            { label: "Active", val: visits.filter(v => v.status === "CHECKED_IN").length, color: "#2563EB" },
            { label: "Missed", val: visits.filter(v => v.status === "MISSED").length, color: "#DC2626" },
          ].map((item, i) => (
            <React.Fragment key={item.label}>
              {i > 0 && <View style={s.summaryDiv} />}
              <View style={s.summaryCell}>
                <ThemedText style={[s.summaryN, { color: item.color }]}>{item.val}</ThemedText>
                <ThemedText style={s.summaryL}>{item.label}</ThemedText>
              </View>
            </React.Fragment>
          ))}
        </View>

        {/* Download Report Button */}
        <TouchableOpacity
          style={[s.downloadBtn, downloading && { opacity: 0.6 }]}
          onPress={() => setShowDownloadSheet(true)}
          disabled={downloading}
        >
          {downloading
            ? <ActivityIndicator size="small" color="#fff" />
            : <Feather name="download" size={15} color="#fff" />}
          <ThemedText style={s.downloadBtnTxt}>
            {downloading ? "Generating..." : `Download Report (${visits.length} visits)`}
          </ThemedText>
        </TouchableOpacity>

        {/* Download Options Sheet */}
        <Modal visible={showDownloadSheet} transparent animationType="slide" onRequestClose={() => setShowDownloadSheet(false)}>
          <TouchableOpacity style={s.sheetOverlay} activeOpacity={1} onPress={() => setShowDownloadSheet(false)}>
            <View style={s.sheet}>
              <View style={s.sheetHandle} />
              <ThemedText style={s.sheetTitle}>Download Site Visit Report</ThemedText>
              <ThemedText style={s.sheetSub}>
                {startDate === endDate ? fmtDate(startDate) : `${fmtDate(startDate)} – ${fmtDate(endDate)}`}
                {empFilter ? ` · ${employees.find(e => e.id === empFilter)?.name || "Selected Employee"}` : " · All Employees"}
              </ThemedText>

              {[
                { mode: "overall" as const,     icon: "file-text",  color: "#059669", title: "Overall Report",       sub: "All visits in one CSV, sorted by date" },
                { mode: "per_person" as const,  icon: "users",      color: "#2563EB", title: "Per Person",           sub: "One CSV file per employee" },
                { mode: "sundays" as const,     icon: "sun",        color: "#D97706", title: "Sundays Only",         sub: "Only visits that happened on Sundays" },
                { mode: "day_wise" as const,    icon: "calendar",   color: "#7C3AED", title: "Day-wise",             sub: "One CSV file per day" },
              ].map(opt => (
                <TouchableOpacity
                  key={opt.mode}
                  style={s.sheetOption}
                  onPress={() => downloadReport(opt.mode)}
                >
                  <View style={[s.sheetOptionIcon, { backgroundColor: opt.color + "18" }]}>
                    <Feather name={opt.icon as any} size={20} color={opt.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <ThemedText style={s.sheetOptionTitle}>{opt.title}</ThemedText>
                    <ThemedText style={s.sheetOptionSub}>{opt.sub}</ThemedText>
                  </View>
                  <Feather name="chevron-right" size={16} color="#9CA3AF" />
                </TouchableOpacity>
              ))}

              <TouchableOpacity style={s.sheetCancel} onPress={() => setShowDownloadSheet(false)}>
                <ThemedText style={s.sheetCancelTxt}>Cancel</ThemedText>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>

        {/* presets */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
          <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 2 }}>
            {PRESETS.map(p => (
              <TouchableOpacity
                key={p.label}
                style={[s.preset, activePreset === p.label && s.presetActive]}
                onPress={() => applyPreset(p)}
              >
                <ThemedText style={[s.presetTxt, activePreset === p.label && s.presetTxtActive]}>{p.label}</ThemedText>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>

        {/* date range + employee filter */}
        <View style={s.filterCard}>
          <View style={{ flexDirection: "row", gap: 10, marginBottom: 10 }}>
            <View style={{ flex: 1 }}>
              <ThemedText style={s.filterLabel}>From</ThemedText>
              {Platform.OS === "web" ? (
                // @ts-ignore
                <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                  style={{ padding: "8px 10px", borderRadius: 8, border: "1.5px solid #E5E7EB", fontSize: 14, color: "#111", backgroundColor: "#F9FAFB", width: "100%" }} />
              ) : (
                <TextInput style={s.input} value={startDate} onChangeText={setStartDate} placeholder="YYYY-MM-DD" placeholderTextColor="#9CA3AF" />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <ThemedText style={s.filterLabel}>To</ThemedText>
              {Platform.OS === "web" ? (
                // @ts-ignore
                <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                  style={{ padding: "8px 10px", borderRadius: 8, border: "1.5px solid #E5E7EB", fontSize: 14, color: "#111", backgroundColor: "#F9FAFB", width: "100%" }} />
              ) : (
                <TextInput style={s.input} value={endDate} onChangeText={setEndDate} placeholder="YYYY-MM-DD" placeholderTextColor="#9CA3AF" />
              )}
            </View>
          </View>

          {/* employee chips */}
          <ThemedText style={[s.filterLabel, { marginBottom: 6 }]}>Employee</ThemedText>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: "row", gap: 6 }}>
              {[{ id: "", name: "All" }, ...employees].map(emp => (
                <TouchableOpacity
                  key={emp.id}
                  style={[s.chip, empFilter === emp.id && s.chipActive]}
                  onPress={() => setEmpFilter(emp.id)}
                >
                  <ThemedText style={[s.chipTxt, empFilter === emp.id && s.chipTxtActive]}>{emp.name}</ThemedText>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          <TouchableOpacity style={s.searchBtn} onPress={() => { setActivePreset(""); load(startDate, endDate, empFilter); }}>
            <Feather name="search" size={14} color="#fff" />
            <ThemedText style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>Search</ThemedText>
          </TouchableOpacity>
        </View>

        {/* results */}
        {loading ? (
          <ActivityIndicator color="#60045d" style={{ marginTop: 40 }} />
        ) : grouped.length === 0 ? (
          <View style={s.empty}>
            <Feather name="map" size={40} color="#D1D5DB" />
            <ThemedText style={s.emptyTxt}>No field visits for this period</ThemedText>
          </View>
        ) : (
          grouped.map(({ date, rows }) => {
            const expanded = expandedDates.has(date);
            const done = rows.filter(r => r.status === "COMPLETED").length;
            const active = rows.filter(r => r.status === "CHECKED_IN").length;
            const missed = rows.filter(r => r.status === "MISSED").length;
            return (
              <View key={date} style={{ marginBottom: 10 }}>
                {/* date header */}
                <TouchableOpacity style={s.dateHeader} onPress={() => toggleDate(date)} activeOpacity={0.85}>
                  <View>
                    <ThemedText style={s.dateHeaderTxt}>{fmtDate(date)}</ThemedText>
                    <ThemedText style={s.dateHeaderSub}>
                      {rows.length} visits · {done} done{active ? ` · ${active} active` : ""}{missed ? ` · ${missed} missed` : ""}
                    </ThemedText>
                  </View>
                  <Feather name={expanded ? "chevron-up" : "chevron-down"} size={18} color="#fff" />
                </TouchableOpacity>

                {expanded && rows.map(visit => {
                  const sc = STATUS_COLOR[visit.status] || STATUS_COLOR.PENDING;
                  const hasGps = !!(visit.checkin_location?.latitude);
                  return (
                    <TouchableOpacity
                      key={visit.id}
                      style={s.card}
                      onPress={() => setSelected(visit)}
                      activeOpacity={0.82}
                    >
                      {/* top row */}
                      <View style={s.cardTop}>
                        <View style={{ flex: 1 }}>
                          <ThemedText style={s.empName}>{visit.profiles?.name || "—"}</ThemedText>
                          <ThemedText style={s.empSub}>{visit.profiles?.employee_number || ""}</ThemedText>
                        </View>
                        <View style={[s.statusBadge, { backgroundColor: sc.bg }]}>
                          <ThemedText style={[s.statusTxt, { color: sc.text }]}>{sc.label}</ThemedText>
                        </View>
                      </View>

                      {/* location */}
                      <View style={s.locRow}>
                        <Feather name="map-pin" size={13} color="#60045d" />
                        <ThemedText style={s.locName} numberOfLines={1}>{visit.location_name}</ThemedText>
                        <View style={[s.typePill, { backgroundColor: visit.visit_type === "site" ? "#D1FAE5" : visit.visit_type === "office" ? "#F5EEF5" : "#EFF6FF" }]}>
                          <ThemedText style={[s.typeTxt, { color: visit.visit_type === "site" ? "#065F46" : visit.visit_type === "office" ? "#60045d" : "#1E40AF" }]}>
                            {visit.visit_type === "site" ? "Site" : visit.visit_type === "office" ? "Office" : "Meeting"}
                          </ThemedText>
                        </View>
                      </View>

                      {visit.from_location_name ? (
                        <View style={s.journeyRow}>
                          <Feather name="navigation" size={10} color="#9CA3AF" />
                          <ThemedText style={s.journeyTxt} numberOfLines={1}>
                            {visit.from_location_name} → {visit.location_name}
                          </ThemedText>
                          <View style={[s.arrivedPill, { backgroundColor: visit.arrived ? "#D1FAE5" : visit.status === "MISSED" ? "#FEE2E2" : "#FEF3C7" }]}>
                            <ThemedText style={[s.arrivedTxt, { color: visit.arrived ? "#065F46" : visit.status === "MISSED" ? "#DC2626" : "#D97706" }]}>
                              {visit.arrived ? "Arrived" : visit.status === "MISSED" ? "Missed" : "En Route"}
                            </ThemedText>
                          </View>
                        </View>
                      ) : null}

                      {visit.location_address ? (
                        <ThemedText style={s.addrTxt} numberOfLines={1}>📌 {visit.location_address}</ThemedText>
                      ) : null}

                      {/* times */}
                      <View style={s.timesRow}>
                        <View style={s.timeChip}>
                          <Feather name="log-in" size={11} color="#059669" />
                          <ThemedText style={s.timeTxt}>In: {fmtTime(visit.checkin_time)}</ThemedText>
                        </View>
                        <View style={s.timeChip}>
                          <Feather name="log-out" size={11} color="#DC2626" />
                          <ThemedText style={s.timeTxt}>Out: {fmtTime(visit.checkout_time)}</ThemedText>
                        </View>
                        {hasGps && (
                          <View style={s.timeChip}>
                            <Feather name="crosshair" size={11} color="#2563EB" />
                            <ThemedText style={[s.timeTxt, { color: "#2563EB" }]}>GPS</ThemedText>
                          </View>
                        )}
                      </View>

                      <ThemedText style={s.tapHint}>Tap for details & map →</ThemedText>
                    </TouchableOpacity>
                  );
                })}
              </View>
            );
          })
        )}

        <View style={{ height: 80 }} />
      </ScrollView>
    </ThemedView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#F3F4F6" },
  container: { padding: 14 },
  summaryRow: { flexDirection: "row", backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: "#E5E7EB" },
  summaryCell: { flex: 1, alignItems: "center" },
  summaryN: { fontSize: 20, fontWeight: "800" },
  summaryL: { fontSize: 10, color: "#9CA3AF", marginTop: 2 },
  summaryDiv: { width: 1, backgroundColor: "#E5E7EB" },
  preset: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: "#E5E7EB", backgroundColor: "#F9FAFB" },
  presetActive: { backgroundColor: "#60045d", borderColor: "#60045d" },
  presetTxt: { fontSize: 13, fontWeight: "600", color: "#374151" },
  presetTxtActive: { color: "#fff" },
  filterCard: { backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: "#E5E7EB" },
  filterLabel: { fontSize: 12, fontWeight: "600", color: "#6B7280", marginBottom: 4 },
  input: { borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 8, padding: 10, fontSize: 14, color: "#111", backgroundColor: "#F9FAFB" },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1.5, borderColor: "#E5E7EB", backgroundColor: "#F9FAFB" },
  chipActive: { backgroundColor: "#60045d", borderColor: "#60045d" },
  chipTxt: { fontSize: 12, fontWeight: "600", color: "#374151" },
  chipTxtActive: { color: "#fff" },
  searchBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: "#60045d", borderRadius: 8, paddingVertical: 10, marginTop: 12 },
  dateHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: "#60045d", padding: 14, borderRadius: 10, marginBottom: 2 },
  dateHeaderTxt: { color: "#fff", fontWeight: "700", fontSize: 14 },
  dateHeaderSub: { color: "rgba(255,255,255,0.75)", fontSize: 11, marginTop: 2 },
  card: { backgroundColor: "#fff", borderRadius: 10, padding: 14, marginBottom: 2, borderLeftWidth: 3, borderLeftColor: "#60045d" },
  cardTop: { flexDirection: "row", alignItems: "flex-start", marginBottom: 8 },
  empName: { fontSize: 14, fontWeight: "700", color: "#111" },
  empSub: { fontSize: 11, color: "#9CA3AF", marginTop: 1 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  statusTxt: { fontSize: 11, fontWeight: "700" },
  locRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  locName: { flex: 1, fontSize: 13, fontWeight: "600", color: "#374151" },
  typePill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  typeTxt: { fontSize: 11, fontWeight: "700" },
  addrTxt: { fontSize: 11, color: "#6B7280", marginBottom: 6 },
  journeyRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6, flexWrap: "wrap" },
  journeyTxt: { flex: 1, fontSize: 11, color: "#6B7280" },
  arrivedPill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  arrivedTxt: { fontSize: 10, fontWeight: "700" },
  timesRow: { flexDirection: "row", gap: 12, marginTop: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: "#F3F4F6" },
  timeChip: { flexDirection: "row", alignItems: "center", gap: 4 },
  timeTxt: { fontSize: 12, color: "#374151", fontWeight: "600" },
  tapHint: { fontSize: 11, color: "#60045d", textAlign: "right", marginTop: 6, fontWeight: "600" },
  empty: { alignItems: "center", paddingTop: 60, gap: 12 },
  emptyTxt: { fontSize: 14, color: "#9CA3AF" },
  downloadBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, backgroundColor: "#059669", borderRadius: 10,
    paddingVertical: 12, marginBottom: 12,
  },
  downloadBtnTxt: { color: "#fff", fontWeight: "700", fontSize: 14 },
  sheetOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 36 },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#E5E7EB", alignSelf: "center", marginBottom: 16 },
  sheetTitle: { fontSize: 17, fontWeight: "800", color: "#111", marginBottom: 4 },
  sheetSub: { fontSize: 12, color: "#6B7280", marginBottom: 18 },
  sheetOption: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  sheetOptionIcon: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  sheetOptionTitle: { fontSize: 15, fontWeight: "700", color: "#111" },
  sheetOptionSub: { fontSize: 12, color: "#6B7280", marginTop: 2 },
  sheetCancel: { marginTop: 16, alignItems: "center", paddingVertical: 12, borderRadius: 10, backgroundColor: "#F3F4F6" },
  sheetCancelTxt: { fontSize: 15, fontWeight: "700", color: "#374151" },
});
