/**
 * FieldVisitFeedbackModal.tsx
 * 5-star rating and notes modal prompted immediately after site visit checkout
 */

import React, { useState } from "react";
import {
  Modal,
  View,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, Spacing } from "@/constants/theme";
import { supabase } from "@/lib/supabase";

export interface FieldVisitFeedbackModalProps {
  visible: boolean;
  visitId: string;
  projectName?: string;
  onClose: () => void;
  onSubmitSuccess?: () => void;
}

export default function FieldVisitFeedbackModal({
  visible,
  visitId,
  projectName = "Site Visit",
  onClose,
  onSubmitSuccess,
}: FieldVisitFeedbackModalProps) {
  const { theme } = useTheme();
  const [rating, setRating] = useState<number>(5);
  const [notes, setNotes] = useState<string>("");
  const [submitting, setSubmitting] = useState<boolean>(false);

  const handleSubmit = async () => {
    if (!rating) {
      Alert.alert("Rating Required", "Please select a star rating.");
      return;
    }

    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc("submit_visit_feedback", {
        p_visit_id: visitId,
        p_rating: rating,
        p_notes: notes.trim() || null,
      });
      if (error) throw error;
      if (data && data.success === false) {
        throw new Error(data.error || "Failed to submit feedback");
      }

      Alert.alert("Thank you!", "Visit feedback submitted successfully.");
      if (onSubmitSuccess) onSubmitSuccess();
      onClose();
    } catch (err: any) {
      Alert.alert("Submission Failed", err.message || "Failed to submit feedback");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={[s.modalCard, { backgroundColor: theme.backgroundDefault, borderColor: theme.border }]}>
          <ThemedText type="h3" style={{ textAlign: "center" }}>
            How was this visit?
          </ThemedText>
          <ThemedText type="caption" style={{ color: theme.textSecondary, textAlign: "center", marginTop: 4 }}>
            {projectName}
          </ThemedText>

          {/* 5-Star Rating Selector */}
          <View style={s.starsRow}>
            {[1, 2, 3, 4, 5].map((star) => {
              const filled = star <= rating;
              return (
                <TouchableOpacity
                  key={`star-${star}`}
                  onPress={() => setRating(star)}
                  style={s.starBtn}
                >
                  <Feather
                    name="star"
                    size={32}
                    color={filled ? "#F59E0B" : "#D1D5DB"}
                    style={filled ? s.starFilled : undefined}
                  />
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Feedback Notes Input */}
          <TextInput
            style={[
              s.notesInput,
              {
                backgroundColor: theme.backgroundRoot,
                borderColor: theme.border,
                color: theme.text,
              },
            ]}
            placeholder="Add visit notes or client feedback (optional)..."
            placeholderTextColor={theme.textSecondary}
            multiline
            numberOfLines={3}
            value={notes}
            onChangeText={setNotes}
          />

          {/* Action Buttons */}
          <View style={s.actionsRow}>
            <TouchableOpacity
              style={[s.skipBtn, { borderColor: theme.border }]}
              onPress={onClose}
              disabled={submitting}
            >
              <ThemedText style={{ color: theme.textSecondary, fontWeight: "600" }}>
                Skip
              </ThemedText>
            </TouchableOpacity>

            <TouchableOpacity
              style={[s.submitBtn, { backgroundColor: "#7C3AED" }]}
              onPress={() => void handleSubmit()}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <ThemedText style={{ color: "#fff", fontWeight: "700" }}>
                  Submit
                </ThemedText>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.lg,
  },
  modalCard: {
    width: "100%",
    maxWidth: 400,
    padding: Spacing.lg,
    borderRadius: BorderRadius.xl,
    borderWidth: 1,
    gap: 16,
    elevation: 8,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  starsRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    marginVertical: 4,
  },
  starBtn: {
    padding: 4,
  },
  starFilled: {
    transform: [{ scale: 1.1 }],
  },
  notesInput: {
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    padding: 10,
    fontSize: 13,
    minHeight: 80,
    textAlignVertical: "top",
  },
  actionsRow: {
    flexDirection: "row",
    gap: 12,
  },
  skipBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  submitBtn: {
    flex: 2,
    paddingVertical: 10,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
});

