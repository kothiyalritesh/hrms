import React, { useState, useEffect, useCallback } from "react";
import { StyleSheet, View, Pressable, RefreshControl } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { ScreenScrollView } from "@/components/ScreenScrollView";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useAuth } from "@/contexts/AuthContext";
import { Spacing, BorderRadius, Colors, Shadows } from "@/constants/theme";
import Spacer from "@/components/Spacer";
import { 
  AttendanceStorage, 
  TaskStorage, 
  LeaveStorage, 
  NotificationStorage,
  AttendanceRecord,
  Task 
} from "@/utils/storage";

type DashboardScreenProps = {
  navigation: NativeStackNavigationProp<any>;
};

interface StatCardProps {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  value: string | number;
  subtitle?: string;
  color: string;
  onPress?: () => void;
}

function StatCard({ icon, title, value, subtitle, color, onPress }: StatCardProps) {
  const { theme } = useTheme();
  
  return (
    <Pressable 
      style={({ pressed }) => [
        styles.statCard, 
        { backgroundColor: theme.backgroundDefault, opacity: pressed ? 0.8 : 1 }
      ]}
      onPress={onPress}
    >
      <View style={[styles.statIconContainer, { backgroundColor: color + "20" }]}>
        <Feather name={icon} size={20} color={color} />
      </View>
      <ThemedText type="caption" style={[styles.statTitle, { color: theme.textSecondary }]}>
        {title}
      </ThemedText>
      <ThemedText type="h3" style={styles.statValue}>{value}</ThemedText>
      {subtitle ? (
        <ThemedText type="caption" style={[styles.statSubtitle, { color: theme.textSecondary }]}>
          {subtitle}
        </ThemedText>
      ) : null}
    </Pressable>
  );
}

interface QuickActionProps {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  color: string;
  onPress: () => void;
}

