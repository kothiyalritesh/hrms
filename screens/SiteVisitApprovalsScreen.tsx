import React, { useState, useCallback } from "react";
import { StyleSheet, View, FlatList, Pressable, Alert } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { ThemedText } from "@/components/ThemedText";
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
  profiles: { name: string } | { name: string }[]; // Supabase may return array or object
}

function getProfileName(profiles: SiteVisitRequest["profiles"]): string {
  if (Array.isArray(profiles)) return profiles[0]?.name ?? "Unknown";
  return profiles?.name ?? "Unknown";
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
      setRequests((data || []) as any);
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
    <View
      style={[styles.requestCard, { backgroundColor: theme.backgroundDefault }]}
    >
      <View style={styles.requestHeader}>
        <View style={styles.requestInfo}>
          <ThemedText type="body" style={styles.employeeName}>
            {getProfileName(item.profiles)}
          </ThemedText>
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            {new Date(item.requested_at).toLocaleString()}
          </ThemedText>
          <ThemedText
            type="caption"
            style={{ color: theme.textSecondary, marginTop: Spacing.xs }}
          >
            Purpose: {item.purpose}
          </ThemedText>
          {item.requested_location && (
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              Location: {item.requested_location.latitude?.toFixed(6)},{" "}
              {item.requested_location.longitude?.toFixed(6)}
            </ThemedText>
          )}
        </View>

        <View style={styles.requestActions}>
          <Pressable
            style={[
              styles.actionButton,
              { backgroundColor: Colors.light.success },
            ]}
            onPress={() => approveRequest(item.id)}
          >
            <Feather name="check" size={16} color="#FFFFFF" />
          </Pressable>

          <Pressable
            style={[
              styles.actionButton,
              { backgroundColor: Colors.light.error },
            ]}
            onPress={() => rejectRequest(item.id)}
          >
            <Feather name="x" size={16} color="#FFFFFF" />
          </Pressable>
        </View>
      </View>
    </View>
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <ThemedText>Loading requests...</ThemedText>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <ThemedText type="h3">Site Visit Approvals</ThemedText>
        <ThemedText type="caption" style={{ color: theme.textSecondary }}>
          Pending requests from your team
        </ThemedText>
      </View>

      <Spacer height={Spacing.md} />

      {requests.length === 0 ? (
        <View style={styles.centered}>
          <Feather name="check-circle" size={48} color={theme.textSecondary} />
          <Spacer height={Spacing.md} />
          <ThemedText style={{ color: theme.textSecondary }}>
            No pending requests
          </ThemedText>
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
  container: {
    flex: 1,
    padding: Spacing.lg,
  },
  header: {
    alignItems: "flex-start",
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  list: {
    gap: Spacing.md,
  },
  requestCard: {
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
  },
  requestHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  requestInfo: {
    flex: 1,
  },
  employeeName: {
    marginBottom: Spacing.xs,
    fontWeight: "600",
  },
  requestActions: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  actionButton: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
});
