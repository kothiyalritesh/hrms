import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  View, StyleSheet, ScrollView, ActivityIndicator,
  RefreshControl, Pressable, Modal, Text, Linking, Platform, Alert,
} from "react-native";
import { WebView } from "react-native-webview";
import Feather from "@expo/vector-icons/Feather";
import { useFocusEffect } from "@react-navigation/native";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { formatDate, formatTime, toTitleCase } from "@/utils/format";
import { BusinessClockService } from "@/services/business-clock.service";
import { AttendanceService, effectiveOfficeRadius } from "@/services/attendance.service";
import { fetchAllPages } from "@/utils/supabasePagination";
import { isDueDateOverdue, parseDatabaseTimestamp } from "@/utils/businessDate";

// ── 5-colour status system (per UI audit, 12 Jun 2026) ───────────────────────
type StatusKey = "present" | "field" | "leave" | "notyet" | "absent";
type StatusDef = { key: StatusKey; label: string; color: string; bg: string };
const STATUS: Record<StatusKey, StatusDef> = {
  present: { key: "present", label: "In office", color: "#12966E", bg: "#E4F4EE" }, // green
  field:   { key: "field",   label: "On field",  color: "#1A5FD4", bg: "#E3EEFB" }, // blue
  leave:   { key: "leave",   label: "On leave",  color: "#D97706", bg: "#FEF3C7" }, // orange
  notyet:  { key: "notyet",  label: "Not in yet", color: "#8A8594", bg: "#EFECF3" }, // grey
  absent:  { key: "absent",  label: "Absent",     color: "#C8252D", bg: "#FDEAEB" }, // red
};

const FRESH_MS = 15 * 60 * 1000;

// ── geo + time helpers ───────────────────────────────────────────────────────
function haversineM(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function toUTC(iso: string | null): Date | null {
  if (!iso) return null;
  return parseDatabaseTimestamp(iso);
}
function isFresh(iso: string | null, nowMs: number) {
  if (!iso) return false;
  const age = nowMs - toUTC(iso)!.getTime();
  return age >= -10_000 && age < FRESH_MS;
}
function isAfterCutoff(d: Date, cutoffMinutes: number) {
  const ist = new Date(d.getTime() + 330 * 60 * 1000);
  const currentSeconds =
    (ist.getUTCHours() * 60 + ist.getUTCMinutes()) * 60 +
    ist.getUTCSeconds();
  return currentSeconds >= cutoffMinutes * 60;
}
function initials(name: string) {
  const p = (name || "").trim().split(/\s+/);
  if (!p[0]) return "?";
  return (p.length === 1 ? p[0][0] : p[0][0] + p[p.length - 1][0]).toUpperCase();
}
function liveAgo(sec: number) {
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}

// ── types ─────────────────────────────────────────────────────────────────────
interface Member {
  id: string; name: string; role: string; team: string | null; employee_number: string | null;
  status: StatusKey; checkin_time: string | null; checkout_time: string | null;
  office_name: string | null; last_ping: string | null; mismatch_m: number | null;
  late: boolean; open_tasks: number; overdue_tasks: number;
  ping_lat: number | null; ping_lon: number | null; ping_fresh: boolean;
}
interface TeamGroup { leadId: string; leadName: string; teamName: string; members: Member[]; }
interface Attention { kind: "mismatch" | "late" | "overdue"; member: Member; detail: string; }

// ── small UI atoms ─────────────────────────────────────────────────────────────
function Avatar({ name, size = 44, square = false }: { name: string; size?: number; square?: boolean }) {
  return (
    <View style={{
      width: size, height: size, borderRadius: square ? size * 0.32 : size / 2,
      backgroundColor: "#6D1B6D", alignItems: "center", justifyContent: "center",
    }}>
      <Text style={{ color: "#fff", fontSize: size * 0.4, fontWeight: "700" }}>{initials(name)}</Text>
    </View>
  );
}

function StatusChip({ status, time }: { status: StatusKey; time?: string | null }) {
  const s = STATUS[status];
  return (
    <View style={[styles.chip, { backgroundColor: s.bg }]}>
      <View style={[styles.dot, { backgroundColor: s.color }]} />
      <ThemedText type="caption" style={{ color: s.color, fontWeight: "700", fontSize: 11 }}>
        {s.label}{time ? ` · ${formatTime(time)}` : ""}
      </ThemedText>
    </View>
  );
}

// Multi-segment progress bar (present/field/leave/notyet/absent)
function SegmentBar({ members, height = 8 }: { members: Member[]; height?: number }) {
  const total = Math.max(members.length, 1);
  const order: StatusKey[] = ["present", "field", "leave", "notyet", "absent"];
  const counts = order.map((k) => ({ k, n: members.filter((m) => m.status === k).length }));
  return (
    <View style={[styles.segTrack, { height, borderRadius: height / 2 }]}>
      {counts.map(({ k, n }) =>
        n > 0 ? <View key={k} style={{ flex: n / total, backgroundColor: STATUS[k].color }} /> : null
      )}
    </View>
  );
}

function Pill({ value, label, color, bg, active, onPress }: { value: number; label: string; color: string; bg: string; active?: boolean; onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.pill,
        { borderColor: active ? color : bg, backgroundColor: active ? color + "18" : "#FFFFFF", opacity: pressed ? 0.8 : 1 },
      ]}
    >
      <ThemedText style={{ fontSize: 22, fontWeight: "800", color, lineHeight: 26 }}>{value}</ThemedText>
      <ThemedText type="caption" style={{ color: active ? color : "#6B6478", marginTop: 2, fontSize: 11, fontWeight: active ? "700" : "400" }}>{label}</ThemedText>
    </Pressable>
  );
}

