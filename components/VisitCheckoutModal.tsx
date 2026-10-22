import React, { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";

type Props = {
  visible: boolean;
  placeName: string;
  /** Called with the notes; resolves with an error message or null on success. */
  onSubmit: (notes: string) => Promise<string | null>;
  onClose: () => void;
  stepLabel?: string | null;
};

/** Check-out of a site visit: optional notes; GPS is recorded by the caller. */
export function VisitCheckoutModal({ visible, placeName, onSubmit, onClose, stepLabel }: Props) {
  const { theme } = useTheme();
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setNotes("");
      setError(null);
      setSubmitting(false);
    }
  }, [visible]);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    const message = await onSubmit(notes.trim());
    setSubmitting(false);
    if (message) setError(message);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={submitting ? undefined : onClose}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: theme.backgroundDefault }]}>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }} keyboardShouldPersistTaps="handled">
            <View style={styles.header}>
              <View style={{ flex: 1 }}>
                <ThemedText style={styles.title}>Complete visit</ThemedText>
                <ThemedText style={{ color: theme.textSecondary }} numberOfLines={2}>{placeName}</ThemedText>
              </View>
              <Pressable onPress={onClose} disabled={submitting} hitSlop={10} accessibilityLabel="Close">
                <Feather name="x" size={22} color={theme.textSecondary} />
              </Pressable>
            </View>

            <ThemedText style={[styles.label, { color: theme.textSecondary }]}>NOTES (OPTIONAL)</ThemedText>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="What was done at the site?"
              placeholderTextColor={theme.textSecondary}
              multiline
              maxLength={500}
              editable={!submitting}
              style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundSecondary }]}
            />

            {error ? (
              <View style={[styles.error, { backgroundColor: theme.error + "14" }]}>
                <Feather name="alert-circle" size={16} color={theme.error} />
                <ThemedText style={{ color: theme.error, flex: 1 }}>{error}</ThemedText>
              </View>
            ) : null}

            <Pressable
              onPress={submit}
              disabled={submitting}
              style={[styles.primary, { backgroundColor: theme.primary, opacity: submitting ? 0.75 : 1 }]}
            >
              {submitting ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <ActivityIndicator color="#fff" />
                  <ThemedText style={styles.primaryText}>{stepLabel || "Completing…"}</ThemedText>
                </View>
              ) : (
                <ThemedText style={styles.primaryText}>Check out and complete</ThemedText>
              )}
            </Pressable>
            <ThemedText type="caption" style={{ color: theme.textSecondary, textAlign: "center" }}>
              Your current GPS location is recorded with the check-out.
            </ThemedText>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(17,24,39,0.5)", justifyContent: Platform.OS === "web" ? "center" : "flex-end", alignItems: "center" },
  sheet: { width: "100%", maxWidth: 480, maxHeight: "92%", borderTopLeftRadius: 18, borderTopRightRadius: 18, borderRadius: Platform.OS === "web" ? 18 : undefined },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  title: { fontSize: 19, fontWeight: "800" },
  label: { fontSize: 11, fontWeight: "800", letterSpacing: 0.6 },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, minHeight: 80, fontSize: 16, textAlignVertical: "top" },
  error: { flexDirection: "row", gap: 8, alignItems: "center", padding: 10, borderRadius: 10 },
  primary: { minHeight: 52, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  primaryText: { color: "#fff", fontWeight: "800", fontSize: 16 },
});

export default VisitCheckoutModal;
