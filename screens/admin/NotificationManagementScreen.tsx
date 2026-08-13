import React, { useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  FlatList,
  Pressable,
  TextInput,
  Alert,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import * as Crypto from "expo-crypto";
import { useFocusEffect } from "@react-navigation/native";
import { ThemedText } from "@/components/ThemedText";
import { formatDate } from "@/utils/format";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, Colors } from "@/constants/theme";
import Spacer from "@/components/Spacer";
import { supabase } from "@/lib/supabase";
import { fetchAllPages } from "@/utils/supabasePagination";
import { PaginationControls } from "@/components/PaginationControls";

const PAGE_SIZE = 50;

interface Notification {
  id: string;
  title: string;
  message: string;
  type: string;
  created_at: string;
  user_name?: string;
}

export default function NotificationManagementScreen() {
  const { theme } = useTheme();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [broadcastTitle, setBroadcastTitle] = useState("");
  const [broadcastMessage, setBroadcastMessage] = useState("");
  const [broadcastType, setBroadcastType] = useState<
    "hr_announcement" | "policy" | "emergency"
  >("hr_announcement");
  const [sending, setSending] = useState(false);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);

  const loadNotifications = useCallback(async () => {
    setLoading(true);
    const from = page * PAGE_SIZE;
    const { data, error, count } = await supabase
        .from("notifications")
        .select("id, title, message, type, created_at", { count: "exact" })
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, from + PAGE_SIZE - 1);

    if (error) {
      console.error("Error loading notifications:", error);
    } else {
      setNotifications(data?.map((n: any) => ({ ...n, type: n.type || "announcement", user_name: undefined })) || []);
      setTotal(count ?? 0);
    }
    setLoading(false);
  }, [page]);

  useFocusEffect(
    useCallback(() => {
      loadNotifications();
    }, [loadNotifications]),
  );

  const sendBroadcastNotification = async () => {
    if (!broadcastTitle.trim() || !broadcastMessage.trim()) {
      Alert.alert("Error", "Please enter both title and message");
      return;
    }

    setSending(true);

    // Get all active users
    const { data: users, error: usersError } = await fetchAllPages<any>(
      (from, to) => supabase.from("profiles").select("id")
        .eq("is_active", true).order("id").range(from, to),
    );

    if (usersError) {
      Alert.alert("Error", "Failed to get user list");
      setSending(false);
      return;
    }

    const broadcastId = Crypto.randomUUID();
    const notificationRows =
      users?.map((user: any) => ({
        user_id: user.id,
        title: broadcastTitle.trim(),
        message: broadcastMessage.trim(),
        type: broadcastType,
        event_key: `broadcast:${broadcastId}:${user.id}`,
        deep_link: "/HRMS/notifications",
        push_data: { broadcastId, broadcastType },
        read: false,
      })) || [];

    const { error } = await supabase
      .from("notifications")
      .insert(notificationRows);

    if (error) {
      Alert.alert("Error", "Failed to send broadcast notification");
    } else {
      Alert.alert("Success", "Broadcast notification sent to all users");
      setBroadcastTitle("");
      setBroadcastMessage("");
      setBroadcastType("hr_announcement");
      loadNotifications();
    }

    setSending(false);
  };

  const renderNotification = ({ item }: { item: Notification }) => (
    <View
      style={[
        styles.notificationCard,
        { backgroundColor: theme.backgroundDefault },
      ]}
    >
      <View style={styles.notificationHeader}>
        <View style={styles.notificationInfo}>
          <ThemedText type="body" style={styles.notificationTitle}>
            {item.title}
          </ThemedText>
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            {item.message}
          </ThemedText>
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            {item.type} • {formatDate(item.created_at)}
            {item.user_name && ` • ${item.user_name}`}
          </ThemedText>
        </View>

        <View
          style={[
            styles.typeBadge,
            { backgroundColor: Colors.light.info + "20" },
          ]}
        >
          <ThemedText
            type="caption"
            style={{ color: Colors.light.info, fontWeight: "600" }}
          >
            {item.type.toUpperCase()}
          </ThemedText>
        </View>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.broadcastSection}>
        <ThemedText type="h3">Send Broadcast Notification</ThemedText>
        <Spacer height={Spacing.md} />

        <View style={styles.broadcastTypes}>
          {([
            ["hr_announcement", "Announcement"],
            ["policy", "Policy"],
            ["emergency", "Emergency"],
          ] as const).map(([value, label]) => (
            <Pressable
              key={value}
              style={[
                styles.broadcastType,
                {
                  backgroundColor:
                    broadcastType === value ? Colors.light.primary : theme.backgroundDefault,
                },
              ]}
              onPress={() => setBroadcastType(value)}
            >
              <ThemedText
                type="caption"
                style={{
                  color: broadcastType === value ? "#FFFFFF" : theme.text,
                  fontWeight: "700",
                }}
              >
                {label}
              </ThemedText>
            </Pressable>
          ))}
        </View>

        <TextInput
          style={[
            styles.input,
            { backgroundColor: theme.backgroundDefault, color: theme.text },
          ]}
          placeholder="Notification Title"
          placeholderTextColor={theme.textSecondary}
          value={broadcastTitle}
          onChangeText={setBroadcastTitle}
        />

        <TextInput
          style={[
            styles.textArea,
            { backgroundColor: theme.backgroundDefault, color: theme.text },
          ]}
          placeholder="Notification Message"
          placeholderTextColor={theme.textSecondary}
          value={broadcastMessage}
          onChangeText={setBroadcastMessage}
          multiline
          numberOfLines={3}
        />

        <Pressable
          style={[
            styles.sendButton,
            {
              backgroundColor: Colors.light.primary,
              opacity:
                sending || !broadcastTitle.trim() || !broadcastMessage.trim()
                  ? 0.5
                  : 1,
            },
          ]}
          onPress={sendBroadcastNotification}
          disabled={
            sending || !broadcastTitle.trim() || !broadcastMessage.trim()
          }
        >
          <Feather name="send" size={16} color="#FFFFFF" />
          <ThemedText type="caption" style={styles.sendButtonText}>
            {sending ? "Sending..." : "Send Broadcast"}
          </ThemedText>
        </Pressable>
      </View>

      <Spacer height={Spacing.xl} />

      <ThemedText type="h3">System Notifications</ThemedText>
      <PaginationControls page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
      <Spacer height={Spacing.md} />

      {loading ? (
        <View style={styles.centered}>
          <ThemedText>Loading notifications...</ThemedText>
        </View>
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(item) => item.id}
          renderItem={renderNotification}
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
  broadcastSection: {
    marginBottom: Spacing.lg,
  },
  broadcastTypes: {
    flexDirection: "row",
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  broadcastType: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
  },
  input: {
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
    marginBottom: Spacing.md,
    fontSize: 16,
  },
  textArea: {
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
    marginBottom: Spacing.md,
    fontSize: 16,
    minHeight: 80,
    textAlignVertical: "top",
  },
  sendButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.sm,
    gap: Spacing.xs,
  },
  sendButtonText: {
    color: "#FFFFFF",
    fontWeight: "600",
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  list: {
    gap: Spacing.md,
  },
  notificationCard: {
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
  },
  notificationHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  notificationInfo: {
    flex: 1,
  },
  notificationTitle: {
    marginBottom: Spacing.xs,
  },
  typeBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.xs,
  },
});