// ── member status computation ───────────────────────────────────────────────────
function computeMember(
  profile: any, att: any, visit: any, onLeave: boolean,
  office: any, ping: any, tasks: { open: number; overdue: number },
  nowMs: number, cutoffMinutes: number,
): Member {
  let status: StatusKey;
  let mismatch_m: number | null = null;
  const checkin = att?.checkin_time ?? null;
  const checkout = att?.checkout_time ?? null;
  // No office means the distance rule is unavailable. Never invent a 100 m
  // rule because that can create a false mismatch warning.
  const officeRadius = office ? effectiveOfficeRadius(office) : null;

  // distance mismatch (check-in or live ping far from their office)
  if (
    officeRadius != null &&
    office?.latitude != null &&
    office?.longitude != null
  ) {
    const cl = att?.checkin_location;
    if (cl?.latitude != null) {
      const d = Math.round(haversineM(office.latitude, office.longitude, cl.latitude, cl.longitude));
      if (d > officeRadius) mismatch_m = d;
    }
    if (ping?.latitude != null && isFresh(ping.recorded_at, nowMs) && ping.source !== "web") {
      const d = Math.round(haversineM(office.latitude, office.longitude, ping.latitude, ping.longitude));
      if (d > officeRadius && (mismatch_m == null || d > mismatch_m)) mismatch_m = d;
    }
  }

  const hasFieldVisit = !!visit && visit.visit_type !== "office";
  const pingOutside = officeRadius != null && ping?.latitude != null && isFresh(ping.recorded_at, nowMs) && office?.latitude != null &&
    haversineM(office.latitude, office.longitude, ping.latitude, ping.longitude) > officeRadius;

  if (onLeave) status = "leave";
  else if (att?.status === "CHECKED_IN" && (hasFieldVisit || (pingOutside && !att?.office_id))) status = "field";
  else if (att?.status === "CHECKED_IN" || att?.status === "CHECKED_OUT") status = att?.office_id ? "present" : "field";
  else status = isAfterCutoff(new Date(nowMs), cutoffMinutes) ? "absent" : "notyet";

  const late = !!checkin && (() => {
    const d = toUTC(checkin);
    return !!d && isAfterCutoff(d, cutoffMinutes);
  })();

  return {
    id: profile.id, name: profile.name, role: profile.role, team: profile.team ?? null,
    employee_number: profile.employee_number ?? null,
    status, checkin_time: checkin, checkout_time: checkout,
    office_name: office?.name ?? null, last_ping: ping?.recorded_at ?? null,
    mismatch_m, late, open_tasks: tasks.open, overdue_tasks: tasks.overdue,
    ping_lat: ping?.latitude ?? null, ping_lon: ping?.longitude ?? null,
    ping_fresh: isFresh(ping?.recorded_at ?? null, nowMs),
  };
}

// ── Member last-ping map (Google Maps via WebView) ────────────────────────────
const GMAPS_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

