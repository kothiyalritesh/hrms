import React, { useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  Pressable,
  RefreshControl,
  Alert,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { ScreenScrollView } from "@/components/ScreenScrollView";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, Colors } from "@/constants/theme";
import Spacer from "@/components/Spacer";
import { NotificationStorage, Notification } from "@/utils/storage";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";

const NOTIFICATION_ICONS: Record<string, keyof typeof Feather.glyphMap> = {
  task: "check-square",
  leave: "calendar",
  payroll: "dollar-sign",
  announcement: "bell",
  reminder: "clock",
  attendance_warning: "alert-triangle",
  location_violation: "map-pin",
  location_alert: "map-pin",
};

const NOTIFICATION_COLORS: Record<string, string> = {
  task: Colors.light.primary,
  leave: Colors.light.success,
  payroll: Colors.light.info,
  announcement: Colors.light.warning,
  reminder: Colors.light.error,
  attendance_warning: Colors.light.warning,
  location_violation: Colors.light.error,
  location_alert: Colors.light.error,
};

interface NotificationCardProps {
  notification: Notification;
  onPress: () => void;
}

function NotificationCard({ notification, onPress }: NotificationCardProps) {
  const { theme } = useTheme();
  const iconColor = NOTIFICATION_COLORS[notification.type] ?? Colors.light.warning;
  const iconName: keyof typeof Feather.glyphMap = NOTIFICATION_ICONS[notification.type] ?? "bell";
  const timeAgo = getTimeAgo(notification.createdAt);

  return (
    <Pressable
      style={({ pressed }) => [
        styles.notificationCard,
        {
          backgroundColor: notification.read
            ? theme.backgroundDefault
            : theme.primary + "08",
          opacity: pressed ? 0.8 : 1,
          borderLeftColor: notification.read ? "transparent" : iconColor,
        },
      ]}
      onPress={onPress}
    >
      <View
        style={[styles.iconContainer, { backgroundColor: iconColor + "20" }]}
      >
        <Feather
          name={iconName}
          size={20}
          color={iconColor}
        />
      </View>

      <View style={styles.notificationContent}>
        <ThemedText
          type="body"
          style={[
            styles.notificationTitle,
            { fontWeight: notification.read ? "400" : "600" },
          ]}
        >
          {notification.title}
        </ThemedText>
        <ThemedText
          type="small"
          style={{ color: theme.textSecondary }}
          numberOfLines={2}
        >
          {notification.message}
        </ThemedText>
        <ThemedText
          type="caption"
          style={[styles.timeText, { color: theme.textSecondary }]}
        >
          {timeAgo}
        </ThemedText>
      </View>

      {!notification.read ? (
        <View style={[styles.unreadDot, { backgroundColor: iconColor }]} />
      ) : null}
    </Pressable>
  );
}

function getTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export default function NotificationsScreen() {
  const { theme } = useTheme();
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    if (!user?.id) return;
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(100);
    const mapped: Notification[] = (data || []).map((n: any) => ({
      id: n.id,
      title: n.title,
      message: n.message,
      type: n.type || "announcement",
      read: n.read ?? false,
      createdAt: n.created_at,
    }));
    setNotifications(mapped);
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const handleNotificationPress = async (notification: Notification) => {
    if (!notification.read) {
      await supabase.from("notifications").update({ read: true }).eq("id", notification.id);
      await loadData();
    }
    Alert.alert(notification.title, notification.message);
  };

  const handleMarkAllRead = async () => {
    if (!user?.id) return;
    await supabase.from("notifications").update({ read: true }).eq("user_id", user.id).eq("read", false);
    await loadData();
  };

  const handleClearAll = () => {
    Alert.alert(
      "Clear All Notifications",
      "Are you sure you want to clear all notifications?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear All",
          style: "destructive",
          onPress: async () => {
            if (!user?.id) return;
            await supabase.from("notifications").delete().eq("user_id", user.id);
            await loadData();
          },
        },
      ],
    );
  };

  const unreadCount = notifications.filter((n) => !n.read).length;
  const todayNotifications = notifications.filter((n) => {
    const notifDate = new Date(n.createdAt).toDateString();
    return notifDate === new Date().toDateString();
  });
  const earlierNotifications = notifications.filter((n) => {
    const notifDate = new Date(n.createdAt).toDateString();
    return notifDate !== new Date().toDateString();
  });

  return (
    <ScreenScrollView
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={theme.primary}
        />
      }
    >
      {notifications.length > 0 ? (
        <>
          <View style={styles.actionsRow}>
            {unreadCount > 0 ? (
              <Pressable
                style={({ pressed }) => [
                  styles.actionBtn,
                  { opacity: pressed ? 0.7 : 1 },
                ]}
                onPress={handleMarkAllRead}
              >
                <Feather name="check-circle" size={16} color={theme.primary} />
                <ThemedText type="small" style={{ color: theme.primary }}>
                  Mark all read
                </ThemedText>
              </Pressable>
            ) : null}
            <Pressable
              style={({ pressed }) => [
                styles.actionBtn,
                { opacity: pressed ? 0.7 : 1 },
              ]}
              onPress={handleClearAll}
            >
              <Feather name="trash-2" size={16} color={Colors.light.error} />
              <ThemedText type="small" style={{ color: Colors.light.error }}>
                Clear all
              </ThemedText>
            </Pressable>
          </View>

          {unreadCount > 0 ? (
            <View
              style={[
                styles.unreadBanner,
                { backgroundColor: Colors.light.infoBg },
              ]}
            >
              <Feather name="bell" size={16} color={Colors.light.infoText} />
              <ThemedText type="small" style={{ color: Colors.light.infoText }}>
                You have {unreadCount} unread notification
                {unreadCount > 1 ? "s" : ""}
              </ThemedText>
            </View>
          ) : null}

          <Spacer height={Spacing.lg} />

          {todayNotifications.length > 0 ? (
            <>
              <ThemedText type="h4" style={styles.sectionTitle}>
                Today
              </ThemedText>
              <Spacer height={Spacing.sm} />
              <View style={styles.notificationsList}>
                {todayNotifications.map((notification) => (
                  <NotificationCard
                    key={notification.id}
                    notification={notification}
                    onPress={() => handleNotificationPress(notification)}
                  />
                ))}
              </View>
              <Spacer height={Spacing.xl} />
            </>
          ) : null}

          {earlierNotifications.length > 0 ? (
            <>
              <ThemedText type="h4" style={styles.sectionTitle}>
                Earlier
              </ThemedText>
              <Spacer height={Spacing.sm} />
              <View style={styles.notificationsList}>
                {earlierNotifications.map((notification) => (
                  <NotificationCard
                    key={notification.id}
                    notification={notification}
                    onPress={() => handleNotificationPress(notification)}
                  />
                ))}
              </View>
            </>
          ) : null}
        </>
      ) : (
        <View
          style={[
            styles.emptyState,
            { backgroundColor: theme.backgroundDefault },
          ]}
        >
          <Feather name="bell-off" size={48} color={theme.textSecondary} />
          <Spacer height={Spacing.md} />
          <ThemedText
            type="body"
            style={{ color: theme.textSecondary, textAlign: "center" }}
          >
            No notifications yet
          </ThemedText>
          <ThemedText
            type="small"
            style={{
              color: theme.textSecondary,
              textAlign: "center",
              marginTop: Spacing.xs,
            }}
          >
            You will see task updates, leave approvals, and announcements here
          </ThemedText>
        </View>
      )}

      <Spacer height={Spacing["2xl"]} />
    </ScreenScrollView>
  );
}

const styles = StyleSheet.create({
  actionsRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: Spacing.lg,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  unreadBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.sm,
    marginTop: Spacing.md,
  },
  sectionTitle: {
    marginLeft: Spacing.xs,
  },
  notificationsList: {
    gap: Spacing.sm,
  },
  notificationCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    gap: Spacing.md,
    borderLeftWidth: 3,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  notificationContent: {
    flex: 1,
  },
  notificationTitle: {
    marginBottom: Spacing.xs,
  },
  timeText: {
    marginTop: Spacing.sm,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: Spacing.sm,
  },
  emptyState: {
    alignItems: "center",
    padding: Spacing["3xl"],
    borderRadius: BorderRadius.md,
    marginTop: Spacing.xl,
  },
});
