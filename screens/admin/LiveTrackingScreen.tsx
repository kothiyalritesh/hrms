import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  StyleSheet,
  View,
  FlatList,
  Pressable,
  RefreshControl,
  Modal,
  ScrollView,
  Linking,
  Platform,
  Image,
  ActivityIndicator,
  Alert,
  TextInput,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useFocusEffect } from "@react-navigation/native";
import { ScreenScrollView } from "@/components/ScreenScrollView";
import { GeofenceReviewPanel } from "@/components/GeofenceReviewPanel";
import { ThemedText } from "@/components/ThemedText";
import { toTitleCase } from "@/utils/format";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, Colors } from "@/constants/theme";
import Spacer from "@/components/Spacer";
import { supabase } from "@/lib/supabase";
import { TrackingAdminService } from "@/services/tracking-admin.service";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { googleStaticMapUrl, googleMapsDeepLink, googleMapsNavLink } from "@/utils/googleGeolocation";
import { getDrivingMinutes } from "@/utils/googleMaps";
import { BusinessClockService } from "@/services/business-clock.service";
import { parseDatabaseTimestamp } from "@/utils/businessDate";
import { formatHrmsTime } from "@/utils/attendanceTimestamp";
import { fetchAllPages } from "@/utils/supabasePagination";
import { reportNonFatalError } from "@/utils/operationalErrors";
import {
  LIVE_MAX_MINUTES,
  STALE_AFTER_MINUTES,
  freshnessOfTimestamp,
  movementText,
} from "@/utils/locationFreshness";
import {
  CanonicalAttendanceDay,
  CanonicalAttendanceService,
} from "@/services/canonical-attendance.service";
import { collapseCurrentLocationSubmissions } from "@/services/field-visit.service";

// ─── Types ────────────────────────────────────────────────────────────────────

type TrackStatus = "GREEN" | "YELLOW" | "ORANGE" | "RED_RANGE" | "RED_GPS_OFF" | "CHECKIN_ONLY" | "CHECKED_OUT";

/**
 * How current the employee's position is: age of the newest RELIABLE GPS fix
 * (stored point or heartbeat), never the check-in time.
 *   LIVE <= 5 min · RECENT 5-15 min · STALE > 15 min.
 * The Android app sends a fix every minute (15 s on a visit), moving or not.
 */
type LocationStatus = "LIVE" | "RECENT" | "STALE" | "NO_LOCATION_TODAY" | "NOT_TRACKING";
// One rule for every location screen (utils/locationFreshness).
const LIVE_WINDOW_MINUTES = LIVE_MAX_MINUTES;

interface LiveEmployee {
  user_id: string;
  name: string;
  employee_number: string | null;
  role: string;
  latitude: number | null;
  longitude: number | null;
  distance_from_base: number | null;
  status: TrackStatus;
  gps_available: boolean;
  recorded_at: string;
  base_latitude: number | null;
  base_longitude: number | null;
  geo_fence_radius: number;
  checkin_time: string | null;
  checkout_time: string | null;
  attendance_checkin: string | null;
  attendance_checkout: string | null;
  last_visit_checkin: string | null;
  last_visit_checkout: string | null;
  last_visit_location: string | null;
  // v9 fields + client-enriched
  has_gps_ping: boolean;
  has_location_data: boolean; // NEW: indicates if ANY location data exists (even if GPS is off)
  office_latitude: number | null;
  office_longitude: number | null;
  office_name: string | null;
  is_stale: boolean;
  stale_mins: number;
  timestamp_invalid: boolean;
  /** Latest ping of today (never the check-in time); null when none. */
  ping_at: string | null;
  location_status: LocationStatus;
  /** GPS accuracy of that position (metres). */
  accuracy_m: number | null;
  /** Last time the phone sent anything (even a poor / unchanged fix). */
  seen_at: string | null;
  seen_quality: string | null;
  /** Server-computed office / site relationship of the newest good fix. */
  relation: LocationRelation | null;
  /** Speed of the newest good fix (m/s), for moving / not moving. */
  speed_mps: number | null;
  /** Why tracking may be unreliable on this person's phone (null = fine / unknown). */
  device_note: { text: string; color: string } | null;
  /** FIELD: on / travelling to a field visit today. OFFICE: everyone else. */
  work_mode: "OFFICE" | "FIELD";
  /** The visit the person is at or travelling to (field tab). */
  active_visit: { id: string; name: string; status: string; visit_type: string; checkin_time: string | null } | null;
  /** Team / office names, used by the search box. */
  team_name?: string | null;
  assigned_office_name?: string | null;
}

/** Lower-cased text the search box matches against (name, emp no., team, office). */
function searchTextOf(e: LiveEmployee): string {
  return [e.name, e.employee_number, e.team_name, e.office_name, e.assigned_office_name, e.role]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/** Phone-side tracking problems reported by the app (rpc_report_tracking_health). */
function deviceNoteFor(h: any): { text: string; color: string } | null {
  if (!h) return null;
  const provider = String(h.last_provider ?? "");
  if (provider === "browser-foreground") {
    return { text: "🖥️ Browser only — location is sent only while HRMS is open on screen", color: "#4B5563" };
  }
  const d = h.device_health as Record<string, any> | null;
  if (!d) {
    return provider.startsWith("expo-location")
      ? { text: "⬆️ Old HRMS app — stops sending while still; ask them to update", color: "#7C3AED" }
      : null;
  }
  if (d.gps_on === false) return { text: "📵 GPS (location) is turned off on the phone", color: "#DC2626" };
  if (d.foreground === false || d.background === false) {
    return { text: "⚠️ Location permission is not \"Allow all the time\"", color: "#DC2626" };
  }
  if (d.precise === false) return { text: "⚠️ Only approximate location is allowed", color: "#D97706" };
  if (d.task_active === false) return { text: "⚠️ Tracking service is not running on the phone", color: "#D97706" };
  if (Number(d.queue_size) >= 10) {
    return { text: `📶 ${d.queue_size} locations waiting to upload (no internet)`, color: "#D97706" };
  }
  if (Number(d.tracking_options_version ?? 0) < 2) {
    return { text: "⬆️ Old HRMS app — stops sending while still; ask them to update", color: "#7C3AED" };
  }
  return null;
}

type LocationRelation = {
  kind: "OFFICE" | "SITE";
  state: string;
  distance_m: number | null;
};

interface AlertRow {
  id: string;
  user_id: string;
  alert_type: string;
  message: string;
  distance_m: number | null;
  resolved: boolean;
  created_at: string;
  escalation_level: number;
  escalated_at: string | null;
  profiles?: { name: string };
}

type FilterStatus = "ALL" | TrackStatus | "STALE";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<TrackStatus, { color: string; label: string; icon: string }> = {
  GREEN:        { color: "#10B981", label: "In Range",       icon: "check-circle" },
  YELLOW:       { color: "#F59E0B", label: "Near Boundary",  icon: "alert-circle" },
  ORANGE:       { color: "#F97316", label: "Borderline",     icon: "alert-triangle" },
  RED_RANGE:    { color: "#EF4444", label: "Out of Range",   icon: "x-circle" },
  RED_GPS_OFF:  { color: "#DC2626", label: "GPS OFF",        icon: "wifi-off" },
  CHECKIN_ONLY: { color: "#6B7280", label: "Awaiting Ping",  icon: "clock" },
  CHECKED_OUT:  { color: "#9CA3AF", label: "Checked Out",    icon: "log-out" },
};

function statusColor(s: TrackStatus) { return STATUS_CONFIG[s]?.color ?? "#6B7280"; }
function statusLabel(s: TrackStatus) { return STATUS_CONFIG[s]?.label ?? s; }

let authoritativeClockMs: number | null = null;
// Offset between the server clock and this device, so ages keep advancing
// between refreshes without trusting the device clock.
let serverClockOffsetMs: number | null = null;
function serverNowMs(): number | null {
  return serverClockOffsetMs == null ? authoritativeClockMs : Date.now() + serverClockOffsetMs;
}

function locationStatusFor(emp: { status: TrackStatus; ping_at: string | null }): {
  status: LocationStatus;
  ageMins: number | null;
} {
  if (emp.status === "CHECKED_OUT") return { status: "NOT_TRACKING", ageMins: null };
  if (!emp.ping_at) return { status: "NO_LOCATION_TODAY", ageMins: null };
  const now = serverNowMs();
  let pingMs: number;
  try {
    pingMs = parseDatabaseTimestamp(emp.ping_at).getTime();
  } catch {
    return { status: "STALE", ageMins: null };
  }
  if (now == null) return { status: "STALE", ageMins: null };
  const ageMins = Math.max(0, (now - pingMs) / 60000);
  return {
    status: ageMins <= LIVE_WINDOW_MINUTES ? "LIVE" : ageMins <= STALE_AFTER_MINUTES ? "RECENT" : "STALE",
    ageMins,
  };
}

function minutesSince(iso: string | null | undefined): number | null {
  const now = serverNowMs();
  if (!iso || now == null) return null;
  try {
    return (now - parseDatabaseTimestamp(iso).getTime()) / 60000;
  } catch {
    return null;
  }
}

function accuracyText(metres: number | null | undefined) {
  return metres == null || !Number.isFinite(metres) ? "" : ` · ±${Math.round(metres)} m`;
}

function fmtDistance(metres: number | null | undefined) {
  if (metres == null || !Number.isFinite(metres)) return "";
  return metres < 1000 ? `${Math.round(metres)} m` : `${(metres / 1000).toFixed(1)} km`;
}

const RELATION_UI: Record<string, { icon: string; text: (d: string) => string; color: string }> = {
  "OFFICE:INSIDE": { icon: "🏢", text: (d) => `In office${d ? ` · ${d} from centre` : ""}`, color: "#059669" },
  "OFFICE:NEAR": { icon: "🏢", text: (d) => `At the office boundary${d ? ` · ${d}` : ""} (GPS uncertain)`, color: "#D97706" },
  "OFFICE:OUTSIDE": { icon: "🚶", text: (d) => `Outside office${d ? ` · ${d} away` : ""}`, color: "#DC2626" },
  "SITE:AT_SITE": { icon: "📍", text: (d) => `At site${d ? ` · ${d}` : ""}`, color: "#059669" },
  "SITE:NEAR_SITE": { icon: "📍", text: (d) => `Near site${d ? ` · ${d}` : ""}`, color: "#D97706" },
  "SITE:APPROACHING": { icon: "🚗", text: (d) => `On the way to site${d ? ` · ${d} to go` : ""}`, color: "#2563EB" },
  "SITE:LEFT_SITE": { icon: "↩️", text: (d) => `Left the site${d ? ` · ${d} away` : ""}`, color: "#DC2626" },
};

function distanceMetres(lat1: number, lng1: number, lat2: number, lng2: number) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const a =
    Math.sin(toRad(lat2 - lat1) / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lng2 - lng1) / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const LOCATION_STATUS_UI: Record<LocationStatus, { label: string; color: string; bg: string }> = {
  LIVE: { label: "LIVE", color: "#059669", bg: "#ECFDF5" },
  RECENT: { label: "RECENT", color: "#0284C7", bg: "#F0F9FF" },
  STALE: { label: "STALE", color: "#D97706", bg: "#FFFBEB" },
  NO_LOCATION_TODAY: { label: "NO LOCATION TODAY", color: "#DC2626", bg: "#FEF2F2" },
  NOT_TRACKING: { label: "NOT TRACKING", color: "#6B7280", bg: "#F3F4F6" },
};
const routeEtaCache = new Map<string, { value: number | null; expiresAt: number }>();

function timeAgo(iso: string | null | undefined) {
  if (!iso) return "—";
  const now = serverNowMs();
  if (now == null) return "server time unavailable";
  let diff: number;
  try {
    diff = Math.floor(
      (now - parseDatabaseTimestamp(iso).getTime()) / 1000,
    );
  } catch {
    return "—";
  }
  if (diff < -10) return "invalid future timestamp";
  if (diff < 0) return "just now";
  if (diff < 60)  return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  return m ? `${h}h ${m}m ago` : `${h}h ago`;
}

function pingDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return parseDatabaseTimestamp(iso).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return "—";
  }
}

