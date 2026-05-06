import React, { useState, useCallback } from "react";
import {
  StyleSheet, View, FlatList, Pressable,
  Alert, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, Modal,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Colors } from "@/constants/theme";
import Spacer from "@/components/Spacer";
import { supabase } from "@/lib/supabase";
import { OnDutyService } from "@/services/on-duty.service";

const STATUS_COLORS = {
  pending: Colors.light.warning,
  approved: Colors.light.success,
  rejected: Colors.light.error,
  completed: Colors.light.info,
};

export default function OnDutyApprovalScreen() {
  const { theme } = useTheme();
  const [userId, setUserId] = useState<string>("");
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<any>(null);
  const [showModal, setShowModal] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [filterStatus, setFilterStatus] = useState("pending");

  // Get current user
  useFocusEffect(
    useCallback(() => {
      const getCurrentUser = async () => {
        const { data } = await supabase.auth.getUser();
        if (data.user) {
          setUserId(data.user.id);
          loadRequests();
        }
      };
      getCurrentUser();
    }, [])
  );

  // Load pending requests
  const loadRequests = async () => {
    setLoading(true);
    try {
      const data = await OnDutyService.getPendingRequests();
      setRequests(data);
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Failed to load requests");
    } finally {
      setLoading(false);
    }
  };

  // Approve request
  const handleApprove = async () => {
    if (!selectedRequest) return;

    setProcessing(true);
    try {
      await OnDutyService.approveRequest(selectedRequest.id, userId);
      Alert.alert("✅ Approved", `On-duty request approved for ${selectedRequest.employee_name}`);
      setShowModal(false);
      setSelectedRequest(null);
      loadRequests();
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Failed to approve request");
    } finally {
      setProcessing(false);
    }
  };

  // Reject request
  const handleReject = async () => {
    if (!selectedRequest) return;

    setProcessing(true);
    try {
      await OnDutyService.rejectRequest(selectedRequest.id, userId);
      Alert.alert("✅ Rejected", `On-duty request rejected for ${selectedRequest.employee_name}`);
      setShowModal(false);
      setSelectedRequest(null);
      loadRequests();
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Failed to reject request");
    } finally {
      setProcessing(false);
    }
  };

  const filteredRequests = requests.filter((r) => r.status === filterStatus);
  const getStatusColor = (status: string) => STATUS_COLORS[status as keyof typeof STATUS_COLORS] || theme.textSecondary;

  return (
    <View style={{ flex: 1, backgroundColor: theme.backgroundRoot }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={s.container} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View>
          <ThemedText type="h3">On-Duty Approvals</ThemedText>
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            {filteredRequests.length} {filterStatus} request{filteredRequests.length !== 1 ? "s" : ""}
          </ThemedText>
        </View>

        <Spacer height={16} />

        {/* Status Filter */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {["pending", "approved", "rejected"].map((status) => (
              <TouchableOpacity
                key={status}
                style={[
                  s.filterChip,
                  filterStatus === status && {
                    backgroundColor: theme.primary,
                    borderColor: theme.primary,
                  },
                ]}
                onPress={() => setFilterStatus(status)}
              >
                <ThemedText
                  style={[
                    s.filterChipText,
                    filterStatus === status && { color: "#fff" },
                  ]}
                >
                  {status.charAt(0).toUpperCase() + status.slice(1)}
                </ThemedText>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>

        {/* Requests List */}
        {loading ? (
          <View style={s.centerContainer}>
            <ActivityIndicator size="large" color={theme.primary} />
          </View>
        ) : filteredRequests.length === 0 ? (
          <View style={s.centerContainer}>
            <Feather name="inbox" size={40} color={theme.textSecondary} />
            <Spacer height={12} />
            <ThemedText style={{ color: theme.textSecondary }}>No {filterStatus} requests</ThemedText>
          </View>
        ) : (
          <FlatList
            data={filteredRequests}
            keyExtractor={(item) => item.id}
            scrollEnabled={false}
            renderItem={({ item }) => (
              <Pressable
                style={[s.requestCard, { backgroundColor: theme.backgroundDefault }]}
                onPress={() => {
                  setSelectedRequest(item);
                  setShowModal(true);
                }}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <View style={{ flex: 1 }}>
                    <ThemedText style={s.empName}>{item.employee_name}</ThemedText>
                    <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: 2 }}>
                      {item.employee_number}
                    </ThemedText>

                    <View style={{ marginTop: 8 }}>
                      <ThemedText style={s.eventName}>{item.event_name}</ThemedText>
                      <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: 2 }}>
                        {new Date(item.event_date).toLocaleDateString("en-IN", {
                          weekday: "short",
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })}
                      </ThemedText>
                    </View>

                    {item.location && (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 }}>
                        <Feather name="map-pin" size={12} color={theme.textSecondary} />
                        <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                          {item.location}
                        </ThemedText>
                      </View>
                    )}
                  </View>

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
              </Pressable>
            )}
          />
        )}

        <Spacer height={80} />
      </ScrollView>

      {/* Detail Modal */}
      <Modal visible={showModal} animationType="slide" transparent>
        <View style={[s.modalOverlay, { backgroundColor: "rgba(0,0,0,0.5)" }]}>
          <View style={[s.modalContent, { backgroundColor: theme.backgroundRoot }]}>
            <View style={s.modalHeader}>
              <ThemedText type="h3">Request Details</ThemedText>
              <TouchableOpacity onPress={() => setShowModal(false)}>
                <Feather name="x" size={24} color={theme.text} />
              </TouchableOpacity>
            </View>

            <ScrollView style={s.modalBody} showsVerticalScrollIndicator={false}>
              {selectedRequest && (
                <>
                  {/* Employee Info */}
                  <View style={s.section}>
                    <ThemedText type="caption" style={{ color: theme.textSecondary, marginBottom: 8 }}>
                      EMPLOYEE
                    </ThemedText>
                    <ThemedText style={s.sectionTitle}>{selectedRequest.employee_name}</ThemedText>
                    <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: 4 }}>
                      {selectedRequest.employee_number}
                    </ThemedText>
                  </View>

                  <Spacer height={16} />

                  {/* Event Info */}
                  <View style={s.section}>
                    <ThemedText type="caption" style={{ color: theme.textSecondary, marginBottom: 8 }}>
                      EVENT DETAILS
                    </ThemedText>
                    <View style={s.detailRow}>
                      <ThemedText type="caption" style={{ color: theme.textSecondary }}>Event Name</ThemedText>
                      <ThemedText style={{ fontWeight: "600" }}>{selectedRequest.event_name}</ThemedText>
                    </View>
                    <View style={s.detailRow}>
                      <ThemedText type="caption" style={{ color: theme.textSecondary }}>Date</ThemedText>
                      <ThemedText style={{ fontWeight: "600" }}>
                        {new Date(selectedRequest.event_date).toLocaleDateString("en-IN", {
                          weekday: "long",
                          day: "2-digit",
                          month: "long",
                          year: "numeric",
                        })}
                      </ThemedText>
                    </View>
                    <View style={s.detailRow}>
                      <ThemedText type="caption" style={{ color: theme.textSecondary }}>Type</ThemedText>
                      <ThemedText style={{ fontWeight: "600" }}>
                        {selectedRequest.event_type.replace(/_/g, " ").toUpperCase()}
                      </ThemedText>
                    </View>
                    {selectedRequest.location && (
                      <View style={s.detailRow}>
                        <ThemedText type="caption" style={{ color: theme.textSecondary }}>Location</ThemedText>
                        <ThemedText style={{ fontWeight: "600" }}>{selectedRequest.location}</ThemedText>
                      </View>
                    )}
                  </View>

                  {selectedRequest.description && (
                    <>
                      <Spacer height={16} />
                      <View style={s.section}>
                        <ThemedText type="caption" style={{ color: theme.textSecondary, marginBottom: 8 }}>
                          DESCRIPTION
                        </ThemedText>
                        <ThemedText style={{ lineHeight: 20 }}>{selectedRequest.description}</ThemedText>
                      </View>
                    </>
                  )}

                  <Spacer height={16} />

                  {/* Status */}
                  <View style={s.section}>
                    <ThemedText type="caption" style={{ color: theme.textSecondary, marginBottom: 8 }}>
                      STATUS
                    </ThemedText>
                    <View
                      style={[
                        s.statusBadgeLarge,
                        { backgroundColor: getStatusColor(selectedRequest.status) + "20" },
                      ]}
                    >
                      <ThemedText
                        style={[s.statusTextLarge, { color: getStatusColor(selectedRequest.status) }]}
                      >
                        {selectedRequest.status.charAt(0).toUpperCase() + selectedRequest.status.slice(1)}
                      </ThemedText>
                    </View>
                  </View>

                  <Spacer height={20} />
                </>
              )}
            </ScrollView>

            {/* Action Buttons */}
            {selectedRequest?.status === "pending" && (
              <View style={s.modalFooter}>
                <TouchableOpacity
                  style={[s.btn, { backgroundColor: Colors.light.error + "20" }]}
                  onPress={handleReject}
                  disabled={processing}
                >
                  <Feather name="x" size={18} color={Colors.light.error} />
                  <ThemedText style={{ color: Colors.light.error, fontWeight: "700", marginLeft: 8 }}>
                    {processing ? "Processing..." : "Reject"}
                  </ThemedText>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.btn, { backgroundColor: Colors.light.success }, processing && { opacity: 0.6 }]}
                  onPress={handleApprove}
                  disabled={processing}
                >
                  <Feather name="check" size={18} color="#fff" />
                  <ThemedText style={{ color: "#fff", fontWeight: "700", marginLeft: 8 }}>
                    {processing ? "Processing..." : "Approve"}
                  </ThemedText>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  container: { padding: 16 },
  centerContainer: { alignItems: "center", paddingTop: 60 },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: "#E5E7EB",
    backgroundColor: "#F9FAFB",
  },
  filterChipText: { fontSize: 12, fontWeight: "600", color: "#374151" },
  requestCard: {
    padding: 14,
    borderRadius: 10,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: "#FFD700",
  },
  empName: { fontSize: 14, fontWeight: "700" },
  eventName: { fontSize: 13, fontWeight: "600" },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10 },
  statusText: { fontSize: 11, fontWeight: "700" },
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
  section: { marginBottom: 12 },
  sectionTitle: { fontSize: 14, fontWeight: "700" },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  },
  statusBadgeLarge: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  statusTextLarge: { fontSize: 13, fontWeight: "700" },
  modalFooter: {
    flexDirection: "row",
    gap: 12,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
  },
  btn: {
    flex: 1,
    flexDirection: "row",
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
});
