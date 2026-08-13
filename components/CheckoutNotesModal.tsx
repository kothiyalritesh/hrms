import React, { useState } from "react";
import {
  Modal,
  View,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { ThemedText } from "@/components/ThemedText";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BorderRadius } from "@/constants/theme";

export type NextAction = "next_stop" | "going_home";

interface Props {
  visible: boolean;
  locationName: string;
  onConfirm: (notes: string, next: NextAction) => void;
  loading?: boolean;
}

export default function CheckoutNotesModal({ visible, locationName, onConfirm, loading }: Props) {
  const insets = useSafeAreaInsets();
  const [notes, setNotes] = useState("");

  const handleAction = (next: NextAction) => {
    onConfirm(notes.trim(), next);
    setNotes("");
  };

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
            <View style={s.checkoutBadge}>
              <Feather name="log-out" size={14} color="#EF4444" />
              <ThemedText style={s.checkoutBadgeText}>Checking out of {locationName}</ThemedText>
            </View>
            <ThemedText style={s.title}>Meeting Notes</ThemedText>
            <ThemedText style={s.subtitle}>Add notes about this visit (outcome, next steps, etc.)</ThemedText>
          </View>

          <ScrollView style={s.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <TextInput
              style={s.notesInput}
              placeholder="What happened? Key outcomes, follow-ups, decisions made..."
              placeholderTextColor="#9CA3AF"
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={5}
              textAlignVertical="top"
              maxLength={1000}
              autoFocus
            />

            <ThemedText style={s.nextLabel}>What’s next?</ThemedText>

            <TouchableOpacity
              style={[s.actionBtn, s.actionBtnPrimary, loading && { opacity: 0.7 }]}
              onPress={() => handleAction("next_stop")}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color="#fff" size="small" />
                : <>
                    <ThemedText style={s.actionBtnIcon}>📍</ThemedText>
                    <View style={s.actionBtnContent}>
                      <ThemedText style={s.actionBtnTitle}>Going to Next Stop</ThemedText>
                      <ThemedText style={s.actionBtnSub}>Log where you’re heading next</ThemedText>
                    </View>
                    <Feather name="chevron-right" size={18} color="#fff" />
                  </>
              }
            </TouchableOpacity>

            <TouchableOpacity
              style={[s.actionBtn, s.actionBtnHome, loading && { opacity: 0.7 }]}
              onPress={() => handleAction("going_home")}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color="#fff" size="small" />
                : <>
                    <ThemedText style={s.actionBtnIcon}>🏠</ThemedText>
                    <View style={s.actionBtnContent}>
                      <ThemedText style={[s.actionBtnTitle, { color: "#065F46" }]}>Going Home</ThemedText>
                      <ThemedText style={[s.actionBtnSub, { color: "#047857" }]}>Done for the day — complete attendance</ThemedText>
                    </View>
                    <Feather name="chevron-right" size={18} color="#10B981" />
                  </>
              }
            </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "88%",
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: "#E5E7EB",
    alignSelf: "center",
    marginTop: 12, marginBottom: 4,
  },
  header: {
    padding: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
    alignItems: "center",
    gap: 6,
  },
  checkoutBadge: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#FEE2E2", paddingHorizontal: 12, paddingVertical: 5,
    borderRadius: BorderRadius.full,
  },
  checkoutBadgeText: { fontSize: 12, color: "#991B1B", fontWeight: "600" },
  title: { fontSize: 18, fontWeight: "800", color: "#111827", textAlign: "center" },
  subtitle: { fontSize: 13, color: "#6B7280", textAlign: "center", lineHeight: 18 },
  body: { paddingHorizontal: 20, paddingTop: 16 },
  notesInput: {
    borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 12,
    padding: 14, fontSize: 14, color: "#111827",
    backgroundColor: "#F9FAFB", minHeight: 120,
    textAlignVertical: "top", marginBottom: 20,
  },
  nextLabel: { fontSize: 14, fontWeight: "700", color: "#374151", marginBottom: 12 },
  actionBtn: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 16, borderRadius: 14, marginBottom: 10,
  },
  actionBtnPrimary: { backgroundColor: "#60045d" },
  actionBtnHome: {
    backgroundColor: "#F0FDF4",
    borderWidth: 1.5, borderColor: "#10B981",
  },
  actionBtnIcon: { fontSize: 22 },
  actionBtnContent: { flex: 1 },
  actionBtnTitle: { fontSize: 15, fontWeight: "700", color: "#FFFFFF" },
  actionBtnSub: { fontSize: 12, color: "rgba(255,255,255,0.75)", marginTop: 2 },
});