function fmtIST(iso?: string | null) {
  return formatHrmsTime(iso, "—");
}

// ─── Employee Card ─────────────────────────────────────────────────────────────

// GPS is truly OFF only when gps_available=false AND no recent ping (>10 min stale)
function isGpsTrulyOff(emp: LiveEmployee): boolean {
  if (emp.status === "CHECKED_OUT" || emp.status === "CHECKIN_ONLY") return false;
  if (!emp.gps_available) return true;
  const now = serverNowMs();
  if (now == null || !emp.ping_at) return true;
  let staleMins: number;
  try {
    staleMins =
      (now - parseDatabaseTimestamp(emp.ping_at).getTime()) /
      60000;
  } catch {
    return true; // treat unparseable timestamp as GPS off
  }
  if (staleMins < -10 / 60) return true;
  return staleMins > STALE_AFTER_MINUTES;
}

function EmployeeCard({
  emp,
  onPress,
  onPing,
  pinging,
}: {
  emp: LiveEmployee;
  onPress: () => void;
  onPing: () => void;
  pinging: boolean;
}) {
  const { theme } = useTheme();
  const color = statusColor(emp.status);
  const isRed = emp.status === "RED_GPS_OFF" || emp.status === "RED_RANGE";
  const isCheckedOut = emp.status === "CHECKED_OUT";
  const gpsOff = isGpsTrulyOff(emp);
  const loc = LOCATION_STATUS_UI[emp.location_status];

  // Top-right timestamp: field visit checkout > field visit checkin > office checkin > GPS ping
  const timeLabel = isCheckedOut
    ? emp.last_visit_checkout
      ? `Site out: ${fmtIST(emp.last_visit_checkout)}`
      : emp.attendance_checkout
      ? `Home: ${fmtIST(emp.attendance_checkout)}`
      : "Checked Out"
    : emp.last_visit_checkout
    ? `Site out: ${fmtIST(emp.last_visit_checkout)}`
    : emp.last_visit_checkin
    ? `At site: ${fmtIST(emp.last_visit_checkin)}`
    : emp.attendance_checkin && !emp.latitude
    ? `Office in: ${fmtIST(emp.attendance_checkin)}`
    : timeAgo(emp.ping_at);

  return (
    <Pressable
      style={[
        styles.card,
        { backgroundColor: theme.backgroundDefault, borderLeftColor: color },
      ]}
      onPress={onPress}
    >
      <View style={styles.cardRow}>
        <View style={[styles.statusDot, { backgroundColor: color }]} />
        <View style={{ flex: 1 }}>
          <ThemedText type="body" style={{ fontWeight: "600" }}>
            {emp.name}
          </ThemedText>
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            {emp.role}
            {emp.employee_number ? ` · ${emp.employee_number}` : ""}
            {emp.team_name ? ` · ${emp.team_name}` : ""}
          </ThemedText>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <ThemedText type="caption" style={{ color: color, fontWeight: "700" }}>
            {emp.location_status === "NO_LOCATION_TODAY" ? "No location" : statusLabel(emp.status)}
          </ThemedText>
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            {timeLabel}
          </ThemedText>
        </View>
      </View>

      {/* Location freshness: never show a location without its age */}
      <View style={[styles.locStatusRow, { backgroundColor: loc.bg }]}>
        <View style={[styles.locDot, { backgroundColor: loc.color }]} />
        <ThemedText type="caption" style={{ color: loc.color, fontWeight: "800" }}>{loc.label}</ThemedText>
        <ThemedText type="caption" style={{ color: "#374151", flex: 1 }} numberOfLines={1}>
          {emp.location_status === "NOT_TRACKING"
            ? "Checked out — tracking stopped"
            : emp.location_status === "NO_LOCATION_TODAY"
              ? "Checked in · no location received today"
              : `Last seen ${timeAgo(emp.ping_at)} · ${pingDateTime(emp.ping_at)}${accuracyText(emp.accuracy_m)}`}
        </ThemedText>
      </View>
      {!isCheckedOut && emp.device_note ? (
        <ThemedText type="caption" style={{ color: emp.device_note.color, marginTop: 4, fontWeight: "600" }}>
          {emp.device_note.text}
        </ThemedText>
      ) : null}
      {/* "Not moving" vs "no data": the phone is still reporting, only without a usable GPS fix */}
      {(emp.location_status === "STALE" || emp.location_status === "NO_LOCATION_TODAY") &&
        (minutesSince(emp.seen_at) ?? Infinity) <= STALE_AFTER_MINUTES && (
          <ThemedText type="caption" style={{ color: "#B45309", marginTop: 4 }}>
            📶 Phone active {timeAgo(emp.seen_at)} —{" "}
            {emp.seen_quality === "LOW_ACCURACY"
              ? "GPS signal too weak for a position"
              : emp.seen_quality === "MOCKED"
                ? "fake (mock) location blocked"
                : "no usable GPS fix"}
          </ThemedText>
        )}

      {/* Attendance check-in + going-home checkout */}
      <View style={{ flexDirection: "row", gap: 12, marginTop: 6 }}>
        {emp.attendance_checkin && (
          <ThemedText type="caption" style={{ color: "#10B981" }}>
            🏢 In: {fmtIST(emp.attendance_checkin)}
          </ThemedText>
        )}
        {emp.attendance_checkout && (
          <ThemedText type="caption" style={{ color: "#6B7280" }}>
            🏠 Home: {fmtIST(emp.attendance_checkout)}
          </ThemedText>
        )}
      </View>

      {/* Latest field visit times */}
      {(emp.last_visit_checkin || emp.last_visit_checkout) && (
        <View style={{ marginTop: 4, backgroundColor: "#F0F9FF", borderRadius: 6, padding: 6 }}>
          {emp.last_visit_location && (
            <ThemedText type="caption" style={{ color: "#1E40AF", fontWeight: "600", marginBottom: 2 }}>
              📍 {emp.last_visit_location}
            </ThemedText>
          )}
          <View style={{ flexDirection: "row", gap: 12 }}>
            {emp.last_visit_checkin && (
              <ThemedText type="caption" style={{ color: "#3B82F6" }}>
                → Arrived: {fmtIST(emp.last_visit_checkin)}
              </ThemedText>
            )}
            {emp.last_visit_checkout && (
              <ThemedText type="caption" style={{ color: "#EF4444" }}>
                ← Left: {fmtIST(emp.last_visit_checkout)}
              </ThemedText>
            )}
          </View>
        </View>
      )}

      {!isCheckedOut && emp.relation && RELATION_UI[`${emp.relation.kind}:${emp.relation.state}`] ? (() => {
        const ui = RELATION_UI[`${emp.relation.kind}:${emp.relation.state}`];
        return (
          <ThemedText type="caption" style={{ color: ui.color, marginTop: 4, fontWeight: "600" }}>
            {ui.icon} {ui.text(fmtDistance(emp.relation.distance_m))}
            {emp.location_status === "STALE" ? " (last known)" : ""}
            {(emp.location_status === "LIVE" || emp.location_status === "RECENT") && movementText(emp.speed_mps)
              ? ` · ${movementText(emp.speed_mps)}`
              : ""}
          </ThemedText>
        );
      })() : emp.distance_from_base !== null && !isCheckedOut ? (
        <ThemedText
          type="caption"
          style={{ color: isRed ? color : theme.textSecondary, marginTop: 4 }}
        >
          📍 {Math.round(emp.distance_from_base)}m from base
          {emp.geo_fence_radius ? ` (fence: ${emp.geo_fence_radius}m)` : ""}
        </ThemedText>
      ) : null}
      {!emp.gps_available && !isCheckedOut && emp.location_status !== "NO_LOCATION_TODAY" && (
        <ThemedText type="caption" style={{ color: "#DC2626", marginTop: 4 }}>
          🔴 Location OFF / not trackable on the phone
        </ThemedText>
      )}
      {/* Google Maps — always show when any coords exist (GPS ping or office fallback) */}
      {!isCheckedOut && (emp.latitude || emp.office_latitude) && (emp.longitude || emp.office_longitude) && (() => {
        const mapLat = (emp.latitude ?? emp.office_latitude)!;
        const mapLng = (emp.longitude ?? emp.office_longitude)!;
        const isRealGps = emp.has_gps_ping;
        const mapLabel = isRealGps
          ? `📡 ${emp.location_status === "LIVE" ? "Live" : emp.location_status === "RECENT" ? "Recent" : "Last known"} · ${timeAgo(emp.ping_at)}${accuracyText(emp.accuracy_m)}`
          : `🏢 ${emp.office_name ?? "Office"} — office position, no GPS today`;
        const mapLabelColor = !isRealGps
          ? "#F59E0B"
          : emp.location_status === "LIVE"
            ? "#10B981"
            : emp.location_status === "RECENT"
              ? "#0284C7"
              : "#F59E0B";
        return (
          <>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 8 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: mapLabelColor }} />
              <ThemedText type="caption" style={{ color: mapLabelColor, fontWeight: "700", fontSize: 10 }}>
                {mapLabel}
              </ThemedText>
            </View>
            {/* No inline map per card: one live map per employee made the list
                load dozens of Google Maps at once and crashed the app on phones.
                View Map / Open Maps open a single map on demand. */}
            <Pressable
              onPress={() => Linking.openURL(googleMapsDeepLink(mapLat, mapLng))}
              style={styles.openMapsRow}
              accessibilityRole="link"
            >
              <Feather name="external-link" size={13} color={theme.primary} />
              <ThemedText type="caption" style={{ color: theme.primary, fontWeight: "700" }}>
                Open in Google Maps · {mapLat.toFixed(5)}, {mapLng.toFixed(5)}
              </ThemedText>
            </Pressable>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
              <Pressable
                onPress={() => Linking.openURL(googleMapsDeepLink(mapLat, mapLng))}
                style={[styles.mapBtn, { backgroundColor: "#EFF6FF" }]}
              >
                <Feather name="map" size={12} color="#2563EB" />
                <ThemedText type="caption" style={{ color: "#2563EB", fontWeight: "700" }}>View Map</ThemedText>
              </Pressable>
              <Pressable
                onPress={() => Linking.openURL(googleMapsNavLink(mapLat, mapLng))}
                style={[styles.mapBtn, { backgroundColor: "#6D1B6D" }]}
              >
                <Feather name="navigation" size={12} color="#fff" />
                <ThemedText type="caption" style={{ color: "#fff", fontWeight: "700" }}>Navigate</ThemedText>
              </Pressable>
            </View>
          </>
        );
      })()}
      {!isCheckedOut && (
        <Pressable
          onPress={(e) => { e.stopPropagation?.(); onPing(); }}
          disabled={pinging}
          style={[styles.pingBtn, { opacity: pinging ? 0.6 : 1 }]}
        >
          <Feather name="radio" size={12} color="#fff" />
          <ThemedText type="caption" style={{ color: "#fff", fontWeight: "700", fontSize: 11 }}>
            {pinging ? "Waiting..." : "📡 Request Ping"}
          </ThemedText>
        </Pressable>
      )}
    </Pressable>
  );
}

