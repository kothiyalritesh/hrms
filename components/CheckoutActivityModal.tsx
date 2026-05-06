import React, { useState } from "react";
import {
  Modal,
  View,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { useAuth } from "@/contexts/AuthContext";
import { ActivityService } from "@/services/activity.service";
import { Spacing, BorderRadius } from "@/constants/theme";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type LocationType = "office" | "site" | "meeting" | "others";

const LOCATION_OPTIONS: { value: LocationType; label: string; icon: string }[] = [
  { value: "office",  label: "Office",     icon: "🏢" },
  { value: "site",    label: "Site Visit", icon: "🏗️" },
  { value: "meeting", label: "Meeting",    icon: "🤝" },
  { value: "others",  label: "Others",     icon: "🚗" },
];

interface Props {
  visible: boolean;
  checkoutTime: string;
  gpsCoordinates?: { latitude: number; longitude: number };
  onDone: () => void;
}

export default function CheckoutActivityModal({ visible, checkoutTime, gpsCoordinates, onDone }: Props) {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [locationType, setLocationType] = useState<LocationType>("office");
  const [locationName, setLocationName] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setLocationType("office");
    setLocationName("");
    setNotes("");
  };

  const handleSubmit = async () => {
    if (!locationName.trim()) {
      Alert.alert("Required", "Please enter a location or company name.");
      return;
    }
    if (!notes.trim()) {
      Alert.alert("Required", "Please describe what you did today.");
      return;
    }

    setLoading(true);
    try {
      await ActivityService.createActivity({
        user_id: user!.id,
        locationType,
        locationName: locationName.trim(),
        notes: notes.trim(),
        gps_coordinates: gpsCoordinates || { latitude: 0, longitude: 0 },
        timestamp: checkoutTime,
      });
      reset();
      onDone();
    } catch (e: any) {
      Alert.alert("Error", e.message || "Failed to save activity log.");
    } finally {
      setLoading(false);
    }
  };

  const handleSkip = () => {
    Alert.alert(
      "Skip Activity Log?",
      "Your checkout is saved, but logging your activity helps track your work. Are you sure you want to skip?",
      [
        { text: "Log Activity", style: "cancel" },
        { text: "Skip", style: "destructive", onPress: () => { reset(); onDone(); } },
      ]
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent presentationStyle="overFullScreen">
      <View style={styles.overlay}>
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.handle} />
            <View style={styles.headerRow}>
              <View style={styles.checkoutBadge}>
                <Feather name="check-circle" size={16} color="#10B981" />
                <ThemedText style={styles.checkoutBadgeText}>
                  Checked out at {new Date(checkoutTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </ThemedText>
              </View>
            </View>
            <ThemedText style={styles.title}>Log Today's Activity</ThemedText>
            <ThemedText style={styles.subtitle}>What did you work on today? (Required to complete checkout)</ThemedText>
          </View>

          <ScrollView style={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {/* Activity Type */}
            <ThemedText style={styles.label}>Activity Type</ThemedText>
            <View style={styles.typeRow}>
              {LOCATION_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.typeChip, locationType === opt.value && styles.typeChipSelected]}
                  onPress={() => setLocationType(opt.value)}
                >
                  <ThemedText style={styles.typeChipIcon}>{opt.icon}</ThemedText>
                  <ThemedText style={[styles.typeChipLabel, locationType === opt.value && styles.typeChipLabelSelected]}>
                    {opt.label}
                  </ThemedText>
                </TouchableOpacity>
              ))}
            </View>

            {/* Location */}
            <ThemedText style={[styles.label, { marginTop: 16 }]}>Location / Company *</ThemedText>
            <TextInput
              style={styles.input}
              placeholder="e.g., Office, ABC Builders, Client Site"
              placeholderTextColor="#9CA3AF"
              value={locationName}
              onChangeText={setLocationName}
              maxLength={255}
            />

            {/* Notes */}
            <ThemedText style={[styles.label, { marginTop: 16 }]}>What did you do? *</ThemedText>
            <TextInput
              style={[styles.input, styles.notesInput]}
              placeholder="Describe your work, meetings, visits, outcomes..."
              placeholderTextColor="#9CA3AF"
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={4}
              maxLength={1000}
              textAlignVertical="top"
            />

            <View style={styles.actions}>
              <TouchableOpacity
                style={[styles.submitBtn, loading && { opacity: 0.7 }]}
                onPress={handleSubmit}
                disabled={loading}
              >
                {loading
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <ThemedText style={styles.submitBtnText}>Save & Done ✓</ThemedText>
                }
              </TouchableOpacity>
              <TouchableOpacity style={styles.skipBtn} onPress={handleSkip} disabled={loading}>
                <ThemedText style={styles.skipBtnText}>Skip</ThemedText>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "92%",
  },
  header: {
    padding: Spacing.xl,
    paddingBottom: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
    alignItems: "center",
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: "#E5E7EB", marginBottom: Spacing.md,
  },
  headerRow: { marginBottom: Spacing.sm },
  checkoutBadge: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#D1FAE5", paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: BorderRadius.full,
  },
  checkoutBadgeText: { fontSize: 13, color: "#065F46", fontWeight: "600" },
  title: { fontSize: 20, fontWeight: "800", color: "#111827", marginTop: 8, textAlign: "center" },
  subtitle: { fontSize: 13, color: "#6B7280", textAlign: "center", marginTop: 4, lineHeight: 18 },
  body: { paddingHorizontal: Spacing.xl },
  label: { fontSize: 14, fontWeight: "600", color: "#374151", marginBottom: 8 },
  typeRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  typeChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: BorderRadius.full, borderWidth: 1.5,
    borderColor: "#E5E7EB", backgroundColor: "#F9FAFB",
  },
  typeChipSelected: { borderColor: "#60045d", backgroundColor: "#F5EEF5" },
  typeChipIcon: { fontSize: 14 },
  typeChipLabel: { fontSize: 13, fontWeight: "500", color: "#6B7280" },
  typeChipLabelSelected: { color: "#60045d", fontWeight: "700" },
  input: {
    borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: BorderRadius.md,
    padding: 12, fontSize: 14, color: "#111827", backgroundColor: "#F9FAFB",
  },
  notesInput: { height: 100, textAlignVertical: "top" },
  actions: { marginTop: 24, gap: 10 },
  submitBtn: {
    backgroundColor: "#60045d", borderRadius: BorderRadius.md,
    paddingVertical: 14, alignItems: "center",
  },
  submitBtnText: { color: "#FFFFFF", fontWeight: "700", fontSize: 15 },
  skipBtn: { alignItems: "center", paddingVertical: 10 },
  skipBtnText: { color: "#9CA3AF", fontSize: 13 },
});
