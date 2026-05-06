import React from "react";
import {
  Modal, View, StyleSheet, TouchableOpacity, ScrollView,
  Platform, Linking,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { FieldVisit } from "@/services/field-visit.service";
import { useSafeAreaInsets } from "react-native-safe-area-context";

function fmt(iso?: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true });
}

const STATUS_CONFIG = {
  PENDING:    { color: "#F59E0B", bg: "#FEF3C7", label: "En Route",    icon: "navigation" as const },
  CHECKED_IN: { color: "#3B82F6", bg: "#DBEAFE", label: "At Location", icon: "map-pin" as const },
  COMPLETED:  { color: "#10B981", bg: "#D1FAE5", label: "Completed",   icon: "check-circle" as const },
  MISSED:     { color: "#EF4444", bg: "#FEE2E2", label: "Missed",      icon: "x-circle" as const },
};

interface Props {
  visit: FieldVisit | null;
  onClose: () => void;
}

export default function VisitDetailModal({ visit, onClose }: Props) {
  const insets = useSafeAreaInsets();
  if (!visit) return null;

  const cfg = STATUS_CONFIG[visit.status];
  const lat = visit.checkin_location?.latitude ?? visit.destination_coords?.latitude;
  const lng = visit.checkin_location?.longitude ?? visit.destination_coords?.longitude;
  const hasCoords = lat != null && lng != null;
  const isCheckinCoords = !!(visit.checkin_location?.latitude);
  const locationAddress = (visit as any).location_address as string | undefined;

  const openInMaps = () => {
    if (!hasCoords) return;
    const url = Platform.OS === "ios"
      ? `maps://?q=${visit.location_name}&ll=${lat},${lng}`
      : `geo:${lat},${lng}?q=${lat},${lng}(${encodeURIComponent(visit.location_name)})`;
    Linking.openURL(url).catch(() =>
      Linking.openURL(`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}&zoom=16`)
    );
  };

  const typeLabel = visit.visit_type === "site" ? "🏗️ Site Visit" : "🤝 Meeting";
  const meetingLabel =
    visit.meeting_type === "client" ? "👤 Client" :
    visit.meeting_type === "channel_partner" ? "🏘️ Channel Partner" : "";

  return (
    <Modal visible={!!visit} animationType="slide" transparent presentationStyle="overFullScreen">
      <View style={s.overlay}>
        <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          {/* Header */}
          <View style={s.header}>
            <View style={s.handle} />
            <View style={s.headerRow}>
              <ThemedText style={s.title} numberOfLines={1}>{visit.location_name}</ThemedText>
              <TouchableOpacity onPress={onClose} style={s.closeBtn}>
                <Feather name="x" size={20} color="#6B7280" />
              </TouchableOpacity>
            </View>
            <View style={[s.statusBadge, { backgroundColor: cfg.bg, alignSelf: "flex-start", marginTop: 6 }]}>
              <Feather name={cfg.icon} size={11} color={cfg.color} />
              <ThemedText style={[s.statusText, { color: cfg.color }]}>{cfg.label}</ThemedText>
            </View>
          </View>

          <ScrollView style={s.body} showsVerticalScrollIndicator={false}>
            {/* Map — shows check-in GPS location */}
            {hasCoords && (
              <View style={s.mapContainer}>
                <ThemedText style={s.mapLabel}>
                  {isCheckinCoords ? "📍 Check-in Location" : "📍 Destination"}
                </ThemedText>
                {Platform.OS === "web" ? (
                  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                  // @ts-ignore — iframe is valid on web
                  <iframe
                    title="map"
                    src={`https://www.openstreetmap.org/export/embed.html?bbox=${lng! - 0.005},${lat! - 0.005},${lng! + 0.005},${lat! + 0.005}&layer=mapnik&marker=${lat},${lng}`}
                    style={{ width: "100%", height: 200, border: "none", borderRadius: 12 }}
                  />
                ) : (
                  <TouchableOpacity style={s.mapPlaceholder} onPress={openInMaps} activeOpacity={0.8}>
                    <Feather name="map" size={32} color="#60045d" />
                    <ThemedText style={s.mapPlaceholderText}>📍 {lat?.toFixed(5)}, {lng?.toFixed(5)}</ThemedText>
                    <ThemedText style={s.mapOpenText}>Tap to open in Maps</ThemedText>
                  </TouchableOpacity>
                )}
                {Platform.OS === "web" && (
                  <TouchableOpacity style={s.openMapsBtn} onPress={() =>
                    Linking.openURL(`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}&zoom=16`)
                  }>
                    <Feather name="external-link" size={13} color="#60045d" />
                    <ThemedText style={s.openMapsBtnText}>Open in Maps</ThemedText>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* Details */}
            <View style={s.section}>
              <Row icon="tag" label="Type" value={`${typeLabel}${meetingLabel ? " · " + meetingLabel : ""}`} />
              {locationAddress ? <Row icon="map-pin" label="Address" value={locationAddress} /> : null}
              {visit.contact_name ? <Row icon="user" label="Contact" value={`${visit.contact_name}${visit.contact_phone ? " · " + visit.contact_phone : ""}`} /> : null}
              {visit.project_name ? <Row icon="home" label="Project" value={visit.project_name} /> : null}
              {visit.company_name ? <Row icon="briefcase" label="Company" value={visit.company_name} /> : null}
              {visit.checkin_time ? <Row icon="log-in" label="Arrived" value={fmt(visit.checkin_time)} color="#10B981" /> : null}
              {visit.checkout_time ? <Row icon="log-out" label="Left" value={fmt(visit.checkout_time)} color="#EF4444" /> : null}
              {hasCoords ? <Row icon="crosshair" label="GPS" value={`${lat?.toFixed(5)}, ${lng?.toFixed(5)}`} color={isCheckinCoords ? "#10B981" : "#6B7280"} /> : null}
            </View>

            {(visit as any).checkout_notes ? (
              <View style={s.notesBox}>
                <ThemedText style={s.notesLabel}>📝 Meeting Notes</ThemedText>
                <ThemedText style={s.notesText}>{(visit as any).checkout_notes}</ThemedText>
              </View>
            ) : null}

            <View style={{ height: 20 }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function Row({ icon, label, value, color }: { icon: any; label: string; value: string; color?: string }) {
  return (
    <View style={s.row}>
      <Feather name={icon} size={14} color={color || "#6B7280"} style={{ marginTop: 1 }} />
      <ThemedText style={s.rowLabel}>{label}</ThemedText>
      <ThemedText style={[s.rowValue, color ? { color } : {}]} numberOfLines={2}>{value}</ThemedText>
    </View>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "90%" },
  header: { padding: 20, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#E5E7EB", alignSelf: "center", marginBottom: 14 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { flex: 1, fontSize: 17, fontWeight: "800", color: "#111827", marginRight: 8 },
  closeBtn: { padding: 4 },
  statusBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  statusText: { fontSize: 12, fontWeight: "700" },
  body: { paddingHorizontal: 20 },
  mapContainer: { marginTop: 16, marginBottom: 4 },
  mapLabel: { fontSize: 12, fontWeight: "700", color: "#6B7280", marginBottom: 6 },
  mapPlaceholder: {
    height: 160, backgroundColor: "#F0F9FF", borderRadius: 12,
    borderWidth: 1.5, borderColor: "#BFDBFE",
    alignItems: "center", justifyContent: "center", gap: 8,
  },
  mapPlaceholderText: { fontSize: 13, color: "#1E40AF", fontWeight: "600" },
  mapOpenText: { fontSize: 12, color: "#3B82F6" },
  openMapsBtn: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 8, alignSelf: "flex-end" },
  openMapsBtnText: { fontSize: 12, color: "#60045d", fontWeight: "600" },
  section: { marginTop: 16, gap: 2 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  rowLabel: { fontSize: 13, color: "#6B7280", width: 70 },
  rowValue: { flex: 1, fontSize: 13, fontWeight: "600", color: "#111827" },
  notesBox: { backgroundColor: "#F0F9FF", borderRadius: 10, padding: 12, marginTop: 14, borderLeftWidth: 3, borderLeftColor: "#3B82F6" },
  notesLabel: { fontSize: 12, fontWeight: "700", color: "#1E40AF", marginBottom: 6 },
  notesText: { fontSize: 13, color: "#1E3A8A", lineHeight: 19 },
});