// ─── Alert Row ─────────────────────────────────────────────────────────────────

function AlertCard({ alert, onResolve }: { alert: AlertRow; onResolve: (id: string) => void }) {
  const { theme } = useTheme();
  const isGpsOff = alert.alert_type === "GPS_OFF";
  const color = isGpsOff ? "#DC2626" : alert.escalation_level >= 3 ? "#7C3AED" : alert.escalation_level === 2 ? "#F97316" : "#F59E0B";
  const levelLabel = alert.escalation_level >= 3 ? "🚨 L3 AUTO" : alert.escalation_level === 2 ? "⚠️ L2" : "L1";

  return (
    <View style={[styles.alertCard, { backgroundColor: theme.backgroundDefault, borderLeftColor: color }]}>
      <View style={styles.cardRow}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 }}>
            <ThemedText type="caption" style={{ color, fontWeight: "700" }}>
              {toTitleCase(alert.profiles?.name) || "Unknown"}
            </ThemedText>
            <View style={{ backgroundColor: color + "20", paddingHorizontal: 6, paddingVertical: 1, borderRadius: 8 }}>
              <ThemedText type="caption" style={{ color, fontWeight: "700", fontSize: 10 }}>
                {levelLabel}
              </ThemedText>
            </View>
          </View>
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            {alert.message}
          </ThemedText>
          <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: 2 }}>
            {timeAgo(alert.created_at)}
            {alert.escalated_at ? ` · escalated ${timeAgo(alert.escalated_at)}` : ""}
          </ThemedText>
        </View>
        {!alert.resolved && (
          <Pressable
            style={[styles.resolveBtn, { borderColor: color }]}
            onPress={() => onResolve(alert.id)}
          >
            <ThemedText type="caption" style={{ color }}>Resolve</ThemedText>
          </Pressable>
        )}
      </View>
    </View>
  );
}

// ─── Meeting Card ──────────────────────────────────────────────────────────────

const MEET_STATUS: Record<string, { color: string; label: string }> = {
  PENDING:    { color: "#F59E0B", label: "Planned" },
  IN_TRANSIT: { color: "#6366F1", label: "Travelling" },
  CHECKED_IN: { color: "#3B82F6", label: "At Location" },
  COMPLETED:  { color: "#10B981", label: "Completed" },
  MISSED:     { color: "#EF4444", label: "Missed" },
};

