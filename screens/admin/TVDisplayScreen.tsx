import React, { useEffect, useRef, useCallback, useState } from "react";
import {
  StyleSheet, View, Text, ScrollView, Modal,
  Platform, Pressable, Dimensions, ActivityIndicator,
  Animated, LayoutChangeEvent,
} from "react-native";
import { supabase } from "@/lib/supabase";
import { TrackingAdminService } from "@/services/tracking-admin.service";
import { toTitleCase } from "@/utils/format";
import { useAuth } from "@/contexts/AuthContext";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { reportNonFatalError } from "@/utils/operationalErrors";
import { formatHrmsTime, getBusinessDateIST } from "@/utils/attendanceTimestamp";
import {
  CanonicalAttendanceDay,
  CanonicalAttendanceService,
} from "@/services/canonical-attendance.service";
import { classifyTvAttendance } from "@/services/tv-occupancy";

const IS_WEB = Platform.OS === "web";
const { width: SW, height: SH } = Dimensions.get("window");
const IS_WIDE = IS_WEB && SW >= 768; // true only on wide web (desktop/tablet)

const C = {
  bg:         "#1a1625",
  cardBg:     "#211c2e",
  cardBorder: "#2e2740",
  text:       "#e2dded",
  textMuted:  "#6b6280",
  textDim:    "#3d3550",
  green:      "#2dd87a",
  pink:       "#e8417a",
  purple:     "#a855f7",
  teal:       "#22d3ee",
  amber:      "#f59e0b",
};