function QuickAction({ icon, label, color, onPress }: QuickActionProps) {
  const { theme } = useTheme();
  
  return (
    <Pressable 
      style={({ pressed }) => [
        styles.quickAction,
        { backgroundColor: theme.backgroundDefault, opacity: pressed ? 0.8 : 1 }
      ]}
      onPress={onPress}
    >
      <View style={[styles.quickActionIcon, { backgroundColor: color }]}>
        <Feather name={icon} size={20} color="#FFFFFF" />
      </View>
      <ThemedText type="caption" style={styles.quickActionLabel} numberOfLines={2}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

interface TaskItemProps {
  task: Task;
  onPress: () => void;
}

function TaskItem({ task, onPress }: TaskItemProps) {
  const { theme } = useTheme();
  const priorityColors = {
    high: Colors.light.error,
    medium: Colors.light.warning,
    low: Colors.light.success,
  };
  
  return (
    <Pressable 
      style={({ pressed }) => [
        styles.taskItem,
        { backgroundColor: theme.backgroundDefault, opacity: pressed ? 0.8 : 1 }
      ]}
      onPress={onPress}
    >
      <View style={styles.taskContent}>
        <ThemedText type="body" style={styles.taskTitle} numberOfLines={1}>
          {task.title}
        </ThemedText>
        <ThemedText type="caption" style={{ color: theme.textSecondary }}>
          Due: {new Date(task.deadline).toLocaleDateString()}
        </ThemedText>
      </View>
      <View style={[styles.priorityBadge, { backgroundColor: priorityColors[task.priority] + "20" }]}>
        <ThemedText type="caption" style={{ color: priorityColors[task.priority], fontWeight: "600" }}>
          {task.priority.toUpperCase()}
        </ThemedText>
      </View>
    </Pressable>
  );
}

export default function DashboardScreen({ navigation }: DashboardScreenProps) {
  const { theme, isDark } = useTheme();
  const { user } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [todayAttendance, setTodayAttendance] = useState<AttendanceRecord | null>(null);
  const [pendingTasks, setPendingTasks] = useState<Task[]>([]);
  const [leaveBalance, setLeaveBalance] = useState({ sick: 12, casual: 12, earned: 15 });
  const [unreadNotifications, setUnreadNotifications] = useState(0);

  const loadData = useCallback(async () => {
    const [attendance, tasks, balance, notifCount] = await Promise.all([
      AttendanceStorage.getTodayRecord(),
      TaskStorage.getByStatus("pending"),
      LeaveStorage.getBalance(),
      NotificationStorage.getUnreadCount(),
    ]);
    setTodayAttendance(attendance);
    setPendingTasks(tasks.slice(0, 3));
    setLeaveBalance(balance);
    setUnreadNotifications(notifCount);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good Morning";
    if (hour < 17) return "Good Afternoon";
    return "Good Evening";
  };

  const getAttendanceStatus = () => {
    if (!todayAttendance) return { status: "Not Marked", color: Colors.light.warning };
    if (todayAttendance.checkIn && !todayAttendance.checkOut) {
      return { status: "Checked In", color: Colors.light.success };
    }
    if (todayAttendance.checkIn && todayAttendance.checkOut) {
      return { status: "Completed", color: Colors.light.info };
    }
    return { status: todayAttendance.status, color: Colors.light.textSecondary };
  };

  const attendanceInfo = getAttendanceStatus();
  const totalLeave = leaveBalance.sick + leaveBalance.casual + leaveBalance.earned;

  return (
    <ScreenScrollView
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />
      }
    >
      <View style={styles.header}>
        <View>
          <ThemedText type="small" style={{ color: theme.textSecondary }}>
            {getGreeting()},
          </ThemedText>
          <ThemedText type="h2">{user?.name || "User"}</ThemedText>
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            {user?.designation} - {user?.department}
          </ThemedText>
        </View>
        <Pressable 
          style={({ pressed }) => [
            styles.notificationBtn,
            { backgroundColor: theme.backgroundDefault, opacity: pressed ? 0.8 : 1 }
          ]}
          onPress={() => navigation.navigate("Notifications")}
        >
          <Feather name="bell" size={22} color={theme.text} />
          {unreadNotifications > 0 ? (
            <View style={[styles.notificationBadge, { backgroundColor: Colors.light.error }]}>
              <ThemedText type="caption" style={styles.badgeText}>
                {unreadNotifications > 9 ? "9+" : unreadNotifications}
              </ThemedText>
            </View>
          ) : null}
        </Pressable>
      </View>

      <Spacer height={Spacing.xl} />

      <View style={styles.statsGrid}>
        <StatCard
          icon="clock"
          title="Attendance"
          value={attendanceInfo.status}
          subtitle={todayAttendance?.checkIn ? `In: ${new Date(todayAttendance.checkIn).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Tap to mark"}
          color={attendanceInfo.color}
          onPress={() => navigation.navigate("AttendanceTab")}
        />
        <StatCard
          icon="check-square"
          title="Pending Tasks"
          value={pendingTasks.length}
          subtitle="To complete"
          color={Colors.light.primary}
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
          value={pendingTasks.filter(t => t.type === "site_visit").length}
          subtitle="Scheduled"
          color={Colors.light.warning}
          onPress={() => navigation.navigate("TasksTab")}
        />
      </View>

      <Spacer height={Spacing.xl} />

      <View style={styles.sectionHeader}>
        <ThemedText type="h3">Quick Actions</ThemedText>
      </View>
      <Spacer height={Spacing.md} />
      <View style={styles.quickActionsRow}>
        <QuickAction
          icon="log-in"
          label="Mark Attendance"
          color={Colors.light.primary}
          onPress={() => navigation.navigate("AttendanceTab")}
        />
        <QuickAction
          icon="file-plus"
          label="Apply Leave"
          color={Colors.light.success}
          onPress={() => navigation.navigate("LeaveScreen")}
        />
        <QuickAction
          icon="upload"
          label="Upload Doc"
          color={Colors.light.warning}
          onPress={() => navigation.navigate("DocumentsScreen")}
        />
        <QuickAction
          icon="home"
          label="Projects"
          color={Colors.light.info}
          onPress={() => navigation.navigate("ProjectsScreen")}
        />
      </View>

      <Spacer height={Spacing.xl} />

      <View style={styles.sectionHeader}>
        <ThemedText type="h3">Pending Tasks</ThemedText>
        <Pressable onPress={() => navigation.navigate("TasksTab")}>
          <ThemedText type="small" style={{ color: theme.primary }}>View All</ThemedText>
        </Pressable>
      </View>
      <Spacer height={Spacing.md} />
      
      {pendingTasks.length > 0 ? (
        <View style={styles.tasksList}>
          {pendingTasks.map(task => (
            <TaskItem 
              key={task.id} 
              task={task} 
              onPress={() => navigation.navigate("TasksTab", { taskId: task.id })} 
            />
          ))}
        </View>
      ) : (
        <View style={[styles.emptyState, { backgroundColor: theme.backgroundDefault }]}>
          <Feather name="check-circle" size={32} color={Colors.light.success} />
          <Spacer height={Spacing.sm} />
          <ThemedText type="body" style={{ color: theme.textSecondary }}>
            All caught up! No pending tasks.
          </ThemedText>
        </View>
      )}

      <Spacer height={Spacing["2xl"]} />
    </ScreenScrollView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  notificationBtn: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  notificationBadge: {
    position: "absolute",
    top: 6,
    right: 6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  badgeText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "700",
  },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.md,
  },
  statCard: {
    width: "48%",
    flexGrow: 1,
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    minWidth: 150,
  },
  statIconContainer: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.sm,
  },
  statTitle: {
    marginBottom: Spacing.xs,
  },
  statValue: {
    marginBottom: 2,
  },
  statSubtitle: {
    fontSize: 11,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  quickActionsRow: {
    flexDirection: "row",
    gap: Spacing.md,
  },
  quickAction: {
    flex: 1,
    alignItems: "center",
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  quickActionIcon: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.sm,
  },
  quickActionLabel: {
    textAlign: "center",
    fontSize: 11,
  },
  tasksList: {
    gap: Spacing.sm,
  },
  taskItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    gap: Spacing.md,
  },
  taskContent: {
    flex: 1,
  },
  taskTitle: {
    marginBottom: Spacing.xs,
  },
  priorityBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.xs,
  },
  emptyState: {
    alignItems: "center",
    padding: Spacing.xl,
    borderRadius: BorderRadius.md,
  },
});
