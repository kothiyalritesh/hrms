import React, { useState, useCallback } from "react";
import { StyleSheet, View, FlatList, Pressable, Alert, Platform, ActivityIndicator } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useFocusEffect } from "@react-navigation/native";
import { ThemedText } from "@/components/ThemedText";
import { PageHeader } from "@/components/PageHeader";
import { useTheme } from "@/hooks/useTheme";
import { useAuth } from "@/contexts/AuthContext";
import { Spacing, BorderRadius, Colors } from "@/constants/theme";
import Spacer from "@/components/Spacer";
import { supabase } from "@/lib/supabase";

interface SiteVisitRequest {
  id: string;
  purpose: string;
  requested_location: any;
  requested_at: string;
  profiles: { name: string };
}

export default function SiteVisitApprovalsScreen() {
  const { theme } = useTheme();
  const { user } = useAuth();
  const [requests, setRequests] = useState<SiteVisitRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const loadRequests = useCallback(async () => {
    const { data, error } = await supabase
      .from("attendance_requests")
      .select(
        `
        id,
        purpose,
        requested_location,
        requested_at,
        profiles ( name )
      `,
      )
      .eq("status", "PENDING");

    if (error) {
      console.error("Error loading requests:", error);
    } else {
      setRequests(data || []);
    }
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadRequests();
    }, [loadRequests]),
  );

  const approveRequest = async (requestId: string) => {
    Alert.alert(
      "Approve Request",
      "Are you sure you want to approve this site visit request?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Approve",
          onPress: async () => {
            const { error } = await supabase
              .from("attendance_requests")
              .update({
                status: "APPROVED",
                approved_by: user!.id,
                approved_at: new Date().toISOString(),
              })
              .eq("id", requestId);

            if (error) {
              Alert.alert("Error", "Failed to approve request");
            } else {
              loadRequests();
            }
          },
        },
      ],
    );
  };

  const rejectRequest = async (requestId: string) => {
    Alert.alert(
      "Reject Request",
      "Are you sure you want to reject this site visit request?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reject",
          style: "destructive",
          onPress: async () => {
            const { error } = await supabase
              .from("attendance_requests")
              .update({
                status: "REJECTED",
                approved_by: user!.id,
                approved_at: new Date().toISOString(),
              })
              .eq("id", requestId);

            if (error) {
              Alert.alert("Error", "Failed to reject request");
            } else {
              loadRequests();
            }
          },
        },
      ],
    );
  };

  const renderRequest = ({ item }: { item: SiteVisitRequest }) => (
    <View style={[styles.requestCard, { backgroundColor: theme.backgroundDefault }]}>
      <View style={styles.requestHeader}>
        <View style={styles.requestInfo}>
          <ThemedText type="body" style={{ fontWeight: "700", color: theme.text, marginBottom: 3 }}>
            {item.profiles.name}
          </ThemedText>
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            {new Date(item.requested_at).toLocaleString()}
          </ThemedText>
          <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: 3 }}>
            Purpose: {item.purpose}
          </ThemedText>
          {item.requested_location && (
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              {item.requested_location.latitude?.toFixed(6)}, {item.requested_location.longitude?.toFixed(6)}
            </ThemedText>
          )}
        </View>
        <View style={styles.requestActions}>
          <Pressable style={[styles.actionButton, { backgroundColor: Colors.light.success }]} onPress={() => approveRequest(item.id)}>
            <Feather name="check" size={16} color="#FFFFFF" />
          </Pressable>
          <Pressable style={[styles.actionButton, { backgroundColor: Colors.light.error }]} onPress={() => rejectRequest(item.id)}>
            <Feather name="x" size={16} color="#FFFFFF" />
          </Pressable>
        </View>
      </View>
    </View>
  );

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.backgroundRoot }}>
        <PageHeader title="Site Visit Approvals" subtitle="Pending requests from your team" />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={theme.primary} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      <PageHeader
        title="Site Visit Approvals"
        subtitle={`${requests.length} pending request${requests.length !== 1 ? "s" : ""}`}
      />

      <Spacer height={Spacing.md} />

      {requests.length === 0 ? (
        <View style={styles.emptyBox}>
          <Feather name="check-circle" size={44} color={theme.textSecondary} />
          <Spacer height={Spacing.md} />
          <ThemedText type="body" style={{ color: theme.textSecondary, textAlign: "center" }}>No pending requests</ThemedText>
        </View>
      ) : (
        <FlatList
          data={requests}
          keyExtractor={(item) => item.id}
          renderItem={renderRequest}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { padding: Spacing.lg, gap: Spacing.sm },
  requestCard: {
    padding: Spacing.lg, borderRadius: 14,
    ...(Platform.OS === "web"
      ? { boxShadow: "0 2px 8px rgba(109,27,109,0.07)" }
      : { shadowColor: "#6D1B6D", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 8, elevation: 2 }),
  },
  requestHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  requestInfo: { flex: 1 },
  requestActions: { flexDirection: "row", gap: Spacing.sm },
  actionButton: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  emptyBox: { flex: 1, alignItems: "center", justifyContent: "center", padding: Spacing["2xl"] },
});