function buildPingMapHtml(lat: number, lon: number, name: string): string {
  const safe = name.replace(/'/g, "\\'").replace(/"/g, "&quot;");
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<script src="https://maps.googleapis.com/maps/api/js?key=${GMAPS_KEY}&libraries=marker"><\/script>
<style>*{margin:0;padding:0}html,body,#map{width:100%;height:100%}</style>
</head><body><div id="map"></div>
<script>
  var map=new google.maps.Map(document.getElementById('map'),{center:{lat:${lat},lng:${lon}},zoom:16,mapTypeControl:false,streetViewControl:false,fullscreenControl:false,gestureHandling:'greedy',mapId:'DEMO_MAP_ID'});
  new google.maps.marker.AdvancedMarkerElement({position:{lat:${lat},lng:${lon}},map:map,title:'${safe}'});
<\/script></body></html>`;
}

function MemberLocationModal({ member, onClose }: { member: Member; onClose: () => void }) {
  const { theme } = useTheme();
  const [ready, setReady] = useState(false);
  const lat = member.ping_lat!;
  const lon = member.ping_lon!;
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;

  const openInGoogleMaps = () => Linking.openURL(mapsUrl);

  // Web: render iframe via Google Maps Embed API (WebView not supported on web)
  const embedUrl = `https://www.google.com/maps/embed/v1/place?key=${GMAPS_KEY}&q=${lat},${lon}&zoom=16`;

  return (
    <Modal visible animationType="slide" transparent={false} presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: theme.backgroundDefault }}>
        {/* Header */}
        <View style={[locStyles.header, { backgroundColor: theme.backgroundDefault, borderBottomColor: theme.border }]}>
          <Pressable onPress={onClose} style={locStyles.backBtn}>
            <Feather name="arrow-left" size={20} color={theme.text} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <ThemedText type="h4" numberOfLines={1}>{toTitleCase(member.name)}</ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              {member.last_ping ? `Last ping · ${formatTime(member.last_ping)}` : "Last known location"}
            </ThemedText>
          </View>
          <Pressable onPress={openInGoogleMaps} style={locStyles.gmapsBtn}>
            <Feather name="navigation" size={14} color="#fff" />
            <Text style={locStyles.gmapsBtnText}>Google Maps</Text>
          </Pressable>
        </View>

        {/* Map */}
        <View style={{ flex: 1 }}>
          {Platform.OS === "web" ? (
            // @ts-ignore — iframe is valid on web
            <iframe
              src={embedUrl}
              style={{ width: "100%", height: "100%", border: "none" }}
              allowFullScreen
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          ) : (
            <>
              {!ready && (
                <View style={[StyleSheet.absoluteFill, locStyles.loader]}>
                  <ActivityIndicator color="#6D1B6D" size="large" />
                </View>
              )}
              <WebView
                source={{ html: buildPingMapHtml(lat, lon, member.name) }}
                style={{ flex: 1 }}
                onLoadEnd={() => setReady(true)}
                javaScriptEnabled
                domStorageEnabled
                originWhitelist={["*"]}
                mixedContentMode="always"
              />
            </>
          )}
        </View>

        {/* Footer coords */}
        <View style={[locStyles.footer, { backgroundColor: theme.backgroundDefault, borderTopColor: theme.border }]}>
          <Feather name="map-pin" size={13} color="#6D1B6D" />
          <ThemedText type="caption" style={{ color: "#6D1B6D", fontWeight: "700", marginLeft: 6 }}>
            {lat.toFixed(6)}, {lon.toFixed(6)}
          </ThemedText>
        </View>
      </View>
    </Modal>
  );
}

const locStyles = StyleSheet.create({
  header: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 16, paddingTop: 52, paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { padding: 4 },
  gmapsBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "#6D1B6D", paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8,
  },
  gmapsBtnText: { color: "#fff", fontWeight: "700", fontSize: 12 },
  loader: { alignItems: "center", justifyContent: "center", zIndex: 10 },
  footer: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});

// ── Member drill-down (day timeline + tasks) ──────────────────────────────────
function MemberDrawer({ member, onClose }: { member: Member | null; onClose: () => void }) {
  const { theme } = useTheme();
  const [showMap, setShowMap] = useState(false);
  if (!member) return null;
  const s = STATUS[member.status];
  const hasLocation = member.ping_lat != null && member.ping_lon != null;
  return (
    <>
    {showMap && hasLocation && <MemberLocationModal member={member} onClose={() => setShowMap(false)} />}
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <View style={[styles.sheet, { backgroundColor: theme.backgroundDefault }]} onStartShouldSetResponder={() => true}>
          <View style={styles.sheetHandle} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: Spacing.md }}>
            <Avatar name={member.name} size={52} />
            <View style={{ flex: 1 }}>
              <ThemedText type="h3">{toTitleCase(member.name)}</ThemedText>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                {toTitleCase(member.role?.replace(/_/g, " "))}{member.team ? ` · ${member.team}` : ""}{member.employee_number ? ` · #${member.employee_number}` : ""}
              </ThemedText>
            </View>
            <StatusChip status={member.status} />
          </View>

          <ThemedText type="caption" style={{ color: theme.textSecondary, letterSpacing: 1, fontWeight: "700", marginBottom: 6 }}>TODAY</ThemedText>
          <View style={[styles.timelineCard, { borderColor: theme.border }]}>
            <TimelineRow icon="log-in" color={STATUS.present.color}
              label="Check-in" value={member.checkin_time ? `${formatTime(member.checkin_time)}${member.late ? "  · late" : ""}` : "No check-in recorded"} />
            <TimelineRow icon="map-pin" color={s.color}
              label="Location" value={member.office_name ?? (member.status === "field" ? "On field" : "—")}
              extra={member.mismatch_m != null ? `${member.mismatch_m >= 1000 ? (member.mismatch_m / 1000).toFixed(1) + " km" : member.mismatch_m + "m"} from office` : undefined} />
            <TimelineRow icon="radio" color={member.ping_fresh ? STATUS.present.color : STATUS.leave.color}
              label="Last ping" value={member.last_ping ? formatTime(member.last_ping) : "No ping yet"} />
            <TimelineRow icon="log-out" color={STATUS.absent.color}
              label="Check-out" value={member.checkout_time ? formatTime(member.checkout_time) : "—"} last />
          </View>

          {hasLocation && (
            <Pressable
              onPress={() => setShowMap(true)}
              style={({ pressed }) => [styles.mapBtn, { opacity: pressed ? 0.8 : 1 }]}
            >
              <Feather name="map" size={15} color="#fff" />
              <ThemedText type="small" style={{ color: "#fff", fontWeight: "700", marginLeft: 6 }}>View Last Location on Map</ThemedText>
            </Pressable>
          )}

          <ThemedText type="caption" style={{ color: theme.textSecondary, letterSpacing: 1, fontWeight: "700", marginTop: Spacing.lg, marginBottom: 6 }}>OPEN TASKS</ThemedText>
          <View style={[styles.timelineCard, { borderColor: theme.border, flexDirection: "row", gap: 10 }]}>
            <View style={[styles.miniStat, { backgroundColor: "#F0EAF5" }]}>
              <ThemedText style={{ fontSize: 20, fontWeight: "800", color: "#6D1B6D" }}>{member.open_tasks}</ThemedText>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>Open</ThemedText>
            </View>
            <View style={[styles.miniStat, { backgroundColor: member.overdue_tasks > 0 ? "#FDEAEB" : "#F0EAF5" }]}>
              <ThemedText style={{ fontSize: 20, fontWeight: "800", color: member.overdue_tasks > 0 ? "#C8252D" : "#6D1B6D" }}>{member.overdue_tasks}</ThemedText>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>Overdue</ThemedText>
            </View>
          </View>

          <Pressable style={styles.closeBtn} onPress={onClose}>
            <ThemedText type="body" style={{ color: "#fff", fontWeight: "700" }}>Close</ThemedText>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
    </>
  );
}
function TimelineRow({ icon, color, label, value, extra, last }: any) {
  const { theme } = useTheme();
  return (
    <View style={[styles.tlRow, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border }]}>
      <View style={[styles.tlIcon, { backgroundColor: color + "1A" }]}>
        <Feather name={icon} size={14} color={color} />
      </View>
      <ThemedText type="small" style={{ color: theme.textSecondary, width: 86 }}>{label}</ThemedText>
      <View style={{ flex: 1 }}>
        <ThemedText type="small" style={{ color: theme.text, fontWeight: "600" }}>{value}</ThemedText>
        {extra ? <ThemedText type="caption" style={{ color: STATUS.absent.color }}>{extra}</ThemedText> : null}
      </View>
    </View>
  );
}