function MeetingCard({ meeting, theme }: { meeting: any; theme: any }) {
  const sc = MEET_STATUS[meeting.status] ?? MEET_STATUS.PENDING;
  const destLat = meeting.checkin_location?.latitude ?? meeting.destination_coords?.latitude;
  const destLng = meeting.checkin_location?.longitude ?? meeting.destination_coords?.longitude;
  const originLat = meeting.origin_lat;
  const originLng = meeting.origin_lon;
  const hasDestCoords = destLat != null && destLng != null;
  const hasOriginCoords = originLat != null && originLng != null;
  const eta = meeting.eta_minutes;
  const distanceM = meeting.distance_from_origin_m;
  const lastPingTime = meeting.last_ping_time;

  const openMap = () => {
    if (!hasDestCoords) return;
    const url = Platform.OS === "web"
      ? `https://www.google.com/maps?q=${destLat},${destLng}`
      : `https://maps.google.com/?q=${destLat},${destLng}`;
    Linking.openURL(url);
  };

  const openNav = () => {
    if (!hasDestCoords) return;
    const url = Platform.OS === "ios"
      ? `maps://?daddr=${destLat},${destLng}`
      : `https://www.google.com/maps/dir/?api=1&destination=${destLat},${destLng}`;
    Linking.openURL(url);
  };

  const openNavFromOrigin = () => {
    if (!hasOriginCoords || !hasDestCoords) return;
    const url = Platform.OS === "ios"
      ? `maps://?saddr=${originLat},${originLng}&daddr=${destLat},${destLng}`
      : `https://www.google.com/maps/dir/?api=1&origin=${originLat},${originLng}&destination=${destLat},${destLng}`;
    Linking.openURL(url);
  };

  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundDefault, borderLeftColor: sc.color }]}>
      {/* Header row */}
      <View style={styles.cardRow}>
        <View style={{ flex: 1 }}>
          <ThemedText type="body" style={{ fontWeight: "700" }}>{meeting.location_name}</ThemedText>
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            {toTitleCase(meeting.profiles?.name) || "—"}
            {meeting.profiles?.employee_number ? ` · ${meeting.profiles.employee_number}` : ""}
          </ThemedText>
        </View>
        <View style={{ backgroundColor: sc.color + "20", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 }}>
          <ThemedText type="caption" style={{ color: sc.color, fontWeight: "700" }}>{sc.label}</ThemedText>
        </View>
      </View>

      {/* Meeting meta */}
      {meeting.meeting_type ? (
        <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: 4 }}>
          {meeting.meeting_type === "client" ? "👤 Client" : "🏘️ Channel Partner"}
          {meeting.contact_name ? ` · ${meeting.contact_name}` : ""}
          {meeting.contact_phone ? ` · ${meeting.contact_phone}` : ""}
        </ThemedText>
      ) : null}
      {meeting.project_name ? (
        <ThemedText type="caption" style={{ color: "#60045d", fontWeight: "600", marginTop: 2 }}>🏗️ {meeting.project_name}</ThemedText>
      ) : null}
      {meeting.location_address ? (
        <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: 2 }} numberOfLines={2}>📌 {meeting.location_address}</ThemedText>
      ) : null}

      {/* Times */}
      <View style={{ flexDirection: "row", gap: 14, marginTop: 6 }}>
        {meeting.checkin_time ? (
          <ThemedText type="caption" style={{ color: "#10B981" }}>→ In: {fmtIST(meeting.checkin_time)}</ThemedText>
        ) : null}
        {meeting.checkout_time ? (
          <ThemedText type="caption" style={{ color: "#6B7280" }}>← Out: {fmtIST(meeting.checkout_time)}</ThemedText>
        ) : null}
      </View>

      {/* ETA display for PENDING meetings */}
      {meeting.status === "PENDING" && (
        <View style={{ backgroundColor: "#FEF3C7", borderRadius: 8, padding: 10, marginTop: 8, gap: 6, borderLeftWidth: 3, borderLeftColor: "#F59E0B" }}>
          {eta ? (
            <>
              <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                <Feather name="clock" size={13} color="#D97706" />
                <ThemedText type="caption" style={{ color: "#D97706", fontWeight: "700" }}>ETA: ~{eta} min driving</ThemedText>
              </View>
              {distanceM != null && (
                <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                  <Feather name="navigation" size={13} color="#F59E0B" />
                  <ThemedText type="caption" style={{ color: "#92400E" }}>
                    {distanceM >= 1000 ? `${(distanceM / 1000).toFixed(1)} km` : `${Math.round(distanceM)}m`} straight line
                  </ThemedText>
                </View>
              )}
              {meeting.origin_name && lastPingTime && (
                <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                  <Feather name="map-pin" size={13} color="#78350F" />
                  <ThemedText type="caption" style={{ color: "#78350F" }}>
                    From: {meeting.origin_name} ({timeAgo(lastPingTime)})
                  </ThemedText>
                </View>
              )}
            </>
          ) : (
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <ActivityIndicator size="small" color="#D97706" />
              <ThemedText type="caption" style={{ color: "#D97706" }}>Calculating route...</ThemedText>
            </View>
          )}
        </View>
      )}

      {lastPingTime && hasOriginCoords && meeting.status === "PENDING" && (
        <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: 6 }}>
          📡 From: {meeting.origin_name || "Check-in"} · {timeAgo(lastPingTime)}
        </ThemedText>
      )}

      {/* Notes */}
      {meeting.checkout_notes ? (
        <View style={{ backgroundColor: "#F0F9FF", borderRadius: 6, padding: 8, marginTop: 6, borderLeftWidth: 3, borderLeftColor: "#3B82F6" }}>
          <ThemedText type="caption" style={{ color: "#1E40AF" }}>📝 {meeting.checkout_notes}</ThemedText>
        </View>
      ) : null}

      {/* Map + Navigate buttons */}
      {hasDestCoords && (
        <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
          <Pressable
            onPress={openMap}
            style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, backgroundColor: "#EFF6FF", borderRadius: 8, paddingVertical: 8 }}
          >
            <Feather name="map" size={13} color="#2563EB" />
            <ThemedText type="caption" style={{ color: "#2563EB", fontWeight: "700" }}>View Map</ThemedText>
          </Pressable>
          {meeting.status === "PENDING" && hasOriginCoords && (
            <Pressable
              onPress={openNavFromOrigin}
              style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, backgroundColor: "#6D1B6D", borderRadius: 8, paddingVertical: 8 }}
            >
              <Feather name="navigation" size={13} color="#fff" />
              <ThemedText type="caption" style={{ color: "#fff", fontWeight: "700" }}>
                Navigate from Last Location
              </ThemedText>
            </Pressable>
          )}
          {meeting.status === "PENDING" && !hasOriginCoords && (
            <Pressable
              onPress={openNav}
              style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, backgroundColor: "#6D1B6D", borderRadius: 8, paddingVertical: 8 }}
            >
              <Feather name="navigation" size={13} color="#fff" />
              <ThemedText type="caption" style={{ color: "#fff", fontWeight: "700" }}>
                Navigate to Destination
              </ThemedText>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

// ─── Main Screen ───────────────────────────────────────────────────────────────

const FILTERS: FilterStatus[] = ["ALL", "STALE", "RED_GPS_OFF", "RED_RANGE", "ORANGE", "YELLOW", "GREEN", "CHECKIN_ONLY", "CHECKED_OUT"];
const FILTER_LABELS: Record<FilterStatus, string> = {
  ALL: "All", STALE: "⏰ Stale", RED_GPS_OFF: "GPS OFF", RED_RANGE: "Out Range",
  ORANGE: "Borderline", YELLOW: "Near", GREEN: "OK",
  CHECKIN_ONLY: "No Ping", CHECKED_OUT: "Done",
};
const AUTO_REFRESH_MS = 30 * 1000; // fallback poll every 30s

