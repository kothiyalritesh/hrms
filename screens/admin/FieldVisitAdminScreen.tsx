import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  View, StyleSheet, ScrollView, TouchableOpacity,
  Modal, Platform, TextInput, ActivityIndicator, RefreshControl, Alert,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useFocusEffect } from "@react-navigation/native";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { useTheme } from "@/hooks/useTheme";
import { supabase } from "@/lib/supabase";
import MarkedLocationReviewPanel from "@/components/MarkedLocationReviewPanel";
import LocationTimelineModal, { PingPoint } from "@/components/LocationTimelineModal";
import type { LocationStory } from "@/components/LocationDayStory";
import { EvidencePhoto } from "@/components/EvidencePhoto";
import { collapseCurrentLocationSubmissions } from "@/services/field-visit.service";
import { BusinessClockService } from "@/services/business-clock.service";
import {
  addBusinessDays,
  businessMonthRange,
  formatBusinessDate,
} from "@/utils/businessDate";
import { fetchAllPages } from "@/utils/supabasePagination";
import { formatHrmsTime } from "@/utils/attendanceTimestamp";
import { freshnessOfTimestamp } from "@/utils/locationFreshness";

// ── helpers ──────────────────────────────────────────────────────────────────
function fmtTime(iso?: string | null) {
  if (!iso) return "—";
  return formatHrmsTime(iso, "No time recorded");
}
function fmtDate(s: string) {
  return formatBusinessDate(s);
}

const STATUS_COLOR: Record<string, { bg: string; text: string; label: string }> = {
  PENDING:    { bg: "#FEF3C7", text: "#D97706", label: "Planned" },
  IN_TRANSIT: { bg: "#E0E7FF", text: "#4338CA", label: "Travelling" },
  CHECKED_IN: { bg: "#DBEAFE", text: "#2563EB", label: "At Location" },
  COMPLETED:  { bg: "#D1FAE5", text: "#059669", label: "Completed" },
  MISSED:     { bg: "#FEE2E2", text: "#DC2626", label: "Missed" },
};

const TYPE_LABEL: Record<string, string> = { site: "Site", meeting: "Meeting", office: "Office", others: "Other" };

type StatusFilter = "ALL" | "COMPLETED" | "ACTIVE" | "MISSED";
const isActiveStatus = (st: string) => st === "CHECKED_IN" || st === "IN_TRANSIT";
function matchesFilter(v: any, f: StatusFilter) {
  if (f === "ALL") return true;
  if (f === "ACTIVE") return isActiveStatus(v.status);
  return v.status === f;
}

const EVIDENCE_TEXT: Record<string, { label: string; color: string; hint: string }> = {
  STRONG: { label: "Strong", color: "#059669", hint: "Several reliable GPS points inside the site radius." },
  PARTIAL: { label: "Partial", color: "#D97706", hint: "Some GPS points near the site, but not enough to be sure." },
  NOT_AT_SITE: { label: "Not at site", color: "#DC2626", hint: "Reliable GPS points were recorded, none inside the site radius." },
  NONE: { label: "No GPS data", color: "#6B7280", hint: "No location points were recorded for this visit." },
};

function minutesBetween(a?: string | null, b?: string | null) {
  if (!a || !b) return null;
  const m = (new Date(b).getTime() - new Date(a).getTime()) / 60000;
  return Number.isFinite(m) && m >= 0 ? Math.round(m) : null;
}
function fmtDuration(m: number | null) {
  if (m == null) return "—";
  const h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : `${m}m`;
}
function haversineM(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad, dLon = (b.longitude - a.longitude) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)));
}
const coordText = (c: any) =>
  c && Number.isFinite(Number(c.latitude)) && Number.isFinite(Number(c.longitude))
    ? `${Number(c.latitude).toFixed(5)}, ${Number(c.longitude).toFixed(5)}`
    : null;

