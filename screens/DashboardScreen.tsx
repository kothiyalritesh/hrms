import React, { useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  Pressable,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Image,
  Platform,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { ScreenScrollView } from "@/components/ScreenScrollView";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useAuth } from "@/contexts/AuthContext";
import { Spacing, BorderRadius, Colors } from "@/constants/theme";
import Spacer from "@/components/Spacer";
import { supabase } from "@/lib/supabase";
import { AttendanceService, GeoFenceError } from "@/services/attendance.service";
import * as Location from "expo-location";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getCurrentGPS } from "@/utils/gps";
import { FieldVisitService } from "@/services/field-visit.service";
import { LeaveBalanceService } from "@/services/leave-balance.service";

type DashboardScreenProps = { navigation: NativeStackNavigationProp<any> };

interface Task {
  id: string;
  title: string;
  status: string;
  priority: "high" | "medium" | "low";
  due_date: string;
  type?: string;
}

function StatCard({
  icon, title, value, subtitle, color, onPress,
}: {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  value: string | number;
  subtitle?: string;
  color: string;
  onPress?: () => void;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      style={({ pressed }) => [styles.statCard, { backgroundColor: theme.backgroundDefault, opacity: pressed ? 0.85 : 1 }]}
      onPress={onPress}
    >
      <View style={[styles.statIconContainer, { backgroundColor: color + "18" }]}>
        <Feather name={icon} size={20} color={color} />
      </View>
      <ThemedText type="caption" style={{ color: theme.textSecondary, marginBottom: 2 }}>{title}</ThemedText>
      <ThemedText type="h3" style={{ color: theme.text }}>{value}</ThemedText>
      {subtitle ? <ThemedText type="caption" style={{ color: theme.textSecondary, fontSize: 11 }}>{subtitle}</ThemedText> : null}
    </Pressable>
  );
}

