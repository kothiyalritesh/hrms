import React, { useState, useCallback } from "react";
import {
  StyleSheet, View, FlatList, Pressable,
  Alert, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, Modal, SafeAreaView,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Colors } from "@/constants/theme";
import Spacer from "@/components/Spacer";
import { supabase } from "@/lib/supabase";
import { OnDutyService } from "@/services/on-duty.service";

const EVENT_TYPES = [
  { id: "training", label: "Training" },
  { id: "conference", label: "Conference" },
  { id: "client_visit", label: "Client Visit" },
  { id: "company_event", label: "Company Event" },
  { id: "other", label: "Other" },
];

const STATUS_COLORS = {
  pending: Colors.light.warning,
  approved: Colors.light.success,
  rejected: Colors.light.error,
  completed: Colors.light.info,
};

export default function OnDutyRequestScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [userId, setUserId] = useState<string>("");
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [formData, setFormData] = useState({
    eventDate: "",
    eventName: "",
    eventType: "training",
    location: "",
    description: "",
  });

  useFocusEffect(
    useCallback(() => {
      const getCurrentUser = async () => {
        const { data } = await supabase.auth.getUser();
        if (data.user) {
          setUserId(data.user.id);
          loadEvents(data.user.id);
        }
      };
      getCurrentUser();
    }, [])
  );

  const loadEvents = async (uid: string) => {
    setLoading(true);
    try {
      const data = await OnDutyService.getUserOnDutyEvents(uid);
      setEvents(data);
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Failed to load events");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!formData.eventDate || !formData.eventName) {
      Alert.alert("Validation", "Please fill in all required fields");
      return;
    }

    setSubmitting(true);
    try {
      await OnDutyService.requestOnDuty(
        userId,
        formData.eventDate,
        formData.eventName,
        formData.eventType,
        formData.location,
        formData.description
      );

      Alert.alert("✅ Success", "On-duty request submitted for approval");
      setFormData({
        eventDate: "",
        eventName: "",
        eventType: "training",
        location: "",
        description: "",
      });
      setShowModal(false);
      loadEvents(userId);
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Failed to submit request");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async (eventId: string) => {
    Alert.alert("Cancel Request", "Are you sure you want to cancel this request?", [
      { text: "No", onPress: () => {} },
      {
        text: "Yes",
        onPress: async () => {
          try {
            await OnDutyService.cancelRequest(eventId);
            Alert.alert("✅ Success", "Request cancelled");
            loadEvents(userId);
          } catch (error: any) {
            Alert.alert("Error", error?.message || "Failed to cancel request");
          }
        },
      },
    ]);
  };

  const getStatusColor = (status: string) => STATUS_COLORS[status as keyof typeof STATUS_COLORS] || theme.textSecondary;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.backgroundRoot }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={s.container} showsVerticalScrollIndicator={false}>
        <View style={s.headerRow}>
          <View style={{ flex: 1 }}>
            <ThemedText type="h3">On-Duty Requests</ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              {events.length} request{events.length !== 1 ? "s" : ""}
            </ThemedText>
          </View>
          <TouchableOpacity
            style={[s.addBtn, { backgroundColor: theme.primary }]}
            onPress={() => setShowModal(true)}
            activeOpacity={0.7}
          >
            <Feather name="plus" size={24} color="#fff" />
          </TouchableOpacity>
        </View>

        <Spacer height={16} />

        {loading ? (
          <View style={s.centerContainer}>
            <ActivityIndicator size="large" color={theme.primary} />
          </View>
        ) : events.length === 0 ? (
          <View style={s.centerContainer}>
            <Feather name="inbox" size={40} color={theme.textSecondary} />
            <Spacer height={12} />
            <ThemedText style={{ color: theme.textSecondary }}>No on-duty requests yet</ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: 4 }}>
              Tap + to apply for outdoor duty
            </ThemedText>
          </View>
        ) : (
          <FlatList
            data={events}
            keyExtractor={(item) => item.id}
            scrollEnabled={false}
            renderItem={({ item }) => (
              <View style={[s.eventCard, { backgroundColor: theme.backgroundDefault }]}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <ThemedText style={s.eventName}>{item.event_name}</ThemedText>
                      <View
                        style={[
                          s.statusBadge,
                          { backgroundColor: getStatusColor(item.status) + "20" },
                        ]}
                      >
                        <ThemedText
                          style={[s.statusText, { color: getStatusColor(item.status) }]}
                        >
                          {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
                        </ThemedText>
                      </View>
                    </View>

                    <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: 4 }}>
                      {new Date(item.event_date).toLocaleDateString("en-IN", {
                        weekday: "short",
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })}
                    </ThemedText>

                    <View style={{ flexDirection: "row", gap: 12, marginTop: 8 }}>
                      <View style={s.infoChip}>
                        <Feather name="tag" size={12} color={theme.textSecondary} />
                        <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                          {EVENT_TYPES.find((t) => t.id === item.event_type)?.label}
                        </ThemedText>
                      </View>
                      {item.location && (
                        <View style={s.infoChip}>
                          <Feather name="map-pin" size={12} color={theme.textSecondary} />
                          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                            {item.location}
                          </ThemedText>
                        </View>
                      )}
                    </View>

                    {item.description && (
                      <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: 8 }}>
                        {item.description}
                      </ThemedText>
                    )}
                  </View>

                  {item.status === "pending" && (
                    <TouchableOpacity
                      style={s.cancelBtn}
                      onPress={() => handleCancel(item.id)}
                    >
                      <Feather name="x" size={16} color={Colors.light.error} />
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            )}
          />
        )}

        <Spacer height={80} />
      </ScrollView>

      <Modal visible={showModal} animationType="slide" transparent>
        <View style={[s.modalOverlay, { backgroundColor: "rgba(0,0,0,0.5)" }]}>
          <View style={[s.modalContent, { backgroundColor: theme.backgroundRoot }]}>
            <View style={s.modalHeader}>
              <ThemedText type="h3">Apply for On-Duty</ThemedText>
              <TouchableOpacity onPress={() => setShowModal(false)}>
                <Feather name="x" size={24} color={theme.text} />
              </TouchableOpacity>
            </View>

            <ScrollView style={s.modalBody} showsVerticalScrollIndicator={false}>
              <View style={s.formGroup}>
                <ThemedText type="caption" style={{ color: theme.textSecondary, marginBottom: 6 }}>
                  Event Date *
                </ThemedText>
                <TextInput
                  style={[s.input, { backgroundColor: theme.backgroundDefault, color: theme.text }]}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={theme.textSecondary}
                  value={formData.eventDate}
                  onChangeText={(text) => setFormData({ ...formData, eventDate: text })}
                />
              </View>

              <View style={s.formGroup}>
                <ThemedText type="caption" style={{ color: theme.textSecondary, marginBottom: 6 }}>
                  Event Name *
                </ThemedText>
                <TextInput
                  style={[s.input, { backgroundColor: theme.backgroundDefault, color: theme.text }]}
                  placeholder="e.g., Client Meeting, Training Session"
                  placeholderTextColor={theme.textSecondary}
                  value={formData.eventName}
                  onChangeText={(text) => setFormData({ ...formData, eventName: text })}
                />
              </View>

              <View style={s.formGroup}>
                <ThemedText type="caption" style={{ color: theme.textSecondary, marginBottom: 8 }}>
                  Event Type
                </ThemedText>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    {EVENT_TYPES.map((type) => (
                      <TouchableOpacity
                        key={type.id}
                        style={[
                          s.typeChip,
                          formData.eventType === type.id && {
                            backgroundColor: theme.primary,
                            borderColor: theme.primary,
                          },
                        ]}
                        onPress={() => setFormData({ ...formData, eventType: type.id })}
                      >
                        <ThemedText
                          style={[
                            s.typeChipText,
                            formData.eventType === type.id && { color: "#fff" },
                          ]}
                        >
                          {type.label}
                        </ThemedText>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
              </View>

              <View style={s.formGroup}>
                <ThemedText type="caption" style={{ color: theme.textSecondary, marginBottom: 6 }}>
                  Location
                </ThemedText>
                <TextInput
                  style={[s.input, { backgroundColor: theme.backgroundDefault, color: theme.text }]}
                  placeholder="e.g., Mumbai, Client Office"
                  placeholderTextColor={theme.textSecondary}
                  value={formData.location}
                  onChangeText={(text) => setFormData({ ...formData, location: text })}
                />
              </View>

              <View style={s.formGroup}>
                <ThemedText type="caption" style={{ color: theme.textSecondary, marginBottom: 6 }}>
                  Description
                </ThemedText>
                <TextInput
                  style={[
                    s.input,
                    s.textArea,
                    { backgroundColor: theme.backgroundDefault, color: theme.text },
                  ]}
                  placeholder="Additional details about the event"
                  placeholderTextColor={theme.textSecondary}
                  value={formData.description}
                  onChangeText={(text) => setFormData({ ...formData, description: text })}
                  multiline
                  numberOfLines={4}
                />
              </View>

              <Spacer height={20} />
            </ScrollView>

            <View style={s.modalFooter}>
              <TouchableOpacity
                style={[s.btn, { backgroundColor: theme.backgroundDefault }]}
                onPress={() => setShowModal(false)}
                disabled={submitting}
              >
                <ThemedText style={{ fontWeight: "700" }}>Cancel</ThemedText>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.btn, { backgroundColor: theme.primary }, submitting && { opacity: 0.6 }]}
                onPress={handleSubmit}
                disabled={submitting}
              >
                <ThemedText style={{ color: "#fff", fontWeight: "700" }}>
                  {submitting ? "Submitting..." : "Submit Request"}
                </ThemedText>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { padding: 16, paddingBottom: 100 },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  addBtn: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 5,
  },
  centerContainer: { alignItems: "center", paddingTop: 60 },
  eventCard: {
    padding: 14,
    borderRadius: 10,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: "#FFD700",
  },
  eventName: { fontSize: 14, fontWeight: "700" },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  statusText: { fontSize: 11, fontWeight: "700" },
  infoChip: { flexDirection: "row", alignItems: "center", gap: 4 },
  cancelBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.light.error + "20",
    alignItems: "center",
    justifyContent: "center",
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  modalContent: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "90%",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
  },
  modalBody: { padding: 16 },
  formGroup: { marginBottom: 16 },
  input: {
    padding: 12,
    borderRadius: 8,
    fontSize: 14,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  textArea: { textAlignVertical: "top" },
  typeChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: "#E5E7EB",
    backgroundColor: "#F9FAFB",
  },
  typeChipText: { fontSize: 12, fontWeight: "600", color: "#374151" },
  modalFooter: {
    flexDirection: "row",
    gap: 12,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
  },
  btn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
  },
});