// ── Types ──────────────────────────────────────────────────────────────────
interface FeedItem {
  key: string;
  name: string;       // employee full name
  office: string;     // office name
  time: string;       // formatted IST time
  isIn: boolean;      // true = check-in, false = check-out
  isNew?: boolean;    // highlight newest entry
}
interface OfficeStat {
  id: string;
  name: string;
  present: number;  // checked-in today (not checked out)
  total: number;    // assigned employees (profiles.office_id)
}
interface AlertCard {
  key: string;
  emoji: string;
  text: string;
  bg: string;
  border: string;
}
interface FraudPerson {
  name: string;
  reason: string;
  distance?: number;
}
interface PersonItem {
  name: string;
  sub?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────
function toIST(iso: string | null): string {
  if (!iso) return "—";
  return formatHrmsTime(iso, "No time recorded");
}
function nowHHMM() {
  return new Date().toLocaleTimeString("en-IN", {
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata",
  });
}
function todayIST() {
  return getBusinessDateIST();
}
const AVATAR_COLORS = ["#a855f7","#22d3ee","#2dd87a","#f59e0b","#e8417a","#6366f1","#10b981","#ef4444"];
function initials(name: string | null) {
  if (!name) return "?";
  return name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
}
function avatarColor(name: string | null) {
  if (!name) return AVATAR_COLORS[0];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

// ── Sub-components ─────────────────────────────────────────────────────────
function StatPill({
  value, label, color, icon, onPress,
}: {
  value: number | string; label: string; color: string; icon: string; onPress?: () => void;
}) {
  return (
    <Pressable
      style={[s.pill, { borderColor: color + "44" }]}
      onPress={onPress}
    >
      <Text style={s.pillIcon}>{icon}</Text>
      <Text style={[s.pillVal, { color }]}>{value}</Text>
      <Text style={s.pillLbl}>{label}</Text>
    </Pressable>
  );
}

function FeedRow({ item }: { item: FeedItem }) {
  const ac = avatarColor(item.name);
  return (
    <View style={[s.feedRow, item.isNew && { backgroundColor: item.isIn ? "#0a2e1a" : "#2e0a1a" }]}>
      {/* Avatar circle with initials */}
      <View style={[s.feedAvatar, { backgroundColor: ac + "28", borderColor: ac + "60" }]}>
        <Text style={[s.feedAvatarText, { color: ac }]}>{initials(item.name)}</Text>
      </View>
      {/* Name + office */}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.feedName} numberOfLines={1}>{item.name}</Text>
        <Text style={s.feedOffice} numberOfLines={1}>{item.office}</Text>
      </View>
      {/* Status badge + time */}
      <View style={{ alignItems: "flex-end" }}>
        <View style={[s.feedBadge, { backgroundColor: item.isIn ? C.green + "22" : C.textMuted + "22" }]}>
          <Text style={[s.feedBadgeText, { color: item.isIn ? C.green : C.textMuted }]}>
            {item.isIn ? "CHECK IN" : "CHECK OUT"}
          </Text>
        </View>
        <Text style={[s.feedTime, { color: item.isIn ? C.green : C.textMuted }]}>{item.time}</Text>
      </View>
    </View>
  );
}

function OccupancyRow({ stat }: { stat: OfficeStat }) {
  const animWidth = useRef(new Animated.Value(0)).current;
  const [barContainerWidth, setBarContainerWidth] = useState(0);

  const pct = stat.total > 0 ? stat.present / stat.total : 0;

  useEffect(() => {
    if (barContainerWidth === 0) return;
    const targetWidth = pct > 0
      ? Math.max(pct * barContainerWidth, 6)
      : 6; // always show tiny 6px stub
    Animated.timing(animWidth, {
      toValue: targetWidth,
      duration: 900,
      useNativeDriver: false,
    }).start();
  }, [barContainerWidth, pct]);

  return (
    <View style={s.occRow}>
      <View style={s.occHeader}>
        <Text style={s.occName} numberOfLines={1}>{stat.name}</Text>
        <Text style={s.occFrac}>
          <Text style={{ color: C.green, fontWeight: "700" }}>{stat.present}</Text>
          <Text style={{ color: C.textMuted }}>/{stat.total}</Text>
        </Text>
      </View>
      <View
        style={s.barBg}
        onLayout={(e: LayoutChangeEvent) => setBarContainerWidth(e.nativeEvent.layout.width)}
      >
        <Animated.View
          style={[
            s.barFill,
            { width: animWidth },
            IS_WEB && ({ background: "linear-gradient(90deg, #a855f7, #e8417a)" } as any),
          ]}
        />
      </View>
    </View>
  );
}

function AlertCard({ item }: { item: AlertCard }) {
  return (
    <View style={[s.alertCard, { backgroundColor: item.bg, borderColor: item.border }]}>
      <Text style={s.alertEmoji}>{item.emoji}</Text>
      <Text style={s.alertText} numberOfLines={3}>{item.text}</Text>
    </View>
  );
}

// ── Generic People Modal ───────────────────────────────────────────────────
function PeopleModal({
  visible, title, dotColor, emptyMsg, onClose, children,
}: {
  visible: boolean; title: string; dotColor: string;
  emptyMsg: string; onClose: () => void; children: React.ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.modalOverlay} onPress={onClose}>
        <Pressable style={s.modalBox} onPress={e => e.stopPropagation()}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>{title}</Text>
            <Pressable onPress={onClose} style={s.modalClose}>
              <Text style={{ color: C.textMuted, fontSize: 18 }}>✕</Text>
            </Pressable>
          </View>
          <ScrollView style={{ maxHeight: 440 }}>
            {children}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function PersonRow({ name, sub, dotColor }: { name: string; sub?: string; dotColor: string }) {
  return (
    <View style={s.fraudRow}>
      <View style={[s.fraudDot, { backgroundColor: dotColor }]} />
      <View style={{ flex: 1 }}>
        <Text style={s.fraudName}>{name}</Text>
        {sub ? <Text style={s.fraudReason}>{sub}</Text> : null}
      </View>
    </View>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────
export default function TVDisplayScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [clock,       setClock]       = useState(nowHHMM());
  const [nextPing,    setNextPing]    = useState(30);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState<string | null>(null);
  const [present,     setPresent]     = useState(0);
  const [absent,      setAbsent]      = useState(0);
  const [meetCount,   setMeetCount]   = useState(0);
  const [routeCount,  setRouteCount]  = useState(0);
  const [fraudCount,  setFraudCount]  = useState(0);
  const [fraudPeople,   setFraudPeople]   = useState<FraudPerson[]>([]);
  const [presentPeople, setPresentPeople] = useState<PersonItem[]>([]);
  const [absentPeople,  setAbsentPeople]  = useState<PersonItem[]>([]);
  const [meetPeople,    setMeetPeople]    = useState<PersonItem[]>([]);
  const [routePeople,   setRoutePeople]   = useState<PersonItem[]>([]);
  const [showFraud,     setShowFraud]     = useState(false);
  const [modal,         setModal]         = useState<null|"present"|"absent"|"meetings"|"route">(null);
  const [feed,          setFeed]          = useState<FeedItem[]>([]);
  const [offices,     setOffices]     = useState<OfficeStat[]>([]);
  const [alerts,      setAlerts]      = useState<AlertCard[]>([]);
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const clockRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pingRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const rotateRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const idleRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [feedPage, setFeedPage] = useState(0);
  const [autoRotate, setAutoRotate] = useState(true);
  const PAGE_SIZE = 20;
  const ROTATE_MS = 12000;
  const IDLE_RESUME_MS = 30000;
  // user ids currently checked in — these are the people we actively ping
  const checkedInIdsRef = useRef<string[]>([]);
  const adminIdRef = useRef<string | null>(null);
  adminIdRef.current = user?.id ?? null;

  // Auto-rotate feed pages
  useEffect(() => {
    if (!autoRotate) return;
    rotateRef.current = setInterval(() => {
      setFeedPage((p) => p + 1);
    }, ROTATE_MS);
    return () => { if (rotateRef.current) clearInterval(rotateRef.current); };
  }, [autoRotate]);

  const handleUserInteraction = () => {
    setAutoRotate(false);
    if (rotateRef.current) clearInterval(rotateRef.current);
    if (idleRef.current) clearTimeout(idleRef.current);
    idleRef.current = setTimeout(() => setAutoRotate(true), IDLE_RESUME_MS);
  };

  // Request a fresh location from every checked-in user's device. Each device
  // answers via its ping-request listener using GPS, falling back to the
  // Google Geolocation API (cell tower / WiFi / IP) when GPS is unavailable,
  // and writes the latest coordinates into location_tracking.
  const requestFreshPings = useCallback(async () => {
    const ids = checkedInIdsRef.current;
    const adminId = adminIdRef.current;
    if (!adminId || !ids.length) return;
    try {
      const { error } = await TrackingAdminService.requestPings(ids);
      if (error) throw error;
    } catch (error) {
      void reportNonFatalError("tv_display.ping_round", error);
    }
  }, []);

  useEffect(() => {
    clockRef.current = setInterval(() => setClock(nowHHMM()), 1000);
    pingRef.current  = setInterval(() => setNextPing(p => {
      if (p <= 1) { requestFreshPings(); return 30; } // "next ping" is a real ping round
      return p - 1;
    }), 1000);
    return () => {
      if (clockRef.current) clearInterval(clockRef.current);
      if (pingRef.current)  clearInterval(pingRef.current);
    };
  }, []);

  const load = useCallback(async () => {
    try {
      setError(null);
      const today = todayIST();

      const [canonicalData, alertResult] = await Promise.all([
        CanonicalAttendanceService.listDay(today),
        supabase.from("location_alerts")
          .select("user_id, alert_type, message, distance_m")
          .eq("resolved", false)
          .order("created_at", { ascending: false })
          .limit(10),
      ]);
      const canonicalRows = canonicalData as CanonicalAttendanceDay[];
      const profiles = canonicalRows
        .filter((row) => row.show_on_tv)
        .map((row) => ({ id: row.user_id, name: row.employee_name, role: row.role, office_id: row.office_id }));
      const atts = canonicalRows
        .filter((row) => row.show_on_tv)
        .map((row) => ({
          user_id: row.user_id,
          checkin_time: row.official_first_in,
          checkout_time: row.official_last_out,
          office_id: row.office_id,
          // The canonical view returns the flag as text, so "false" must not count.
          warning: row.warning === true || String(row.warning).toLowerCase() === "true",
          distance_from_office: row.distance_from_office_m,
          attendance_status: row.attendance_status,
          active_field_visit_id: row.active_field_visit_id,
        }));
      const pings = canonicalRows.map((row) => ({
        user_id: row.user_id,
        status: row.tracking_health_reason || row.latest_tracking_status,
        distance_from_base: row.distance_from_office_m,
        recorded_at: row.latest_ping_at,
        stale: row.ping_is_stale,
      }));
      const officeList = Array.from(new Map(canonicalRows
        .filter((row) => row.office_id && row.office_name)
        .map((row) => [row.office_id, { id: row.office_id, name: row.office_name }])).values());
      const fieldVisits = canonicalRows
        .filter((row) => row.active_field_visit_id)
        .map((row) => ({
          user_id: row.user_id,
          visit_type: "field_visit",
          status: "CHECKED_IN",
          location_name: row.active_field_visit_name,
        }));
      const locationAlerts = alertResult.data ?? [];

      // ── Lookup maps ────────────────────────────────────────────────────
      // Title Case all display names at the source (per UI audit, 12 Jun 2026)
      const cleanProfiles = ((profiles ?? []) as any[]).map((p: any) => ({ ...p, name: toTitleCase(p.name) }));
      const profMap = new Map<string, { name: string; role: string; office_id: string | null }>();
      for (const p of cleanProfiles) profMap.set(p.id, p);

      const offMap = new Map<string, string>();
      for (const o of (officeList ?? []) as any[]) offMap.set(o.id, o.name);

      // Latest attendance per user (already ordered desc)
      const attMap = new Map<string, any>();
      for (const a of (atts ?? []) as any[]) {
        if (!attMap.has(a.user_id)) attMap.set(a.user_id, a);
      }

      // Latest ping per user
      const pingMap = new Map<
        string,
        { status: string | null; dist: number; stale: boolean }
      >();
      for (const p of (pings ?? []) as any[]) {
        if (!pingMap.has(p.user_id)) {
          pingMap.set(p.user_id, {
            status: p.status,
            dist: p.distance_from_base ?? 0,
            stale: p.stale === true,
          });
        }
      }

      // Active field visits per user (latest wins)
      const visitMap = new Map<string, any>();
      for (const v of (fieldVisits ?? []) as any[]) {
        if (!visitMap.has(v.user_id)) visitMap.set(v.user_id, v);
      }

      // ── Office occupancy: total assigned from profiles ─────────────────
      // officeStats: id → { name, present, total }
      const officeStats = new Map<string, OfficeStat>();
      for (const o of (officeList ?? []) as any[]) {
        officeStats.set(o.id, { id: o.id, name: o.name, present: 0, total: 0 });
      }

      // ── Employee stats ─────────────────────────────────────────────────
      const filtered = cleanProfiles;

      // Targets for the live ping round: everyone checked in and not yet out
      checkedInIdsRef.current = filtered
        .filter((p: any) => { const a = attMap.get(p.id); return a?.checkin_time && !a?.checkout_time; })
        .map((p: any) => p.id);

      let presentCount = 0, absentCount = 0;
      let meetingCount = 0, inRouteCount = 0;
      const fraudList: FraudPerson[] = [];
      const presentList: PersonItem[] = [];
      const absentList:  PersonItem[] = [];
      const meetList:    PersonItem[] = [];
      const routeList:   PersonItem[] = [];

      for (const p of filtered) {
        const att   = attMap.get(p.id);
        const cIn   = !!att?.checkin_time;
        const cOut  = !!att?.checkout_time;
        const canonicalStatus = String(att?.attendance_status || "NO_DATA");
        const ping  = pingMap.get(p.id);
        const visit = visitMap.get(p.id);

        // Count total assigned per office (from profiles.office_id)
        if (p.office_id && officeStats.has(p.office_id)) {
          officeStats.get(p.office_id)!.total++;
        }

        const occupancy = classifyTvAttendance({
          official_first_in: att?.checkin_time,
          official_last_out: att?.checkout_time,
          attendance_status: canonicalStatus,
          active_field_visit_id: att?.active_field_visit_id,
        });

        if (occupancy.isAbsent) {
          absentCount++;
          absentList.push({ name: p.name, sub: offMap.get(p.office_id) ?? "No office" });
          continue;
        }
        if (occupancy.isActivelyWorking) {
          presentCount++;
          const attOfficeId = att?.office_id;
          if (occupancy.isInOffice && attOfficeId && officeStats.has(attOfficeId)) {
            officeStats.get(attOfficeId)!.present++;
          }
          presentList.push({
            name: p.name,
            sub: `${
              att?.office_id
                ? offMap.get(att.office_id) ?? "Unknown"
                : "Unknown"
            } · ${toIST(att?.checkin_time)}`,
          });
        }

        // Meetings & route
        if (visit && visit.status === "CHECKED_IN") {
          meetingCount++;
          meetList.push({ name: p.name, sub: visit.location_name ?? "Field visit" });
        }
        if (cOut) {
          inRouteCount++;
          routeList.push({ name: p.name, sub: `Checked out ${toIST(att.checkout_time)}` });
        }

        // Fraud detection - users who should be in Distance Mismatch alert
      // This includes:
      // 1. GPS turned off (RED_GPS_OFF status)
      // 2. Out of range (RED_RANGE status) 
      // 3. Checked in with warning flag
      const isFraud =
        ping?.status === "RED_RANGE" ||
        ping?.status === "RED_GPS_OFF" ||
        // Inside the allowed area (incl. the 50-100 m band) or simply no recent
        // ping is normal, not suspicious.
        (att?.warning === true && cIn && !cOut);

      if (isFraud) {
        let reason = "Suspicious check-in";
        if (ping?.status === "RED_GPS_OFF") reason = "GPS turned off";
        else if (ping?.status === "RED_RANGE") reason = "Out of office range";
        else if (att?.warning) reason = "Checked in far from office";
        fraudList.push({ name: p.name, reason, distance: ping?.dist ?? att?.distance_from_office });
      }
      }

      // ── LIVE CHECK-IN FEED (latest 15, name + office + time) ──────────
      const feedItems: FeedItem[] = [];
      for (const a of (atts ?? []) as any[]) {
        const prof = profMap.get(a.user_id);
        if (!prof) continue;
        const oName =
          (a.office_id ? offMap.get(a.office_id) : undefined) ??
          (prof.office_id ? offMap.get(prof.office_id) : undefined) ??
          "Unknown Office";
        // add check-in row
        feedItems.push({
          key:    a.user_id + "_in_" + a.checkin_time,
          name:   prof.name ?? "Unknown",
          office: oName,
          time:   a.checkin_time ? toIST(a.checkin_time) : "—",
          isIn:   true,
          isNew:  feedItems.length === 0,
        });
        // also add check-out row if exists
        if (a.checkout_time) {
          feedItems.push({
            key:    a.user_id + "_out_" + a.checkout_time,
            name:   prof.name ?? "Unknown",
            office: oName,
            time:   toIST(a.checkout_time),
            isIn:   false,
            isNew:  false,
          });
        }
        if (feedItems.length >= 15) break;
      }
      // sort by most recent first (time string is HH:MM so lexicographic works)
      feedItems.sort((a, b) => b.time.localeCompare(a.time));
      if (feedItems.length > 0) feedItems[0].isNew = true;

      // ── OFFICE OCCUPANCY sorted by present desc ────────────────────────
      const offList = Array.from(officeStats.values())
        .sort((a, b) => b.present - a.present || a.name.localeCompare(b.name));

      // ── NEEDS ATTENTION ────────────────────────────────────────────────
      const alertCards: AlertCard[] = [];

      // Real unresolved GPS alerts (deduplicated per user)
      const alertedUsers = new Set<string>();
      for (const al of (locationAlerts ?? []) as any[]) {
        if (alertedUsers.has(al.user_id)) continue;
        alertedUsers.add(al.user_id);
        const prof = profMap.get(al.user_id);
        const name = prof?.name ?? "Unknown";
        const dist = al.distance_m ? ` · ${Math.round(al.distance_m)}m` : "";
        let emoji = "⚠️", bg = "#3d1a0a", border = "#7c3a1a";
        if (al.alert_type === "GPS_OFF" || al.alert_type === "NO_DATA") {
          emoji = "📵"; bg = "#1a1a3d"; border = "#3a3a7c";
        }
        alertCards.push({
          key: al.user_id,
          emoji,
          text: `${name} — ${al.message ?? al.alert_type}${dist}`,
          bg, border,
        });
        if (alertCards.length >= 3) break;
      }

      // Derived: meetings
      if (meetingCount > 0) {
        const names = filtered
          .filter((p: any) => {
            const v = visitMap.get(p.id);
            return v?.visit_type === "meeting" && v?.status === "CHECKED_IN";
          })
          .map((p: any) => p.name.split(" ")[0])
          .slice(0, 3)
          .join(", ");
        alertCards.push({
          key: "meetings",
          emoji: "🤝",
          text: `${meetingCount} meeting${meetingCount > 1 ? "s" : ""} live — ${names}`,
          bg: "#3d2e0a", border: "#7c5c1a",
        });
      }

      // Derived: in route
      if (inRouteCount > 0) {
        alertCards.push({
          key: "route",
          emoji: "🚗",
          text: `${inRouteCount} agent${inRouteCount > 1 ? "s" : ""} in route to site`,
          bg: "#0a1e3d", border: "#1a3a7c",
        });
      }

      if (alertCards.length === 0) {
        alertCards.push({
          key: "ok", emoji: "✅",
          text: "All systems normal — no issues detected",
          bg: "#0a2e1a", border: "#1a5c2a",
        });
      }

      // ── Commit ─────────────────────────────────────────────────────────
      setPresent(presentCount);
      setAbsent(absentCount);
      setMeetCount(meetingCount);
      setRouteCount(inRouteCount);
      setFraudCount(fraudList.length);
      setFraudPeople(fraudList);
      setPresentPeople(presentList);
      setAbsentPeople(absentList);
      setMeetPeople(meetList);
      setRoutePeople(routeList);
      setFeed(feedItems);
      setOffices(offList);
      setAlerts(alertCards);
      setLastRefreshed(formatHrmsTime(new Date(), "Not refreshed"));
      setNextPing(30);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    load();
    timerRef.current = setInterval(load, 30000);
    const ch = supabase.channel("tv-live")
      .on("postgres_changes", { event: "*",      schema: "public", table: "attendance_logs" },    load)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "location_tracking" },  load)
      .on("postgres_changes", { event: "*",      schema: "public", table: "location_alerts" },    load)
      .on("postgres_changes", { event: "*",      schema: "public", table: "field_visits" },       load)
      .subscribe();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (rotateRef.current) clearInterval(rotateRef.current);
      if (idleRef.current) clearTimeout(idleRef.current);
      supabase.removeChannel(ch);
    };
  }, [load]));

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>

