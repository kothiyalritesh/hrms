import React, { useState, useCallback, useRef } from "react";
import { StyleSheet, View, Pressable, RefreshControl, Platform, Alert } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useFocusEffect, useLinkTo, useNavigation } from "@react-navigation/native";
import { ScreenScrollView } from "@/components/ScreenScrollView";
import { PageHeader } from "@/components/PageHeader";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, Colors } from "@/constants/theme";
import Spacer from "@/components/Spacer";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { EventService } from "@/services/event.service";
import { getBusinessDateIST } from "@/utils/businessDate";
import { PaginationControls } from "@/components/PaginationControls";
import { DashboardSummaryService } from "@/services/dashboard-summary.service";
import {
  isOfficeExitNotification,
  officeExitEventIdFrom,
  requestOfficeExitPrompt,
} from "@/services/location/officeExitPrompt";

const PAGE_SIZE = 50;

interface DbNotification {
  id: string;
  title: string;
  message: string;
  read: boolean;
  created_at: string;
  type?: string;
  event_id?: string | null;
  acknowledged_at?: string | null;
  deep_link?: string | null;
}

const TYPE_META: Record<string, { icon: keyof typeof Feather.glyphMap; color: string }> = {
  location_alert:     { icon: "alert-triangle", color: "#C8252D" },
  location_reminder:  { icon: "map-pin",        color: "#D97706" },
  attendance_warning: { icon: "alert-circle",   color: "#D97706" },
  announcement:       { icon: "bell",           color: "#6D1B6D" },
  task:               { icon: "check-square",   color: "#1A5FD4" },
  leave:              { icon: "calendar",        color: "#12966E" },
};

function getType(title: string, type?: string) {
  if (type === "event_announcement") return "announcement";
  if (title?.includes("Location") || title?.includes("GPS") || title?.includes("No Location")) return "location_alert";
  if (title?.includes("Paused")) return "location_reminder";
  if (title?.includes("Attendance")) return "attendance_warning";
  return "announcement";
}

/**
 * notifications.created_at is written by the database default now(). When the
 * value arrives without a zone designator (timestamp WITHOUT time zone), it is
 * UTC wall-clock time; parsing it as device-local time put every notification
 * 5h30m in the past on Indian devices ("5h ago" for something just sent).
 */
function parseServerTime(value: string): Date {
  const text = String(value ?? "").trim();
  const hasZone = /(?:z|[+-]\d{2}(?::?\d{2})?)$/i.test(text);
  return new Date(hasZone ? text : `${text.replace(" ", "T")}Z`);
}

const IST_TIME = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});
const IST_DATE_TIME = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

function timeAgo(iso: string) {
  const date = parseServerTime(iso);
  if (Number.isNaN(date.getTime())) return "";
  const diff = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago · ${IST_TIME.format(date)}`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago · ${IST_TIME.format(date)}`;
  return IST_DATE_TIME.format(date);
}

function istDateOf(iso: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(parseServerTime(iso));
}

function NotifCard({
  notif,
  onPress,
  onAcknowledge,
}: {
  notif: DbNotification;
  onPress: () => void;
  onAcknowledge?: () => void;
}) {
  const { theme } = useTheme();
  const type  = getType(notif.title, notif.type);
  const meta  = TYPE_META[type] ?? TYPE_META.announcement;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: notif.read ? theme.backgroundDefault : theme.primary + "08",
          borderLeftColor: notif.read ? "transparent" : meta.color,
          opacity: pressed ? 0.82 : 1,
        },
      ]}
      onPress={onPress}
    >
      <View style={[styles.iconBox, { backgroundColor: meta.color + "18" }]}>
        <Feather name={meta.icon} size={19} color={meta.color} />
      </View>
      <View style={{ flex: 1 }}>
        <ThemedText type="small" style={{ fontWeight: notif.read ? "500" : "700", color: theme.text }}>
          {notif.title}
        </ThemedText>
        <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: 2, lineHeight: 17 }} numberOfLines={2}>
          {notif.message}
        </ThemedText>
        <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: 4 }}>
          {timeAgo(notif.created_at)}
        </ThemedText>
        {notif.event_id ? (
          <Pressable
            style={[
              styles.gotItButton,
              {
                backgroundColor: notif.acknowledged_at
                  ? Colors.light.success + "18"
                  : meta.color,
              },
            ]}
            disabled={!!notif.acknowledged_at}
            onPress={(event) => {
              event.stopPropagation();
              onAcknowledge?.();
            }}
          >
            <Feather
              name={notif.acknowledged_at ? "check-circle" : "check"}
              size={13}
              color={notif.acknowledged_at ? Colors.light.success : "#FFFFFF"}
            />
            <ThemedText
              type="caption"
              style={{
                color: notif.acknowledged_at
                  ? Colors.light.success
                  : "#FFFFFF",
                fontWeight: "700",
              }}
            >
              {notif.acknowledged_at ? "Seen" : "Got it"}
            </ThemedText>
          </Pressable>
        ) : null}
      </View>
      {!notif.read && <View style={[styles.dot, { backgroundColor: meta.color }]} />}
    </Pressable>
  );
}

