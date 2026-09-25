import React, { useState } from "react";
import { Modal, View, Text, TextInput, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from "react-native";
import { supabase } from "@/lib/supabase";
import { Colors } from "@/constants/theme";

interface GeofenceReasonModalProps {
  visible: boolean;
  eventId: string;
  distance: number;
  onClose: () => void;
  onSubmitSuccess: () => void;
}

export default function GeofenceReasonModal({ visible, eventId, distance, onClose, onSubmitSuccess }: GeofenceReasonModalProps) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (reason.trim().length < 10) {
      Alert.alert("Reason too short", "Please provide a detailed reason (minimum 10 characters).");
      return;
    }
    
    setSubmitting(true);
    const { error } = await supabase.rpc("rpc_submit_geofence_reason", {
      p_event_id: eventId,
      p_reason: reason.trim(),
    });

    setSubmitting(false);

    if (error) {
      Alert.alert("Error", "Failed to submit reason. Please try again.");
      console.error(error);
    } else {
      setReason("");
      onSubmitSuccess();
      Alert.alert("Success", "Your reason has been submitted for review.");
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.overlay}>
        <View style={styles.modalContainer}>
          <Text style={styles.title}>Geofence Violation</Text>
          <Text style={styles.subtitle}>
            You were detected {Math.round(distance)}m away from your active workplace. Please provide a reason for this boundary exit.
          </Text>
          
          <TextInput
            style={styles.input}
            placeholder="E.g., Client meeting ran over, stepped out for lunch..."
            multiline
            numberOfLines={4}
            value={reason}
            onChangeText={setReason}
            editable={!submitting}
          />
          
          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose} disabled={submitting}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            
            <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit} disabled={submitting}>
              {submitting ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.submitBtnText}>Submit</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", padding: 20 },
  modalContainer: { backgroundColor: "#fff", borderRadius: 12, padding: 24 },
  title: { fontSize: 20, fontWeight: "700", color: "#d32f2f", marginBottom: 8 },
  subtitle: { fontSize: 14, color: "#555", marginBottom: 16, lineHeight: 20 },
  input: { borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 12, minHeight: 100, textAlignVertical: "top", fontSize: 16 },
  actions: { flexDirection: "row", justifyContent: "flex-end", marginTop: 20, gap: 12 },
  cancelBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 6 },
  cancelBtnText: { color: "#666", fontSize: 16, fontWeight: "600" },
  submitBtn: { backgroundColor: Colors.light.primary, paddingVertical: 10, paddingHorizontal: 20, borderRadius: 6, minWidth: 90, alignItems: "center" },
  submitBtnText: { color: "#fff", fontSize: 16, fontWeight: "600" }
});