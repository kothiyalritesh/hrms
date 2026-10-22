import React, { useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, TextInput, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { supabase } from "@/lib/supabase";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";

interface GeofenceReasonModalProps {
  visible: boolean;
  eventId: string;
  distance: number;
  /** POTENTIAL_EXIT: just left (can explain right away); PENDING_REASON: outside 10+ min. */
  status?: string | null;
  officeName?: string | null;
  onClose: () => void;
  onSubmitSuccess: () => void;
}

function friendlyError(message: string) {
  if (message.includes("REASON_TOO_SHORT")) return "Please write at least 10 characters.";
  if (message.includes("REASON_ALREADY_SUBMITTED")) return "A reason was already submitted for this.";
  if (message.includes("EVENT_NOT_FOUND")) return "This alert is no longer open.";
  return "Could not submit the reason. Check your connection and try again.";
}

/** Asks the employee why they left the office (just left, or outside > 10 min). */
export default function GeofenceReasonModal({
  visible,
  eventId,
  distance,
  status,
  officeName,
  onClose,
  onSubmitSuccess,
}: GeofenceReasonModalProps) {
  const office = officeName || "your office";
  const justLeft = status === "POTENTIAL_EXIT";
  const { theme } = useTheme();
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const handleSubmit = async () => {
    if (reason.trim().length < 10) {
      setError("Please write at least 10 characters.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc("rpc_submit_geofence_reason", {
      p_event_id: eventId,
      p_reason: reason.trim(),
    });
    setSubmitting(false);
    if (rpcError) {
      setError(friendlyError(rpcError.message || ""));
      return;
    }
    setReason("");
    setDone(true);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: theme.backgroundDefault, borderColor: theme.border }]}>
          {done ? (
            <>
              <View style={[styles.icon, { backgroundColor: theme.success + "1A" }]}>
                <Feather name="check" size={22} color={theme.success} />
              </View>
              <ThemedText style={styles.title}>Reason submitted</ThemedText>
              <ThemedText style={[styles.subtitle, { color: theme.textSecondary }]}>
                Your manager and HR will review it.
              </ThemedText>
              <Pressable style={[styles.primary, { backgroundColor: theme.primary }]} onPress={onSubmitSuccess}>
                <ThemedText style={styles.primaryText}>Done</ThemedText>
              </Pressable>
            </>
          ) : (
            <>
              <View style={[styles.icon, { backgroundColor: theme.error + "1A" }]}>
                <Feather name="map-pin" size={22} color={theme.error} />
              </View>
              <ThemedText style={styles.title}>You left the office</ThemedText>
              <ThemedText style={[styles.subtitle, { color: theme.textSecondary }]}>
                {justLeft
                  ? `You are about ${Math.round(distance)} m from ${office}, outside the allowed area. If this is for work, tell us why now.`
                  : `You were about ${Math.round(distance)} m from ${office} for more than 10 minutes during working hours. Please tell us why.`}
              </ThemedText>
              <TextInput
                style={[styles.input, { color: theme.text, borderColor: error ? theme.error : theme.border, backgroundColor: theme.backgroundSecondary }]}
                placeholder="E.g. client meeting, bank work for the company…"
                placeholderTextColor={theme.textSecondary}
                multiline
                value={reason}
                onChangeText={(text) => {
                  setReason(text);
                  if (error) setError(null);
                }}
                editable={!submitting}
                maxLength={1000}
              />
              {error ? <ThemedText style={[styles.error, { color: theme.error }]}>{error}</ThemedText> : null}
              <View style={styles.actions}>
                <Pressable style={[styles.secondary, { borderColor: theme.border }]} onPress={onClose} disabled={submitting}>
                  <ThemedText style={{ fontWeight: "700" }}>Later</ThemedText>
                </Pressable>
                <Pressable
                  style={[styles.primary, { backgroundColor: theme.primary, flex: 1, opacity: submitting ? 0.7 : 1 }]}
                  onPress={handleSubmit}
                  disabled={submitting}
                >
                  {submitting ? <ActivityIndicator color="#fff" /> : <ThemedText style={styles.primaryText}>Submit reason</ThemedText>}
                </Pressable>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(17,24,39,0.55)", justifyContent: "center", alignItems: "center", padding: 16 },
  card: { width: "100%", maxWidth: 440, borderRadius: 16, borderWidth: 1, padding: 20 },
  icon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  title: { fontSize: 18, fontWeight: "800", marginBottom: 6 },
  subtitle: { fontSize: 14, lineHeight: 20, marginBottom: 14 },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, minHeight: 96, fontSize: 16, textAlignVertical: "top" },
  error: { fontSize: 13, marginTop: 6 },
  actions: { flexDirection: "row", gap: 10, marginTop: 16 },
  primary: { minHeight: 48, borderRadius: 10, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  primaryText: { color: "#fff", fontWeight: "800" },
  secondary: { minHeight: 48, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 18 },
});