export default function LiveTrackingScreen() {
  const { hasPermission: hasTrackingPermission } = usePermissions();
  const canViewTracking = hasTrackingPermission("live_tracking.view");
  const { theme } = useTheme();
  const { user } = useAuth();

  const [employees, setEmployees] = useState<LiveEmployee[]>([]);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [meetings, setMeetings] = useState<any[]>([]);
  const [filter, setFilter] = useState<FilterStatus>("ALL");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<"office" | "field" | "alerts">("office");
  const [selectedEmp, setSelectedEmp] = useState<LiveEmployee | null>(null);
  const [isEscalationMember, setIsEscalationMember] = useState(false);
  const [pingingUserId, setPingingUserId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [realtimeStatus, setRealtimeStatus] = useState<
    "CONNECTING" | "SUBSCRIBED" | "CHANNEL_ERROR" | "TIMED_OUT" | "CLOSED"
  >("CONNECTING");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Search: instant for normal lists, lightly debounced for big ones.
  const bigList = employees.length > 150;
  useEffect(() => {
    if (!bigList || !searchInput) {
      setSearchQuery(searchInput);
      return;
    }
    const t = setTimeout(() => setSearchQuery(searchInput), 200);
    return () => clearTimeout(t);
  }, [searchInput, bigList]);

  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from("escalation_matrix")
      .select("id")
      .eq("user_id", user.id)
      .limit(1)
      .then(({ data, error }: { data: any[] | null; error: any }) => {
        if (error) {
          setLoadError(error.message);
          return;
        }
        setIsEscalationMember(!!data?.length);
      });
  }, [user?.id]);

  const loadData = useCallback(async () => {
    try {
    const clock = await BusinessClockService.get(true);
    const today = clock.date;
    const dayStart = new Date(`${today}T00:00:00+05:30`).toISOString();
    const dayEnd = new Date(`${today}T23:59:59.999+05:30`).toISOString();
    const authoritativeNowMs = Date.parse(clock.now);
    authoritativeClockMs = authoritativeNowMs;
    serverClockOffsetMs = authoritativeNowMs - Date.now();
    // Office / site relationship per employee (optional: older databases lack the RPC).
    const heartbeatPromise = Promise.resolve(supabase.rpc("rpc_tracking_heartbeats"))
      .then((res: any) => (res?.error ? [] : (res?.data ?? [])) as any[], () => [] as any[]);
    const [alertRes, meetRes, officeRes, attRes, pingRes, canonicalRes] = await Promise.all([
      supabase.from("location_alerts")
        .select("id,user_id,alert_type,message,distance_m,resolved,created_at,escalation_level,escalated_at,metadata,profiles(name)")
        .eq("resolved", false)
        .order("escalation_level", { ascending: false })
        .order("created_at", { ascending: false })
        .order("id")
        .limit(250),
      fetchAllPages<any>((from, to) =>
        supabase.from("field_visits")
          .select("*, profiles:user_id(name, employee_number, role)")
          .eq("date", today)
          .order("created_at", { ascending: true })
          .order("id")
          .range(from, to),
      ),
      supabase.from("offices").select("id, name, latitude, longitude, allowed_radius_meters, attendance_radius").eq("is_active", true),
      fetchAllPages<any>((from, to) =>
        supabase.from("attendance_logs")
          .select("id, user_id, checkin_location, checkin_time, office_id")
          .eq("date", today)
          .eq("status", "CHECKED_IN")
          .order("user_id")
          .order("id")
          .range(from, to),
      ),
      // One latest ping per employee (server-side). The old org-wide query was
      // capped at 1000 rows, so people dropped to "Last ping: —" during the day.
      supabase.rpc("rpc_latest_location_pings", { p_business_date: today }).then(async (res: any): Promise<any> => {
        if (!res.error || !["PGRST202", "42883"].includes(String(res.error.code))) return res;
        return supabase.from("location_tracking")
          .select("id, user_id, latitude, longitude, recorded_at")
          .gte("recorded_at", dayStart)
          .lte("recorded_at", dayEnd)
          .not("latitude", "is", null)
          .not("longitude", "is", null)
          .order("recorded_at", { ascending: false })
          .order("id")
          .limit(5000);
      }),
      CanonicalAttendanceService.listDay(today)
        .then((data) => ({ data, error: null }))
        .catch((error) => ({ data: null, error })),
    ]);
    const failed = [meetRes, officeRes, attRes, pingRes]
      .find((result) => result.error);
    if (failed?.error) throw failed.error;
    if (canonicalRes.error) throw canonicalRes.error;

    // Build office coords map
    const officeMap = new Map<string, {
      name: string; latitude: number; longitude: number;
      allowed_radius_meters?: number | null; attendance_radius?: number | null;
    }>();
    for (const o of (officeRes.data ?? []) as any[]) {
      if (o.latitude && o.longitude) officeMap.set(o.id, o);
    }

    // Build latest ping per user
    const pingMap = new Map<string, {
      latitude: number; longitude: number; recorded_at: string;
      accuracy: number | null; last_seen_at: string | null; last_seen_quality: string | null;
    }>();
    for (const p of (pingRes.data ?? []) as any[]) {
      if (!pingMap.has(p.user_id)) {
        pingMap.set(p.user_id, {
          latitude: p.latitude,
          longitude: p.longitude,
          recorded_at: p.recorded_at,
          accuracy: p.accuracy == null ? null : Number(p.accuracy),
          last_seen_at: p.last_seen_at ?? null,
          last_seen_quality: p.last_seen_quality ?? null,
        });
      }
    }

    const relationMap = new Map<string, LocationRelation>();
    const speedMap = new Map<string, number | null>();
    const deviceNoteMap = new Map<string, { text: string; color: string } | null>();
    const onVisitUsers = new Set<string>();
    for (const h of await heartbeatPromise) {
      deviceNoteMap.set(h.user_id, deviceNoteFor(h));
      if (h.field_visit_id) onVisitUsers.add(h.user_id);
      speedMap.set(h.user_id, h.last_fix_speed_mps == null ? null : Number(h.last_fix_speed_mps));
      if (h.site_state) {
        relationMap.set(h.user_id, { kind: "SITE", state: h.site_state, distance_m: h.site_distance_m ?? null });
      } else if (h.office_state && h.office_state !== "UNKNOWN") {
        relationMap.set(h.user_id, { kind: "OFFICE", state: h.office_state, distance_m: h.office_distance_m ?? null });
      }
    }

    // Build attendance check-in map
    const attMap = new Map<string, any>();
    for (const a of (attRes.data ?? []) as any[]) {
      attMap.set(a.user_id, a);
    }

    // Today's visits (all types); a verification re-submission replaces its source row.
    const todaysVisits = collapseCurrentLocationSubmissions((meetRes.data ?? []) as any[]) as any[];
    const activeVisitByUser = new Map<string, any>();
    for (const v of todaysVisits) {
      const st = String(v.status || "").toUpperCase();
      if (st !== "CHECKED_IN" && st !== "IN_TRANSIT") continue;
      const prev = activeVisitByUser.get(v.user_id);
      // At a site beats travelling to one.
      if (!prev || (st === "CHECKED_IN" && String(prev.status).toUpperCase() !== "CHECKED_IN")) {
        activeVisitByUser.set(v.user_id, v);
      }
    }

        const liveEmployeeRows: any[] = ((canonicalRes.data ?? []) as CanonicalAttendanceDay[])
      // Checked in today, or out on a field visit (even before an office check-in).
      .filter((row) => row.official_first_in || activeVisitByUser.has(row.user_id) || onVisitUsers.has(row.user_id))
      .map((row) => {
        const ping = pingMap.get(row.user_id);
        const rawStatus = String(row.latest_tracking_status || "").toUpperCase();
        const validStatus = Object.prototype.hasOwnProperty.call(STATUS_CONFIG, rawStatus)
          ? (rawStatus as TrackStatus)
          : null;
        const status: TrackStatus = row.official_last_out
          ? "CHECKED_OUT"
          : !ping
            ? "CHECKIN_ONLY"
            : validStatus ?? "GREEN";
        
        // Use the actual punch office if available, otherwise fallback to assigned office
        const punchOfficeId = attMap.get(row.user_id)?.office_id || row.office_id;
            
        return {
          user_id: row.user_id,
          name: row.employee_name,
          employee_number: row.employee_number,
          role: row.role || "Employee",
          office_id: punchOfficeId,
          // Search-only fields (already returned by the canonical day RPC).
          team_name: row.team_name ?? null,
          assigned_office_name: row.check_in_office_name ?? row.office_name ?? null,
          latitude: ping?.latitude ?? null,
          longitude: ping?.longitude ?? null,
          distance_from_base: row.distance_from_office_m ?? null,
          status,
          gps_available: status !== "RED_GPS_OFF",
          // Location time is the ping's own time — never the check-in time.
          recorded_at: ping?.recorded_at ?? "",
          ping_at: ping?.recorded_at ?? null,
          accuracy_m: ping?.accuracy ?? null,
          seen_at: ping?.last_seen_at ?? null,
          seen_quality: ping?.last_seen_quality ?? null,
          relation: relationMap.get(row.user_id) ?? null,
          speed_mps: speedMap.get(row.user_id) ?? null,
          device_note: deviceNoteMap.get(row.user_id) ?? null,
          attendance_checkin: row.official_first_in,
          attendance_checkout: row.official_last_out,
          checkin_time: row.official_first_in,
          checkout_time: row.official_last_out,
          last_visit_location: row.active_field_visit_name ?? activeVisitByUser.get(row.user_id)?.location_name ?? null,
          last_visit_checkin: row.field_visit_first_in,
          last_visit_checkout: row.field_visit_checkout,
          work_mode:
            onVisitUsers.has(row.user_id)
            || activeVisitByUser.has(row.user_id)
            || relationMap.get(row.user_id)?.kind === "SITE"
            || Boolean(row.active_field_visit_name)
              ? "FIELD"
              : "OFFICE",
          active_visit: (() => {
            const v = activeVisitByUser.get(row.user_id);
            return v
              ? { id: v.id, name: v.location_name || "Field visit", status: String(v.status), visit_type: v.visit_type, checkin_time: v.checkin_time ?? null }
              : null;
          })(),
          geo_fence_radius: 500,
          has_location_data: Boolean(ping),
          has_gps_ping: Boolean(ping),
        };
      });

    {
      // Enrich employees: merge office coords for fallback + compute stale flag
      const enriched = liveEmployeeRows.map((raw: any) => {
        // Title Case all display names at the source (per UI audit, 12 Jun 2026)
        const e = { ...raw, name: toTitleCase(raw.name) };
        const hasGpsPing = !!(e.latitude && e.longitude && e.status !== "CHECKIN_ONLY");
        let officeLat = e.office_latitude ?? null;
        let officeLng = e.office_longitude ?? null;
        let officeName = e.office_name ?? null;
        let fenceRadius: number | null = null;
        if (e.office_id) {
          const o = officeMap.get(e.office_id);
          if (o) {
            if (!officeLat) { officeLat = o.latitude; officeLng = o.longitude; officeName = o.name; }
            fenceRadius = Number(o.allowed_radius_meters ?? o.attendance_radius) || null;
          }
        }
        // Distance from the office of the SAME ping shown on the card.
        const distanceFromBase =
          e.latitude != null && e.longitude != null && officeLat != null && officeLng != null
            ? distanceMetres(officeLat, officeLng, e.latitude, e.longitude)
            : e.distance_from_base;

        const pingTimestamp = e.ping_at
          ? (() => { try { return parseDatabaseTimestamp(e.ping_at).getTime(); } catch { return null; } })()
          : null;
        const staleMins = pingTimestamp == null
          ? Infinity
          : (authoritativeNowMs - pingTimestamp) / 60000;
        const timestampInvalid = staleMins < -10 / 60;
        const isStale =
          hasGpsPing &&
          (staleMins > 15 || timestampInvalid) &&
          e.status !== "CHECKED_OUT";

        return {
          ...e,
          has_gps_ping: hasGpsPing,
          office_latitude: officeLat,
          office_longitude: officeLng,
          office_name: officeName,
          distance_from_base: distanceFromBase,
          geo_fence_radius: fenceRadius ?? 0,
          is_stale: isStale,
          stale_mins: Number.isFinite(staleMins) ? Math.max(0, Math.floor(staleMins)) : 0,
          timestamp_invalid: timestampInvalid,
          location_status: locationStatusFor({ status: e.status, ping_at: e.ping_at }).status,
        };
      });
      setEmployees(enriched as LiveEmployee[]);
    }
    if (alertRes.error) {
      // Alerts are supplementary. A large/temporarily unhealthy alerts table
      // must not take the whole live employee map offline.
      void reportNonFatalError("live_tracking.alerts", alertRes.error);
      setAlerts([]);
    } else {
      setAlerts((alertRes.data ?? []) as AlertRow[]);
    }
    
    // Enrich visits with origin coordinates and ETA
    if (meetRes.data) {
      const enrichedMeetings = await Promise.all(todaysVisits.map(async (m: any) => {
        // Get origin coordinates (priority: last GPS ping > office check-in location)
        const ping = pingMap.get(m.user_id);
        const att = attMap.get(m.user_id);
        
        let originLat = null;
        let originLng = null;
        let originName = null;
        let lastPingTime = null;

        // ETA only from a real GPS position — never from the check-in point.
        if (ping) {
          const fresh = freshnessOfTimestamp(ping.recorded_at, authoritativeNowMs);
          originLat = ping.latitude;
          originLng = ping.longitude;
          originName = fresh === "LIVE" || fresh === "RECENT" ? "Current location" : "Last known location";
          lastPingTime = ping.recorded_at;
        }
        void att;

        // Calculate ETA and distance if both origin and destination exist
        let etaMinutes = null;
        let distanceFromOriginM = null;
        if (originLat && originLng && m.destination_coords?.latitude && m.destination_coords?.longitude) {
          try {
            const routeKey = [
              Number(originLat).toFixed(5),
              Number(originLng).toFixed(5),
              Number(m.destination_coords.latitude).toFixed(5),
              Number(m.destination_coords.longitude).toFixed(5),
            ].join(":");
            const cachedRoute = routeEtaCache.get(routeKey);
            if (cachedRoute && cachedRoute.expiresAt > authoritativeNowMs) {
              etaMinutes = cachedRoute.value;
            } else {
              etaMinutes = await getDrivingMinutes(
                { latitude: originLat, longitude: originLng },
                { latitude: m.destination_coords.latitude, longitude: m.destination_coords.longitude }
              );
              routeEtaCache.set(routeKey, {
                value: etaMinutes,
                expiresAt: authoritativeNowMs + 10 * 60 * 1000,
              });
            }
            // Calculate straight-line distance in meters for reference
            const R = 6371000;
            const dLat = ((m.destination_coords.latitude - originLat) * Math.PI) / 180;
            const dLon = ((m.destination_coords.longitude - originLng) * Math.PI) / 180;
            const a = Math.sin(dLat / 2) ** 2 +
              Math.cos((originLat * Math.PI) / 180) *
              Math.cos((m.destination_coords.latitude * Math.PI) / 180) *
              Math.sin(dLon / 2) ** 2;
            distanceFromOriginM = Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
          } catch (e) {
            console.error("ETA calculation error:", e);
          }
        }

        return {
          ...m,
          origin_lat: originLat,
          origin_lon: originLng,
          origin_name: originName,
          last_ping_time: lastPingTime,
          eta_minutes: etaMinutes,
          distance_from_origin_m: distanceFromOriginM,
        };
      }));
      setMeetings(enrichedMeetings);
    }
    setLoadError(null);
    } catch (error: any) {
      const message = error?.message || "Live tracking data could not be loaded.";
      setLoadError(message);
      console.error("[LiveTracking] Data refresh failed", error);
    }
  }, []);

  // A ping arrives from somebody every few seconds; reload at most every 10 s.
  const lastLoadRef = useRef(0);
  const pendingLoadRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleLoad = useCallback(() => {
    if (pendingLoadRef.current) return;
    const wait = Math.max(0, 10_000 - (Date.now() - lastLoadRef.current));
    pendingLoadRef.current = setTimeout(() => {
      pendingLoadRef.current = null;
      lastLoadRef.current = Date.now();
      void loadData();
    }, wait);
  }, [loadData]);

  // A location turns STALE with no new ping: recalculate ages every minute
  // from the ticking server clock, without a server round trip.
  useEffect(() => {
    const tick = setInterval(() => {
      setEmployees((prev) =>
        prev.map((e) => {
          const r = locationStatusFor(e);
          return {
            ...e,
            location_status: r.status,
            is_stale: r.status === "STALE",
            stale_mins: r.ageMins == null ? e.stale_mins : Math.floor(r.ageMins),
          };
        }),
      );
    }, 60_000);
    return () => clearInterval(tick);
  }, []);

  // Popups only when an employee's location status CHANGES.
  const previousStatusRef = useRef<Map<string, LocationStatus>>(new Map());
  const statusPrimedRef = useRef(false);
  const [toasts, setToasts] = useState<{ id: string; title: string; body: string; color: string }[]>([]);
  const pushToast = useCallback((title: string, body: string, color: string) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev.slice(-2), { id, title, body, color }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 8000);
  }, []);
  useEffect(() => {
    if (!employees.length) return;
    const prev = previousStatusRef.current;
    if (!statusPrimedRef.current) {
      // First load of this screen: one summary instead of one popup per person.
      statusPrimedRef.current = true;
      employees.forEach((e) => prev.set(e.user_id, e.location_status));
      const missing = employees.filter((e) => e.location_status === "NO_LOCATION_TODAY").length;
      const stale = employees.filter((e) => e.location_status === "STALE").length;
      if (missing || stale) {
        pushToast(
          "Location check",
          [missing ? `${missing} checked in with no location today` : null, stale ? `${stale} not updated for 15+ min` : null]
            .filter(Boolean)
            .join(" · "),
          "#D97706",
        );
      }
      return;
    }
    const changes: { e: LiveEmployee; from: LocationStatus | undefined }[] = [];
    for (const e of employees) {
      const before = prev.get(e.user_id);
      if (before !== e.location_status) changes.push({ e, from: before });
      prev.set(e.user_id, e.location_status);
    }
    const notable = changes.filter(({ e, from }) =>
      e.location_status === "STALE" ||
      e.location_status === "NO_LOCATION_TODAY" ||
      ((e.location_status === "LIVE" || e.location_status === "RECENT") &&
        (from === "STALE" || from === "NO_LOCATION_TODAY")),
    );
    if (notable.length > 3) {
      pushToast("Location updates", `${notable.length} employees changed location status`, "#6366F1");
      return;
    }
    for (const { e } of notable) {
      if (e.location_status === "STALE") {
        pushToast(
          "Location update delayed",
          `${e.name}'s last location was ${timeAgo(e.ping_at)} (${pingDateTime(e.ping_at)}).`,
          "#D97706",
        );
      } else if (e.location_status === "NO_LOCATION_TODAY") {
        pushToast("Location not received", `No location from ${e.name} today. Attendance: checked in.`, "#DC2626");
      } else {
        pushToast("Location restored", `${e.name}'s location received — updated ${timeAgo(e.ping_at)}.`, "#059669");
      }
    }
  }, [employees, pushToast]);

  useFocusEffect(
    useCallback(() => {
      lastLoadRef.current = Date.now();
      loadData();

      // Fallback poll
      timerRef.current = setInterval(loadData, AUTO_REFRESH_MS);

      // Realtime: refresh dashboard when a new location ping arrives
      const channel = supabase
        .channel("live-tracking-updates")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "location_tracking" },
          () => scheduleLoad()
        )
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "location_alerts" },
          () => loadData()
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "location_alerts" },
          () => loadData()
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "attendance_logs" },
          () => scheduleLoad()
        )
        .subscribe((status) => {
          setRealtimeStatus(
            status as
              | "SUBSCRIBED"
              | "CHANNEL_ERROR"
              | "TIMED_OUT"
              | "CLOSED",
          );
        });

      return () => {
        if (timerRef.current) clearInterval(timerRef.current);
        supabase.removeChannel(channel);
      };
    }, [loadData])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await loadData();
    } finally {
      setRefreshing(false);
    }
  };

  const resolveAlert = async (id: string) => {
      try {
        const { error } = await TrackingAdminService.resolveAlert(id);
        if (error) throw error;
        setAlerts((prev) => prev.filter((a) => a.id !== id));
      } catch (error: any) {
        Alert.alert(
          "Alert not resolved",
          error?.message || "The server did not confirm this action.",
        );
      }
    };
    
  const requestPing = async (targetUserId: string, name: string) => {
    if (pingingUserId) return;
    setPingingUserId(targetUserId);
    try {
      const { requests, error } =
        await TrackingAdminService.requestPings([targetUserId]);
      const req = requests[0];

      if (error || !req?.id) {
        throw error ?? new Error("The server did not create a location ping request.");
      }

      // Listen for the device to respond (fulfilled/failed)
      const pingChannel = supabase
        .channel(`ping-response-${req.id}`)
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "location_ping_requests", filter: `id=eq.${req.id}` },
          async (payload: any) => {
            if (payload.new?.status === "fulfilled" || payload.new?.status === "failed") {
              await loadData();
              setPingingUserId(null);
              supabase.removeChannel(pingChannel);
            }
          }
        )
        .subscribe();

      // Fallback: clear after 20s regardless
      setTimeout(() => {
        setPingingUserId(null);
        supabase.removeChannel(pingChannel);
        loadData();
      }, 20000);
    } catch (error: any) {
      setPingingUserId(null);
      Alert.alert("Ping request failed", error?.message || "Unable to request a location update.");
    }
  };

  // ── Derived counts ──────────────────────────────────────────────────────────
  const counts = employees.reduce(
    (acc, e) => {
      acc[e.status] = (acc[e.status] ?? 0) + 1;
      if (e.is_stale) acc["STALE"] = (acc["STALE"] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );
  const redCount = (counts["RED_GPS_OFF"] ?? 0) + (counts["RED_RANGE"] ?? 0) + (counts["STALE"] ?? 0);

  const officeEmployees = employees.filter((e) => e.work_mode !== "FIELD");
  const fieldEmployees = employees.filter((e) => e.work_mode === "FIELD");
  const tabEmployees = tab === "field" ? fieldEmployees : officeEmployees;
  const statusFiltered = filter === "ALL"
    ? tabEmployees
    : filter === "STALE"
    ? tabEmployees.filter((e) => e.is_stale)
    : tabEmployees.filter((e) => e.status === filter);
  const searchTerms = searchQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matchesSearch = (e: LiveEmployee) => {
    if (!searchTerms.length) return true;
    const hay = searchTextOf(e);
    return searchTerms.every((t) => hay.includes(t));
  };
  const filtered = searchTerms.length ? statusFiltered.filter(matchesSearch) : statusFiltered;
  // Matches hidden by the other tab / the status filter, so the empty state can say where they are.
  const otherTabMatches = searchTerms.length
    ? (tab === "field" ? officeEmployees : fieldEmployees).filter(matchesSearch).length
    : 0;
  const hiddenByFilter = searchTerms.length && filter !== "ALL"
    ? tabEmployees.filter(matchesSearch).length - filtered.length
    : 0;
  const openSearchResult = (emp: LiveEmployee) => {
    setSelectedEmp(emp);
  };
  const visitCounts = meetings.reduce(
    (acc, m) => {
      const st = String(m.status || "").toUpperCase();
      if (st === "CHECKED_IN") acc.atSite++;
      else if (st === "IN_TRANSIT") acc.travelling++;
      else if (st === "PENDING") acc.planned++;
      else if (st === "COMPLETED") acc.done++;
      else if (st === "MISSED") acc.missed++;
      return acc;
    },
    { atSite: 0, travelling: 0, planned: 0, done: 0, missed: 0 },
  );

  // ── Access guard ────────────────────────────────────────────────────────────
  // admins, live_tracking.view (scoped by the server), or escalation members
  const canView = canViewTracking || isEscalationMember;

  if (!canView) {
    return (
      <View style={[styles.center, { backgroundColor: theme.backgroundRoot }]}>
        <Feather name="lock" size={40} color={theme.textSecondary} />
        <Spacer height={Spacing.md} />
        <ThemedText type="body" style={{ color: theme.textSecondary }}>
          Access restricted to escalation team only.
        </ThemedText>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.backgroundRoot }}>
      {toasts.length ? (
        <View style={styles.toastStack} pointerEvents="box-none">
          {toasts.map((t) => (
            <Pressable
              key={t.id}
              onPress={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
              style={[styles.toast, { backgroundColor: theme.backgroundDefault, borderLeftColor: t.color }]}
            >
              <ThemedText style={{ fontWeight: "800", color: t.color }}>{t.title}</ThemedText>
              <ThemedText type="caption" style={{ color: theme.text }}>{t.body}</ThemedText>
            </Pressable>
          ))}
        </View>
      ) : null}
      {loadError ? (
        <View style={{ margin: 12, padding: 12, borderRadius: 10, backgroundColor: "#FEE2E2" }}>
          <ThemedText style={{ color: "#991B1B", fontWeight: "700" }}>
            Live tracking data may be incomplete: {loadError}
          </ThemedText>
        </View>
      ) : null}
      {/* ── Summary Bar ── */}
      <View style={[styles.summaryBar, { backgroundColor: theme.backgroundDefault }]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: "#10B981" }} />
          <ThemedText type="caption" style={{ color: "#10B981", fontWeight: "700", fontSize: 10 }}>
            {employees.filter((e) => e.location_status === "LIVE" || e.location_status === "RECENT").length} LIVE
          </ThemedText>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <View
            style={{
              width: 7,
              height: 7,
              borderRadius: 4,
              backgroundColor:
                realtimeStatus === "SUBSCRIBED" ? "#10B981" : "#F59E0B",
            }}
          />
          <ThemedText type="caption" style={{ color: theme.textSecondary, fontSize: 9 }}>
            Realtime {realtimeStatus === "SUBSCRIBED"
              ? "connected"
              : realtimeStatus.toLowerCase()}
          </ThemedText>
        </View>
        <SummaryChip label="Total" value={employees.length} color={theme.text} />
        <SummaryChip label="🟢 OK"    value={counts["GREEN"] ?? 0}       color="#10B981" />
        <SummaryChip label="🟡 Near"  value={(counts["YELLOW"] ?? 0) + (counts["ORANGE"] ?? 0)} color="#F59E0B" />
        <SummaryChip label="🔴 Alert" value={redCount} color="#EF4444" />
        <SummaryChip label="⏳ Ping"  value={counts["CHECKIN_ONLY"] ?? 0} color="#6B7280" />
        <SummaryChip label="✅ Done"  value={counts["CHECKED_OUT"] ?? 0} color="#9CA3AF" />
        <SummaryChip label="⚠️ Open"  value={alerts.length}              color="#F97316" />
      </View>

      {/* ── Tabs ── */}
      <View style={[styles.tabRow, { backgroundColor: theme.backgroundDefault }]}>
        {(["office", "field", "alerts"] as const).map((t) => (
          <Pressable
            key={t}
            style={[styles.tab, tab === t && { borderBottomColor: theme.primary, borderBottomWidth: 2 }]}
            onPress={() => setTab(t)}
          >
            <ThemedText
              type="caption"
              style={{ color: tab === t ? theme.primary : theme.textSecondary, fontWeight: "600" }}
            >
              {t === "office" ? `🏢 Office (${officeEmployees.length})` : t === "field" ? `📍 Field Visit (${fieldEmployees.length})` : `🚨 Alerts (${alerts.length})`}
            </ThemedText>
          </Pressable>
        ))}
      </View>

      {tab === "office" || tab === "field" ? (
        <>
          {/* ── Employee search (stays above the scrolling list) ── */}
          <View style={[styles.searchPanel, { backgroundColor: theme.backgroundDefault, borderBottomColor: theme.border }]}>
            <View style={[styles.searchBox, { backgroundColor: theme.backgroundSecondary, borderColor: searchInput ? theme.primary : theme.border }]}>
              <Feather name="search" size={16} color={theme.textSecondary} />
              <TextInput
                value={searchInput}
                onChangeText={setSearchInput}
                placeholder="Search name, employee no., team, office"
                placeholderTextColor={theme.textTertiary}
                style={[styles.searchInput, { color: theme.text }]}
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="search"
                clearButtonMode="never"
                accessibilityLabel="Search employees"
                onSubmitEditing={() => {
                  // Enter with a single match opens that employee directly.
                  if (filtered.length === 1) openSearchResult(filtered[0]);
                }}
              />
              {searchInput ? (
                <Pressable
                  onPress={() => { setSearchInput(""); setSearchQuery(""); }}
                  hitSlop={8}
                  style={styles.searchClear}
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                >
                  <Feather name="x" size={16} color={theme.textSecondary} />
                </Pressable>
              ) : null}
            </View>
            {searchTerms.length ? (
              <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: 4 }}>
                {filtered.length} {filtered.length === 1 ? "employee" : "employees"} found
                {filtered.length === 1 ? " · tap or press Enter to open" : ""}
                {otherTabMatches ? ` · ${otherTabMatches} more in ${tab === "field" ? "Office" : "Field Visit"}` : ""}
              </ThemedText>
            ) : null}
          </View>

          {/* ── Filter chips ── */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ maxHeight: 44 }}
            contentContainerStyle={styles.filterRow}
          >
            {FILTERS.map((f) => (
              <Pressable
                key={f}
                style={[
                  styles.filterChip,
                  {
                    backgroundColor:
                      filter === f ? theme.primary : theme.backgroundDefault,
                  },
                ]}
                onPress={() => setFilter(f)}
              >
                <ThemedText
                  type="caption"
                  style={{ color: filter === f ? "#fff" : theme.textSecondary }}
                >
                  {FILTER_LABELS[f]}
                  {f !== "ALL" && counts[f] ? ` (${counts[f]})` : ""}
                </ThemedText>
              </Pressable>
            ))}
          </ScrollView>

          <FlatList
            data={filtered}
            keyExtractor={(e) => e.user_id}
            contentContainerStyle={{ padding: Spacing.md, gap: Spacing.sm }}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />
            }
            ListHeaderComponent={tab === "field" ? (
              <View style={[styles.fieldSummary, { backgroundColor: theme.backgroundDefault, borderColor: theme.border }]}>
                <ThemedText type="caption" style={{ fontWeight: "700", color: theme.text }}>Today's field visits</ThemedText>
                <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: 2 }}>
                  {visitCounts.atSite} at site · {visitCounts.travelling} travelling · {visitCounts.planned} planned · {visitCounts.done} completed · {visitCounts.missed} missed
                </ThemedText>
              </View>
            ) : null}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              searchTerms.length ? (
                <View style={styles.center}>
                  <Feather name="search" size={28} color={theme.textTertiary} />
                  <Spacer height={Spacing.sm} />
                  <ThemedText type="body" style={{ color: theme.text, fontWeight: "600", textAlign: "center" }}>
                    No employee matches “{searchQuery.trim()}”
                  </ThemedText>
                  {otherTabMatches || hiddenByFilter ? (
                    <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: 4, textAlign: "center" }}>
                      {otherTabMatches ? `${otherTabMatches} found in the ${tab === "field" ? "Office" : "Field Visit"} tab. ` : ""}
                      {hiddenByFilter ? `${hiddenByFilter} hidden by the “${FILTER_LABELS[filter]}” filter.` : ""}
                    </ThemedText>
                  ) : null}
                  <Pressable
                    onPress={() => { setSearchInput(""); setSearchQuery(""); }}
                    style={[styles.clearSearchBtn, { borderColor: theme.primary }]}
                    accessibilityRole="button"
                  >
                    <ThemedText type="caption" style={{ color: theme.primary, fontWeight: "700" }}>Clear search</ThemedText>
                  </Pressable>
                </View>
              ) : (
                <View style={styles.center}>
                  <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                    {tab === "field" ? "Nobody is on a field visit right now." : "No employees tracked in the office today."}
                  </ThemedText>
                </View>
              )
            }
            renderItem={({ item }) => (
              <View>
                {tab === "field" && item.active_visit ? (
                  <ThemedText type="caption" style={{ color: item.active_visit.status.toUpperCase() === "CHECKED_IN" ? "#059669" : "#2563EB", fontWeight: "700", marginBottom: 2, marginLeft: 4 }}>
                    {item.active_visit.status.toUpperCase() === "CHECKED_IN" ? "At site" : "Travelling to"}: {item.active_visit.name}
                  </ThemedText>
                ) : null}
                <EmployeeCard emp={item} onPress={() => setSelectedEmp(item)} onPing={() => requestPing(item.user_id, item.name)} pinging={pingingUserId === item.user_id} />
              </View>
            )}
            ListFooterComponent={tab === "field" && meetings.length && !searchTerms.length ? (
              <View style={{ marginTop: Spacing.md, gap: Spacing.sm }}>
                <ThemedText type="caption" style={{ fontWeight: "700", color: theme.textSecondary }}>
                  ALL VISITS TODAY ({meetings.length})
                </ThemedText>
                {meetings.map((m) => <MeetingCard key={m.id} meeting={m} theme={theme} />)}
              </View>
            ) : null}
          />
        </>
      ) : (
        <FlatList
          data={alerts}
          keyExtractor={(a) => a.id}
          ListHeaderComponent={<GeofenceReviewPanel />}
          contentContainerStyle={{ padding: Spacing.md, gap: Spacing.sm }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Feather name="check-circle" size={32} color="#10B981" />
              <Spacer height={Spacing.sm} />
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                No open alerts 🎉
              </ThemedText>
            </View>
          }
          renderItem={({ item }) => (
            <AlertCard alert={item} onResolve={resolveAlert} />
          )}
        />
      )}

      {/* ── Employee Detail Modal ── */}
      <Modal
        visible={!!selectedEmp}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedEmp(null)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setSelectedEmp(null)}>
          <View
            style={[styles.modalSheet, { backgroundColor: theme.backgroundDefault }]}
            onStartShouldSetResponder={() => true}
          >
            {selectedEmp && (
              <ScrollView showsVerticalScrollIndicator={false}>
                <EmployeeDetail emp={selectedEmp} onClose={() => setSelectedEmp(null)} />
              </ScrollView>
            )}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

