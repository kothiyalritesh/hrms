import React, { useEffect, useRef } from "react";
import { View, StyleSheet, ScrollView, TouchableOpacity, Modal, Platform } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { FieldVisit } from "@/services/field-visit.service";
import LocationComparisonMap from "@/components/LocationComparisonMap";
import { loadGoogleMaps } from "@/utils/googleMapsLoader";
import {
  advancedMapOptions,
  loadAdvancedMarkerLibrary,
} from "@/utils/googleAdvancedMarkers";

function fmtTime(iso?: string | null) {
  if (!iso) return "—";
  const utc = iso.endsWith("Z") || iso.includes("+") ? iso : iso + "Z";
  return new Date(utc).toLocaleTimeString("en-IN", {
    hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata",
  });
}

function fmtDate(s: string) {
  return new Date(s + "T00:00:00").toLocaleDateString("en-IN", {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
  });
}

const STATUS_COLOR: Record<string, { bg: string; text: string; label: string }> = {
  PENDING:    { bg: "#FEF3C7", text: "#D97706",  label: "En Route" },
  CHECKED_IN: { bg: "#DBEAFE", text: "#2563EB",  label: "At Location" },
  COMPLETED:  { bg: "#D1FAE5", text: "#059669",  label: "Completed" },
  MISSED:     { bg: "#FEE2E2", text: "#DC2626",  label: "Missed" },
};

// Same pills on dark surfaces: lighter text on a translucent tint.
const STATUS_COLOR_DARK: Record<string, { bg: string; text: string }> = {
  PENDING:    { bg: "#FBBF2426", text: "#FBBF24" },
  CHECKED_IN: { bg: "#7DB3FF26", text: "#7DB3FF" },
  COMPLETED:  { bg: "#34D39926", text: "#34D399" },
  MISSED:     { bg: "#F8717126", text: "#F87171" },
};

// Row value colours that need a lighter tone in dark mode.
const DARK_ROW_TONE: Record<string, string> = {
  "#059669": "#34D399",
  "#DC2626": "#F87171",
};

function Row({ icon, label, value, color }: { icon: any; label: string; value: string; color?: string }) {
  const { theme, isDark } = useTheme();
  const tone = color && isDark ? DARK_ROW_TONE[color] ?? color : color;
  return (
    <View style={[s.row, isDark && { borderBottomColor: theme.borderLight }]}>
      <Feather name={icon} size={13} color={tone || (isDark ? theme.textSecondary : "#9CA3AF")} style={{ marginTop: 1 }} />
      <ThemedText style={[s.rowLabel, isDark && { color: theme.textSecondary }]}>{label}</ThemedText>
      <ThemedText style={[s.rowValue, isDark && { color: theme.text }, tone ? { color: tone } : {}]} numberOfLines={4}>{value}</ThemedText>
    </View>
  );
}

function RouteMap({ originLat, originLng, destLat, destLng, checkinLat, checkinLng }: {
  originLat?: number; originLng?: number;
  destLat: number; destLng: number;
  checkinLat?: number; checkinLng?: number;
}) {
  const mapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mapRef.current) return;
    void loadGoogleMaps().then(async () => {
      if (!mapRef.current) return;
      const google = (window as any).google;

      const map = new google.maps.Map(mapRef.current, advancedMapOptions({
        center: { lat: destLat, lng: destLng },
        zoom: 13,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        gestureHandling: "greedy",
      }));
      const { AdvancedMarkerElement, PinElement } =
        await loadAdvancedMarkerLibrary(google);
      const addMarker = (position: { lat: number; lng: number }, title: string, glyph?: string, color?: string) => {
        const pin = new PinElement({
          glyph,
          background: color || "#60045d",
          borderColor: "#ffffff",
          glyphColor: "#ffffff",
        });
        return new AdvancedMarkerElement({ map, position, title, content: pin.element });
      };

      // If we have both origin and destination, show directions route
      if (originLat && originLng) {
        addMarker({ lat: originLat, lng: originLng }, "Starting Point", "A");
        addMarker({ lat: destLat, lng: destLng }, "Destination", "B");
        const directionsService = new google.maps.DirectionsService();
        const directionsRenderer = new google.maps.DirectionsRenderer({
          map,
          suppressMarkers: true,
          polylineOptions: { strokeColor: "#60045d", strokeWeight: 4 },
        });
        directionsService.route({
          origin: { lat: originLat, lng: originLng },
          destination: { lat: destLat, lng: destLng },
          travelMode: google.maps.TravelMode.DRIVING,
        }, (result: any, status: any) => {
          if (status === "OK") {
            directionsRenderer.setDirections(result);
          } else {
            // Fallback to polyline if directions fail
            new google.maps.Polyline({
              map,
              path: [{ lat: originLat, lng: originLng }, { lat: destLat, lng: destLng }],
              strokeColor: "#60045d", strokeWeight: 3, strokeOpacity: 0.7,
            });
            const bounds = new google.maps.LatLngBounds();
            bounds.extend({ lat: originLat, lng: originLng });
            bounds.extend({ lat: destLat, lng: destLng });
            map.fitBounds(bounds);
          }
        });
      } else {
        // Just show destination pin
        addMarker({ lat: destLat, lng: destLng }, "Destination", "B");
      }

      // Also show actual checkin location if different
      if (checkinLat && checkinLng) {
        addMarker(
          { lat: checkinLat, lng: checkinLng },
          "Actual Check-in Location",
          "✓",
          "#10B981",
        );
      }
    }).catch(() => undefined);
  }, [originLat, originLng, destLat, destLng, checkinLat, checkinLng]);

  // @ts-ignore
  return <div ref={mapRef} style={{ width: "100%", height: 260, borderRadius: 12, overflow: "hidden" }} />;
}