      {/* ── HEADER ── */}
      <View style={s.header}>
        <Pressable onPress={() => navigation?.goBack?.()} style={s.backBtn}>
          <Text style={{ color: C.textMuted, fontSize: 22, lineHeight: 24 }}>‹</Text>
        </Pressable>
        <View style={s.brand}>
          <Text style={s.brandBop}>
            bop<Text style={{ color: C.pink }}>.in</Text>
          </Text>
          <Text style={s.brandSub}>  LIVE ATTENDANCE</Text>
        </View>
        <View style={{ flex: 1 }} />
        <Text style={s.feedOffice}>Last refreshed {lastRefreshed ?? "pending"}</Text>
        <View style={s.liveRow}>
          <View style={s.liveDot} />
          <Text style={s.liveTxt}>{IS_WEB ? `LIVE · ${nextPing}s` : "LIVE"}</Text>
        </View>
        <Text style={s.clock}>{clock}</Text>
      </View>

      {/* ── STAT PILLS ── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={s.pillsScroll}
        contentContainerStyle={s.pillsContent}
      >
        <StatPill value={present}    label="PRESENT"  color={C.green}  icon="👤" onPress={() => setModal("present")} />
        <StatPill value={absent}     label="ABSENT"   color={C.pink}   icon="👤" onPress={() => setModal("absent")} />
        <StatPill value={meetCount}  label="FIELD VISITS" color={C.amber}  icon="🤝" onPress={() => setModal("meetings")} />
        <StatPill value={routeCount} label="CHECKED OUT" color={C.teal}   icon="🚗" onPress={() => setModal("route")} />
        <StatPill value={fraudCount} label="FRAUD"    color={C.purple} icon="⚠️" onPress={() => setShowFraud(true)} />
      </ScrollView>

      {/* ── BODY ── */}
      {error && lastRefreshed ? (
        <View style={{ backgroundColor: "#3d2e0a", paddingHorizontal: 14, paddingVertical: 6 }}>
          <Text style={{ color: C.amber, fontSize: 12 }}>
            Live refresh warning: {error}. Showing the last successful data.
          </Text>
        </View>
      ) : null}
      {loading ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color={C.purple} />
          <Text style={{ color: C.textMuted, marginTop: 10 }}>Loading live data…</Text>
        </View>
      ) : error && !lastRefreshed ? (
        <View style={s.center}>
          <Text style={{ color: C.pink, fontSize: 15, textAlign: "center" }}>{error}</Text>
          <Pressable onPress={load} style={s.retryBtn}>
            <Text style={{ color: "#fff", fontWeight: "700" }}>Retry</Text>
          </Pressable>
        </View>
      ) : IS_WIDE ? (
        /* ── DESKTOP WEB: 3-column layout ── */
        <View style={s.body}>
      {/* ── LIVE CHECK-IN FEED (auto-rotating) ── */}
          <View style={s.panel}>
            <View style={s.panelTitleRow}>
              <Text style={s.panelTitle}>LIVE CHECK-IN FEED</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                {(() => {
                  const totalPages = Math.max(1, Math.ceil(feed.length / PAGE_SIZE));
                  const page = feedPage % totalPages;
                  return (
                    <Text style={{ color: C.textMuted, fontSize: 10, fontWeight: "600" }}>
                      {totalPages > 1 ? `${page + 1} / ${totalPages}` : ""}
                    </Text>
                  );
                })()}
                <View style={s.livePing}>
                  <View style={s.liveDot} />
                  <Text style={s.liveTxtSmall}>LIVE</Text>
                </View>
              </View>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
              {(() => {
                const totalPages = Math.max(1, Math.ceil(feed.length / PAGE_SIZE));
                const page = feedPage % totalPages;
                const pageFeed = feed.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
                return feed.length === 0
                  ? <Text style={s.empty}>No check-ins today yet</Text>
                  : pageFeed.map(item => <FeedRow key={item.key} item={item} />);
              })()}
            </ScrollView>
          </View>

          <View style={s.panel}>
            <Text style={s.panelTitle}>OFFICE OCCUPANCY</Text>
            <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
              {offices.length === 0
                ? <Text style={s.empty}>No office data</Text>
                : offices.map(o => <OccupancyRow key={o.id} stat={o} />)
              }
            </ScrollView>
          </View>

          <View style={s.panel}>
            <Text style={s.panelTitle}>NEEDS ATTENTION</Text>
            <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
              {alerts.map(item => <AlertCard key={item.key} item={item} />)}
            </ScrollView>
          </View>
        </View>
      ) : (
        /* ── MOBILE (and narrow web): 3 sections stacked vertically one by one ── */
        <ScrollView
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={s.mobileBody}
        >
          {/* 1. NEEDS ATTENTION */}
          <View style={s.mCol}>
            <Text style={[s.panelTitle, { marginBottom: 14 }]}>NEEDS ATTENTION</Text>
            {alerts.map(item => <AlertCard key={item.key} item={item} />)}
          </View>

          {/* 2. OFFICE OCCUPANCY */}
          <View style={s.mCol}>
            <Text style={[s.panelTitle, { marginBottom: 16 }]}>OFFICE OCCUPANCY</Text>
            {offices.length === 0
              ? <Text style={s.empty}>No office data</Text>
              : offices.map(o => <OccupancyRow key={o.id} stat={o} />)
            }
          </View>

          {/* 3. LIVE CHECK-IN FEED (auto-rotating) */}
          <View style={s.mCol}>
            <View style={[s.panelTitleRow, { marginBottom: 14 }]}>
              <Text style={s.panelTitle}>LIVE CHECK-IN FEED</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                {(() => {
                  const totalPages = Math.max(1, Math.ceil(feed.length / PAGE_SIZE));
                  const page = feedPage % totalPages;
                  return totalPages > 1 ? (
                    <Text style={{ color: C.textMuted, fontSize: 10, fontWeight: "600" }}>
                      {page + 1} / {totalPages}
                    </Text>
                  ) : null;
                })()}
                <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                  <View style={s.liveDot} />
                  <Text style={s.liveTxtSmall}>LIVE</Text>
                </View>
              </View>
            </View>
            {(() => {
              const totalPages = Math.max(1, Math.ceil(feed.length / PAGE_SIZE));
              const page = feedPage % totalPages;
              const pageFeed = feed.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
              return feed.length === 0
                ? <Text style={s.empty}>No check-ins today yet</Text>
                : pageFeed.map(item => <FeedRow key={item.key} item={item} />);
            })()}
          </View>
        </ScrollView>
      )}

      {/* ── FRAUD MODAL ── */}
      <PeopleModal
        visible={showFraud}
        title="⚠️  Fraud / GPS Anomaly"
        dotColor={C.pink}
        emptyMsg="No anomalies detected"
        onClose={() => setShowFraud(false)}
      >
        {fraudPeople.length === 0
          ? <Text style={[s.fraudReason, { padding: 16, color: C.green }]}>✅ No anomalies detected right now</Text>
          : fraudPeople.map((p, i) => (
              <PersonRow key={i} name={p.name} dotColor={C.pink}
                sub={p.reason + (p.distance ? `  ·  ${Math.round(p.distance)}m away` : "")} />
            ))
        }
      </PeopleModal>

      {/* ── PRESENT MODAL ── */}
      <PeopleModal
        visible={modal === "present"}
        title={`✅  Present Today (${present})`}
        dotColor={C.green}
        emptyMsg="No one checked in yet"
        onClose={() => setModal(null)}
      >
        {presentPeople.length === 0
          ? <Text style={[s.fraudReason, { padding: 16 }]}>No one checked in yet</Text>
          : presentPeople.map((p, i) => <PersonRow key={i} name={p.name} sub={p.sub} dotColor={C.green} />)
        }
      </PeopleModal>

      {/* ── ABSENT MODAL ── */}
      <PeopleModal
        visible={modal === "absent"}
        title={`❌  Absent Today (${absent})`}
        dotColor={C.pink}
        emptyMsg="Everyone is present!"
        onClose={() => setModal(null)}
      >
        {absentPeople.length === 0
          ? <Text style={[s.fraudReason, { padding: 16, color: C.green }]}>Everyone is present! 🎉</Text>
          : absentPeople.map((p, i) => <PersonRow key={i} name={p.name} sub={p.sub} dotColor={C.pink} />)
        }
      </PeopleModal>

      {/* ── MEETINGS MODAL ── */}
      <PeopleModal
        visible={modal === "meetings"}
        title={`🤝  Live Meetings (${meetCount})`}
        dotColor={C.amber}
        emptyMsg="No active meetings"
        onClose={() => setModal(null)}
      >
        {meetPeople.length === 0
          ? <Text style={[s.fraudReason, { padding: 16 }]}>No active meetings right now</Text>
          : meetPeople.map((p, i) => <PersonRow key={i} name={p.name} sub={p.sub} dotColor={C.amber} />)
        }
      </PeopleModal>

      {/* ── IN ROUTE MODAL ── */}
      <PeopleModal
        visible={modal === "route"}
        title={`🚗  In Route (${routeCount})`}
        dotColor={C.teal}
        emptyMsg="No agents in route"
        onClose={() => setModal(null)}
      >
        {routePeople.length === 0
          ? <Text style={[s.fraudReason, { padding: 16 }]}>No agents currently in route</Text>
          : routePeople.map((p, i) => <PersonRow key={i} name={p.name} sub={p.sub} dotColor={C.teal} />)
        }
      </PeopleModal>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: IS_WIDE ? 20 : 14,
    paddingVertical: IS_WIDE ? 14 : 12,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.cardBorder,
  },
  backBtn: { padding: 6 },
  brand:   { flexDirection: "row", alignItems: "baseline" },
  brandBop: { color: C.text, fontSize: IS_WIDE ? 22 : 18, fontWeight: "700" },
  brandSub: { color: C.textMuted, fontSize: IS_WIDE ? 11 : 9, fontWeight: "600", letterSpacing: 2 },
  liveRow:  { flexDirection: "row", alignItems: "center", gap: 6, marginRight: IS_WIDE ? 16 : 6 },
  liveDot: {
    width: IS_WIDE ? 10 : 8, height: IS_WIDE ? 10 : 8, borderRadius: 5, backgroundColor: C.green,
    ...(Platform.OS === "web"
      ? { boxShadow: "0 0 8px #2dd87a" }
      : { shadowColor: C.green, shadowOpacity: 1, shadowRadius: 6, elevation: 4 }),
  },
  liveTxt:  { color: C.textMuted, fontSize: IS_WIDE ? 13 : 10, fontWeight: "600" },
  clock:    { color: C.text, fontSize: IS_WIDE ? 26 : 17, fontWeight: "300", letterSpacing: 1 },

  // Stat pills — horizontal scroll on mobile, row on web
  pillsScroll: {
    flexGrow: 0,
    paddingBottom: 2,
  },
  pillsContent: {
    paddingHorizontal: IS_WIDE ? 20 : 12,
    paddingVertical: 10,
    gap: IS_WIDE ? 10 : 8,
    flexDirection: "row",
    flexGrow: 1,
    justifyContent: "center",
  },
  pill: {
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    backgroundColor: C.cardBg,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: IS_WIDE ? 20 : 14,
    paddingVertical: IS_WIDE ? 14 : 12,
    minWidth: IS_WIDE ? 130 : 90,
  },
  pillIcon: { fontSize: IS_WIDE ? 22 : 18 },
  pillVal:  { fontSize: IS_WIDE ? 28 : 22, fontWeight: "800", lineHeight: IS_WIDE ? 34 : 28 },
  pillLbl:  { color: C.textMuted, fontSize: IS_WIDE ? 10 : 9, fontWeight: "700", letterSpacing: 0.5, textAlign: "center" },

  // Body (desktop only)
  body: {
    flex: 1,
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  panel: {
    flex: 1,
    backgroundColor: C.cardBg,
    borderRadius: 14, borderWidth: 1, borderColor: C.cardBorder,
    padding: 14,
    maxHeight: SH * 0.72,
    overflow: "hidden",
  },
  panelTitleRow: {
    flexDirection: "row", alignItems: "center",
    justifyContent: "space-between", marginBottom: 12,
  },
  panelTitle: {
    color: C.textMuted,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 2,
  },
  livePing: { flexDirection: "row", alignItems: "center", gap: 5 },
  liveTxtSmall: { color: C.green, fontSize: 9, fontWeight: "700", letterSpacing: 1.5 },

  feedRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingVertical: 12, paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.cardBorder,
  },
  feedAvatar: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, flexShrink: 0,
  },
  feedAvatarText: { fontSize: 14, fontWeight: "800" },
  feedName:   { color: C.text, fontSize: 14, fontWeight: "600" },
  feedOffice: { color: C.textMuted, fontSize: 12, marginTop: 2 },
  feedBadge:  { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, marginBottom: 3 },
  feedBadgeText: { fontSize: 9, fontWeight: "800", letterSpacing: 0.8 },
  feedTime:   { fontSize: 12, fontWeight: "700" },

  occRow:    { marginBottom: 20 },
  occHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 },
  occName:   { color: C.text, fontSize: 14, flex: 1 },
  occFrac:   { fontSize: 14, marginLeft: 6 },
  barBg:     { height: 10, backgroundColor: "#2e2740", borderRadius: 5, overflow: "hidden" },
  barFill:   { height: 10, borderRadius: 5, backgroundColor: "#c040a0" },

  alertCard: {
    flexDirection: "row", alignItems: "flex-start", gap: 12,
    borderRadius: 12, borderWidth: 1,
    padding: 16, marginBottom: 10,
  },
  alertEmoji: { fontSize: 20 },
  alertText:  { color: C.text, fontSize: 14, flex: 1, lineHeight: 22 },

  // Fraud modal
  modalOverlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.7)",
    alignItems: "center", justifyContent: "center",
  },
  modalBox: {
    backgroundColor: "#211c2e",
    borderRadius: 16, borderWidth: 1, borderColor: "#2e2740",
    width: IS_WIDE ? 480 : "88%", maxHeight: "80%",
    overflow: "hidden",
  },
  modalHeader: {
    flexDirection: "row", alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderBottomWidth: 1, borderBottomColor: "#2e2740",
  },
  modalTitle: { color: C.text, fontSize: 15, fontWeight: "700" },
  modalClose: { padding: 4 },
  fraudRow: {
    flexDirection: "row", alignItems: "flex-start", gap: 12,
    padding: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#2e2740",
  },
  fraudDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: C.pink, marginTop: 5,
  },
  fraudName:   { color: C.text, fontSize: 14, fontWeight: "600" },
  fraudReason: { color: C.textMuted, fontSize: 12, marginTop: 2 },

  mobileBody: {
    padding: 12,
    gap: 12,
    paddingBottom: 60,
  },
  mCol: {
    backgroundColor: C.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.cardBorder,
    padding: 16,
    ...(Platform.OS !== "web"
      ? { shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 6 }
      : {}),
  },

  // Misc
  empty:    { color: C.textMuted, fontSize: 13, textAlign: "center", marginTop: 24 },
  center:   { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  retryBtn: {
    marginTop: 8, paddingHorizontal: 24, paddingVertical: 10,
    borderRadius: 8, backgroundColor: C.pink,
  },
});