// ─── Employee Detail ───────────────────────────────────────────────────────────

function EmployeeDetail({ emp, onClose }: { emp: LiveEmployee; onClose: () => void }) {
  const { theme } = useTheme();
  const color = statusColor(emp.status);

  const rows: [string, string][] = [
    ["Status",        statusLabel(emp.status)],
    ["Office In",     fmtIST(emp.attendance_checkin)  || "—"],
    ["Gone Home",     emp.attendance_checkout ? fmtIST(emp.attendance_checkout) : "Still out"],
    ["Visit Location",emp.last_visit_location ?? "—"],
    ["Visit Arrived", fmtIST(emp.last_visit_checkin)  || "—"],
    ["Visit Left",    emp.last_visit_checkout ? fmtIST(emp.last_visit_checkout) : "Still there"],
    ["Last GPS",      emp.latitude ? fmtIST(emp.recorded_at) : "No ping yet"],
    ["GPS",           emp.gps_available ? "✅ Available" : "🔴 OFF"],
    ["Distance",      emp.distance_from_base !== null ? `${Math.round(emp.distance_from_base)}m` : "—"],
    ["Geo-fence",     `${emp.geo_fence_radius}m`],
    ["Latitude",      emp.latitude?.toFixed(6) ?? "—"],
    ["Longitude",     emp.longitude?.toFixed(6) ?? "—"],
  ];

  return (
    <View>
      <View style={styles.cardRow}>
        <View style={[styles.statusDot, { backgroundColor: color, width: 14, height: 14 }]} />
        <ThemedText type="h3" style={{ flex: 1 }}>{emp.name}</ThemedText>
        <Pressable onPress={onClose}>
          <Feather name="x" size={22} color={theme.textSecondary} />
        </Pressable>
      </View>
      <ThemedText type="caption" style={{ color: theme.textSecondary, marginBottom: Spacing.md }}>
        {emp.role}{emp.employee_number ? ` · ${emp.employee_number}` : ""}
      </ThemedText>

      {/* Google Maps embed in detail modal — GPS ping or office fallback */}
      {(emp.latitude || emp.office_latitude) && (emp.longitude || emp.office_longitude) && (() => {
        const mapLat = (emp.latitude ?? emp.office_latitude)!;
        const mapLng = (emp.longitude ?? emp.office_longitude)!;
        const isRealGps = emp.has_gps_ping;
        return (
          <>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: LOCATION_STATUS_UI[emp.location_status].color }} />
              <ThemedText type="caption" style={{ color: LOCATION_STATUS_UI[emp.location_status].color, fontWeight: "700" }}>
                {isRealGps
                  ? `${LOCATION_STATUS_UI[emp.location_status].label} · GPS ${timeAgo(emp.ping_at)} · ${pingDateTime(emp.ping_at)}${accuracyText(emp.accuracy_m)}`
                  : `${emp.office_name ?? "Office"} — office position, no GPS received today`}
              </ThemedText>
            </View>
            <Pressable
              onPress={() => Linking.openURL(googleMapsDeepLink(mapLat, mapLng))}
              style={[styles.mapContainer, { height: 200, marginBottom: Spacing.md }]}
            >
              {Platform.OS === "web" ? (
                // @ts-ignore
                <iframe
                  title={`detail-map-${emp.user_id}`}
                  src={`https://www.google.com/maps/embed/v1/place?key=${process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY}&q=${mapLat},${mapLng}&zoom=17`}
                  style={{ width: "100%", height: "100%", border: "none", borderRadius: 10 }}
                />
              ) : (
                <Image
                  source={{ uri: googleStaticMapUrl(mapLat, mapLng, 17, "600x400") }}
                  style={styles.mapImage}
                  resizeMode="cover"
                />
              )}
              <View style={styles.mapOverlay}>
                <Feather name="map-pin" size={12} color="#fff" />
                <ThemedText type="caption" style={{ color: "#fff", fontWeight: "700", fontSize: 10 }}>
                  {mapLat.toFixed(5)}, {mapLng.toFixed(5)}
                </ThemedText>
              </View>
            </Pressable>
            <View style={{ flexDirection: "row", gap: 8, marginBottom: Spacing.md }}>
              <Pressable
                onPress={() => Linking.openURL(googleMapsDeepLink(mapLat, mapLng))}
                style={[styles.mapBtn, { flex: 1, backgroundColor: "#EFF6FF" }]}
              >
                <Feather name="map" size={13} color="#2563EB" />
                <ThemedText type="caption" style={{ color: "#2563EB", fontWeight: "700" }}>Open in Google Maps</ThemedText>
              </Pressable>
              <Pressable
                onPress={() => Linking.openURL(googleMapsNavLink(mapLat, mapLng))}
                style={[styles.mapBtn, { flex: 1, backgroundColor: "#6D1B6D" }]}
              >
                <Feather name="navigation" size={13} color="#fff" />
                <ThemedText type="caption" style={{ color: "#fff", fontWeight: "700" }}>Navigate</ThemedText>
              </Pressable>
            </View>
          </>
        );
      })()}

      {rows.map(([label, val]) => (
        <View key={label} style={styles.detailRow}>
          <ThemedText type="caption" style={{ color: theme.textSecondary, width: 90 }}>{label}</ThemedText>
          <ThemedText type="caption" style={{ flex: 1, fontWeight: "600" }}>{val}</ThemedText>
        </View>
      ))}
    </View>
  );
}