interface Props {
  visit: FieldVisit | null;
  onClose: () => void;
}

export default function VisitDetailModal({ visit, onClose }: Props) {
  const { theme, isDark } = useTheme();
  if (!visit) return null;
  const scLight = STATUS_COLOR[visit.status] || STATUS_COLOR.PENDING;
  const sc = isDark
    ? { ...scLight, ...(STATUS_COLOR_DARK[visit.status] || STATUS_COLOR_DARK.PENDING) }
    : scLight;
  const divider = isDark ? theme.border : "#F3F4F6";
  const muted = isDark ? theme.textSecondary : "#6B7280";
  const typeBadge = visit.visit_type === "site"
    ? (isDark ? { bg: "#34D39926", text: "#6EE4C0" } : { bg: "#D1FAE5", text: "#065F46" })
    : (isDark ? { bg: "#7DB3FF26", text: "#A8C8FC" } : { bg: "#EFF6FF", text: "#1E40AF" });

  const typeLabel = visit.visit_type === "site" ? "🏗️ Site"
    : visit.visit_type === "office" ? "🏢 Office"
    : visit.visit_type === "others" ? "📌 Other"
    : "🤝 Meeting";

  const meetingLabel = visit.meeting_type === "client" ? " · 👤 Client"
    : visit.meeting_type === "channel_partner" ? " · 🏘️ Channel Partner"
    : "";

  const destLat = visit.destination_coords?.latitude;
  const destLng = visit.destination_coords?.longitude;
  const originLat = (visit as any).origin_lat;
  const originLng = (visit as any).origin_lon;
  const originName = (visit as any).origin_name;
  const checkinLat = visit.checkin_location?.latitude;
  const checkinLng = visit.checkin_location?.longitude;
  const isMarkedLocation = !!visit.location_match_status && visit.location_match_status !== "MATCHED";
  const displayLocationName = isMarkedLocation
    ? visit.actual_location_name || visit.location_name
    : visit.location_name;

  const hasMap = destLat != null && destLng != null;

  return (
    <Modal visible animationType="slide" transparent presentationStyle="overFullScreen" onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={[s.sheet, { backgroundColor: theme.backgroundDefault }]}>
          <View style={[s.header, { borderBottomColor: divider }]}>
            <View style={[s.handle, isDark && { backgroundColor: theme.border }]} />
            <View style={s.headerRow}>
              <ThemedText style={[s.title, { color: isDark ? theme.text : "#111" }]} numberOfLines={1}>{displayLocationName}</ThemedText>
              <TouchableOpacity onPress={onClose} style={{ padding: 4 }}>
                <Feather name="x" size={20} color={muted} />
              </TouchableOpacity>
            </View>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
              <View style={[s.badge, { backgroundColor: sc.bg }]}>
                <ThemedText style={[s.badgeTxt, { color: sc.text }]}>{sc.label}</ThemedText>
              </View>
              <View style={[s.badge, { backgroundColor: typeBadge.bg }]}>
                <ThemedText style={[s.badgeTxt, { color: typeBadge.text }]}>
                  {typeLabel}{meetingLabel}
                </ThemedText>
              </View>
            </View>
          </View>

          <ScrollView style={s.body} showsVerticalScrollIndicator={false}>

            {isMarkedLocation ? (
              <View style={[s.markedBox, isDark && { backgroundColor: theme.warningBg }]}>
                <ThemedText style={[s.markedTitle, isDark && { color: theme.warningText }]}>Checked in at current location · Evidence {visit.verification_status?.replace("_", " ")}</ThemedText>
                <Row icon="map-pin" label="Marked at" value={visit.actual_location_name || visit.location_name} />
                <Row icon="navigation" label="Distance" value={`${Math.round(visit.selected_site_distance_metres || 0)} metres from selected site`} />
                <Row icon="crosshair" label="Accuracy" value={`±${Math.round(visit.actual_location_accuracy_metres || 0)} metres`} />
                <Row icon="file-text" label="Reason" value={visit.location_mismatch_reason || "—"} />
                <Row icon="briefcase" label="Purpose" value={visit.visit_purpose || "—"} />
                <Row icon="camera" label="Photo" value={visit.evidence_photo_added ? "Added" : "No photo evidence provided"} />
                {visit.reviewer_notes ? <Row icon="message-square" label="Reviewer" value={visit.reviewer_notes} /> : null}
              </View>
            ) : null}

            {visit.actual_latitude != null && visit.actual_longitude != null && visit.selected_site_latitude != null && visit.selected_site_longitude != null ? (
              <View style={{ marginTop: 16 }}>
                <LocationComparisonMap
                  selected={{ latitude: visit.selected_site_latitude, longitude: visit.selected_site_longitude, name: "Selected site" }}
                  actual={{ latitude: visit.actual_latitude, longitude: visit.actual_longitude, name: visit.actual_location_name || "Marked location" }}
                  radiusMetres={visit.selected_site_radius_metres || 100}
                />
              </View>
            ) : null}

            {/* Embedded Route Map */}
            {hasMap && Platform.OS === "web" && (
              <View style={{ marginTop: 16 }}>
                <ThemedText style={[s.sectionTitle, { color: muted }]}>
                  {originLat ? "🗺️ Route: Starting Point → Destination" : "📍 Destination"}
                </ThemedText>
                {/* @ts-ignore */}
                <RouteMap
                  originLat={originLat} originLng={originLng}
                  destLat={destLat!} destLng={destLng!}
                  checkinLat={checkinLat} checkinLng={checkinLng}
                />
                {originName ? (
                  <ThemedText style={{ fontSize: 11, color: muted, marginTop: 6 }}>
                    🟢 Started from: {originName} &nbsp;|&nbsp; 🔴 Destination: {visit.location_name}
                    {checkinLat ? "  |  🟩 Actual check-in" : ""}
                  </ThemedText>
                ) : null}
              </View>
            )}

            {/* Visit details */}
            <View style={[s.section, { borderBottomColor: divider }]}>
              {(isMarkedLocation ? visit.actual_location_address || visit.location_address : visit.location_address) ? <Row icon="navigation" label="Address" value={(isMarkedLocation ? visit.actual_location_address || visit.location_address : visit.location_address)!} /> : null}
              {visit.contact_name ? <Row icon="phone" label="Contact" value={`${visit.contact_name}${visit.contact_phone ? " · " + visit.contact_phone : ""}`} /> : null}
              {visit.company_name ? <Row icon="briefcase" label="Company" value={visit.company_name} /> : null}
              {visit.project_name ? <Row icon="home" label="Project" value={visit.project_name} /> : null}
              {visit.notes ? <Row icon="file-text" label="Notes" value={visit.notes} /> : null}
            </View>

            {/* Times */}
            <View style={[s.section, { borderBottomColor: divider }]}>
              <Row icon="calendar" label="Date" value={fmtDate(visit.date)} />
              <Row icon="log-in" label="Check In" value={fmtTime(visit.checkin_time)} color="#059669" />
              <Row icon="log-out" label="Check Out" value={fmtTime(visit.checkout_time)} color="#DC2626" />
            </View>

            {/* Checkout notes */}
            {visit.checkout_notes ? (
              <View style={[s.notesBox, isDark && { backgroundColor: theme.infoBg, borderLeftColor: theme.info }]}>
                <ThemedText style={[s.notesLabel, isDark && { color: theme.infoText }]}>📝 Meeting Notes</ThemedText>
                <ThemedText style={[s.notesText, isDark && { color: theme.infoText }]}>{visit.checkout_notes}</ThemedText>
              </View>
            ) : null}

            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay:      { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet:        { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "92%" },
  header:       { padding: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  handle:       { width: 40, height: 4, borderRadius: 2, backgroundColor: "#E5E7EB", alignSelf: "center", marginBottom: 14 },
  headerRow:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title:        { flex: 1, fontSize: 17, fontWeight: "800", color: "#111", marginRight: 8 },
  badge:        { alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  badgeTxt:     { fontSize: 12, fontWeight: "700" },
  body:         { paddingHorizontal: 20 },
  section:      { marginTop: 16, borderBottomWidth: 1, borderBottomColor: "#F3F4F6", paddingBottom: 12 },
  sectionTitle: { fontSize: 12, fontWeight: "700", color: "#6B7280", marginBottom: 8 },
  row:          { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: "#F9FAFB" },
  rowLabel:     { fontSize: 12, color: "#9CA3AF", width: 72 },
  rowValue:     { flex: 1, fontSize: 13, fontWeight: "600", color: "#111" },
  notesBox:     { backgroundColor: "#F0F9FF", borderRadius: 10, padding: 12, marginTop: 14, borderLeftWidth: 3, borderLeftColor: "#3B82F6" },
  notesLabel:   { fontSize: 12, fontWeight: "700", color: "#1E40AF", marginBottom: 6 },
  notesText:    { fontSize: 13, color: "#1E3A8A", lineHeight: 19 },
  markedBox:    { marginTop: 16, borderRadius: 12, padding: 12, backgroundColor: "#FFF7ED", borderLeftWidth: 4, borderLeftColor: "#F97316" },
  markedTitle:  { color: "#9A3412", fontSize: 14, fontWeight: "800", marginBottom: 6 },
});
