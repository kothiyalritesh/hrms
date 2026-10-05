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
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useFocusEffect } from "@react-navigation/native";
import { ScreenScrollView } from "@/components/ScreenScrollView";
import { ThemedText } from "@/components/ThemedText";
import { toTitleCase } from "@/utils/format";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, Colors } from "@/constants/theme";
import Spacer from "@/components/Spacer";
import { supabase } from "@/lib/supabase";
import { TrackingAdminService } from "@/services/tracking-admin.service";
import { useAuth } from "@/contexts/AuthContext";
import { googleStaticMapUrl, googleMapsDeepLink, googleMapsNavLink } from "@/utils/googleGeolocation";
import { getDrivingMinutes } from "@/utils/googleMaps";
import { BusinessClockService } from "@/services/business-clock.service";
import { parseDatabaseTimestamp } from "@/utils/businessDate";
import { formatHrmsTime } from "@/utils/attendanceTimestamp";
import { fetchAllPages } from "@/utils/supabasePagination";
import { reportNonFatalError } from "@/utils/operationalErrors";
import {
  CanonicalAttendanceDay,
  CanonicalAttendanceService,
} from "@/services/canonical-attendance.service";

// ─── Types ────────────────────────────────────────────────────────────────────

type TrackStatus = "GREEN" | "YELLOW" | "ORANGE" | "RED_RANGE" | "RED_GPS_OFF" | "CHECKIN_ONLY" | "CHECKED_OUT";

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
}

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
const routeEtaCache = new Map<string, { value: number | null; expiresAt: number }>();