// ── Team card (collapsed) ──────────────────────────────────────────────────────
function TeamCard({ group, onOpen }: { group: TeamGroup; onOpen: () => void }) {
  const { theme } = useTheme();
  const present = group.members.filter((m) => m.status === "present").length;
  const field = group.members.filter((m) => m.status === "field").length;
  const late = group.members.filter((m) => m.late).length;
  const allIn = group.members.length > 0 && group.members.every((m) => m.status === "present" || m.status === "field" || m.status === "leave");

  let chipLabel = "", chipColor = STATUS.present.color, chipBg = STATUS.present.bg;
  if (late > 0) { chipLabel = `${late} late`; chipColor = STATUS.leave.color; chipBg = STATUS.leave.bg; }
  else if (field > 0) { chipLabel = `${field} on field`; chipColor = STATUS.field.color; chipBg = STATUS.field.bg; }
  else if (allIn) { chipLabel = "All in"; }

  return (
    <Pressable onPress={onOpen} style={({ pressed }) => [styles.teamCard, { backgroundColor: theme.backgroundDefault, borderColor: theme.border, opacity: pressed ? 0.92 : 1 }]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Avatar name={group.teamName} size={48} square />
        <View style={{ flex: 1 }}>
          <ThemedText type="h4" numberOfLines={1} style={{ color: theme.text }}>{group.teamName}</ThemedText>
          <ThemedText type="caption" style={{ color: theme.textSecondary }} numberOfLines={1}>
            {toTitleCase(group.leadName)} · {group.members.length} member{group.members.length !== 1 ? "s" : ""}
          </ThemedText>
        </View>
        {chipLabel ? (
          <View style={[styles.chip, { backgroundColor: chipBg }]}>
            <ThemedText type="caption" style={{ color: chipColor, fontWeight: "700", fontSize: 11 }}>{chipLabel}</ThemedText>
          </View>
        ) : null}
        <Feather name="chevron-right" size={18} color={theme.textTertiary} />
      </View>
      <View style={{ marginTop: 10 }}>
        <SegmentBar members={group.members} />
      </View>
    </Pressable>
  );
}

// ── Member row ──────────────────────────────────────────────────────────────────
function MemberRow({ member, onOpen }: { member: Member; onOpen: () => void }) {
  const { theme } = useTheme();
  return (
    <Pressable onPress={onOpen} style={({ pressed }) => [styles.memberRow, { backgroundColor: theme.backgroundDefault, borderColor: theme.border, opacity: pressed ? 0.92 : 1 }]}>
      <Avatar name={member.name} size={42} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <ThemedText type="small" style={{ color: theme.text, fontWeight: "700" }} numberOfLines={1}>{toTitleCase(member.name)}</ThemedText>
        <ThemedText type="caption" style={{ color: theme.textSecondary }} numberOfLines={1}>
          {toTitleCase(member.role?.replace(/_/g, " "))}{member.team ? ` · ${member.team}` : ""}{member.employee_number ? ` · #${member.employee_number}` : ""}
        </ThemedText>
      </View>
      <View style={{ alignItems: "flex-end", gap: 4 }}>
        <StatusChip status={member.status} time={member.status === "present" ? member.checkin_time : null} />
        {member.overdue_tasks > 0 ? (
          <ThemedText type="caption" style={{ color: STATUS.absent.color, fontSize: 10 }}>{member.overdue_tasks} overdue</ThemedText>
        ) : null}
      </View>
    </Pressable>
  );
}

// ── Needs Attention card ─────────────────────────────────────────────────────────
function AttentionCard({ item, onOpen }: { item: Attention; onOpen: () => void }) {
  const { theme } = useTheme();
  const cfg = item.kind === "mismatch"
    ? { icon: "alert-triangle" as const, color: STATUS.absent.color, bg: STATUS.absent.bg }
    : item.kind === "late"
    ? { icon: "clock" as const, color: STATUS.leave.color, bg: STATUS.leave.bg }
    : { icon: "check-square" as const, color: STATUS.field.color, bg: STATUS.field.bg };
  return (
    <Pressable onPress={onOpen} style={({ pressed }) => [styles.attnCard, { backgroundColor: theme.backgroundDefault, borderColor: theme.border, opacity: pressed ? 0.92 : 1 }]}>
      <View style={[styles.attnAccent, { backgroundColor: cfg.color }]} />
      <View style={[styles.attnIcon, { backgroundColor: cfg.bg }]}>
        <Feather name={cfg.icon} size={16} color={cfg.color} />
      </View>
      <View style={{ flex: 1 }}>
        <ThemedText type="small" style={{ color: theme.text, fontWeight: "700" }} numberOfLines={1}>{item.detail}</ThemedText>
        <ThemedText type="caption" style={{ color: theme.textSecondary }} numberOfLines={1}>{toTitleCase(item.member.name)} · {toTitleCase(item.member.role?.replace(/_/g, " "))}</ThemedText>
      </View>
      <Feather name="chevron-right" size={16} color={theme.textTertiary} />
    </Pressable>
  );
}

// ── Main screen ──────────────────────────────────────────────────────────────────
export default function MyTeamScreen({ navigation }: { navigation?: any }) {
  const { theme } = useTheme();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [groups, setGroups] = useState<TeamGroup[]>([]);
  const [flatMembers, setFlatMembers] = useState<Member[]>([]);
  const [attention, setAttention] = useState<Attention[]>([]);
  const [openTeam, setOpenTeam] = useState<TeamGroup | null>(null);
  const [selected, setSelected] = useState<Member | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number>(Date.now());
  const [afterPolicyCutoff, setAfterPolicyCutoff] = useState(false);
  const [, force] = useState(0);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);

  // live "updated Xs ago" ticker
  useEffect(() => {
    tick.current = setInterval(() => force((n) => n + 1), 1000);
    return () => { if (tick.current) clearInterval(tick.current); };
  }, []);

  const loadData = useCallback(async () => {
    if (!user?.id) { setLoading(false); return; }
    try {
    const [clock, policy] = await Promise.all([
      BusinessClockService.get(true),
      AttendanceService.getPolicy(user.id),
    ]);
    const today = clock.date;
    const todayIST = clock.date;
    const todayStart = new Date(`${today}T00:00:00+05:30`).toISOString();
    const todayEnd = new Date(`${today}T23:59:59.999+05:30`).toISOString();
    const [cutoffHour, cutoffMinute] = policy.late_checkin_time
      .split(":")
      .map(Number);
    const cutoffMinutes = cutoffHour * 60 + cutoffMinute;
    const serverNowMs = Date.parse(clock.now);
    setAfterPolicyCutoff(isAfterCutoff(new Date(serverNowMs), cutoffMinutes));
    const profilesRes = await fetchAllPages<any>(
      (from, to) => supabase.from("profiles")
        .select("id,name,role,team,employee_number,reports_to,is_active")
        .eq("is_active", true).order("id").range(from, to),
    );
    if (profilesRes.error) throw profilesRes.error;
    const profiles: any[] = profilesRes?.data ?? [];
    const childrenOf: Record<string, any[]> = {};
    for (const p of profiles) {
      if (!p.reports_to) continue;
      (childrenOf[p.reports_to] ||= []).push(p);
    }
    // BFS subtree under the current lead
    const subtree: any[] = [];
    const queue = [...(childrenOf[user.id] ?? [])];
    const seen = new Set<string>();
    while (queue.length) {
      const p = queue.shift()!;
      if (seen.has(p.id)) continue;
      seen.add(p.id); subtree.push(p);
      for (const c of childrenOf[p.id] ?? []) queue.push(c);
    }
    const subtreeIds = subtree.map((p) => p.id);
    if (subtreeIds.length === 0) {
      setGroups([]); setFlatMembers([]); setAttention([]); setLoading(false); setUpdatedAt(Date.now()); return;
    }

    const [attRes, visitRes, leaveRes, pingRes, officeRes, taskRes]: any[] = await Promise.all([
      fetchAllPages<any>((from, to) => supabase.from("attendance_logs").select("id,user_id,status,checkin_time,checkout_time,office_id,checkin_location").eq("date", today).in("user_id", subtreeIds).order("user_id").order("id").range(from, to)),
      fetchAllPages<any>((from, to) => supabase.from("field_visits").select("id,user_id,visit_type,checkin_time,checkout_time,status").eq("date", todayIST).in("user_id", subtreeIds).order("user_id").order("id").range(from, to)),
      fetchAllPages<any>((from, to) => supabase.from("leave_requests").select("id,user_id").eq("status", "approved").lte("start_date", today).gte("end_date", today).in("user_id", subtreeIds).order("user_id").order("id").range(from, to)),
      fetchAllPages<any>((from, to) => supabase.from("location_tracking").select("id,user_id,latitude,longitude,recorded_at,source").gte("recorded_at", todayStart).lte("recorded_at", todayEnd).in("user_id", subtreeIds).order("recorded_at", { ascending: false }).order("id").range(from, to)),
      fetchAllPages<any>((from, to) =>
        supabase.from("offices")
          .select("id,name,latitude,longitude,attendance_radius,allowed_radius_meters")
          .order("id").range(from, to),
      ),
      fetchAllPages<any>((from, to) => supabase.from("tasks").select("id,assigned_to,status,due_date").in("assigned_to", subtreeIds).order("assigned_to").order("id").range(from, to)),
    ]);
    const queryFailure = [attRes, visitRes, leaveRes, pingRes, officeRes, taskRes]
      .find((result) => result?.error);
    if (queryFailure?.error) throw queryFailure.error;

    const attBy: Record<string, any> = {};
    for (const a of attRes?.data ?? []) attBy[a.user_id] = a;
    const visitBy: Record<string, any> = {};
    for (const v of visitRes?.data ?? []) if (!visitBy[v.user_id] || (!v.checkout_time)) visitBy[v.user_id] = v;
    const leaveSet = new Set((leaveRes?.data ?? []).map((l: any) => l.user_id));
    const pingBy: Record<string, any> = {};
    for (const p of pingRes?.data ?? []) if (!pingBy[p.user_id]) pingBy[p.user_id] = p;
    const officeBy: Record<string, any> = {};
    for (const o of officeRes?.data ?? []) officeBy[o.id] = o;
    const taskBy: Record<string, { open: number; overdue: number }> = {};
    for (const t of taskRes?.data ?? []) {
      const rec = (taskBy[t.assigned_to] ||= { open: 0, overdue: 0 });
      const done = ["completed", "done", "closed"].includes((t.status ?? "").toLowerCase());
      if (done) continue;
      rec.open += 1;
      if (isDueDateOverdue(t.due_date, today)) rec.overdue += 1;
    }

    const buildMember = (p: any): Member =>
      computeMember(p, attBy[p.id], visitBy[p.id], leaveSet.has(p.id),
        attBy[p.id]?.office_id ? officeBy[attBy[p.id].office_id] : null,
        pingBy[p.id], taskBy[p.id] ?? { open: 0, overdue: 0 },
        serverNowMs, cutoffMinutes);

    const allMembers = subtree.map(buildMember);

    // Group into sub-teams: a direct report who themselves has reports = a team lead
    const directReports = childrenOf[user.id] ?? [];
    const teamLeads = directReports.filter((d) => (childrenOf[d.id] ?? []).length > 0);
    const grps: TeamGroup[] = [];
    if (teamLeads.length > 0) {
      for (const lead of teamLeads) {
        const ids = new Set<string>();
        const q = [...(childrenOf[lead.id] ?? [])];
        while (q.length) { const c = q.shift()!; if (ids.has(c.id)) continue; ids.add(c.id); for (const cc of childrenOf[c.id] ?? []) q.push(cc); }
        const members = allMembers.filter((m) => ids.has(m.id));
        members.unshift(buildMember(lead));
        grps.push({ leadId: lead.id, leadName: lead.name, teamName: lead.team || toTitleCase(lead.name) + "'s Team", members });
      }
      // direct individual contributors (no sub-team)
      const directMembers = directReports.filter((d) => (childrenOf[d.id] ?? []).length === 0).map(buildMember);
      if (directMembers.length) grps.push({ leadId: user.id, leadName: user.name ?? "", teamName: "Direct reports", members: directMembers });
    }

    // Needs attention (across whole subtree)
    const attn: Attention[] = [];
    for (const m of allMembers) {
      if (m.mismatch_m != null)
        attn.push({ kind: "mismatch", member: m, detail: `Distance mismatch · ${m.mismatch_m >= 1000 ? (m.mismatch_m / 1000).toFixed(1) + " km" : m.mismatch_m + "m"} from ${m.office_name ?? "office"}` });
    }
    const lateOnes = allMembers.filter((m) => m.late);
    if (lateOnes.length)
      attn.push({ kind: "late", member: lateOnes[0], detail: `${lateOnes.length} late check-in${lateOnes.length > 1 ? "s" : ""} · after ${policy.late_checkin_time} policy cutoff` });
    const overdueOnes = allMembers.filter((m) => m.overdue_tasks > 0);
    for (const m of overdueOnes.slice(0, 3))
      attn.push({ kind: "overdue", member: m, detail: `${m.overdue_tasks} overdue task${m.overdue_tasks > 1 ? "s" : ""}` });

    setGroups(grps);
    setFlatMembers(teamLeads.length > 0 ? [] : allMembers);
    setAttention(attn);
    setUpdatedAt(Date.now());
    setLoading(false);
    } catch (error: any) {
      setLoading(false);
      Alert.alert("Team data unavailable", error?.message || "A team query failed.");
    }
  }, [user?.id, user?.name]);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    loadData();
    const ch = supabase.channel("myteam-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "attendance_logs" }, loadData)
      .on("postgres_changes", { event: "*", schema: "public", table: "location_tracking" }, loadData)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [loadData]));

  const onRefresh = async () => { setRefreshing(true); await loadData(); setRefreshing(false); };

  // roll-up counts across everyone in view
  const everyone = groups.length > 0 ? groups.flatMap((g) => g.members) : flatMembers;
  const dedup = Array.from(new Map(everyone.map((m) => [m.id, m])).values());
  const present = dedup.filter((m) => m.status === "present").length;
  const field = dedup.filter((m) => m.status === "field").length;
  const leave = dedup.filter((m) => m.status === "leave").length;
  const notyet = dedup.filter((m) => m.status === "notyet").length;
  const absent = dedup.filter((m) => m.status === "absent").length;
  const scheduledEmployees = dedup.length - leave;
  const rate = scheduledEmployees > 0
    ? Math.round(((present + field) / scheduledEmployees) * 100)
    : 100;
  const agoSec = Math.floor((Date.now() - updatedAt) / 1000);

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: theme.backgroundRoot }]}>
        <ActivityIndicator color="#6D1B6D" size="large" />
        <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: 12 }}>Loading your team…</ThemedText>
      </View>
    );
  }

  if (dedup.length === 0) {
    return (
      <View style={[styles.center, { backgroundColor: theme.backgroundRoot, padding: 32 }]}>
        <Feather name="users" size={34} color={theme.textTertiary} />
        <ThemedText type="h4" style={{ color: theme.text, marginTop: 12 }}>No team members yet</ThemedText>
        <ThemedText type="caption" style={{ color: theme.textSecondary, textAlign: "center", marginTop: 4 }}>
          People who report to you will appear here once they're assigned in HR records.
        </ThemedText>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.backgroundRoot }}
      contentContainerStyle={{ paddingBottom: 120, paddingTop: 8 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6D1B6D" />}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <View>
            <ThemedText type="h2" style={{ color: theme.text, fontWeight: "800" }}>Team Reports</ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>{formatDate(new Date())}</ThemedText>
          </View>
          <View style={styles.liveTag}>
            <View style={styles.livePulse} />
            <ThemedText type="caption" style={{ color: STATUS.present.color, fontWeight: "700", fontSize: 11 }}>
              Live · {liveAgo(agoSec)}
            </ThemedText>
          </View>
        </View>
      </View>

      {/* 4-pill strip */}
      <View style={styles.pillStrip}>
        <Pill value={present} label="Present" color={STATUS.present.color} bg={STATUS.present.bg} />
        <Pill value={field} label="On field" color={STATUS.field.color} bg={STATUS.field.bg} />
        <Pill value={leave} label="On leave" color={STATUS.leave.color} bg={STATUS.leave.bg} />
        <Pill value={notyet + absent} label="Not in yet" color={afterPolicyCutoff ? STATUS.absent.color : STATUS.notyet.color} bg={afterPolicyCutoff ? STATUS.absent.bg : STATUS.notyet.bg} />
      </View>
      <ThemedText type="caption" style={{ color: theme.textSecondary, paddingHorizontal: Spacing.lg, marginTop: 2 }}>
        Attendance rate {rate}% · {dedup.length} people
      </ThemedText>

      {/* Needs Attention (pinned) */}
      <SectionTitle title="Needs attention" />
      {attention.length === 0 ? (
        <View style={[styles.okCard, { marginHorizontal: Spacing.lg }]}>
          <Feather name="check-circle" size={18} color={STATUS.present.color} />
          <ThemedText type="small" style={{ color: STATUS.present.color, fontWeight: "600", marginLeft: 8 }}>Nothing needs attention right now</ThemedText>
        </View>
      ) : (
        <View style={{ paddingHorizontal: Spacing.lg, gap: 8 }}>
          {attention.map((a, i) => (
            <AttentionCard key={i} item={a} onOpen={() => setSelected(a.member)} />
          ))}
        </View>
      )}

      {/* Teams or member list */}
      <SectionTitle title={groups.length > 0 ? "My teams" : "Team members"} />
      <View style={{ paddingHorizontal: Spacing.lg, gap: 10 }}>
        {groups.length > 0
          ? groups.map((g) => <TeamCard key={g.leadId} group={g} onOpen={() => setOpenTeam(g)} />)
          : flatMembers.map((m) => <MemberRow key={m.id} member={m} onOpen={() => setSelected(m)} />)}
      </View>

      {/* Team drill-down */}
      <Modal visible={!!openTeam} animationType="slide" transparent onRequestClose={() => setOpenTeam(null)}>
        <Pressable style={styles.overlay} onPress={() => setOpenTeam(null)}>
          <View style={[styles.sheet, { backgroundColor: theme.backgroundDefault, maxHeight: "88%" }]} onStartShouldSetResponder={() => true}>
            <View style={styles.sheetHandle} />
            {openTeam && (
              <>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 4 }}>
                  <Avatar name={openTeam.teamName} size={44} square />
                  <View style={{ flex: 1 }}>
                    <ThemedText type="h3">{openTeam.teamName}</ThemedText>
                    <ThemedText type="caption" style={{ color: theme.textSecondary }}>{toTitleCase(openTeam.leadName)} · {openTeam.members.length} members</ThemedText>
                  </View>
                  <Pressable onPress={() => setOpenTeam(null)}><Feather name="x" size={22} color={theme.textSecondary} /></Pressable>
                </View>
                <View style={{ marginVertical: 10 }}><SegmentBar members={openTeam.members} height={10} /></View>
                <ScrollView showsVerticalScrollIndicator={false}>
                  <View style={{ gap: 8, paddingBottom: 24 }}>
                    {openTeam.members.map((m) => (
                      <MemberRow key={m.id} member={m} onOpen={() => { setSelected(m); }} />
                    ))}
                  </View>
                </ScrollView>
              </>
            )}
          </View>
        </Pressable>
      </Modal>

      <MemberDrawer member={selected} onClose={() => setSelected(null)} />
    </ScrollView>
  );
}

