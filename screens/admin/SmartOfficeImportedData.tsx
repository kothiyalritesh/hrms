import React, { useState, useEffect } from "react";
import { View, StyleSheet, FlatList, ScrollView, Alert } from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { supabase } from "@/lib/supabase";
import { smartOfficeService } from "@/services/smartoffice.service";
import { Colors } from "@/constants/theme";
import { PaginationControls } from "@/components/PaginationControls";

const USER_PAGE_SIZE = 25;
const LOG_PAGE_SIZE = 50;

export function SmartOfficeImportedData() {
  const { theme } = useTheme();
  const [importedUsers, setImportedUsers] = useState<any[]>([]);
  const [deviceLogs, setDeviceLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState({ users: 0, logs: 0 });
  const [userPage, setUserPage] = useState(0);
  const [logPage, setLogPage] = useState(0);

  useEffect(() => {
    void loadData();
  }, [userPage, logPage]);

  const refreshEmployeeData = async () => {
    setRefreshing(true);
    try {
      // Get fresh employee data from SmartOffice
      const employees = await smartOfficeService.getEmployeeDetails();

      if (!Array.isArray(employees)) {
        Alert.alert("Error", "Invalid data from SmartOffice");
        return;
      }

      const result =
        await smartOfficeService.syncEmployeeProfilesBatch(employees);

      Alert.alert(
        "Refresh Complete",
        `Transaction committed.\nBatch: ${result.batchId}\nUpdated: ${result.updated}/${result.submitted}` +
          (result.unmatched
            ? `\nNot linked to active HRMS profiles: ${result.unmatched}`
            : ""),
      );

      // Reload data
      await loadData();
    } catch (error: any) {
      Alert.alert("Error", error.message);
    } finally {
      setRefreshing(false);
    }
  };

  const loadData = async () => {
    setLoading(true);
    try {
      // Get imported users
      const userFrom = userPage * USER_PAGE_SIZE;
      const { data: users, error: usersError, count: userCount } = await supabase
            .from("profiles")
            .select("*", { count: "exact" })
            .not("smartoffice_employee_code", "is", null)
            .order("smartoffice_synced_at", { ascending: false })
            .order("id")
            .range(userFrom, userFrom + USER_PAGE_SIZE - 1);
      if (usersError) throw usersError;

      // Get device logs count
      const logFrom = logPage * LOG_PAGE_SIZE;
      const { data: logs, error: logsError, count: logsCount } = await supabase
            .from("smartoffice_device_logs")
            .select("*", { count: "exact" })
            .order("log_date", { ascending: false })
            .order("id")
            .range(logFrom, logFrom + LOG_PAGE_SIZE - 1);
      if (logsError) throw logsError;

      setImportedUsers(users || []);
      setDeviceLogs(logs || []);
      setStats({
        users: userCount || 0,
        logs: logsCount || 0,
      });
    } catch (error: any) {
      Alert.alert(
        "Unable to load SmartOffice data",
        error?.message || "Please try again.",
      );
    } finally {
      setLoading(false);
    }
  };

  const renderUser = ({ item }: any) => (
    <View style={[styles.card, { backgroundColor: theme.backgroundDefault }]}>
      <ThemedText style={styles.userName}>{item.name}</ThemedText>
      <ThemedText style={[styles.userDetail, { color: theme.textSecondary }]}>
        Code: {item.smartoffice_employee_code}
      </ThemedText>
      {item.email && (
        <ThemedText style={[styles.userDetail, { color: theme.textSecondary }]}>
          📧 {item.email}
        </ThemedText>
      )}
      {item.smartoffice_department && (
        <ThemedText style={[styles.userDetail, { color: theme.textSecondary }]}>
          🏢 {item.smartoffice_department}
        </ThemedText>
      )}
      <ThemedText style={[styles.syncDate, { color: Colors.light.success }]}>
        Synced: {new Date(item.smartoffice_synced_at).toLocaleDateString()}
      </ThemedText>
    </View>
  );

  const renderLog = ({ item }: any) => (
    <View
      style={[styles.logCard, { backgroundColor: theme.backgroundDefault }]}
    >
      <View style={styles.logHeader}>
        <ThemedText style={styles.logEmployee}>
          Employee: {item.employee_code}
        </ThemedText>
        <ThemedText style={[styles.logDate, { color: theme.textSecondary }]}>
          {new Date(item.log_date).toLocaleString()}
        </ThemedText>
      </View>
      {item.punch_direction && (
        <ThemedText style={styles.logDetail}>
          Direction: {item.punch_direction}
        </ThemedText>
      )}
      {item.temperature && (
        <ThemedText style={styles.logDetail}>
          Temp: {item.temperature}°F ({item.temperature_state})
        </ThemedText>
      )}
      {item.serial_number && (
        <ThemedText style={[styles.logDetail, { color: theme.textSecondary }]}>
          Device: {item.serial_number}
        </ThemedText>
      )}
    </View>
  );

  return (
    <ThemedView style={styles.container}>
      <PageHeader title="SmartOffice Imported Data" />

      <ScrollView style={styles.content}>
        {/* Statistics */}
        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Statistics</ThemedText>
          <View style={styles.statsRow}>
            <View style={[styles.statBox, { backgroundColor: theme.backgroundSecondary }]}>
              <ThemedText style={styles.statNumber}>{stats.users}</ThemedText>
              <ThemedText style={styles.statLabel}>Imported Users</ThemedText>
            </View>
            <View style={[styles.statBox, { backgroundColor: theme.backgroundSecondary }]}>
              <ThemedText style={styles.statNumber}>{stats.logs}</ThemedText>
              <ThemedText style={styles.statLabel}>Device Logs</ThemedText>
            </View>
          </View>

          <Button
            title="Refresh Employee Data from SmartOffice"
            onPress={refreshEmployeeData}
            loading={refreshing}
            variant="primary"
            style={styles.refreshButton}
          />
          <ThemedText
            style={[styles.helperText, { color: theme.textSecondary }]}
          >
            Fetch latest employee details (names, emails, departments) from
            SmartOffice and update existing records
          </ThemedText>
        </View>

        {/* Imported Users */}
        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>
            Recently Imported Users ({importedUsers.length})
          </ThemedText>
          <PaginationControls page={userPage} pageSize={USER_PAGE_SIZE} total={stats.users} onPageChange={setUserPage} />
          <FlatList
            data={importedUsers}
            renderItem={renderUser}
            keyExtractor={(item) => item.id}
            scrollEnabled={false}
            contentContainerStyle={styles.list}
          />
        </View>

        {/* Device Logs */}
        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>
            Recent Device Logs ({deviceLogs.length})
          </ThemedText>
          <PaginationControls page={logPage} pageSize={LOG_PAGE_SIZE} total={stats.logs} onPageChange={setLogPage} />
          <FlatList
            data={deviceLogs}
            renderItem={renderLog}
            keyExtractor={(item) => item.id}
            scrollEnabled={false}
            contentContainerStyle={styles.list}
          />
        </View>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 12,
  },
  statsRow: {
    flexDirection: "row",
    gap: 12,
  },
  statBox: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
        alignItems: "center",
  },
  statNumber: {
    fontSize: 28,
    fontWeight: "700",
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    opacity: 0.7,
  },
  refreshButton: {
    marginTop: 16,
    marginBottom: 8,
  },
  helperText: {
    fontSize: 11,
    lineHeight: 14,
  },
  list: {
    gap: 8,
  },
  card: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  userName: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 4,
  },
  userDetail: {
    fontSize: 13,
    marginBottom: 2,
  },
  syncDate: {
    fontSize: 11,
    marginTop: 4,
  },
  logCard: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  logHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  logEmployee: {
    fontSize: 14,
    fontWeight: "600",
  },
  logDate: {
    fontSize: 11,
  },
  logDetail: {
    fontSize: 12,
    marginTop: 2,
  },
});
