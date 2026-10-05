import React, { useState, useEffect } from "react";
import {
  Modal, View, StyleSheet, TouchableOpacity, ScrollView,
  TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, Alert,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { ThemedText } from "@/components/ThemedText";
import { PredefinedSite, PredefinedSiteService } from "@/services/predefined-site.service";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import LocationSearchInput, { PlaceResult } from "@/components/LocationSearchInput";

export interface SitePickerResult {
  predefinedSite?: PredefinedSite;
  locationName: string;
  locationAddress?: string;
  destinationCoords?: { latitude: number; longitude: number };
  checkinRadiusM: number;
  projectName?: string;
  notes: string;
  googlePlaceId?: string;
  locationSource?: PlaceResult["locationSource"] | "PREDEFINED_SITE";
}

interface Props {
  visible: boolean;
  visitType: "site" | "meeting";
  visitTypeLabel?: string;  // override header label (e.g. for "Other")
  onConfirm: (result: SitePickerResult) => void;
  onCancel: () => void;
}

export default function SitePickerModal({ visible, visitType, visitTypeLabel, onConfirm, onCancel }: Props) {
  const insets = useSafeAreaInsets();
  const [sites, setSites] = useState<PredefinedSite[]>([]);
  const [loading, setLoading] = useState(false);
  const [savedOpen, setSavedOpen] = useState(false);

  // Manual entry fields
  const [manualName, setManualName] = useState("");
  const [manualAddress, setManualAddress] = useState("");
  const [manualProject, setManualProject] = useState("");
  const [manualNotes, setManualNotes] = useState("");
  const [manualCoords, setManualCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [manualPlaceId, setManualPlaceId] = useState<string | undefined>();
  const [manualLocationSource, setManualLocationSource] = useState<PlaceResult["locationSource"]>();
  const [selectedSavedSite, setSelectedSavedSite] = useState<PredefinedSite | null>(null);

  useEffect(() => {
    if (visible) {
      setSavedOpen(false);
      setManualName(""); setManualAddress(""); setManualProject(""); setManualNotes(""); setManualCoords(null);
      setManualPlaceId(undefined); setManualLocationSource(undefined); setSelectedSavedSite(null);
      setLoading(true);
      PredefinedSiteService.getAll()
        .then(setSites)
        .finally(() => setLoading(false));
    }
  }, [visible]);

  // Group sites by project_name
  const grouped = sites.reduce<Record<string, PredefinedSite[]>>((acc, s) => {
    if (!acc[s.project_name]) acc[s.project_name] = [];
    acc[s.project_name].push(s);
    return acc;
  }, {});

  const handleConfirmManual = () => {
    if (!manualName.trim()) {
      Alert.alert("Required", "Please enter a location name.");
      return;
    }
    if (!manualCoords) {
      Alert.alert(
        "Map Pin Required",
        "Please search for an address and confirm the location on the map.\n\nThis is needed so the app can verify you've actually arrived at this location when you check in.",
        [{ text: "OK" }]
      );
      return;
    }
    onConfirm({
      locationName: manualName.trim(),
      locationAddress: manualAddress.trim() || undefined,
      destinationCoords: manualCoords,
      checkinRadiusM: 300,  // wider radius for manually-searched locations (Google Places pin ≠ exact entrance)
      projectName: manualProject.trim() || undefined,
      notes: manualNotes.trim(),
      googlePlaceId: manualPlaceId,
      locationSource: manualLocationSource ?? "MAP_PIN",
    });
  };

  const handleConfirmSaved = (site: PredefinedSite) => {
    onConfirm({
      predefinedSite: site,
      locationName: site.site_label,
      locationAddress: site.address,
      destinationCoords: { latitude: site.latitude, longitude: site.longitude },
      checkinRadiusM: site.checkin_radius_m,
      projectName: site.project_name,
      notes: "",
      locationSource: "PREDEFINED_SITE",
    });
  };

  const typeIcon = visitType === "site" ? "🏗️" : "🤝";
  const typeLabel = visitTypeLabel ?? (visitType === "site" ? "Site Visit" : "Meeting Location");

  return (
    <Modal visible={visible} animationType="slide" transparent presentationStyle="overFullScreen">
      <KeyboardAvoidingView style={st.overlay} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={[st.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>

          {/* Header */}
          <View style={st.header}>
            <View style={st.handle} />
            <View style={st.headerRow}>
              <View style={{ width: 60 }} />
              <ThemedText style={st.title}>{typeIcon} {typeLabel}</ThemedText>
              <TouchableOpacity onPress={onCancel} style={st.closeBtn}>
                <Feather name="x" size={20} color="#6B7280" />
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView style={st.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

            {/* ── Manual Entry (shown first) ── */}
            <View style={{ paddingTop: 16 }}>
              <ThemedText style={st.sectionHint}>
                Enter the location manually — or pick from Saved Sites below.
              </ThemedText>

              <LocationSearchInput
                label="Location Name / Address"
                value={manualName}
                placeholder="Search place, area or address..."
                required
                onSelect={(place: PlaceResult) => {
                  setManualName(place.displayName.split(",")[0].trim());
                  setManualAddress(place.displayName);
                  setManualCoords({ latitude: place.latitude, longitude: place.longitude });
                  setManualPlaceId(place.placeId);
                  setManualLocationSource(place.locationSource);
                }}
                onChange={(text) => {
                  setManualName(text);
                  if (!text) { setManualCoords(null); setManualAddress(""); }
                }}
              />

              {manualCoords ? (
                <View style={st.destinationCard}>
                  <ThemedText style={st.destinationTitle}>Destination selected</ThemedText>
                  <ThemedText style={st.destinationText}>Address: {manualAddress || manualName}</ThemedText>
                  <ThemedText style={st.destinationText}>
                    Coordinates: {manualCoords.latitude.toFixed(6)}, {manualCoords.longitude.toFixed(6)}
                  </ThemedText>
                  <ThemedText style={st.destinationText}>Arrival radius: 300 metres</ThemedText>
                </View>
              ) : null}

              <View style={st.fieldWrap}>
                <ThemedText style={st.fieldLabel}>Project Name</ThemedText>
                <TextInput
                  style={st.fieldInput}
                  value={manualProject}
                  onChangeText={setManualProject}
                  placeholder="Which project is this for?"
                  placeholderTextColor="#9CA3AF"
                  maxLength={255}
                />
              </View>

              <View style={st.fieldWrap}>
                <ThemedText style={st.fieldLabel}>Notes</ThemedText>
                <TextInput
                  style={[st.fieldInput, { height: 80, textAlignVertical: "top" }]}
                  value={manualNotes}
                  onChangeText={setManualNotes}
                  placeholder="Purpose, what to discuss..."
                  placeholderTextColor="#9CA3AF"
                  multiline
                  maxLength={500}
                />
              </View>

              <TouchableOpacity
                style={[st.confirmBtn, !manualName.trim() && { opacity: 0.45 }]}
                onPress={handleConfirmManual}
                disabled={!manualName.trim()}
              >
                <Feather name="navigation" size={16} color="#fff" />
                <ThemedText style={st.confirmBtnText}>Confirm Destination</ThemedText>
              </TouchableOpacity>
            </View>

            {/* ── Saved Sites collapsible bar ── */}
            <TouchableOpacity
              style={[st.savedBar, savedOpen && st.savedBarOpen]}
              onPress={() => setSavedOpen((v) => !v)}
              activeOpacity={0.8}
            >
              <View style={st.savedBarLeft}>
                <Feather name="bookmark" size={15} color={savedOpen ? "#fff" : "#60045d"} />
                <ThemedText style={[st.savedBarText, savedOpen && { color: "#fff" }]}>
                  Saved Sites
                </ThemedText>
                {sites.length > 0 && (
                  <View style={[st.savedCount, savedOpen && { backgroundColor: "rgba(255,255,255,0.25)" }]}>
                    <ThemedText style={[st.savedCountText, savedOpen && { color: "#fff" }]}>
                      {sites.length}
                    </ThemedText>
                  </View>
                )}
              </View>
              <Feather
                name={savedOpen ? "chevron-up" : "chevron-down"}
                size={16}
                color={savedOpen ? "#fff" : "#60045d"}
              />
            </TouchableOpacity>

            {savedOpen && (
              <View style={st.savedContent}>
                {loading ? (
                  <ActivityIndicator color="#60045d" style={{ marginVertical: 20 }} />
                ) : sites.length === 0 ? (
                  <ThemedText style={{ color: "#9CA3AF", fontSize: 13, textAlign: "center", marginVertical: 16 }}>
                    No saved sites configured
                  </ThemedText>
                ) : (
                  Object.entries(grouped).map(([project, projectSites]) => (
                    <View key={project} style={st.projectGroup}>
                      <ThemedText style={st.projectLabel}>{project}</ThemedText>
                      {projectSites.map((site) => (
                        <TouchableOpacity
                          key={site.id}
                          style={st.siteRow}
                          onPress={() => { setSelectedSavedSite(site); setSavedOpen(false); }}
                          activeOpacity={0.75}
                        >
                          <View style={st.siteIcon}>
                            <ThemedText style={{ fontSize: 16 }}>
                              {site.site_type === "office" ? "🏢" : "📍"}
                            </ThemedText>
                          </View>
                          <View style={{ flex: 1 }}>
                            <ThemedText style={st.siteName}>{site.site_label}</ThemedText>
                            {site.address ? (
                              <ThemedText style={st.siteAddr} numberOfLines={1}>{site.address}</ThemedText>
                            ) : null}
                          </View>
                          <Feather name="chevron-right" size={16} color="#9CA3AF" />
                        </TouchableOpacity>
                      ))}
                    </View>
                  ))
                )}
              </View>
            )}

            {selectedSavedSite ? (
              <View style={st.destinationCard}>
                <ThemedText style={st.destinationTitle}>Destination selected</ThemedText>
                <ThemedText style={st.destinationText}>Address: {selectedSavedSite.address || selectedSavedSite.site_label}</ThemedText>
                <ThemedText style={st.destinationText}>
                  Coordinates: {selectedSavedSite.latitude.toFixed(6)}, {selectedSavedSite.longitude.toFixed(6)}
                </ThemedText>
                <ThemedText style={st.destinationText}>Arrival radius: {selectedSavedSite.checkin_radius_m} metres</ThemedText>
                <TouchableOpacity style={[st.confirmBtn, { marginBottom: 0 }]} onPress={() => handleConfirmSaved(selectedSavedSite)}>
                  <Feather name="navigation" size={16} color="#fff" />
                  <ThemedText style={st.confirmBtnText}>Confirm Destination</ThemedText>
                </TouchableOpacity>
              </View>
            ) : null}

            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const st = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#FFFFFF", borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "92%" },
  header: { padding: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#E5E7EB", alignSelf: "center", marginBottom: 14 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { flex: 1, fontSize: 17, fontWeight: "800", color: "#111827", textAlign: "center" },
  closeBtn: { padding: 4, width: 60, alignItems: "flex-end" },
  body: { paddingHorizontal: 20 },
  sectionHint: { fontSize: 13, color: "#6B7280", marginBottom: 14, lineHeight: 19 },
  destinationCard: { marginBottom: 14, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: "#A7F3D0", backgroundColor: "#ECFDF5" },
  destinationTitle: { fontSize: 14, fontWeight: "800", color: "#047857", marginBottom: 5 },
  destinationText: { fontSize: 12, color: "#065F46", marginTop: 2 },

  // Manual form
  fieldWrap: { marginBottom: 14 },
  fieldLabel: { fontSize: 13, fontWeight: "600", color: "#374151", marginBottom: 6 },
  fieldInput: {
    borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 8,
    padding: 11, fontSize: 14, color: "#111827", backgroundColor: "#F9FAFB",
  },

  // Confirm button
  confirmBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: "#60045d", borderRadius: 10, paddingVertical: 14, marginTop: 4, marginBottom: 20,
  },
  confirmBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },

  // Saved Sites bar
  savedBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 13, paddingHorizontal: 16,
    borderWidth: 1.5, borderColor: "#60045d", borderRadius: 12,
    backgroundColor: "#F5EEF5", marginBottom: 4,
  },
  savedBarOpen: { backgroundColor: "#60045d", borderColor: "#60045d" },
  savedBarLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  savedBarText: { fontSize: 14, fontWeight: "700", color: "#60045d" },
  savedCount: {
    backgroundColor: "#60045d", borderRadius: 10,
    paddingHorizontal: 7, paddingVertical: 1,
  },
  savedCountText: { fontSize: 11, fontWeight: "700", color: "#fff" },

  // Saved sites content
  savedContent: {
    borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 12,
    paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4,
    marginBottom: 8, backgroundColor: "#FAFAFA",
  },
  projectGroup: { marginBottom: 12 },
  projectLabel: {
    fontSize: 11, fontWeight: "800", color: "#60045d",
    textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6,
  },
  siteRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    padding: 11, borderRadius: 10,
    borderWidth: 1, borderColor: "#E5E7EB", backgroundColor: "#fff",
    marginBottom: 6,
  },
  siteIcon: {
    width: 36, height: 36, borderRadius: 8,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "#F3F4F6",
  },
  siteName: { fontSize: 13, fontWeight: "700", color: "#111827" },
  siteAddr: { fontSize: 11, color: "#6B7280", marginTop: 1 },
});
