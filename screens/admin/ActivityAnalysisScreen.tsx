import React, { useState, useEffect } from "react";
import {
  View, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, Platform, Alert, TextInput,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { ThemedView } from "@/components/ThemedView";
import { ThemedText } from "@/components/ThemedText";
import { ActivityService } from "@/services/activity.service";
import { supabase } from "@/lib/supabase";
import { BusinessClockService } from "@/services/business-clock.service";
import { addBusinessDays, formatBusinessDate } from "@/utils/businessDate";
import { formatHrmsTime } from "@/utils/attendanceTimestamp";

function fmtTime(iso?: string | null) {
  if (!iso) return "—";
  return formatHrmsTime(iso, "No time recorded");
}
const ACT_COLORS: Record<string, string> = {
  SITE_VISIT: "#10B981", CLIENT_MEETING: "#3B82F6",
  CHANNEL_PARTNER_MEETING: "#8B5CF6", INTERNAL_MEETING: "#F59E0B",
  TRAVEL: "#EF4444", OFFICE_WORK: "#6B7280", OTHER: "#9CA3AF",
};

export default function ActivityAnalysisScreen({ navigation }: any) {
  const [date, setDate] = useState("");
  const [allLogs, setAllLogs] = useState<any[]>([]);
  const [offices, setOffices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [officeFilter, setOfficeFilter] = useState(""); // stores office NAME
  const [searchText, setSearchText] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);

  useEffect(() => {
    if (!date) {
      BusinessClockService.getDate(true)
        .then(setDate)
        .catch((error) => Alert.alert("Server time unavailable", error.message));
      return;
    }
    setExpanded(null);
    load();
  }, [date]);
  useEffect(() => {
    supabase.from("offices").select("id, name").eq("is_active", true)
      .then(({ data }: { data: any[] | null }) => setOffices(data || []));
  }, []);

  const load = async () => {
    if (!date) return;
    setLoading(true);
    try {
      const { data, error } = await ActivityService.getDailyEmployeeLogs({ date });
      if (error) throw error;
      setAllLogs(data || []);
    } catch (e: any) {
      Alert.alert("Error", e.message || "Failed to load");
    } finally { setLoading(false); }
  };

  const shift = (n: number) => {
    setDate(addBusinessDays(date, n));
  };

  // Suggestions — all employee names that match typed text
  const suggestions = searchText.length > 0
    ? allLogs
        .map((l) => l.employee_name)
        .filter((name, i, arr) =>
          name?.toLowerCase().includes(searchText.toLowerCase()) &&
          arr.indexOf(name) === i
        )
    : [];

  // Apply filters — office filter compares by NAME
  const logs = allLogs.filter((l) => {
    if (searchText && !l.employee_name?.toLowerCase().includes(searchText.toLowerCase())) return false;
    if (officeFilter && l.office_name !== officeFilter) return false;
    return true;
  });

  const present = logs.filter((l) => !!l.checkin_time);
  const absent  = logs.filter((l) => l.attendance_status === "ABSENT");
  const other = logs.filter((l) => !l.checkin_time && l.attendance_status !== "ABSENT");
  const configurationRequired = logs.filter((l) => l.attendance_status === "CONFIG_REQUIRED");

  const displayDate = formatBusinessDate(date);

  return (
    <ThemedView style={{ flex: 1, backgroundColor: "#F3F4F6", overflow: Platform.OS === "web" ? "visible" : "hidden" }}>

      {/* ── Row 1: Date picker + arrows ── */}
      <View style={s.topBar}>
        <TouchableOpacity onPress={() => shift(-1)} style={s.arrow}>
          <ThemedText style={s.arrowTxt}>‹</ThemedText>
        </TouchableOpacity>

        <View style={{ flex: 1, alignItems: "center" }}>
          {Platform.OS === "web" ? (
            <input
              type="date"
              value={date}
              onChange={(e) => { if (e.target.value) { setDate(e.target.value); setExpanded(null); } }}
              style={{
                fontSize: 15, fontWeight: "700", color: "#60045d",
                border: "2px solid #60045d", borderRadius: 8,
                padding: "6px 14px", cursor: "pointer",
                outline: "none", backgroundColor: "#fff",
              }}
            />
          ) : (
            <TextInput
              style={s.dateInput}
              value={date}
              onChangeText={(v) => { setDate(v); setExpanded(null); }}
              placeholder="YYYY-MM-DD"
            />
          )}
          <ThemedText style={s.displayDate}>{displayDate}</ThemedText>
        </View>

        <TouchableOpacity onPress={() => shift(1)} style={s.arrow}>
          <ThemedText style={s.arrowTxt}>›</ThemedText>
        </TouchableOpacity>
      </View>

      {/* ── Row 2: Search + office chips ── */}
      <View style={s.filterBar}>
        {/* Search with suggestions */}
        <View style={{ position: "relative", zIndex: 9999 }}>
          {Platform.OS === "web" ? (
            // On web use native datalist — always floats above everything
            <View style={s.searchBox}>
              <Feather name="search" size={14} color="#9CA3AF" />
              <input
                list="emp-suggestions"
                placeholder="Search employee..."
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                style={{
                  flex: 1, fontSize: 14, color: "#111",
                  border: "none", outline: "none",
                  backgroundColor: "transparent", width: "100%",
                }}
              />
              <datalist id="emp-suggestions">
                {allLogs.map((l) => (
                  <option key={l.user_id} value={l.employee_name} />
                ))}
              </datalist>
              {searchText ? (
                <TouchableOpacity onPress={() => setSearchText("")}>
                  <Feather name="x" size={14} color="#9CA3AF" />
                </TouchableOpacity>
              ) : null}
            </View>
          ) : (
            // Native — use custom suggestions dropdown
            <View>
              <View style={s.searchBox}>
                <Feather name="search" size={14} color="#9CA3AF" />
                <TextInput
                  style={s.searchInput}
                  placeholder="Search employee..."
                  placeholderTextColor="#9CA3AF"
                  value={searchText}
                  onChangeText={(t) => { setSearchText(t); setShowSuggestions(true); }}
                  onFocus={() => setShowSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                />
                {searchText ? (
                  <TouchableOpacity onPress={() => { setSearchText(""); setShowSuggestions(false); }}>
                    <Feather name="x" size={14} color="#9CA3AF" />
                  </TouchableOpacity>
                ) : null}
              </View>
              {showSuggestions && suggestions.length > 0 && (
                <View style={s.suggestions}>
                  {suggestions.slice(0, 6).map((name) => (
                    <TouchableOpacity
                      key={name}
                      style={s.suggestionItem}
                      onPress={() => { setSearchText(name); setShowSuggestions(false); }}
                    >
                      <Feather name="user" size={13} color="#6B7280" />
                      <ThemedText style={s.suggestionTxt}>{name}</ThemedText>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          )}
        </View>

        {/* Office filter chips */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
          <View style={{ flexDirection: "row", gap: 6 }}>
            {[{ name: "" }, ...offices].map((o) => {
              const label = o.name || "All Offices";
              const active = officeFilter === o.name;
              return (
                <TouchableOpacity
                  key={label}
                  style={[s.chip, active && s.chipActive]}
                  onPress={() => setOfficeFilter(active ? "" : o.name)}
                >
                  <ThemedText style={[s.chipTxt, active && s.chipTxtActive]}>{label}</ThemedText>
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>
      </View>

      {/* ── Summary bar ── */}
      {!loading && (
        <>
        {configurationRequired.length ? (
          <TouchableOpacity
            style={{ backgroundColor: "#FEF3C7", padding: 10, borderBottomWidth: 1, borderBottomColor: "#F59E0B" }}
            onPress={() => navigation.getParent?.()?.navigate?.("AdminTab", { screen: "OfficeSettings" })}
          >
            <ThemedText style={{ color: "#92400E", fontWeight: "800" }}>
              {configurationRequired.length} employee(s) need office or attendance policy configuration. Open Office Settings.
            </ThemedText>
          </TouchableOpacity>
        ) : null}
        <View style={s.summaryBar}>
          {[
            { label: "Present",    val: present.length, color: "#10B981" },
            { label: "Late",       val: present.filter((l) => l.is_late === true).length, color: "#F59E0B" },
            { label: "Absent",     val: absent.length,  color: "#EF4444" },
            { label: "Config",     val: configurationRequired.length, color: "#D97706" },
            { label: "Activities", val: logs.reduce((n, l) => n + (l.total_activities || 0), 0), color: "#3B82F6" },
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
        </>
      )}

      {/* ── Split: Present | Absent ── */}
      {loading ? (
        <ThemedText style={s.center}>Loading…</ThemedText>
      ) : logs.length === 0 ? (
        <ThemedText style={s.center}>No employees found.</ThemedText>
      ) : (
        <View style={s.splitContainer}>
          {/* LEFT — Present */}
          <View style={s.splitCol}>
            <View style={s.colHeader}>
              <View style={s.onlineDot} />
              <ThemedText style={[s.colTitle, { color: "#10B981" }]}>Present ({present.length})</ThemedText>
            </View>
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ padding: 6, paddingBottom: 40 }}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
            >
              {present.length === 0 ? (
                <ThemedText style={s.emptyCol}>No one present yet.</ThemedText>
              ) : present.map((log) => {
                const isOpen = expanded === log.user_id;
                const acts: any[] = log.activities || [];
                const isLate = log.is_late === true;
                return (
                  <TouchableOpacity
                    key={log.user_id}
                    style={[s.pCard, { borderLeftColor: isLate ? "#F59E0B" : "#10B981" }]}
                    onPress={() => setExpanded(isOpen ? null : log.user_id)}
                    activeOpacity={0.85}
                  >
                    <View style={s.cardRow}>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                          <View style={[s.statusDot, { backgroundColor: isLate ? "#F59E0B" : "#10B981" }]} />
                          <ThemedText style={s.empName}>{log.employee_name}</ThemedText>
                        </View>
                        <ThemedText style={s.empRole}>{log.role}{log.office_name ? ` · ${log.office_name}` : ""}</ThemedText>
                      </View>
                      <View style={[s.badge, { backgroundColor: isLate ? "#F59E0B" : "#10B981" }]}>
                        <ThemedText style={s.badgeTxt}>{isLate ? "LATE" : "PRESENT"}</ThemedText>
                      </View>
                    </View>

                    <View style={s.timeRow}>
                      {[
                        { label: "In",   val: fmtTime(log.checkin_time) },
                        { label: "Out",  val: fmtTime(log.checkout_time) },
                        { label: "Acts", val: String(log.total_activities || 0) },
                      ].map((t, i) => (
                        <React.Fragment key={t.label}>
                          {i > 0 && <View style={s.tdiv} />}
                          <View style={s.tcell}>
                            <ThemedText style={s.tlabel}>{t.label}</ThemedText>
                            <ThemedText style={s.tval}>{t.val}</ThemedText>
                          </View>
                        </React.Fragment>
                      ))}
                    </View>

                    {isOpen && (
                      <View style={s.timeline}>
                        <ThemedText style={s.tlTitle}>Day Timeline</ThemedText>
                        {log.checkin_time && (
                          <View style={s.tlRow}>
                            <View style={[s.dot, { backgroundColor: "#10B981" }]} />
                            <View>
                              <ThemedText style={s.tlTime}>{fmtTime(log.checkin_time)}</ThemedText>
                              <ThemedText style={s.tlDesc}>Checked in{log.office_name ? ` · ${log.office_name}` : ""}</ThemedText>
                            </View>
                          </View>
                        )}
                        {acts.map((a, i) => (
                          <View key={a.id || i} style={s.tlRow}>
                            <View style={[s.dot, { backgroundColor: ACT_COLORS[a.activity_type] || "#9CA3AF" }]} />
                            <View style={{ flex: 1 }}>
                              <ThemedText style={s.tlTime}>{fmtTime(a.time || a.timestamp)}</ThemedText>
                              <ThemedText style={s.tlDesc}>{a.summary || a.notes}</ThemedText>
                              {(a.client_name || a.company_name) ? <ThemedText style={s.tlSub}>🏢 {a.client_name || a.company_name}</ThemedText> : null}
                              <View style={{ flexDirection: "row", gap: 6, marginTop: 4 }}>
                                <View style={[s.tag, { backgroundColor: ACT_COLORS[a.activity_type] || "#9CA3AF" }]}>
                                  <ThemedText style={s.tagTxt}>{(a.activity_type || "OTHER").replace(/_/g, " ")}</ThemedText>
                                </View>
                                {a.is_billable && <View style={s.billTag}><ThemedText style={s.billTxt}>Billable</ThemedText></View>}
                              </View>
                            </View>
                          </View>
                        ))}
                        {acts.length === 0 && <ThemedText style={s.noActs}>No activities logged.</ThemedText>}
                        {log.checkout_time && (
                          <View style={s.tlRow}>
                            <View style={[s.dot, { backgroundColor: "#EF4444" }]} />
                            <View>
                              <ThemedText style={s.tlTime}>{fmtTime(log.checkout_time)}</ThemedText>
                              <ThemedText style={s.tlDesc}>Checked out</ThemedText>
                            </View>
                          </View>
                        )}
                      </View>
                    )}
                    <ThemedText style={s.hint}>{isOpen ? "▲ Collapse" : "▼ Timeline"}</ThemedText>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>

          {/* Divider */}
          <View style={s.colDivider} />

          {/* RIGHT — Absent */}
          <View style={s.splitCol}>
            <View style={s.colHeader}>
              <View style={[s.onlineDot, { backgroundColor: "#EF4444" }]} />
              <ThemedText style={[s.colTitle, { color: "#EF4444" }]}>Not present ({absent.length + other.length})</ThemedText>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 6, paddingBottom: 40 }}>
              {absent.length + other.length === 0 ? (
                <ThemedText style={s.emptyCol}>All present! 🎉</ThemedText>
              ) : [...absent, ...other].map((log) => (
                <View key={log.user_id} style={s.absentCard}>
                  <View style={[s.statusDot, { backgroundColor: "#EF4444", marginTop: 3, flexShrink: 0 }]} />
                  <View style={{ flex: 1 }}>
                    <ThemedText style={s.empName}>{log.employee_name}</ThemedText>
                    <ThemedText style={s.empRole}>{log.role}{log.office_name ? ` · ${log.office_name}` : ""}</ThemedText>
                  </View>
                  <View style={[s.badge, { backgroundColor: "#EF4444" }]}>
                    <ThemedText style={s.badgeTxt}>{log.attendance_status.replaceAll("_", " ")}</ThemedText>
                  </View>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      )}
    </ThemedView>
  );
}

const s = StyleSheet.create({
  topBar: { flexDirection: "row", alignItems: "center", paddingVertical: 10, paddingHorizontal: 8, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  arrow: { padding: 8 },
  arrowTxt: { fontSize: 30, color: "#60045d", fontWeight: "300" },
  dateInput: { fontSize: 15, fontWeight: "700", color: "#60045d", borderWidth: 2, borderColor: "#60045d", borderRadius: 8, paddingVertical: 6, paddingHorizontal: 12, textAlign: "center" },
  displayDate: { fontSize: 11, color: "#6B7280", marginTop: 2, textAlign: "center" },
  filterBar: { backgroundColor: "#fff", paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#E5E7EB", zIndex: 100, elevation: 100 },
  searchBox: { flexDirection: "row", alignItems: "center", backgroundColor: "#F3F4F6", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, gap: 8 },
  searchInput: { flex: 1, fontSize: 14, color: "#111" },
  suggestions: {
    position: "absolute", top: 44, left: 0, right: 0,
    backgroundColor: "#fff", borderRadius: 8, zIndex: 9999,
    borderWidth: 1, borderColor: "#E5E7EB",
    elevation: 9999,
    ...(Platform.OS === "web"
      ? { boxShadow: "0 4px 16px rgba(0,0,0,0.15)" }
      : { shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } }),
  },
  suggestionItem: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  suggestionTxt: { fontSize: 14, color: "#111" },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1.5, borderColor: "#E5E7EB", backgroundColor: "#F9FAFB" },
  chipActive: { backgroundColor: "#60045d", borderColor: "#60045d" },
  chipTxt: { fontSize: 12, fontWeight: "600", color: "#374151" },
  chipTxtActive: { color: "#fff" },
  summaryBar: { flexDirection: "row", backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB", paddingVertical: 10 },
  summaryCell: { flex: 1, alignItems: "center" },
  summaryN: { fontSize: 20, fontWeight: "800" },
  summaryL: { fontSize: 11, color: "#9CA3AF", marginTop: 1 },
  summaryDiv: { width: 1, backgroundColor: "#E5E7EB" },
  center: { textAlign: "center", marginTop: 40, color: "#666" },
  splitContainer: { flex: 1, flexDirection: "row" },
  splitCol: { flex: 1 },
  colDivider: { width: 1, backgroundColor: "#E5E7EB" },
  colHeader: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  onlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#10B981" },
  colTitle: { fontSize: 12, fontWeight: "700" },
  emptyCol: { textAlign: "center", marginTop: 20, color: "#9CA3AF", fontSize: 12 },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#10B981" },
  pCard: { backgroundColor: "#fff", borderRadius: 10, padding: 10, marginBottom: 6, borderWidth: 1, borderColor: "#E5E7EB", borderLeftWidth: 3 },
  absentCard: { flexDirection: "row", alignItems: "flex-start", gap: 6, backgroundColor: "#FEF2F2", borderRadius: 8, padding: 10, marginBottom: 4 },
  cardRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: 10 },
  empName: { fontSize: 15, fontWeight: "700", color: "#111" },
  empRole: { fontSize: 12, color: "#6B7280", marginTop: 2 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  badgeTxt: { fontSize: 11, fontWeight: "700", color: "#fff" },
  timeRow: { flexDirection: "row", backgroundColor: "#F9FAFB", borderRadius: 8, padding: 10, marginBottom: 6 },
  tcell: { flex: 1, alignItems: "center" },
  tdiv: { width: 1, backgroundColor: "#E5E7EB" },
  tlabel: { fontSize: 10, color: "#9CA3AF", marginBottom: 2 },
  tval: { fontSize: 13, fontWeight: "700", color: "#111" },
  timeline: { borderTopWidth: 1, borderTopColor: "#F0F0F0", paddingTop: 12, marginTop: 6 },
  tlTitle: { fontSize: 13, fontWeight: "700", color: "#374151", marginBottom: 10 },
  tlRow: { flexDirection: "row", gap: 10, marginBottom: 12 },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 3, flexShrink: 0 },
  tlTime: { fontSize: 11, fontWeight: "700", color: "#374151" },
  tlDesc: { fontSize: 13, color: "#4B5563", marginTop: 1 },
  tlSub: { fontSize: 12, color: "#3B82F6", marginTop: 2 },
  tag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  tagTxt: { fontSize: 10, color: "#fff", fontWeight: "600" },
  billTag: { backgroundColor: "#D1FAE5", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  billTxt: { fontSize: 10, color: "#065F46", fontWeight: "600" },
  noActs: { fontSize: 12, color: "#9CA3AF", fontStyle: "italic", marginLeft: 20 },
  hint: { fontSize: 11, color: "#007AFF", textAlign: "center", marginTop: 8 },
});