// ─── Summary Chip ──────────────────────────────────────────────────────────────

function SummaryChip({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={styles.summaryChip}>
      <ThemedText type="caption" style={{ color, fontWeight: "700", fontSize: 16 }}>
        {value}
      </ThemedText>
      <ThemedText type="caption" style={{ color, fontSize: 10 }}>{label}</ThemedText>
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  fieldSummary: { borderWidth: 1, borderRadius: 10, padding: 10, marginBottom: 4 },
  searchPanel: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingLeft: 12,
    minHeight: 44,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    paddingVertical: Platform.OS === "web" ? 10 : 8,
    ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : null),
  },
  searchClear: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  clearSearchBtn: { marginTop: Spacing.md, borderWidth: 1, borderRadius: 20, paddingHorizontal: 16, minHeight: 40, justifyContent: "center" },
  locStatusRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 6 },
  locDot: { width: 7, height: 7, borderRadius: 4 },
  toastStack: { position: "absolute", top: 8, left: 12, right: 12, zIndex: 50, gap: 6 },
  toast: { borderLeftWidth: 4, borderRadius: 10, padding: 10, gap: 2, shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 4 },
  summaryBar: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  summaryChip: { alignItems: "center" },
  tabRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
  },
  tab: {
    flex: 1,
    alignItems: "center",
    paddingVertical: Spacing.sm,
  },
  filterRow: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    gap: Spacing.xs,
    alignItems: "center",
  },
  filterChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 4,
    borderRadius: BorderRadius.full ?? 20,
  },
  card: {
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderLeftWidth: 4,
  },
  alertCard: {
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderLeftWidth: 4,
  },
  cardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  resolveBtn: {
    borderWidth: 1,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.xl,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    borderTopLeftRadius: BorderRadius.lg ?? 16,
    borderTopRightRadius: BorderRadius.lg ?? 16,
    padding: Spacing.lg,
    paddingBottom: Spacing["2xl"] ?? 32,
    maxHeight: "90%",
  },
  detailRow: {
    flexDirection: "row",
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E5E7EB",
  },
  pingBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 8,
    alignSelf: "flex-start",
    backgroundColor: "#7C3AED",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  openMapsRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8, minHeight: 32 },
  mapContainer: {
    height: 140,
    borderRadius: 10,
    overflow: "hidden",
    marginTop: 10,
    position: "relative",
  },
  mapImage: {
    width: "100%",
    height: "100%",
    borderRadius: 10,
  },
  mapOverlay: {
    position: "absolute",
    bottom: 6,
    right: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  mapBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 8,
    borderRadius: 8,
  },
});