function SectionTitle({ title }: { title: string }) {
  const { theme } = useTheme();
  return (
    <View style={{ paddingHorizontal: Spacing.lg, marginTop: Spacing.xl, marginBottom: Spacing.sm }}>
      <ThemedText type="caption" style={{ color: "#6D1B6D", letterSpacing: 1.5, fontWeight: "800", fontSize: 12 }}>
        {title.toUpperCase()}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.sm },
  liveTag: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: STATUS.present.bg, paddingHorizontal: 10, paddingVertical: 5, borderRadius: BorderRadius.full,
  },
  livePulse: { width: 7, height: 7, borderRadius: 4, backgroundColor: STATUS.present.color },
  pillStrip: { flexDirection: "row", gap: 8, paddingHorizontal: Spacing.lg, marginTop: Spacing.sm },
  pill: {
    flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: BorderRadius.lg,
    backgroundColor: "#FFFFFF", borderWidth: 1.5,
    ...(Platform_OS_web() ? { boxShadow: "0 2px 8px rgba(109,27,109,0.06)" } as any : {
      shadowColor: "#6D1B6D", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
    }),
  },
  chip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 9, paddingVertical: 4, borderRadius: BorderRadius.full },
  dot: { width: 6, height: 6, borderRadius: 3 },
  segTrack: { flexDirection: "row", width: "100%", backgroundColor: "#E8DEEE", overflow: "hidden" },
  teamCard: {
    borderRadius: BorderRadius.xl, borderWidth: 1, padding: Spacing.md,
    ...(Platform_OS_web() ? { boxShadow: "0 2px 10px rgba(109,27,109,0.06)" } as any : {
      shadowColor: "#6D1B6D", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 10, elevation: 2,
    }),
  },
  memberRow: { flexDirection: "row", alignItems: "center", borderRadius: BorderRadius.lg, borderWidth: 1, padding: Spacing.sm + 2 },
  attnCard: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: BorderRadius.lg, borderWidth: 1, padding: Spacing.sm + 2, overflow: "hidden" },
  attnAccent: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4 },
  attnIcon: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center", marginLeft: 4 },
  okCard: {
    flexDirection: "row", alignItems: "center", padding: Spacing.md, borderRadius: BorderRadius.lg,
    backgroundColor: STATUS.present.bg,
  },
  overlay: { flex: 1, backgroundColor: "rgba(20,8,28,0.5)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: BorderRadius["2xl"], borderTopRightRadius: BorderRadius["2xl"], padding: Spacing.lg, paddingBottom: 36, maxHeight: "82%" },
  sheetHandle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: "#D6C7E0", marginBottom: 14 },
  timelineCard: { borderRadius: BorderRadius.lg, borderWidth: 1, padding: Spacing.sm },
  tlRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10 },
  tlIcon: { width: 28, height: 28, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  miniStat: { flex: 1, alignItems: "center", paddingVertical: 14, borderRadius: BorderRadius.md },
  closeBtn: { marginTop: Spacing.lg, backgroundColor: "#6D1B6D", borderRadius: BorderRadius.lg, alignItems: "center", paddingVertical: 14 },
  mapBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    marginTop: Spacing.md, backgroundColor: "#1A5FD4",
    borderRadius: BorderRadius.lg, paddingVertical: 11,
  },
});

// tiny inline platform check to keep the StyleSheet self-contained
function Platform_OS_web() {
  try { const { Platform } = require("react-native"); return Platform.OS === "web"; } catch { return false; }
}