export default function NotificationsScreen() {
  const { theme } = useTheme();
  const { user } = useAuth();
  const navigation = useNavigation<any>();
  const linkTo = useLinkTo();
  const [notifications, setNotifications] = useState<DbNotification[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const requestIdRef = useRef(0);
  const pageRef = useRef(page);
  pageRef.current = page;

  const loadData = useCallback(async () => {
    if (!user?.id) return;
    const requestId = ++requestIdRef.current;
    const from = page * PAGE_SIZE;
    const [pageResult, unreadResult] = await Promise.all([
      supabase
        .from("notifications")
        .select("id, title, message, read, created_at, type, event_id, acknowledged_at, deep_link", { count: "exact" })
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, from + PAGE_SIZE - 1),
      supabase.from("notifications").select("id", { count: "exact", head: true })
        .eq("user_id", user.id).eq("read", false),
    ]);
    if (requestId !== requestIdRef.current) return;
    if (pageResult.error || unreadResult.error) {
      const error = pageResult.error || unreadResult.error;
      Alert.alert("Unable to load notifications", error?.message || "Please try again.");
      return;
    }
    setNotifications((pageResult.data || []) as DbNotification[]);
    setTotal(pageResult.count ?? 0);
    setUnreadTotal(unreadResult.count ?? 0);
  }, [page, user?.id]);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));
  const loadDataRef = useRef(loadData);
  loadDataRef.current = loadData;

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      if (page !== 0) setPage(0);
      else await loadData();
    } finally {
      setRefreshing(false);
    }
  };

  useFocusEffect(useCallback(() => {
    if (!user?.id) return;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase
      .channel(`notifications-screen-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          if (debounce) clearTimeout(debounce);
          debounce = setTimeout(() => {
            if (pageRef.current !== 0) setPage(0);
            else void loadDataRef.current();
          }, 1000);
        },
      )
      .subscribe();
    return () => {
      if (debounce) clearTimeout(debounce);
      supabase.removeChannel(channel);
    };
  }, [user?.id]));

  const markAllRead = async () => {
    const { error } = await supabase.from("notifications").update({ read: true }).eq("user_id", user!.id).eq("read", false);
    if (error) {
      Alert.alert("Could not mark as read", error.message || "Please try again.");
      return;
    }
    DashboardSummaryService.invalidateEmployee(user!.id);
    loadData();
  };

  const clearAll = async () => {
    let confirmed: boolean;
    if (Platform.OS === "web") {
      confirmed = window.confirm("Clear all notifications?");
    } else {
      confirmed = await new Promise<boolean>((res) =>
        Alert.alert("Clear All", "Remove all notifications?", [
          { text: "Cancel", style: "cancel", onPress: () => res(false) },
          { text: "Clear", style: "destructive", onPress: () => res(true) },
        ], { cancelable: true, onDismiss: () => res(false) })
      );
    }
    if (!confirmed) return;
    // Only clear the list once the server confirms the rows are gone; otherwise
    // they would reappear on the next refresh.
    const { error } = await supabase.from("notifications").delete().eq("user_id", user!.id);
    if (error) {
      const msg = error.message || "Please try again.";
      if (Platform.OS === "web") window.alert(`Could not clear notifications: ${msg}`);
      else Alert.alert("Could not clear notifications", msg);
      return;
    }
    DashboardSummaryService.invalidateEmployee(user!.id);
    setPage(0);
    setNotifications([]);
    setTotal(0);
    setUnreadTotal(0);
  };

  const onPress = async (notif: DbNotification) => {
    if (!notif.read) {
      const { error } = await supabase.from("notifications").update({ read: true }).eq("id", notif.id);
      if (!error) {
        setNotifications((prev) => prev.map((n) => n.id === notif.id ? { ...n, read: true } : n));
        setUnreadTotal((current) => Math.max(0, current - 1));
      }
    }
    // "Tell us why you left the office": open the reason form directly.
    if (isOfficeExitNotification({ type: notif.type, deep_link: notif.deep_link })) {
      requestOfficeExitPrompt(officeExitEventIdFrom({ deep_link: notif.deep_link }));
      return;
    }
    if (notif.event_id) {
      navigation.getParent()?.navigate("TasksTab", {
        screen: "Tasks",
        params: { eventId: notif.event_id },
      });
      return;
    }
    // Server notifications carry the screen to open, e.g. /HRMS/admin/live-tracking.
    const link = notif.deep_link?.trim();
    if (link && link.startsWith("/HRMS/") && !link.startsWith("/HRMS/notifications")) {
      try {
        linkTo(Platform.OS === "web" ? link : link.replace(/^\/HRMS/, ""));
      } catch {
        // Unknown route: the notification stays readable here.
      }
    }
  };

  const acknowledge = async (notif: DbNotification) => {
    if (!user?.id || !notif.event_id || notif.acknowledged_at) return;
    try {
      const acknowledgedAt = await EventService.acknowledgeEvent(
        notif.event_id,
        user.id,
      );
      setNotifications((prev) =>
        prev.map((item) =>
          item.event_id === notif.event_id
            ? { ...item, read: true, acknowledged_at: acknowledgedAt }
            : item,
        ),
      );
      if (!notif.read) setUnreadTotal((current) => Math.max(0, current - 1));
    } catch (error: any) {
      Alert.alert("Unable to acknowledge", error?.message || "Please try again.");
    }
  };

  const todayDateIST = getBusinessDateIST();
  const today = notifications.filter((n) => istDateOf(n.created_at) === todayDateIST);
  const earlier = notifications.filter((n) => istDateOf(n.created_at) !== todayDateIST);

  return (
    <View style={{ flex: 1, backgroundColor: theme.backgroundRoot }}>
      <PageHeader
        title="Notifications"
        subtitle={unreadTotal > 0 ? `${unreadTotal} unread` : "All caught up"}
      />

      <ScreenScrollView
        noPaddingTop
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />}
        contentContainerStyle={styles.content}
      >
        <Spacer height={Spacing.lg} />
        <PaginationControls page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />

        {notifications.length > 0
          ? <>
              {/* Action row */}
              <View style={styles.actions}>
                {unreadTotal > 0
                  ? <Pressable style={styles.actionBtn} onPress={markAllRead}>
                      <Feather name="check-circle" size={15} color={theme.primary} />
                      <ThemedText type="small" style={{ color: theme.primary }}>Mark all read</ThemedText>
                    </Pressable>
                  : null
                }
                <Pressable style={styles.actionBtn} onPress={clearAll}>
                  <Feather name="trash-2" size={15} color={Colors.light.error} />
                  <ThemedText type="small" style={{ color: Colors.light.error }}>Clear all</ThemedText>
                </Pressable>
              </View>

              {today.length > 0
                ? <>
                    <ThemedText type="small" style={[styles.groupLabel, { color: theme.textSecondary }]}>TODAY</ThemedText>
                    <View style={styles.group}>
                      {today.map((n) => (
                        <NotifCard
                          key={n.id}
                          notif={n}
                          onPress={() => onPress(n)}
                          onAcknowledge={() => acknowledge(n)}
                        />
                      ))}
                    </View>
                    <Spacer height={Spacing.xl} />
                  </>
                : null
              }

              {earlier.length > 0
                ? <>
                    <ThemedText type="small" style={[styles.groupLabel, { color: theme.textSecondary }]}>EARLIER</ThemedText>
                    <View style={styles.group}>
                      {earlier.map((n) => (
                        <NotifCard
                          key={n.id}
                          notif={n}
                          onPress={() => onPress(n)}
                          onAcknowledge={() => acknowledge(n)}
                        />
                      ))}
                    </View>
                  </>
                : null
              }
            </>
          : <View style={[styles.empty, { backgroundColor: theme.backgroundDefault }]}>
              <Feather name="bell-off" size={44} color={theme.textSecondary} />
              <Spacer height={Spacing.md} />
              <ThemedText type="body" style={{ color: theme.textSecondary, textAlign: "center" }}>No notifications yet</ThemedText>
            </View>
        }
        <Spacer height={Spacing["2xl"]} />
      </ScreenScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  content:    { paddingHorizontal: Spacing.lg },
  actions:    { flexDirection: "row", justifyContent: "flex-end", gap: Spacing.lg, marginBottom: Spacing.md },
  actionBtn:  { flexDirection: "row", alignItems: "center", gap: 5 },
  groupLabel: { fontWeight: "700", fontSize: 11, letterSpacing: 0.8, marginBottom: Spacing.sm },
  group:      { gap: Spacing.sm },
  card: {
    flexDirection: "row", alignItems: "flex-start",
    padding: Spacing.lg, borderRadius: 14, gap: Spacing.md, borderLeftWidth: 3,
    ...(Platform.OS === "web"
      ? { boxShadow: "0 2px 8px rgba(109,27,109,0.07)" }
      : { shadowColor: "#6D1B6D", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 8, elevation: 2 }),
  },
  iconBox: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  dot:     { width: 8, height: 8, borderRadius: 4, marginTop: 4 },
  gotItButton: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: BorderRadius.full,
  },
  empty:   { alignItems: "center", padding: Spacing["3xl"], borderRadius: 14, marginTop: Spacing.xl },
});