const PRESETS = [
  { label: "Today", range: (base: string) => [base, base] },
  { label: "Yesterday", range: (base: string) => {
    const date = addBusinessDays(base, -1);
    return [date, date];
  } },
  { label: "This Week", range: (base: string) => {
    const day = new Date(`${base}T12:00:00Z`).getUTCDay() || 7;
    return [addBusinessDays(base, 1 - day), base];
  } },
  { label: "This Month", range: (base: string) => {
    const month = businessMonthRange(base);
    return [month.start, base];
  } },
  { label: "Last Month", range: (base: string) => {
    const previous = businessMonthRange(`${addBusinessDays(`${base.slice(0, 8)}01`, -1)}`);
    return [previous.start, previous.end];
  } },
];

// ── Detail Modal ──────────────────────────────────────────────────────────────
function DetailModal({ visit, onClose, openTimeline }: { visit: any; onClose: () => void; openTimeline?: (uid: string, name: string, date: string) => void }) {
  const [evidence, setEvidence] = useState<any>(null);
  const [live, setLive] = useState<any>(null);
  useEffect(() => {
    let cancelled = false;
    setEvidence(null);
    setLive(null);
    if (!visit) return;
    if (visit.location_evidence && typeof visit.location_evidence === "object") {
      setEvidence(visit.location_evidence);
    } else if (visit.status !== "PENDING") {
      void Promise.resolve(supabase.rpc("rpc_field_visit_location_evidence", { p_visit_id: visit.id }))
        .then(({ data }: any) => { if (!cancelled && data && typeof data === "object") setEvidence(data); })
        .catch(() => undefined);
    }
    if (isActiveStatus(visit.status)) {
      void Promise.resolve(supabase.rpc("rpc_latest_locations_for_users", { p_user_ids: [visit.user_id] }))
        .then(({ data }: any) => { if (!cancelled && Array.isArray(data) && data[0]) setLive(data[0]); })
        .catch(() => undefined);
    }
    return () => { cancelled = true; };
  }, [visit?.id]);
  if (!visit) return null;
  const sc = STATUS_COLOR[visit.status] || STATUS_COLOR.PENDING;
  const dest = visit.destination_coords?.latitude != null ? visit.destination_coords : null;
  const livePos = live?.latitude != null ? { latitude: Number(live.latitude), longitude: Number(live.longitude) } : null;
  const liveFresh = live?.recorded_at ? freshnessOfTimestamp(live.recorded_at, Date.now()) : null;
  const isMismatch = ["CURRENT_LOCATION_MARKED", "LOW_ACCURACY", "MOCK_LOCATION_FLAGGED", "MISMATCHED"].includes(String(visit.location_match_status || ""));
  const ev = evidence?.level ? EVIDENCE_TEXT[evidence.level] ?? null : null;

  const destLat = visit.destination_coords?.latitude ?? visit.checkin_location?.latitude;
  const destLng = visit.destination_coords?.longitude ?? visit.checkin_location?.longitude;
  const originLat = visit.origin_lat;
  const originLng = visit.origin_lon;

  const navUrl = originLat && originLng && destLat && destLng
    ? `https://www.google.com/maps/dir/${originLat},${originLng}/${destLat},${destLng}`
    : destLat && destLng
    ? `https://www.google.com/maps/search/?api=1&query=${destLat},${destLng}`
    : null;

  const openNav = () => { if (navUrl) { if (Platform.OS === 'web') window.open(navUrl, '_blank'); } };

  return (
    <Modal visible animationType="slide" transparent presentationStyle="overFullScreen">
      <View style={d.overlay}>
        <View style={d.sheet}>
          <View style={d.header}>
            <View style={d.handle} />
            <View style={d.headerRow}>
              <ThemedText style={d.title} numberOfLines={1}>{visit.location_name}</ThemedText>
              <TouchableOpacity onPress={onClose} style={{ padding: 4 }}>
                <Feather name="x" size={20} color="#6B7280" />
              </TouchableOpacity>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <View style={[d.badge, { backgroundColor: sc.bg }]}>
                <ThemedText style={[d.badgeTxt, { color: sc.text }]}>{sc.label}</ThemedText>
              </View>
              <View style={[d.badge, { backgroundColor: visit.visit_type === 'site' ? '#D1FAE5' : '#EFF6FF' }]}>
                <ThemedText style={[d.badgeTxt, { color: visit.visit_type === 'site' ? '#065F46' : '#1E40AF' }]}>
                  {TYPE_LABEL[visit.visit_type] ?? 'Visit'}
                </ThemedText>
              </View>
              {visit.auto_closed ? (
                <View style={[d.badge, { backgroundColor: '#F3F4F6' }]}>
                  <ThemedText style={[d.badgeTxt, { color: '#4B5563' }]}>Auto-closed</ThemedText>
                </View>
              ) : null}
            </View>
          </View>

          <ScrollView style={d.body} showsVerticalScrollIndicator={false}>
            {/* Employee */}
            <View style={d.section}>
              <Row icon="user" label="Employee" value={visit.profiles?.name || '—'} />
              <Row icon="hash" label="Emp No." value={visit.profiles?.employee_number || '—'} />
              <Row icon="calendar" label="Date" value={fmtDate(visit.date)} />
            </View>

            {/* Visit Details */}
            <View style={d.section}>
              <Row icon="map-pin" label="Destination" value={visit.location_name} />
              {visit.location_address ? <Row icon="navigation" label="Address" value={visit.location_address} /> : null}
              {visit.contact_name ? <Row icon="phone" label="Contact" value={`${visit.contact_name}${visit.contact_phone ? ' · ' + visit.contact_phone : ''}`} /> : null}
              {visit.company_name ? <Row icon="briefcase" label="Company" value={visit.company_name} /> : null}
              {visit.project_name ? <Row icon="home" label="Project" value={visit.project_name} /> : null}
              {visit.notes ? <Row icon="file-text" label="Notes" value={visit.notes} /> : null}
              {visit.meeting_type ? <Row icon="users" label="Meeting" value={visit.meeting_type === 'client' ? '👤 Client' : '🏘️ Channel Partner'} /> : null}
            </View>

            {/* Origin → Destination Navigation */}
            {navUrl ? (
              <View style={d.section}>
                <ThemedText style={d.sectionTitle}>📍 Navigation</ThemedText>
                {visit.origin_name ? <Row icon="crosshair" label="Started From" value={visit.origin_name} /> : null}
                {originLat && originLng ? <Row icon="map-pin" label="Origin GPS" value={`${originLat.toFixed(5)}, ${originLng.toFixed(5)}`} /> : null}
                <Row icon="map-pin" label="Destination" value={`${destLat?.toFixed(5)}, ${destLng?.toFixed(5)}`} />
                <TouchableOpacity style={d.navBtn} onPress={openNav}>
                  <Feather name="navigation" size={15} color="#fff" />
                  <ThemedText style={d.navBtnTxt}>
                    {originLat ? 'Open Route in Google Maps' : 'Open Destination in Maps'}
                  </ThemedText>
                </TouchableOpacity>
              </View>
            ) : null}

            {/* Active visit: where the person is now */}
            {isActiveStatus(visit.status) ? (
              <View style={d.section}>
                <ThemedText style={d.sectionTitle}>📡 Live position</ThemedText>
                {livePos ? (
                  <>
                    <Row icon="crosshair" label="Latest GPS" value={`${coordText(livePos)}${live.accuracy != null ? ` (±${Math.round(Number(live.accuracy))} m)` : ''}`} />
                    <Row icon="clock" label="Updated" value={`${fmtTime(live.recorded_at)}${liveFresh ? ` · ${liveFresh === 'LIVE' ? 'live' : liveFresh === 'RECENT' ? 'recent' : 'old'}` : ''}`}
                      color={liveFresh === 'LIVE' ? '#059669' : liveFresh === 'RECENT' ? '#D97706' : '#DC2626'} />
                    {dest ? <Row icon="navigation" label="To site" value={`${haversineM(livePos, dest)} m (straight line)`} /> : null}
                    {visit.checkin_location?.latitude != null ? (
                      <Row icon="corner-down-right" label="From check-in" value={`${haversineM(livePos, visit.checkin_location)} m`} />
                    ) : null}
                  </>
                ) : (
                  <ThemedText style={d.muted}>No location received from this phone today.</ThemedText>
                )}
              </View>
            ) : null}

            {/* Times */}
            <View style={d.section}>
              <ThemedText style={d.sectionTitle}>🕐 Timing</ThemedText>
              <Row icon="calendar" label="Planned" value={fmtTime(visit.created_at)} />
              {visit.tracking_started_at ? <Row icon="play" label="Started trip" value={fmtTime(visit.tracking_started_at)} /> : null}
              <Row icon="log-in" label="Check In" value={fmtTime(visit.checkin_time)} color="#059669" />
              <Row icon="log-out" label="Check Out" value={fmtTime(visit.checkout_time)} color="#DC2626" />
              <Row icon="watch" label="Time at site" value={fmtDuration(minutesBetween(visit.checkin_time, visit.checkout_time))} />
              {coordText(visit.checkin_location)
                ? <Row icon="crosshair" label="Checkin GPS" value={coordText(visit.checkin_location)!} color="#059669" />
                : null}
              {coordText(visit.checkout_location)
                ? <Row icon="crosshair" label="Checkout GPS" value={`${coordText(visit.checkout_location)}${visit.checkout_accuracy_m != null ? ` (±${Math.round(visit.checkout_accuracy_m)} m)` : ''}`} color="#DC2626" />
                : null}
              {visit.checkout_distance_m != null
                ? <Row icon="maximize" label="Checkout from site" value={`${Math.round(visit.checkout_distance_m)} m`} />
                : null}
              {visit.status === 'MISSED'
                ? <Row icon="alert-circle" label="Missed" value={visit.auto_closed ? 'Closed automatically: no check-in that day' : 'Marked missed (no check-in)'} color="#DC2626" />
                : null}
            </View>

            {/* GPS evidence for the visit */}
            {ev ? (
              <View style={d.section}>
                <ThemedText style={d.sectionTitle}>🛰️ Location evidence</ThemedText>
                <Row icon="shield" label="Result" value={ev.label} color={ev.color} />
                <ThemedText style={d.muted}>{ev.hint}</ThemedText>
                {evidence.minutes_at_site != null ? <Row icon="watch" label="At site" value={`${Math.round(evidence.minutes_at_site)} min of GPS inside the radius`} /> : null}
                {evidence.closest_m != null ? <Row icon="target" label="Closest" value={`${Math.round(evidence.closest_m)} m from site`} /> : null}
                {evidence.good_points != null ? <Row icon="list" label="GPS points" value={`${evidence.good_points} reliable of ${evidence.total_points ?? 0}`} /> : null}
                {Array.isArray(evidence.flags) && evidence.flags.length ? (
                  <Row icon="flag" label="Flags" value={evidence.flags.map((f: string) => f.replace(/_/g, ' ').toLowerCase()).join(', ')} color="#B45309" />
                ) : null}
              </View>
            ) : null}

            {/* Location mismatch (the only place a photo is taken) */}
            {isMismatch ? (
              <View style={d.section}>
                <ThemedText style={d.sectionTitle}>⚠️ Location mismatch</ThemedText>
                <Row icon="map-pin" label="Marked at" value={visit.actual_location_name || coordText({ latitude: visit.actual_latitude, longitude: visit.actual_longitude }) || '—'} />
                {visit.selected_site_distance_metres != null ? <Row icon="navigation" label="From site" value={`${Math.round(visit.selected_site_distance_metres)} m`} /> : null}
                {visit.actual_location_accuracy_metres != null ? <Row icon="crosshair" label="Accuracy" value={`±${Math.round(visit.actual_location_accuracy_metres)} m`} /> : null}
                {visit.location_mismatch_reason ? <Row icon="file-text" label="Reason" value={visit.location_mismatch_reason} /> : null}
                <Row icon="check-square" label="Review" value={String(visit.verification_status || 'PENDING').replace(/_/g, ' ')} />
                {visit.evidence_photo_path ? (
                  <View style={{ marginTop: 8 }}>
                    <EvidencePhoto path={visit.evidence_photo_path} height={200} />
                  </View>
                ) : null}
              </View>
            ) : null}

            {openTimeline ? (
              <TouchableOpacity style={[d.navBtn, { backgroundColor: '#2563EB' }]} onPress={() => openTimeline(visit.user_id, visit.profiles?.name || 'Employee', visit.date)}>
                <Feather name="activity" size={15} color="#fff" />
                <ThemedText style={d.navBtnTxt}>View route & day timeline</ThemedText>
              </TouchableOpacity>
            ) : null}

            {/* Checkout Notes */}
            {visit.checkout_notes ? (
              <View style={d.notesBox}>
                <ThemedText style={d.notesLabel}>📝 Meeting Notes</ThemedText>
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
  sectionTitle: { fontSize: 12, fontWeight: "700", color: "#6B7280", marginBottom: 4, marginTop: 4 },
  navBtn: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#60045d", borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16, marginTop: 10, justifyContent: "center" },
  navBtnTxt: { color: "#fff", fontWeight: "700", fontSize: 14 },
  muted: { fontSize: 12, color: "#6B7280", marginTop: 4 },
});

// ── View toggle (All Field Visits / Current Locations Marked) ────────────────
function ViewToggle({
  view,
  onChange,
}: {
  view: "VISITS" | "MARKED";
  onChange: (v: "VISITS" | "MARKED") => void;
}) {
  const { theme } = useTheme();
  const options: { key: "VISITS" | "MARKED"; label: string; icon: React.ComponentProps<typeof Feather>["name"] }[] = [
    { key: "VISITS", label: "All Field Visits", icon: "briefcase" },
    { key: "MARKED", label: "Current Locations Marked", icon: "map-pin" },
  ];
  return (
    <View style={[vt.bar, { backgroundColor: theme.backgroundDefault, borderBottomColor: theme.border }]}>
      <View style={[vt.track, { backgroundColor: theme.backgroundSecondary, borderColor: theme.border }]}>
        {options.map((o) => {
          const active = view === o.key;
          return (
            <TouchableOpacity
              key={o.key}
              style={[vt.btn, active && { backgroundColor: theme.primary }]}
              onPress={() => onChange(o.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Feather name={o.icon} size={14} color={active ? "#FFFFFF" : theme.textSecondary} />
              <ThemedText
                numberOfLines={2}
                style={[vt.txt, { color: active ? "#FFFFFF" : theme.text }, active && { fontWeight: "800" }]}
              >
                {o.label}
              </ThemedText>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}
const vt = StyleSheet.create({
  bar: { paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1 },
  track: { flexDirection: "row", borderWidth: 1, borderRadius: 12, padding: 3, gap: 3 },
  btn: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: 9,
    paddingVertical: 9,
    paddingHorizontal: 8,
  },
  txt: { fontSize: 13, fontWeight: "600", lineHeight: 17, textAlign: "center", flexShrink: 1 },
});

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function FieldVisitAdminScreen() {
  const [businessDate, setBusinessDate] = useState("");
  const [view, setView] = useState<"VISITS" | "MARKED">("VISITS");
  const [visits, setVisits] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [activePreset, setActivePreset] = useState("Today");
  const [empFilter, setEmpFilter] = useState("");
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<any>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [timeline, setTimeline] = useState<{ name: string; date: string } | null>(null);
  const [timelineStory, setTimelineStory] = useState<LocationStory | null>(null);
  const [timelinePings, setTimelinePings] = useState<PingPoint[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  // The applied query, used by refresh / focus (editing a date does not query).
  const applied = useRef({ s: "", e: "", emp: "" });

  const openTimeline = useCallback(async (userId: string, name: string, date: string) => {
    setSelected(null);
    setTimeline({ name, date });
    setTimelineLoading(true);
    setTimelineStory(null);
    setTimelinePings([]);
    const res: any = await supabase.rpc("rpc_location_timeline", { p_user_id: userId, p_date: date });
    if (!res.error && res.data) {
      const story = res.data as LocationStory;
      setTimelineStory(story);
      setTimelinePings((story.points ?? []).map((p: any) => ({
        latitude: p.latitude, longitude: p.longitude, recorded_at: p.recorded_at,
        gps_available: true, status: p.quality === "RELIABLE" || p.quality === "STALE" ? "GREEN" : "RED_RANGE",
        source: "app", quality: p.quality, accuracy: p.accuracy,
      })));
    }
    setTimelineLoading(false);
  }, []);

  const load = useCallback(async (s: string, e: string, emp: string) => {
    applied.current = { s, e, emp };
    setLoading(true);
    try {
      const [visitResult, employeeResult] = await Promise.all([
        fetchAllPages<any>((from, to) => {
          let query = supabase
            .from("field_visits")
            .select("*, profiles:user_id(name, employee_number, role)")
            .gte("date", s)
            .lte("date", e)
            .order("date", { ascending: false })
            .order("created_at", { ascending: true })
            .order("id");
          if (emp) query = query.eq("user_id", emp);
          return query.range(from, to);
        }),
        fetchAllPages<any>((from, to) =>
          supabase.from("profiles").select("id, name")
            .eq("is_active", true).order("name").order("id").range(from, to),
        ),
      ]);
      if (visitResult.error) throw visitResult.error;
      if (employeeResult.error) throw employeeResult.error;
      // A location re-submission replaces its source visit (one row per visit).
      setVisits(collapseCurrentLocationSubmissions(visitResult.data || []));
      setEmployees(employeeResult.data || []);
    } catch (error: any) {
      Alert.alert("Field visits unavailable", error?.message || "Data query failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    if (businessDate) {
      const a = applied.current;
      void load(a.s || businessDate, a.e || businessDate, a.emp);
      return;
    }
    void BusinessClockService.getDate(true).then((date) => {
      setBusinessDate(date);
      setStartDate(date);
      setEndDate(date);
      setExpandedDates(new Set([date]));
      return load(date, date, "");
    });
  }, [businessDate, load]));

  const applyPreset = (p: typeof PRESETS[0]) => {
    if (!businessDate) return;
    const [s, e] = p.range(businessDate);
    setStartDate(s); setEndDate(e); setActivePreset(p.label);
    const dates = new Set<string>();
    let cursor = s;
    while (cursor <= e) {
      dates.add(cursor);
      cursor = addBusinessDays(cursor, 1);
    }
    setExpandedDates(dates);
    load(s, e, empFilter);
  };

  const toggleDate = (date: string) =>
    setExpandedDates(prev => { const n = new Set(prev); n.has(date) ? n.delete(date) : n.add(date); return n; });

  // group by date (after the status filter)
  const grouped: { date: string; rows: any[] }[] = [];
  const seen = new Set<string>();
  for (const v of visits.filter((x) => matchesFilter(x, statusFilter))) {
    if (!seen.has(v.date)) { seen.add(v.date); grouped.push({ date: v.date, rows: [] }); }
    grouped.find(g => g.date === v.date)!.rows.push(v);
  }


  if (view === "MARKED") return (
    <ThemedView style={s.root}>
      <ViewToggle view={view} onChange={setView} />
      <ScrollView contentContainerStyle={s.container}><MarkedLocationReviewPanel /></ScrollView>
    </ThemedView>
  );

  return (
    <ThemedView style={s.root}>
      <DetailModal visit={selected} onClose={() => setSelected(null)} openTimeline={openTimeline} />
      <LocationTimelineModal
        visible={!!timeline}
        employeeName={timeline?.name ?? ""}
        date={timeline?.date ?? ""}
        pings={timelinePings}
        story={timelineStory}
        loading={timelineLoading}
        onClose={() => setTimeline(null)}
      />

      <ViewToggle view={view} onChange={setView} />

      <ScrollView
        contentContainerStyle={s.container}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(applied.current.s || businessDate, applied.current.e || businessDate, applied.current.emp); setRefreshing(false); }} tintColor="#60045d" />}
      >
        {/* summary strip */}
        <View style={s.summaryRow}>
          {([
            { key: "ALL", label: "Total", val: visits.length, color: "#60045d" },
            { key: "COMPLETED", label: "Completed", val: visits.filter(v => v.status === "COMPLETED").length, color: "#059669" },
            { key: "ACTIVE", label: "Active", val: visits.filter(v => isActiveStatus(v.status)).length, color: "#2563EB" },
            { key: "MISSED", label: "Missed", val: visits.filter(v => v.status === "MISSED").length, color: "#DC2626" },
          ] as const).map((item, i) => (
            <React.Fragment key={item.label}>
              {i > 0 && <View style={s.summaryDiv} />}
              <TouchableOpacity
                style={[s.summaryCell, statusFilter === item.key && { backgroundColor: item.color + "14", borderRadius: 8 }]}
                onPress={() => setStatusFilter(item.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: statusFilter === item.key }}
              >
                <ThemedText style={[s.summaryN, { color: item.color }]}>{item.val}</ThemedText>
                <ThemedText style={[s.summaryL, statusFilter === item.key && { color: item.color, fontWeight: "700" }]}>{item.label}</ThemedText>
              </TouchableOpacity>
            </React.Fragment>
          ))}
        </View>
        {statusFilter !== "ALL" ? (
          <ThemedText style={{ fontSize: 12, color: "#6B7280", marginBottom: 8 }}>
            Showing {statusFilter === "ACTIVE" ? "active (at site or travelling)" : statusFilter.toLowerCase()} visits · tap Total to show all
          </ThemedText>
        ) : null}

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

          <TouchableOpacity style={s.searchBtn} onPress={() => {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || startDate > endDate) {
              Alert.alert("Check the dates", "Use YYYY-MM-DD, with From on or before To.");
              return;
            }
            setActivePreset(""); load(startDate, endDate, empFilter);
          }}>
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
            <ThemedText style={s.emptyTxt}>
              {visits.length && statusFilter !== "ALL" ? "No visits match this filter" : "No field visits for this period"}
            </ThemedText>
          </View>
        ) : (
          grouped.map(({ date, rows }) => {
            const expanded = expandedDates.has(date);
            const done = rows.filter(r => r.status === "COMPLETED").length;
            const active = rows.filter(r => isActiveStatus(r.status)).length;
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
                        <View style={[s.typePill, { backgroundColor: visit.visit_type === "site" ? "#D1FAE5" : "#EFF6FF" }]}>
                          <ThemedText style={[s.typeTxt, { color: visit.visit_type === "site" ? "#065F46" : "#1E40AF" }]}>
                            {TYPE_LABEL[visit.visit_type] ?? "Visit"}
                          </ThemedText>
                        </View>
                      </View>

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
  timesRow: { flexDirection: "row", gap: 12, marginTop: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: "#F3F4F6" },
  timeChip: { flexDirection: "row", alignItems: "center", gap: 4 },
  timeTxt: { fontSize: 12, color: "#374151", fontWeight: "600" },
  tapHint: { fontSize: 11, color: "#60045d", textAlign: "right", marginTop: 6, fontWeight: "600" },
  empty: { alignItems: "center", paddingTop: 60, gap: 12 },
  emptyTxt: { fontSize: 14, color: "#9CA3AF" },
});
