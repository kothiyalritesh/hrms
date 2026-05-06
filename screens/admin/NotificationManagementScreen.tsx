import React, { useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  FlatList,
  Pressable,
  TextInput,
  Alert,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, Colors } from "@/constants/theme";
import Spacer from "@/components/Spacer";
import { supabase } from "@/lib/supabase";

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
  const [sending, setSending] = useState(false);

  const loadNotifications = useCallback(async () => {
    const { data, error } = await supabase
      .from("notifications")
      .select(
        `
        id,
        title,
        message,
        type,
        created_at
      `,
      )
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("Error loading notifications:", error);
    } else {
      const formattedData =
        data?.map((notif: any) => ({
          id: notif.id,
          title: notif.title,
          message: notif.message,
          type: notif.type,
          created_at: notif.created_at,
          user_name: undefined,
        })) || [];
      setNotifications(formattedData);
    }
    setLoading(false);
  }, []);

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
    const { data: users, error: usersError } = await supabase
      .from("profiles")
      .select("id")
      .eq("is_active", true);

    if (usersError) {
      Alert.alert("Error", "Failed to get user list");
      setSending(false);
      return;
    }

    // Create notification for each user
    const notifications =
      users?.map((user: any) => ({
        user_id: user.id,
        title: broadcastTitle,
        message: broadcastMessage,
        type: "announcement",
        is_read: false,
      })) || [];

    const { error } = await supabase
      .from("notifications")
      .insert(notifications);

    if (error) {
      Alert.alert("Error", "Failed to send broadcast notification");
    } else {
      setBroadcastTitle("");
      setBroadcastMessage("");
      loadNotifications();
      Alert.alert("✅ Broadcast Sent", `Notification sent to ${users?.length || 0} employees.`);
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
            {item.type} • {new Date(item.created_at).toLocaleDateString()}
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
