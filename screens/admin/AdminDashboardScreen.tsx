import React, { useState, useCallback } from "react";
import { StyleSheet, View, Pressable, RefreshControl } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { ScreenScrollView } from "@/components/ScreenScrollView";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, Colors } from "@/constants/theme";
import Spacer from "@/components/Spacer";
import { supabase } from "@/lib/supabase";

type AdminDashboardScreenProps = {
  navigation: NativeStackNavigationProp<any>;
};

interface AdminStatCardProps {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  value: string | number;
  subtitle?: string;
  color: string;
  onPress?: () => void;
}

function AdminStatCard({
  icon,
  title,
  value,
  subtitle,
  color,
  onPress,
}: AdminStatCardProps) {
  const { theme } = useTheme();

  return (
    <Pressable
      style={({ pressed }) => [
        styles.statCard,
        {
          backgroundColor: theme.backgroundDefault,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
      onPress={onPress}
    >
      <View
        style={[styles.statIconContainer, { backgroundColor: color + "20" }]}
      >
        <Feather name={icon} size={20} color={color} />
      </View>
      <ThemedText
        type="caption"
        style={[styles.statTitle, { color: theme.textSecondary }]}
      >
        {title}
      </ThemedText>
      <ThemedText type="h3" style={styles.statValue}>
        {value}
      </ThemedText>
      {subtitle && (
        <ThemedText
          type="caption"
          style={[styles.statSubtitle, { color: theme.textSecondary }]}
        >
          {subtitle}
        </ThemedText>
      )}
    </Pressable>
  );
}

export default function AdminDashboardScreen({
  navigation,
}: AdminDashboardScreenProps) {
  const { theme } = useTheme();
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState({
    totalEmployees: 0,
    activeEmployees: 0,
    todayAttendance: 0,
    pendingLeaves: 0,
    overdueTasks: 0,
    upcomingBirthdays: 0,
  });

  const loadAdminData = useCallback(async () => {
    const today = new Date().toISOString().split("T")[0];
    const [
      employeesRes,
      activeEmployeesRes,
      attendanceRes,
      pendingLeavesRes,
      overdueTasksRes,
    ] = await Promise.all([
      supabase.from("profiles").select("*", { count: "exact", head: true }),
      supabase.from("profiles").select("*", { count: "exact", head: true }).eq("is_active", true),
      supabase.from("attendance_logs").select("*", { count: "exact", head: true }).eq("date", today),
      supabase.from("leaves").select("*", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("tasks").select("*", { count: "exact", head: true }).lt("due_date", today).in("status", ["pending", "in_progress"]),
    ]);

    // Birthday view may not exist — query separately so it never crashes the dashboard
    let birthdayCount = 0;
    try {
      const { count } = await supabase.from("upcoming_birthdays_30_days").select("*", { count: "exact", head: true });
      birthdayCount = count || 0;
    } catch { birthdayCount = 0; }

    setStats({
      totalEmployees: employeesRes.count || 0,
      activeEmployees: activeEmployeesRes.count || 0,
      todayAttendance: attendanceRes.count || 0,
      pendingLeaves: pendingLeavesRes.count || 0,
      overdueTasks: overdueTasksRes.count || 0,
      upcomingBirthdays: birthdayCount,
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadAdminData();
    }, [loadAdminData]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadAdminData();
    setRefreshing(false);
  };

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
      <View style={styles.header}>
        <ThemedText type="h2">Admin Dashboard</ThemedText>
        <ThemedText type="caption" style={{ color: theme.textSecondary }}>
          Operational Overview
        </ThemedText>
      </View>

      <Spacer height={Spacing.xl} />

      <View style={styles.statsGrid}>
        <AdminStatCard
          icon="users"
          title="Total Employees"
          value={stats.totalEmployees}
          subtitle={`${stats.activeEmployees} active`}
          color={Colors.light.primary}
          onPress={() => navigation.navigate("UserManagement")}
        />
        <AdminStatCard
          icon="clock"
          title="Today's Attendance"
          value={stats.todayAttendance}
          subtitle="Present today"
          color={Colors.light.success}
          onPress={() => navigation.navigate("AttendanceControl")}
        />
        <AdminStatCard
          icon="calendar"
          title="Pending Leaves"
          value={stats.pendingLeaves}
          subtitle="Need approval"
          color={Colors.light.warning}
          onPress={() => navigation.navigate("LeaveManagement")}
        />
        <AdminStatCard
          icon="alert-triangle"
          title="Overdue Tasks"
          value={stats.overdueTasks}
          subtitle="Past deadline"
          color={Colors.light.error}
          onPress={() => navigation.navigate("TaskProjectControl")}
        />
        <AdminStatCard
          icon="gift"
          title="Upcoming Birthdays"
          value={stats.upcomingBirthdays}
          subtitle="Next 7 days"
          color="#FF6B9D"
        />
        <AdminStatCard
          icon="activity"
          title="Activity Analysis"
          value="View"
          subtitle="Employee activities"
          color="#8B5CF6"
          onPress={() => navigation.navigate("ActivityAnalysis")}
        />
        <AdminStatCard
          icon="map"
          title="Field Visits"
          value="View"
          subtitle="Team location log"
          color="#10B981"
          onPress={() => navigation.navigate("FieldVisitAdmin")}
        />
        <AdminStatCard
          icon="radio"
          title="Live Tracking"
          value="● Live"
          subtitle="Real-time GPS status"
          color="#10B981"
          onPress={() => navigation.navigate("LiveTracking")}
        />
        <AdminStatCard
          icon="navigation"
          title="Location Compliance"
          value="View"
          subtitle="Geo-fence alerts"
          color="#0EA5E9"
          onPress={() => navigation.navigate("LocationCompliance")}
        />
        <AdminStatCard
          icon="check-circle"
          title="Site Visit Approvals"
          value="View"
          subtitle="Pending requests"
          color="#F59E0B"
          onPress={() => navigation.navigate("SiteVisitApprovals")}
        />
        <AdminStatCard
          icon="layers"
          title="Organization"
          value="View"
          subtitle="Depts & Designations"
          color="#6366F1"
          onPress={() => navigation.navigate("OrganizationSettings")}
        />
        <AdminStatCard
          icon="users"
          title="Employee Lifecycle"
          value="Manage"
          subtitle="Onboarding & exits"
          color="#8B5CF6"
          onPress={() => navigation.navigate("Onboarding")}
        />
        <AdminStatCard
          icon="dollar-sign"
          title="Payroll"
          value="Run"
          subtitle="Salary & payslips"
          color="#10B981"
          onPress={() => navigation.navigate("PayrollAdmin")}
        />
        <AdminStatCard
          icon="star"
          title="Performance"
          value="View"
          subtitle="Goals & reviews"
          color="#F59E0B"
          onPress={() => navigation.navigate("PerformanceAdmin")}
        />
        <AdminStatCard
          icon="briefcase"
          title="On-Duty Approvals"
          value="View"
          subtitle="Pending requests"
          color="#8B5CF6"
          onPress={() => navigation.navigate("OnDutyApproval")}
        />
      </View>

      <Spacer height={Spacing.xl} />

      <View style={styles.sectionHeader}>
        <ThemedText type="h3">Quick Actions</ThemedText>
      </View>
      <Spacer height={Spacing.md} />

      <View style={styles.quickActionsGrid}>
        <Pressable
          style={[styles.quickAction, { backgroundColor: theme.backgroundDefault }]}
          onPress={() => navigation.navigate("LiveTracking")}
        >
          <Feather name="radio" size={24} color="#10B981" />
          <ThemedText type="caption" style={styles.quickActionLabel}>Live Tracking</ThemedText>
        </Pressable>

        <Pressable
          style={[styles.quickAction, { backgroundColor: theme.backgroundDefault }]}
          onPress={() => navigation.navigate("UserManagement")}
        >
          <Feather name="user-plus" size={24} color={Colors.light.primary} />
          <ThemedText type="caption" style={styles.quickActionLabel}>Add Employee</ThemedText>
        </Pressable>

        <Pressable
          style={[styles.quickAction, { backgroundColor: theme.backgroundDefault }]}
          onPress={() => navigation.navigate("AttendanceControl")}
        >
          <Feather name="download" size={24} color={Colors.light.success} />
          <ThemedText type="caption" style={styles.quickActionLabel}>Attendance Report</ThemedText>
        </Pressable>

        <Pressable
          style={[styles.quickAction, { backgroundColor: theme.backgroundDefault }]}
          onPress={() => navigation.navigate("NotificationManagement")}
        >
          <Feather name="bell" size={24} color={Colors.light.info} />
          <ThemedText type="caption" style={styles.quickActionLabel}>Send Notification</ThemedText>
        </Pressable>

        <Pressable
          style={[styles.quickAction, { backgroundColor: theme.backgroundDefault }]}
          onPress={() => navigation.navigate("AuditLogs")}
        >
          <Feather name="file-text" size={24} color={Colors.light.warning} />
          <ThemedText type="caption" style={styles.quickActionLabel}>View Logs</ThemedText>
        </Pressable>

        <Pressable
          style={[styles.quickAction, { backgroundColor: theme.backgroundDefault }]}
          onPress={() => navigation.navigate("AdminAttendanceEdit")}
        >
          <Feather name="edit-3" size={24} color="#EC4899" />
          <ThemedText type="caption" style={styles.quickActionLabel}>Edit Attendance</ThemedText>
        </Pressable>
      </View>

      <Spacer height={Spacing["2xl"]} />
    </ScreenScrollView>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: "flex-start",
  },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.md,
  },
  statCard: {
    width: "48%",
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
  quickActionsGrid: {
    flexDirection: "row",
    gap: Spacing.md,
  },
  quickAction: {
    flex: 1,
    alignItems: "center",
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
  },
  quickActionLabel: {
    textAlign: "center",
    marginTop: Spacing.sm,
    fontSize: 11,
  },
});
