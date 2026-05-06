import React, { useState, useCallback } from "react";
import { View, ScrollView, SafeAreaView, ActivityIndicator, Alert } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useAuth } from "@/contexts/AuthContext";
import Spacer from "@/components/Spacer";
import { supabase } from "@/lib/supabase";

export default function DiagnosticScreen() {
  const { theme } = useTheme();
  const { user: authUser } = useAuth();
  const [loading, setLoading] = useState(true);
  const [diagnostics, setDiagnostics] = useState<any>({});

  useFocusEffect(
    useCallback(() => {
      const runDiagnostics = async () => {
        try {
          const userId = authUser?.id;

          const results: any = {
            userId,
            currentUser: authUser?.email,
            userName: authUser?.name,
          };

          // Check ALL attendance_logs (not just current user)
          const { data: allAttendanceLogs, error: allLogsError } = await supabase
            .from("attendance_logs")
            .select("*")
            .order("date", { ascending: false })
            .limit(20);

          results.allAttendanceLogs = {
            count: allAttendanceLogs?.length || 0,
            error: allLogsError?.message,
            data: allAttendanceLogs,
          };

          // Check attendance_logs for current user
          const { data: attendanceLogs, error: logsError } = await supabase
            .from("attendance_logs")
            .select("*")
            .eq("user_id", userId)
            .order("date", { ascending: false })
            .limit(10);

          results.attendanceLogs = {
            count: attendanceLogs?.length || 0,
            error: logsError?.message,
            data: attendanceLogs,
          };

          // Check admin_attendance_export
          const { data: adminExport, error: exportError } = await supabase
            .from("admin_attendance_export")
            .select("*")
            .eq("user_id", userId)
            .order("date", { ascending: false })
            .limit(10);

          results.adminAttendanceExport = {
            count: adminExport?.length || 0,
            error: exportError?.message,
            data: adminExport,
          };

          // Check monthly_attendance_report
          const { data: monthlyReport, error: monthlyError } = await supabase
            .from("monthly_attendance_report")
            .select("*")
            .eq("user_id", userId)
            .limit(10);

          results.monthlyAttendanceReport = {
            count: monthlyReport?.length || 0,
            error: monthlyError?.message,
            data: monthlyReport,
          };

          // Check profiles
          const { data: profile, error: profileError } = await supabase
            .from("profiles")
            .select("*")
            .eq("id", userId)
            .single();

          results.profile = {
            error: profileError?.message,
            data: profile,
          };

          setDiagnostics(results);
        } catch (error: any) {
          Alert.alert("Error", error.message);
        } finally {
          setLoading(false);
        }
      };

      runDiagnostics();
    }, [])
  );

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.backgroundRoot }}>
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <ActivityIndicator size="large" color={theme.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.backgroundRoot }}>
      <ScrollView style={{ flex: 1, padding: 16 }}>
        <ThemedText type="h3">Database Diagnostics</ThemedText>
        <Spacer height={16} />

        {/* User Info */}
        <View style={{ backgroundColor: theme.backgroundDefault, padding: 12, borderRadius: 8, marginBottom: 12 }}>
          <ThemedText type="h4">Current User</ThemedText>
          <ThemedText style={{ fontSize: 12, marginTop: 4 }}>Name: {diagnostics.userName || "—"}</ThemedText>
          <ThemedText style={{ fontSize: 12 }}>Email: {diagnostics.currentUser || "—"}</ThemedText>
          <ThemedText style={{ fontSize: 12 }}>ID: {diagnostics.userId || "—"}</ThemedText>
        </View>

        {/* Profile */}
        <View style={{ backgroundColor: theme.backgroundDefault, padding: 12, borderRadius: 8, marginBottom: 12 }}>
          <ThemedText type="h4">Profile</ThemedText>
          {diagnostics.profile?.error ? (
            <ThemedText style={{ fontSize: 12, color: "red", marginTop: 4 }}>Error: {diagnostics.profile.error}</ThemedText>
          ) : (
            <>
              <ThemedText style={{ fontSize: 12, marginTop: 4 }}>Name: {diagnostics.profile?.data?.full_name}</ThemedText>
              <ThemedText style={{ fontSize: 12 }}>Office ID: {diagnostics.profile?.data?.office_id}</ThemedText>
            </>
          )}
        </View>

        {/* All Attendance Logs */}
        <View style={{ backgroundColor: theme.backgroundDefault, padding: 12, borderRadius: 8, marginBottom: 12 }}>
          <ThemedText type="h4">ALL attendance_logs (All Users)</ThemedText>
          <ThemedText style={{ fontSize: 12, marginTop: 4, color: diagnostics.allAttendanceLogs?.count > 0 ? "green" : "red" }}>
            Total Records: {diagnostics.allAttendanceLogs?.count}
          </ThemedText>
          {diagnostics.allAttendanceLogs?.error && (
            <ThemedText style={{ fontSize: 12, color: "red" }}>Error: {diagnostics.allAttendanceLogs.error}</ThemedText>
          )}
          {diagnostics.allAttendanceLogs?.data && diagnostics.allAttendanceLogs.data.length > 0 && (
            <View style={{ marginTop: 8 }}>
              {diagnostics.allAttendanceLogs.data.slice(0, 5).map((log: any, idx: number) => (
                <View key={idx} style={{ marginBottom: 8, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: theme.border }}>
                  <ThemedText style={{ fontSize: 11, fontWeight: "700" }}>User: {log.user_id?.substring(0, 8)}...</ThemedText>
                  <ThemedText style={{ fontSize: 11 }}>Date: {log.date}</ThemedText>
                  <ThemedText style={{ fontSize: 11 }}>Check-in: {log.checkin_time ? new Date(log.checkin_time).toLocaleTimeString() : "—"}</ThemedText>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Current User Attendance Logs */}
        <View style={{ backgroundColor: theme.backgroundDefault, padding: 12, borderRadius: 8, marginBottom: 12 }}>
          <ThemedText type="h4">attendance_logs Table</ThemedText>
          <ThemedText style={{ fontSize: 12 }}>Your Records: {diagnostics.attendanceLogs.count}</ThemedText>
          {diagnostics.attendanceLogs.error && (
            <ThemedText style={{ fontSize: 12, color: "red" }}>Error: {diagnostics.attendanceLogs.error}</ThemedText>
          )}
          {diagnostics.attendanceLogs.data && diagnostics.attendanceLogs.data.length > 0 && (
            <View style={{ marginTop: 8 }}>
              {diagnostics.attendanceLogs.data.slice(0, 3).map((log: any, idx: number) => (
                <View key={idx} style={{ marginBottom: 8, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: theme.border }}>
                  <ThemedText style={{ fontSize: 11 }}>Date: {log.date}</ThemedText>
                  <ThemedText style={{ fontSize: 11 }}>Status: {log.status}</ThemedText>
                  <ThemedText style={{ fontSize: 11 }}>Check-in: {log.checkin_time ? new Date(log.checkin_time).toLocaleTimeString() : "—"}</ThemedText>
                  <ThemedText style={{ fontSize: 11 }}>Check-out: {log.checkout_time ? new Date(log.checkout_time).toLocaleTimeString() : "—"}</ThemedText>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Admin Attendance Export */}
        <View style={{ backgroundColor: theme.backgroundDefault, padding: 12, borderRadius: 8, marginBottom: 12 }}>
          <ThemedText type="h4">admin_attendance_export Table</ThemedText>
          <ThemedText style={{ fontSize: 12, marginTop: 4, color: diagnostics.adminAttendanceExport.count > 0 ? "green" : "orange" }}>
            Records: {diagnostics.adminAttendanceExport.count}
          </ThemedText>
          {diagnostics.adminAttendanceExport.error && (
            <ThemedText style={{ fontSize: 12, color: "red" }}>Error: {diagnostics.adminAttendanceExport.error}</ThemedText>
          )}
        </View>

        {/* Monthly Attendance Report */}
        <View style={{ backgroundColor: theme.backgroundDefault, padding: 12, borderRadius: 8, marginBottom: 12 }}>
          <ThemedText type="h4">monthly_attendance_report Table</ThemedText>
          <ThemedText style={{ fontSize: 12, marginTop: 4, color: diagnostics.monthlyAttendanceReport.count > 0 ? "green" : "orange" }}>
            Records: {diagnostics.monthlyAttendanceReport.count}
          </ThemedText>
          {diagnostics.monthlyAttendanceReport.error && (
            <ThemedText style={{ fontSize: 12, color: "red" }}>Error: {diagnostics.monthlyAttendanceReport.error}</ThemedText>
          )}
        </View>

        {/* Summary */}
        <View style={{ backgroundColor: theme.backgroundDefault, padding: 12, borderRadius: 8, marginBottom: 12 }}>
          <ThemedText type="h4">Summary</ThemedText>
          {diagnostics.attendanceLogs.count === 0 ? (
            <ThemedText style={{ fontSize: 12, marginTop: 4, color: "red" }}>
              ❌ No attendance records found. You need to check in first to create attendance data.
            </ThemedText>
          ) : (
            <ThemedText style={{ fontSize: 12, marginTop: 4, color: "green" }}>
              ✅ Found {diagnostics.attendanceLogs.count} attendance records
            </ThemedText>
          )}
        </View>

        <Spacer height={40} />
      </ScrollView>
    </SafeAreaView>
  );
}