function timeAgo(iso: string) {
  if (authoritativeClockMs == null) return "server time unavailable";
  let diff: number;
  try {
    diff = Math.floor(
      (authoritativeClockMs - parseDatabaseTimestamp(iso).getTime()) / 1000,
    );
  } catch {
    return "—";
  }
  if (diff < -10) return "invalid future timestamp";
  if (diff < 0) return "just now";
  if (diff < 60)  return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function fmtIST(iso?: string | null) {
  return formatHrmsTime(iso, "—");
}

// ─── Employee Card ─────────────────────────────────────────────────────────────

// GPS is truly OFF only when gps_available=false AND no recent ping (>10 min stale)
function isGpsTrulyOff(emp: LiveEmployee): boolean {
  if (emp.status === "CHECKED_OUT" || emp.status === "CHECKIN_ONLY") return false;
  if (!emp.gps_available) return true;
  if (authoritativeClockMs == null) return true;
  let staleMins: number;
  try {
    staleMins =
      (authoritativeClockMs - parseDatabaseTimestamp(emp.recorded_at).getTime()) /
      60000;
  } catch {
    return true; // treat unparseable timestamp as GPS off
  }
  if (staleMins < -10 / 60) return true;
  return staleMins > 10;
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
    : emp.has_location_data && !emp.has_gps_ping
    ? "📍 No GPS (ping present)" // GPS is off but pings exist
    : timeAgo(emp.recorded_at);

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
          </ThemedText>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <ThemedText type="caption" style={{ color: gpsOff && !isCheckedOut ? "#DC2626" : color, fontWeight: "700" }}>
            {gpsOff && !isCheckedOut && emp.status !== "CHECKIN_ONLY" ? "GPS OFF" : statusLabel(emp.status)}
          </ThemedText>
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            {timeLabel}
          </ThemedText>
        </View>
      </View>

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

      {emp.distance_from_base !== null && !isCheckedOut && (
        <ThemedText
          type="caption"
          style={{ color: isRed ? color : theme.textSecondary, marginTop: 4 }}
        >
          📍 {Math.round(emp.distance_from_base)}m from base
          {emp.geo_fence_radius ? ` (fence: ${emp.geo_fence_radius}m)` : ""}
        </ThemedText>
      )}
      {/* Last GPS ping — only for active employees */}
      {(emp.latitude || emp.has_location_data) && !isCheckedOut && (
        <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: 4 }}>
          {emp.has_gps_ping ? `📡 Last ping: ${timeAgo(emp.recorded_at)}` : `📍 Ping exists (no GPS)`}
        </ThemedText>
      )}
      {emp.status === "CHECKIN_ONLY" && (
        <ThemedText type="caption" style={{ color: "#6B7280", marginTop: 4 }}>
          ⏳ Awaiting first GPS ping
        </ThemedText>
      )}
      {gpsOff && !isCheckedOut && emp.status !== "CHECKIN_ONLY" && (
        <ThemedText type="caption" style={{ color: "#DC2626", marginTop: 4 }}>
          🔴 {!emp.gps_available ? "Location OFF / Not Trackable" : "GPS signal lost (no ping >10 min)"}
        </ThemedText>
      )}
      {/* Stale ping warning — checked in with GPS history but silent >15 min */}
      {emp.is_stale && !gpsOff && !isCheckedOut && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 4, backgroundColor: "#FEF3C7", borderRadius: 6, padding: 6 }}>
          <Feather name="alert-triangle" size={12} color="#D97706" />
          <ThemedText type="caption" style={{ color: "#92400E", fontWeight: "600" }}>
            No ping for {emp.stale_mins}m — location may be off
          </ThemedText>
        </View>
      )}
      {/* Google Maps — always show when any coords exist (GPS ping or office fallback) */}
      {!isCheckedOut && (emp.latitude || emp.office_latitude) && (emp.longitude || emp.office_longitude) && (() => {
        const mapLat = (emp.latitude ?? emp.office_latitude)!;
        const mapLng = (emp.longitude ?? emp.office_longitude)!;
        const isRealGps = emp.has_gps_ping;
        const mapLabel = isRealGps
          ? `📡 Live · ${timeAgo(emp.recorded_at)}`
          : `🏢 ${emp.office_name ?? "Check-in location"}`;
        const mapLabelColor = isRealGps ? "#10B981" : "#F59E0B";
        return (
          <>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 8 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: mapLabelColor }} />
              <ThemedText type="caption" style={{ color: mapLabelColor, fontWeight: "700", fontSize: 10 }}>
                {mapLabel}
              </ThemedText>
            </View>
            <Pressable
              onPress={() => Linking.openURL(googleMapsDeepLink(mapLat, mapLng))}
              style={styles.mapContainer}
            >
              {Platform.OS === "web" ? (
                // @ts-ignore
                <iframe
                  title={`map-${emp.user_id}`}
                  src={`https://www.google.com/maps/embed/v1/place?key=${process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY}&q=${mapLat},${mapLng}&zoom=16`}
                  style={{ width: "100%", height: "100%", border: "none", borderRadius: 10 }}
                />
              ) : (
                <Image
                  source={{ uri: googleStaticMapUrl(mapLat, mapLng, 16, "600x200") }}
                  style={styles.mapImage}
                  resizeMode="cover"
                />
              )}
              <View style={styles.mapOverlay}>
                <Feather name="external-link" size={12} color="#fff" />
                <ThemedText type="caption" style={{ color: "#fff", fontWeight: "700", fontSize: 10 }}>Open Maps</ThemedText>
              </View>
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
  PENDING:    { color: "#F59E0B", label: "En Route" },
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
                    {distanceM >= 1000 ? `${(distanceM / 1000).toFixed(1)} km` : `${Math.round(distanceM)}m`} by road
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

      {/* Google Maps embed (web) */}
      {hasDestCoords && Platform.OS === "web" && (
        <Pressable
          onPress={openMap}
          style={[styles.mapContainer, { height: 180, marginTop: 10 }]}
        >
          {/* @ts-ignore */}
          <iframe
            title={meeting.id}
            src={`https://www.google.com/maps/embed/v1/place?key=${process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY}&q=${destLat},${destLng}&zoom=16`}
            style={{ width: "100%", height: "100%", border: "none", borderRadius: 10 }}
          />
        </Pressable>
      )}

      {/* Static map image (native) */}
      {hasDestCoords && Platform.OS !== "web" && (
        <Pressable onPress={openMap} style={[styles.mapContainer, { height: 150, marginTop: 10 }]}>
          <Image
            source={{ uri: googleStaticMapUrl(destLat, destLng, 16, "600x300") }}
            style={styles.mapImage}
            resizeMode="cover"
          />
          <View style={styles.mapOverlay}>
            <Feather name="map-pin" size={12} color="#fff" />
            <ThemedText type="caption" style={{ color: "#fff", fontWeight: "700", fontSize: 10 }}>Tap to open</ThemedText>
          </View>
        </Pressable>
      )}

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
  const { theme } = useTheme();
  const { user } = useAuth();

  const [employees, setEmployees] = useState<LiveEmployee[]>([]);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [meetings, setMeetings] = useState<any[]>([]);
  const [filter, setFilter] = useState<FilterStatus>("ALL");
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<"map" | "alerts" | "meetings">("map");
  const [selectedEmp, setSelectedEmp] = useState<LiveEmployee | null>(null);
  const [isEscalationMember, setIsEscalationMember] = useState(false);
  const [pingingUserId, setPingingUserId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [realtimeStatus, setRealtimeStatus] = useState<
    "CONNECTING" | "SUBSCRIBED" | "CHANNEL_ERROR" | "TIMED_OUT" | "CLOSED"
  >("CONNECTING");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
          .eq("visit_type", "meeting")
          .order("created_at", { ascending: true })
          .order("id")
          .range(from, to),
      ),
      supabase.from("offices").select("id, name, latitude, longitude").eq("is_active", true),
      fetchAllPages<any>((from, to) =>
        supabase.from("attendance_logs")
          .select("id, user_id, checkin_location, checkin_time, office_id")
          .eq("date", today)
          .eq("status", "CHECKED_IN")
          .order("user_id")
          .order("id")
          .range(from, to),
      ),
      supabase.from("location_tracking")
          .select("id, user_id, latitude, longitude, recorded_at")
          .gte("recorded_at", dayStart)
          .lte("recorded_at", dayEnd)
          .not("latitude", "is", null)
          .not("longitude", "is", null)
          .order("recorded_at", { ascending: false })
          .order("id")
          .limit(5000),
      CanonicalAttendanceService.listDay(today)
        .then((data) => ({ data, error: null }))
        .catch((error) => ({ data: null, error })),
    ]);
    const failed = [meetRes, officeRes, attRes, pingRes]
      .find((result) => result.error);
    if (failed?.error) throw failed.error;
    if (canonicalRes.error) throw canonicalRes.error;

    // Build office coords map
    const officeMap = new Map<string, { name: string; latitude: number; longitude: number }>();
    for (const o of (officeRes.data ?? []) as any[]) {
      if (o.latitude && o.longitude) officeMap.set(o.id, o);
    }

    // Build latest ping per user
    const pingMap = new Map<string, { latitude: number; longitude: number; recorded_at: string }>();
    for (const p of (pingRes.data ?? []) as any[]) {
      if (!pingMap.has(p.user_id)) {
        pingMap.set(p.user_id, { latitude: p.latitude, longitude: p.longitude, recorded_at: p.recorded_at });
      }
    }

    // Build attendance check-in map
    const attMap = new Map<string, any>();
    for (const a of (attRes.data ?? []) as any[]) {
      attMap.set(a.user_id, a);
    }

        const liveEmployeeRows: any[] = ((canonicalRes.data ?? []) as CanonicalAttendanceDay[])
      .filter((row) => row.official_first_in)
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
          latitude: ping?.latitude ?? null,
          longitude: ping?.longitude ?? null,
          distance_from_base: row.distance_from_office_m ?? null,
          status,
          gps_available: status !== "RED_GPS_OFF",
          recorded_at: ping?.recorded_at ?? (() => {
            const ts = row.official_first_in;
            if (!ts) return ts;
            const normalized = ts.trim().replace(' ', 'T');
            return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized)
              ? normalized
              : normalized + '+05:30';
          })(),
          attendance_checkin: row.official_first_in,
          attendance_checkout: row.official_last_out,
          checkin_time: row.official_first_in,
          checkout_time: row.official_last_out,
          last_visit_location: row.active_field_visit_name,
          last_visit_checkin: row.field_visit_first_in,
          last_visit_checkout: row.field_visit_checkout,
          geo_fence_radius: 500,
          has_location_data: Boolean(ping),
          has_gps_ping: Boolean(ping),
        };
      });

    if (liveEmployeeRows.length) {
      // Enrich employees: merge office coords for fallback + compute stale flag
      const enriched = liveEmployeeRows.map((raw: any) => {
        // Title Case all display names at the source (per UI audit, 12 Jun 2026)
        const e = { ...raw, name: toTitleCase(raw.name) };
        const hasGpsPing = !!(e.latitude && e.longitude && e.status !== "CHECKIN_ONLY");
        let officeLat = e.office_latitude ?? null;
        let officeLng = e.office_longitude ?? null;
        let officeName = e.office_name ?? null;
        if (!officeLat && e.office_id) {
          const o = officeMap.get(e.office_id);
          if (o) { officeLat = o.latitude; officeLng = o.longitude; officeName = o.name; }
        }

        const pingTimestamp = e.recorded_at
          ? (() => { try { return parseDatabaseTimestamp(e.recorded_at).getTime(); } catch { return null; } })()
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
          is_stale: isStale,
          stale_mins: Math.max(0, Math.floor(staleMins)),
          timestamp_invalid: timestampInvalid,
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
    
    // Enrich meetings with origin coordinates and ETA
    if (meetRes.data) {
      const enrichedMeetings = await Promise.all((meetRes.data as any[]).map(async (m: any) => {
        // Get origin coordinates (priority: last GPS ping > office check-in location)
        const ping = pingMap.get(m.user_id);
        const att = attMap.get(m.user_id);
        
        let originLat = null;
        let originLng = null;
        let originName = null;
        let lastPingTime = null;

        if (ping) {
          originLat = ping.latitude;
          originLng = ping.longitude;
          originName = "Current Location";
          lastPingTime = ping.recorded_at;
        } else if (att?.checkin_location?.latitude && att?.checkin_location?.longitude) {
          originLat = att.checkin_location.latitude;
          originLng = att.checkin_location.longitude;
          originName = "Check-in Location";
          lastPingTime = att.checkin_time;
        }

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

  useFocusEffect(
    useCallback(() => {
      loadData();

      // Fallback poll
      timerRef.current = setInterval(loadData, AUTO_REFRESH_MS);

      // Realtime: refresh dashboard when a new location ping arrives
      const channel = supabase
        .channel("live-tracking-updates")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "location_tracking" },
          () => loadData()
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
          () => loadData()
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
    
  const resolveWithAction = async (alertId: string, action: "APPROVED" | "REJECTED", eventId?: string) => {
    try {
      if (eventId) {
        // It's a geofence alert, use the credit score engine
        const { error } = await supabase.rpc("rpc_resolve_geofence_violation", {
          p_event_id: eventId,
          p_resolution: action,
          p_notes: "Resolved by admin from Live Tracking",
        });
        if (error) throw error;
      }
      // Also dismiss the alert card
      const { error: alertError } = await TrackingAdminService.resolveAlert(alertId);
      if (alertError) throw alertError;
      
      setAlerts((prev) => prev.filter((a) => a.id !== alertId));
    } catch (error: any) {
      Alert.alert(
        "Action Failed",
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

  const filtered = filter === "ALL"
    ? employees
    : filter === "STALE"
    ? employees.filter((e) => e.is_stale)
    : employees.filter((e) => e.status === filter);

  // ── Access guard ────────────────────────────────────────────────────────────
  const canView =
    user?.role === "SYSTEM_ADMIN" ||
    user?.role === "ADMIN" ||
    user?.role === "HR" ||
    user?.role === "HRD" ||
    isEscalationMember;

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
          <ThemedText type="caption" style={{ color: "#10B981", fontWeight: "700", fontSize: 10 }}>LIVE</ThemedText>
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
        {(["map", "meetings", "alerts"] as const).map((t) => (
          <Pressable
            key={t}
            style={[styles.tab, tab === t && { borderBottomColor: theme.primary, borderBottomWidth: 2 }]}
            onPress={() => setTab(t)}
          >
            <ThemedText
              type="caption"
              style={{ color: tab === t ? theme.primary : theme.textSecondary, fontWeight: "600" }}
            >
              {t === "map" ? `👥 Employees (${employees.length})` : t === "meetings" ? `🤝 Meetings (${meetings.length})` : `🚨 Alerts (${alerts.length})`}
            </ThemedText>
          </Pressable>
        ))}
      </View>

      {tab === "map" ? (
        <>
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
            ListEmptyComponent={
              <View style={styles.center}>
                <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                  No employees tracked today.
                </ThemedText>
              </View>
            }
            renderItem={({ item }) => (
              <EmployeeCard emp={item} onPress={() => setSelectedEmp(item)} onPing={() => requestPing(item.user_id, item.name)} pinging={pingingUserId === item.user_id} />
            )}
          />
        </>
      ) : tab === "meetings" ? (
        <FlatList
          data={meetings}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: Spacing.md, gap: Spacing.sm }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Feather name="users" size={32} color={theme.textSecondary} />
              <Spacer height={Spacing.sm} />
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                No meetings logged today.
              </ThemedText>
            </View>
          }
          renderItem={({ item }) => <MeetingCard meeting={item} theme={theme} />}
        />
      ) : (
        <FlatList
          data={alerts}
          keyExtractor={(a) => a.id}
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
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: isRealGps ? "#10B981" : "#F59E0B" }} />
              <ThemedText type="caption" style={{ color: isRealGps ? "#10B981" : "#F59E0B", fontWeight: "700" }}>
                {isRealGps ? `Live GPS · ${timeAgo(emp.recorded_at)}` : `Check-in location · ${emp.office_name ?? "Office"}`}
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