function QuickAction({ icon, label, color, onPress }: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  color: string;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      style={({ pressed }) => [styles.quickAction, { backgroundColor: theme.backgroundDefault, opacity: pressed ? 0.85 : 1 }]}
      onPress={onPress}
    >
      <View style={[styles.quickActionIcon, { backgroundColor: color }]}>
        <Feather name={icon} size={18} color="#FFFFFF" />
      </View>
      <ThemedText type="caption" style={[styles.quickActionLabel, { color: theme.textSecondary }]} numberOfLines={2}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

export default function DashboardScreen({ navigation }: DashboardScreenProps) {
  const { theme } = useTheme();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);
  const [todayAttendance, setTodayAttendance] = useState<any>(null);
  const [pendingTasks, setPendingTasks] = useState<Task[]>([]);
  const [leaveBalance, setLeaveBalance] = useState({ sick: 0, casual: 0, earned: 0 });
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [pendingVisits, setPendingVisits] = useState(0);
  const [checkInMsg, setCheckInMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [offices, setOffices] = useState<any[]>([]);
  const [showOfficePicker, setShowOfficePicker] = useState(false);

  const loadData = useCallback(async () => {
    if (!user?.id) return;
    try {
      const today = new Date().toISOString().split("T")[0];

      // Load attendance first — most critical
      const attendanceRes = await supabase
        .from("attendance_logs")
        .select("*")
        .eq("user_id", user.id)
        .eq("date", today)
        .maybeSingle();
      console.log("[DASHBOARD] attendance loaded:", !!attendanceRes.data);
      setTodayAttendance(attendanceRes.data || null);

      // Load live leave balance from DB
      try {
        const lb = await LeaveBalanceService.getOrCreate(user.id);
        if (lb) {
          const rem = LeaveBalanceService.remaining(lb);
          setLeaveBalance({ sick: rem.sick, casual: rem.casual, earned: rem.earned });
        }
      } catch (e) { console.warn("[DASHBOARD] leave balance error:", e); }

      // Load tasks and notifications — non-critical
      const [tasksRes, notifRes] = await Promise.all([
        supabase.from("tasks").select("*").eq("assigned_to", user.id).in("status", ["pending", "in_progress"]),
        supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("read", false),
      ]);
      setPendingTasks(tasksRes.data || []);
      setUnreadNotifications(notifRes.count || 0);

      // Load field visits — non-critical, may fail if table missing
      try {
        const { data: fvData } = await FieldVisitService.getPendingVisits(user.id);
        setPendingVisits(fvData?.length || 0);
      } catch { setPendingVisits(0); }

    } catch (e) {
      console.warn("loadData error:", e);
    }
  }, [user?.id]);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const onRefresh = async () => { setRefreshing(true); await loadData(); setRefreshing(false); };

  const getGreeting = () => {
    const h = new Date().getHours();
    if (h < 12) return "Good Morning";
    if (h < 17) return "Good Afternoon";
    return "Good Evening";
  };

  const isCheckedIn = !!(todayAttendance?.checkin_time || todayAttendance?.checkIn || todayAttendance?.check_in);
  const isCheckedOut = !!(todayAttendance?.checkout_time || todayAttendance?.checkOut || todayAttendance?.check_out);

  const handleAttendanceToggle = async () => {
    console.log("[CHECKIN] Step 1: button pressed");
    if (!user?.id) { Alert.alert("Error", "You must be logged in."); return; }
    console.log("[CHECKIN] Step 2: user ok -", user.id);

    if (isCheckedIn && isCheckedOut) {
      Alert.alert("Attendance Complete", "You have already checked in and out for today.");
      return;
    }

    // ── Check Out ──────────────────────────────────────────────────────────
    if (isCheckedIn && !isCheckedOut) {
      setAttendanceLoading(true);
      try {
        const gps = await getCurrentGPS();
        await AttendanceService.checkOut({ userId: user.id, location: gps ?? undefined });
        await loadData();
        const now = new Date();
        const msg = `Checked out at ${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
        if (typeof window !== "undefined") window.alert(msg);
        else Alert.alert("Checked Out", msg);
      } catch (e: any) {
        const errMsg = e?.message || "Check-out failed. Please try again.";
        if (typeof window !== "undefined") window.alert(errMsg);
        else Alert.alert("Error", errMsg);
      } finally {
        setAttendanceLoading(false);
      }
      return;
    }

    setAttendanceLoading(true);
    try {
      console.log("[CHECKIN] Step 3: getting GPS...");
      const gps = await getCurrentGPS();
      console.log("[CHECKIN] Step 4: GPS obtained");

      if (!gps) {
        const msg = "Could not get your location. Please allow location access in your browser address bar and try again.";
        if (typeof window !== "undefined") window.alert(msg);
        else Alert.alert("Location Required", msg);
        return;
      }

      console.log("[CHECKIN] Step 5: fetching offices...");
      const { OfficeService } = await import("@/services/office.service");
      const offices = await OfficeService.getAllOffices();
      console.log("[CHECKIN] Step 6: offices loaded");

      if (!offices || offices.length === 0) {
        Alert.alert("No Offices", "No offices configured. Contact your admin.");
        return;
      }

      console.log("[CHECKIN] Step 7: calling officeCheckIn...");
      // Pass any office — officeCheckIn will auto-detect the nearest one
      await AttendanceService.officeCheckIn({
        userId: user.id,
        office: offices[0],
        location: gps,
        distance: 0,
      });
      console.log("[CHECKIN] Step 8: officeCheckIn SUCCESS");

      await loadData();
      const now = new Date();
      const successMsg = `Checked in at ${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
      if (typeof window !== "undefined") window.alert(successMsg);
      else Alert.alert("Checked In", successMsg);

    } catch (e: any) {
      console.log("[CHECKIN] ERROR");
      if (e?.name === "GeoFenceError") {
        const msg = `You are ${Math.round(e.distanceMetres)}m away from ${e.officeName}.\n\nYou must be within ${e.radiusMetres}m to check in. Please go to your office and try again.`;
        if (typeof window !== "undefined") window.alert(msg);
        else Alert.alert("Not at Office", msg);
        return;
      }
      const errMsg = e?.message || "Check-in failed. Please try again.";
      if (typeof window !== "undefined") window.alert(errMsg);
      else Alert.alert("Error", errMsg);
    } finally {
      console.log("[CHECKIN] finally: setAttendanceLoading false");
      setAttendanceLoading(false);
    }
  };

  const totalLeave = leaveBalance.sick + leaveBalance.casual + leaveBalance.earned;

  const attendanceLabel = isCheckedIn && isCheckedOut
    ? "Completed"
    : isCheckedIn
    ? "Check Out"
    : "Check In";

  const attendanceBtnColor = isCheckedIn && isCheckedOut
    ? Colors.light.success
    : isCheckedIn
    ? Colors.light.info
    : theme.primary;

  const attendanceBtnIcon: keyof typeof Feather.glyphMap = isCheckedIn && isCheckedOut
    ? "check-circle"
    : isCheckedIn
    ? "log-out"
    : "log-in";

  return (
    <ScreenScrollView
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />}
    >
      {/* Header */}
      <View style={[styles.header, { backgroundColor: "#FFFFFF", borderBottomWidth: 1, borderBottomColor: "#F0E6F0", paddingTop: insets.top + Spacing.sm }]}>
        <View style={styles.headerTop}>
          <Image source={require("../assets/images/logo.png")} style={styles.headerLogo} resizeMode="contain" />
          <View style={{ flexDirection: "row", gap: 8 }}>
          <Pressable
            style={({ pressed }) => [styles.notificationBtn, { opacity: pressed ? 0.7 : 1 }]}
            onPress={() => navigation.navigate("Notifications")}
          >
            <Feather name="bell" size={22} color={theme.primary} />
            {unreadNotifications > 0 ? (
              <View style={styles.notificationBadge}>
                <ThemedText type="caption" style={styles.badgeText}>
                  {unreadNotifications > 9 ? "9+" : unreadNotifications}
                </ThemedText>
              </View>
            ) : null}
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.notificationBtn, { opacity: pressed ? 0.7 : 1 }]}
            onPress={() => navigation.navigate("Diagnostic")}
          >
            <Feather name="tool" size={22} color="#999" />
          </Pressable>
        </View>
        </View>
        <Spacer height={Spacing.sm} />
        <ThemedText type="small" style={{ color: theme.textSecondary }}>{getGreeting()},</ThemedText>
        <ThemedText type="h2" style={{ color: "#000000" }}>{user?.name || "User"}</ThemedText>
        <ThemedText type="caption" style={{ color: theme.textSecondary, marginTop: 2 }}>{user?.role?.replace(/_/g, " ")}</ThemedText>

        <Spacer height={Spacing.xl} />

        {/* Check In / Check Out Button */}
        <Pressable
          onPress={handleAttendanceToggle}
          disabled={attendanceLoading || (isCheckedIn && isCheckedOut)}
          style={({ pressed }) => [
            styles.attendanceToggleBtn,
            {
              backgroundColor: isCheckedIn && isCheckedOut
                ? Colors.light.successBg
                : theme.primary,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          {attendanceLoading ? (
            <ActivityIndicator color={isCheckedIn && isCheckedOut ? Colors.light.success : "#fff"} size="small" />
          ) : (
            <>
              <Feather name={attendanceBtnIcon} size={20} color={isCheckedIn && isCheckedOut ? Colors.light.success : "#fff"} />
              <ThemedText type="body" style={[styles.attendanceToggleText, { color: isCheckedIn && isCheckedOut ? Colors.light.success : "#fff" }]}>
                {attendanceLabel}
              </ThemedText>
              {isCheckedIn && !isCheckedOut ? (
                <View style={[styles.liveIndicator, { backgroundColor: Colors.light.success }]} />
              ) : null}
            </>
          )}
        </Pressable>

        {isCheckedIn ? (
          <ThemedText type="caption" style={[styles.checkinTimeText, { color: theme.textSecondary }]}>
            {isCheckedOut
              ? `In: ${(todayAttendance?.checkin_time || todayAttendance?.checkIn || "").substring(11, 16)}  ·  Out: ${(todayAttendance?.checkout_time || todayAttendance?.checkOut || "").substring(11, 16)}`
              : `Checked in at ${(todayAttendance?.checkin_time || todayAttendance?.checkIn || "").substring(11, 16)}`
            }
          </ThemedText>
        ) : null}

        {/* Web: keep tab open warning when checked in */}
        {Platform.OS === "web" && isCheckedIn && !isCheckedOut && (
          <View style={s3.keepOpenBanner}>
            <Feather name="wifi" size={13} color="#92400E" />
            <ThemedText type="caption" style={s3.keepOpenText}>
              GPS tracking active — keep this tab open. Closing the browser stops location updates.
            </ThemedText>
          </View>
        )}

        <Spacer height={Spacing.lg} />
      </View>

      <View style={styles.content}>
        <Spacer height={Spacing.xl} />

        {/* Pending Field Visits Alert */}
        {pendingVisits > 0 && (
          <TouchableOpacity
            style={s2.visitAlert}
            onPress={() => navigation.navigate("FieldVisits")}
          >
            <View style={s2.visitAlertLeft}>
              <Feather name="alert-circle" size={18} color="#D97706" />
              <View>
                <ThemedText style={s2.visitAlertTitle}>
                  {pendingVisits} Field Visit{pendingVisits > 1 ? "s" : ""} Need Attention
                </ThemedText>
                <ThemedText style={s2.visitAlertSub}>
                  Tap to check in / check out at your location
                </ThemedText>
              </View>
            </View>
            <Feather name="chevron-right" size={16} color="#D97706" />
          </TouchableOpacity>
        )}

        {/* Stats */}
        <View style={styles.statsGrid}>
          <StatCard
            icon="clock"
            title="Attendance"
            value={isCheckedIn && isCheckedOut ? "Done" : isCheckedIn ? "Active" : "Not Marked"}
            subtitle={isCheckedIn ? "Today" : "Tap to check in"}
            color={isCheckedIn ? Colors.light.success : Colors.light.warning}
            onPress={() => navigation.navigate("HomeTab")}
          />
          <StatCard
            icon="check-square"
            title="Pending Tasks"
            value={pendingTasks.length}
            subtitle="To complete"
            color={theme.primary}
            onPress={() => navigation.navigate("TasksTab")}
          />
          <StatCard
            icon="calendar"
            title="Leave Balance"
            value={totalLeave}
            subtitle="Days remaining"
            color={Colors.light.success}
            onPress={() => navigation.navigate("LeaveScreen")}
          />
          <StatCard
            icon="map-pin"
            title="Site Visits"
            value={pendingVisits}
            subtitle="Pending today"
            color={Colors.light.warning}
            onPress={() => navigation.navigate("FieldVisits")}
          />
        </View>

        <Spacer height={Spacing.xl} />

        {/* Quick Actions */}
        <ThemedText type="h3" style={{ color: theme.text }}>Quick Actions</ThemedText>
        <Spacer height={Spacing.md} />
        <View style={styles.quickActionsGrid}>
          <QuickAction icon="file-plus" label="Apply Leave" color={Colors.light.success} onPress={() => navigation.navigate("LeaveScreen")} />
          <QuickAction icon="upload" label="Upload Doc" color={Colors.light.warning} onPress={() => navigation.navigate("DocumentsScreen")} />
          <QuickAction icon="briefcase" label="On-Duty" color="#8B5CF6" onPress={() => navigation.navigate("OnDutyRequest")} />
          <QuickAction icon="home" label="Projects" color={Colors.light.info} onPress={() => navigation.navigate("ProjectsScreen")} />
          <QuickAction icon="map-pin" label="Field Visits" color="#60045d" onPress={() => navigation.navigate("FieldVisits")} />
          <QuickAction icon="file-text" label="My Report" color="#EC4899" onPress={() => navigation.navigate("EmployeeMonthlyReport")} />
        </View>

        <Spacer height={Spacing.xl} />

        {/* Pending Tasks */}
        <View style={styles.sectionHeader}>
          <ThemedText type="h3" style={{ color: theme.text }}>Pending Tasks</ThemedText>
          <Pressable onPress={() => navigation.navigate("TasksTab")}>
            <ThemedText type="small" style={{ color: theme.primary }}>View All</ThemedText>
          </Pressable>
        </View>
        <Spacer height={Spacing.md} />

        {pendingTasks.length > 0 ? (
          <View style={{ gap: Spacing.sm }}>
            {pendingTasks.slice(0, 5).map((task) => {
              const priorityColors = { high: Colors.light.error, medium: Colors.light.warning, low: Colors.light.success };
              const pc = priorityColors[task.priority] || Colors.light.info;
              return (
                <Pressable
                  key={task.id}
                  style={({ pressed }) => [styles.taskItem, { backgroundColor: theme.backgroundDefault, opacity: pressed ? 0.85 : 1 }]}
                  onPress={() => navigation.navigate("TasksTab", { taskId: task.id })}
                >
                  <View style={[styles.taskPriorityBar, { backgroundColor: pc }]} />
                  <View style={{ flex: 1 }}>
                    <ThemedText type="body" numberOfLines={1} style={{ color: theme.text }}>{task.title}</ThemedText>
                    <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                      Due: {task.due_date ? new Date(task.due_date).toLocaleDateString() : "No date"}
                    </ThemedText>
                  </View>
                  <View style={[styles.priorityBadge, { backgroundColor: pc + "20" }]}>
                    <ThemedText type="caption" style={{ color: pc, fontWeight: "600", fontSize: 10 }}>
                      {task.priority?.toUpperCase()}
                    </ThemedText>
                  </View>
                </Pressable>
              );
            })}
          </View>
        ) : (
          <View style={[styles.emptyState, { backgroundColor: theme.backgroundDefault }]}>
            <Feather name="check-circle" size={32} color={Colors.light.success} />
            <Spacer height={Spacing.sm} />
            <ThemedText type="body" style={{ color: theme.textSecondary }}>All caught up! No pending tasks.</ThemedText>
          </View>
        )}

        <Spacer height={Spacing["2xl"]} />
      </View>
    </ScreenScrollView>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.lg,
  },
  headerTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  headerLogo: { width: 40, height: 40, borderRadius: BorderRadius.sm },
  notificationBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", position: "relative" },
  notificationBadge: {
    position: "absolute", top: 4, right: 4,
    minWidth: 16, height: 16, borderRadius: 8,
    backgroundColor: Colors.light.error,
    alignItems: "center", justifyContent: "center", paddingHorizontal: 3,
  },
  badgeText: { color: "#FFFFFF", fontSize: 9, fontWeight: "700" },
  attendanceToggleBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    paddingVertical: 14,
    paddingHorizontal: Spacing.xl,
    borderRadius: BorderRadius.full,
    alignSelf: "center",
    minWidth: 180,
    ...(Platform.OS === "web"
      ? { boxShadow: "0 2px 6px rgba(0,0,0,0.15)" }
      : { shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 6, elevation: 4 }),
  },
  attendanceToggleText: { fontWeight: "700", fontSize: 16 },
  liveIndicator: { width: 8, height: 8, borderRadius: 4 },
  checkinTimeText: { color: "rgba(255,255,255,0.8)", textAlign: "center", marginTop: Spacing.sm },
  content: { paddingHorizontal: Spacing.xl },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.md },
  statCard: {
    width: "48%", flexGrow: 1, padding: Spacing.lg,
    borderRadius: BorderRadius.lg, minWidth: 150,
    ...(Platform.OS === "web"
      ? { boxShadow: "0 2px 6px rgba(96,4,93,0.06)" }
      : { shadowColor: "#60045d", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2 }),
  },
  statIconContainer: { width: 40, height: 40, borderRadius: BorderRadius.sm, alignItems: "center", justifyContent: "center", marginBottom: Spacing.sm },
  quickActionsGrid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  quickAction: {
    width: "30%", flexGrow: 1, alignItems: "center", padding: Spacing.md,
    borderRadius: BorderRadius.lg, minWidth: 90,
    ...(Platform.OS === "web"
      ? { boxShadow: "0 1px 4px rgba(96,4,93,0.05)" }
      : { shadowColor: "#60045d", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 }),
  },
  quickActionIcon: { width: 44, height: 44, borderRadius: BorderRadius.full, alignItems: "center", justifyContent: "center", marginBottom: Spacing.sm },
  quickActionLabel: { textAlign: "center", fontSize: 11, fontWeight: "500" },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  taskItem: {
    flexDirection: "row", alignItems: "center", borderRadius: BorderRadius.lg,
    overflow: "hidden", gap: Spacing.md,
    ...(Platform.OS === "web"
      ? { boxShadow: "0 1px 4px rgba(96,4,93,0.05)" }
      : { shadowColor: "#60045d", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 }),
  },
  taskPriorityBar: { width: 4, height: "100%", minHeight: 56 },
  priorityBadge: { paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs, borderRadius: BorderRadius.xs, marginRight: Spacing.md },
  emptyState: { alignItems: "center", padding: Spacing.xl, borderRadius: BorderRadius.lg },
});

const s2 = StyleSheet.create({
  visitAlert: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: "#FEF3C7", borderWidth: 1.5, borderColor: "#F59E0B",
    borderRadius: 12, padding: 14, marginBottom: Spacing.lg,
  },
  visitAlertLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  visitAlertTitle: { fontSize: 13, fontWeight: "700", color: "#92400E" },
  visitAlertSub: { fontSize: 11, color: "#B45309", marginTop: 2 },
});

const s3 = StyleSheet.create({
  keepOpenBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    backgroundColor: "#FEF3C7",
    borderLeftWidth: 3,
    borderLeftColor: "#F59E0B",
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
  },
  keepOpenText: {
    flex: 1,
    color: "#92400E",
    fontSize: 12,
  },
});
