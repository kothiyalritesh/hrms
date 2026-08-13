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
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { ThemedText } from "@/components/ThemedText";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export type NextStopType = "site" | "meeting" | "others" | "home";

export interface NextStopDetails {
  type: NextStopType;
  locationName: string;
  notes: string;
  contactName?: string;
  contactPhone?: string;
  projectName?: string;
}

interface Props {
  visible: boolean;
  onSubmit: (details: NextStopDetails) => void;
  onCancel: () => void;
}

const STOP_OPTIONS: { type: NextStopType; icon: string; label: string; sub: string; color: string; bg: string }[] = [
  { type: "site",    icon: "🏗️", label: "Site Visit",  sub: "Visiting a project or property site", color: "#10B981", bg: "#F0FDF4" },
  { type: "meeting", icon: "🤝", label: "Meeting",     sub: "Client or channel partner meeting",   color: "#3B82F6", bg: "#EFF6FF" },
  { type: "others",  icon: "🚗", label: "Other",       sub: "Travel, training or other activity",  color: "#F59E0B", bg: "#FFFBEB" },
  { type: "home",    icon: "🏠", label: "Going Home",  sub: "Done for the day — complete attendance", color: "#10B981", bg: "#F0FDF4" },
];

export default function NextStopModal({ visible, onSubmit, onCancel }: Props) {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<"pick" | "form">("pick");
  const [selectedType, setSelectedType] = useState<NextStopType | null>(null);
  const [locationName, setLocationName] = useState("");
  const [notes, setNotes] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [projectName, setProjectName] = useState("");
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setStep("pick");
    setSelectedType(null);
    setLocationName("");
    setNotes("");
    setContactName("");
    setContactPhone("");
    setProjectName("");
  };

  const handleCancel = () => { reset(); onCancel(); };

  const handlePickType = (type: NextStopType) => {
    if (type === "home") {
      onSubmit({ type: "home", locationName: "Home", notes: "" });
      reset();
      return;
    }
    setSelectedType(type);
    setStep("form");
  };

  const handleSubmit = () => {
    if (!locationName.trim()) {
      Alert.alert("Required", "Please enter a location or company name.");
      return;
    }
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      onSubmit({
        type: selectedType!,
        locationName: locationName.trim(),
        notes: notes.trim(),
        contactName: contactName.trim() || undefined,
        contactPhone: contactPhone.trim() || undefined,
        projectName: projectName.trim() || undefined,
      });
      reset();
    }, 100);
  };

  const selectedOption = STOP_OPTIONS.find((o) => o.type === selectedType);

  return (
    <Modal visible={visible} animationType="slide" transparent presentationStyle="overFullScreen">
      <KeyboardAvoidingView
        style={s.overlay}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={s.handle} />

          {/* Header */}
          <View style={s.header}>
            {step === "form" && (
              <TouchableOpacity onPress={() => setStep("pick")} style={s.backBtn}>
                <Feather name="arrow-left" size={14} color="#60045d" />
                <ThemedText style={s.backBtnText}>Back</ThemedText>
              </TouchableOpacity>
            )}
            <ThemedText style={s.title}>
              {step === "pick" ? "Where are you going?" : `${selectedOption?.icon} ${selectedOption?.label}`}
            </ThemedText>
            <TouchableOpacity onPress={handleCancel} style={s.closeBtn}>
              <Feather name="x" size={20} color="#6B7280" />
            </TouchableOpacity>
          </View>

          <ScrollView style={s.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {/* Step 1: Pick type */}
            {step === "pick" && (
              <View style={s.pickList}>
                {STOP_OPTIONS.map((opt) => (
                  <TouchableOpacity
                    key={opt.type}
                    style={[s.pickCard, { backgroundColor: opt.bg, borderColor: opt.color + "40" }]}
                    onPress={() => handlePickType(opt.type)}
                  >
                    <ThemedText style={s.pickIcon}>{opt.icon}</ThemedText>
                    <View style={s.pickText}>
                      <ThemedText style={[s.pickLabel, { color: opt.type === "home" ? "#065F46" : "#111827" }]}>
                        {opt.label}
                      </ThemedText>
                      <ThemedText style={s.pickSub}>{opt.sub}</ThemedText>
                    </View>
                    <Feather name="chevron-right" size={18} color={opt.color} />
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Step 2: Fill details */}
            {step === "form" && (
              <View style={s.form}>
                <ThemedText style={s.fieldLabel}>
                  {selectedType === "site" ? "Site / Location Name *" : "Company / Location Name *"}
                </ThemedText>
                <TextInput
                  style={s.input}
                  placeholder={selectedType === "site" ? "e.g., Project Alpha Site, Sector 62" : "e.g., ABC Builders, Client Office"}
                  placeholderTextColor="#9CA3AF"
                  value={locationName}
                  onChangeText={setLocationName}
                  maxLength={255}
                  autoFocus
                />

                {selectedType === "meeting" && (
                  <>
                    <ThemedText style={[s.fieldLabel, { marginTop: 14 }]}>Contact Name</ThemedText>
                    <TextInput
                      style={s.input}
                      placeholder="Who are you meeting?"
                      placeholderTextColor="#9CA3AF"
                      value={contactName}
                      onChangeText={setContactName}
                      maxLength={255}
                    />
                    <ThemedText style={[s.fieldLabel, { marginTop: 14 }]}>Contact Phone</ThemedText>
                    <TextInput
                      style={s.input}
                      placeholder="+91 XXXXX XXXXX"
                      placeholderTextColor="#9CA3AF"
                      value={contactPhone}
                      onChangeText={setContactPhone}
                      keyboardType="phone-pad"
                      maxLength={20}
                    />
                  </>
                )}

                <ThemedText style={[s.fieldLabel, { marginTop: 14 }]}>Project Name</ThemedText>
                <TextInput
                  style={s.input}
                  placeholder="Which project? (optional)"
                  placeholderTextColor="#9CA3AF"
                  value={projectName}
                  onChangeText={setProjectName}
                  maxLength={255}
                />

                <ThemedText style={[s.fieldLabel, { marginTop: 14 }]}>Notes (optional)</ThemedText>
                <TextInput
                  style={[s.input, s.notesInput]}
                  placeholder="Purpose of visit, what to discuss..."
                  placeholderTextColor="#9CA3AF"
                  value={notes}
                  onChangeText={setNotes}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                  maxLength={500}
                />

                <TouchableOpacity
                  style={[s.submitBtn, loading && { opacity: 0.7 }]}
                  onPress={handleSubmit}
                  disabled={loading}
                >
                  {loading
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <ThemedText style={s.submitBtnText}>Confirm Next Stop ✓</ThemedText>
                  }
                </TouchableOpacity>
              </View>
            )}

            <View style={{ height: 20 }} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "90%",
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: "#E5E7EB",
    alignSelf: "center",
    marginTop: 12, marginBottom: 4,
  },
  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: "#F3F4F6",
    gap: 8,
  },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  backBtnText: { fontSize: 13, color: "#60045d", fontWeight: "600" },
  title: { flex: 1, fontSize: 17, fontWeight: "800", color: "#111827", textAlign: "center" },
  closeBtn: { padding: 4 },
  body: { paddingHorizontal: 20, paddingTop: 16 },
  pickList: { gap: 10 },
  pickCard: {
    flexDirection: "row", alignItems: "center", gap: 14,
    padding: 16, borderRadius: 14, borderWidth: 1.5,
  },
  pickIcon: { fontSize: 24 },
  pickText: { flex: 1 },
  pickLabel: { fontSize: 15, fontWeight: "700" },
  pickSub: { fontSize: 12, color: "#6B7280", marginTop: 2 },
  form: {},
  fieldLabel: { fontSize: 13, fontWeight: "600", color: "#374151", marginBottom: 6 },
  input: {
    borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 10,
    padding: 12, fontSize: 14, color: "#111827", backgroundColor: "#F9FAFB",
  },
  notesInput: { height: 80, textAlignVertical: "top" },
  submitBtn: {
    backgroundColor: "#60045d", borderRadius: 12,
    paddingVertical: 14, alignItems: "center", marginTop: 20,
  },
  submitBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
});
