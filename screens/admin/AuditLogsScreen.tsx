import React, { useState, useCallback, useEffect } from "react";
import { StyleSheet, View, FlatList, Pressable } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius, Colors } from "@/constants/theme";
import Spacer from "@/components/Spacer";
import { supabase } from "@/lib/supabase";

interface AuditLog {
  id: string;
  action: string;
  table_name: string;
  record_id: string;
  old_values?: any;
  new_values?: any;
  performed_by: string;
  performed_at: string;
  user_name?: string;
}

const FIELD_LABELS: Record<string, string> = {
  id: "ID",
  created_at: "Created At",
  updated_at: "Updated At",
  name: "Name",
  email: "Email",
  phone: "Phone",
  role: "Role",
  is_active: "Active Status",
  office_id: "Office",
  first_name: "First Name",
  last_name: "Last Name",
  full_name: "Full Name",
  username: "Username",
  role_id: "Role ID",
  team: "Team",
  reports_to: "Reports To",
  base_latitude: "Base Latitude",
  base_longitude: "Base Longitude",
  geo_fence_radius: "Geo Fence Radius",
  employee_number: "Employee Number",
  date_of_birth: "Date of Birth",
  custom_password: "Password",
  is_escalation_member: "Escalation Member",
  leads_year: "Leads Year",
  leads_month: "Leads Month",
  monthly_leads: "Monthly Leads",
  user_id: "Employee",
  check_in_time: "Check In Time",
  check_out_time: "Check Out Time",
  check_in_location: "Check In Location",
  check_out_location: "Check Out Location",
  status: "Status",
  notes: "Notes",
  leave_type: "Leave Type",
  start_date: "Start Date",
  end_date: "End Date",
  reason: "Reason",
  approved_by: "Approved By",
  approval_date: "Approval Date",
  title: "Title",
  description: "Description",
  assigned_to: "Assigned To",
  due_date: "Due Date",
  priority: "Priority",
  completed: "Completed",
  completion_date: "Completion Date",
};

const parseJsonValue = (value: any): any => {
  if (typeof value === "string" && value.includes("&quot;")) {
    try {
      return JSON.parse(
        value
          .replace(/&quot;/g, '"')
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&amp;/g, "&")
      );
    } catch {
      return value;
    }
  }
  return value;
};

const getChangedFields = (oldValues: any, newValues: any): Record<string, { old: any; new: any }> => {
  const changes: Record<string, { old: any; new: any }> = {};
  const oldParsed = parseJsonValue(oldValues) || {};
  const newParsed = parseJsonValue(newValues) || {};

  const allKeys = new Set([...Object.keys(oldParsed), ...Object.keys(newParsed)]);
  allKeys.forEach((key) => {
    if (JSON.stringify(oldParsed[key]) !== JSON.stringify(newParsed[key])) {
      changes[key] = { old: oldParsed[key], new: newParsed[key] };
    }
  });
  return changes;
};

const formatValue = (value: any): string => {
  if (value === null || value === undefined) return "(empty)";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

export default function AuditLogsScreen() {
  const { theme } = useTheme();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadAuditLogs = useCallback(async () => {
    let query = supabase
      .from("audit_logs")
      .select(
        `
        id,
        action,
        table_name,
        record_id,
        old_values,
        new_values,
        performed_by,
        performed_at
      `,
      )
      .order("performed_at", { ascending: false })
      .limit(100);

    if (filter !== "all") {
      query = query.eq("table_name", filter);
    }

    const { data, error } = await query;

    if (error) {
      console.error("Error loading audit logs:", error);
    } else {
      const formattedData =
        data?.map((log: any) => ({
          id: log.id,
          action: log.action,
          table_name: log.table_name,
          record_id: log.record_id,
          old_values: log.old_values,
          new_values: log.new_values,
          performed_by: log.performed_by,
          performed_at: log.performed_at,
          user_name: "System",
        })) || [];
      setLogs(formattedData);
    }
    setLoading(false);
  }, [filter]);

  useFocusEffect(
    useCallback(() => {
      loadAuditLogs();
      const interval = setInterval(loadAuditLogs, 10000);
      return () => clearInterval(interval);
    }, [loadAuditLogs]),
  );

  const getActionColor = (action: string) => {
    switch (action.toLowerCase()) {
      case "insert":
      case "create":
        return Colors.light.success;
      case "update":
      case "modify":
        return Colors.light.warning;
      case "delete":
      case "remove":
        return Colors.light.error;
      default:
        return Colors.light.info;
    }
  };

  const getActionIcon = (action: string) => {
    switch (action.toLowerCase()) {
      case "insert":
      case "create":
        return "plus-circle";
      case "update":
      case "modify":
        return "edit";
      case "delete":
      case "remove":
        return "trash-2";
      default:
        return "activity";
    }
  };

  const renderAuditLog = ({ item }: { item: AuditLog }) => {
    const isExpanded = expandedId === item.id;
    const changes = item.action === "UPDATE" ? getChangedFields(item.old_values, item.new_values) : null;
    const hasChanges = changes && Object.keys(changes).length > 0;

    return (
      <Pressable
        onPress={() => setExpandedId(isExpanded ? null : item.id)}
        style={[styles.logCard, { backgroundColor: theme.backgroundDefault }]}
      >
        <View style={styles.logHeader}>
          <View style={styles.logInfo}>
            <View style={styles.actionRow}>
              <Feather
                name={getActionIcon(item.action) as any}
                size={16}
                color={getActionColor(item.action)}
              />
              <ThemedText
                type="body"
                style={[
                  styles.actionText,
                  { color: getActionColor(item.action) },
                ]}
              >
                {item.action === "INSERT" ? "Added" : item.action === "UPDATE" ? "Updated" : "Deleted"}
              </ThemedText>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                {item.table_name === "profiles" ? "User" : item.table_name.replace(/_/g, " ")}
              </ThemedText>
            </View>

            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              {new Date(item.performed_at).toLocaleString()}
            </ThemedText>
          </View>
          <Feather
            name={isExpanded ? "chevron-up" : "chevron-down"}
            size={16}
            color={theme.textSecondary}
          />
        </View>

        {isExpanded && (
          <View style={styles.expandedContent}>
            {item.action === "INSERT" && item.new_values && (
              <View style={styles.changesSection}>
                <ThemedText type="caption" style={[styles.sectionTitle, { color: Colors.light.success }]}>
                  New Record Created
                </ThemedText>
                {Object.entries(parseJsonValue(item.new_values) || {}).map(([key, value]) => (
                  <View key={key} style={styles.fieldRow}>
                    <ThemedText type="caption" style={[styles.fieldLabel, { color: theme.textSecondary }]}>
                      {FIELD_LABELS[key] || key}:
                    </ThemedText>
                    <ThemedText type="caption" style={styles.fieldValue}>
                      {formatValue(value)}
                    </ThemedText>
                  </View>
                ))}
              </View>
            )}

            {item.action === "UPDATE" && hasChanges && (
              <View style={styles.changesSection}>
                <ThemedText type="caption" style={[styles.sectionTitle, { color: Colors.light.warning }]}>
                  Changes Made
                </ThemedText>
                {Object.entries(changes).map(([key, { old, new: newVal }]) => (
                  <View key={key} style={styles.changeItem}>
                    <ThemedText type="caption" style={[styles.fieldLabel, { color: theme.textSecondary }]}>
                      {FIELD_LABELS[key] || key}
                    </ThemedText>
                    <View style={styles.changeValues}>
                      <View style={styles.oldValue}>
                        <ThemedText type="caption" style={styles.changeLabel}>
                          Before:
                        </ThemedText>
                        <ThemedText type="caption" style={styles.fieldValue}>
                          {formatValue(old)}
                        </ThemedText>
                      </View>
                      <View style={styles.newValue}>
                        <ThemedText type="caption" style={styles.changeLabel}>
                          After:
                        </ThemedText>
                        <ThemedText type="caption" style={styles.fieldValue}>
                          {formatValue(newVal)}
                        </ThemedText>
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {item.action === "DELETE" && item.old_values && (
              <View style={styles.changesSection}>
                <ThemedText type="caption" style={[styles.sectionTitle, { color: Colors.light.error }]}>
                  Record Deleted
                </ThemedText>
                {Object.entries(parseJsonValue(item.old_values) || {}).map(([key, value]) => (
                  <View key={key} style={styles.fieldRow}>
                    <ThemedText type="caption" style={[styles.fieldLabel, { color: theme.textSecondary }]}>
                      {FIELD_LABELS[key] || key}:
                    </ThemedText>
                    <ThemedText type="caption" style={styles.fieldValue}>
                      {formatValue(value)}
                    </ThemedText>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}
      </Pressable>
    );
  };

  const filterOptions = [
    { label: "All Tables", value: "all" },
    { label: "Attendance", value: "attendance_logs" },
    { label: "Leaves", value: "leaves" },
    { label: "Users", value: "profiles" },
    { label: "Tasks", value: "tasks" },
  ];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <ThemedText type="h3">Audit & Logs</ThemedText>
        <ThemedText type="caption" style={{ color: theme.textSecondary }}>
          Read-only system activity log
        </ThemedText>
      </View>

      <Spacer height={Spacing.md} />

      <View style={styles.filterSection}>
        <ThemedText type="caption" style={{ color: theme.textSecondary }}>
          Filter by table:
        </ThemedText>
        <View style={styles.filterButtons}>
          {filterOptions.map((option) => (
            <Pressable
              key={option.value}
              style={[
                styles.filterButton,
                {
                  backgroundColor:
                    filter === option.value
                      ? Colors.light.primary
                      : theme.backgroundDefault,
                },
              ]}
              onPress={() => setFilter(option.value)}
            >
              <ThemedText
                type="caption"
                style={{
                  color: filter === option.value ? "#FFFFFF" : theme.text,
                  fontWeight: filter === option.value ? "600" : "400",
                }}
              >
                {option.label}
              </ThemedText>
            </Pressable>
          ))}
        </View>
      </View>

      <Spacer height={Spacing.md} />

      {loading ? (
        <View style={styles.centered}>
          <ThemedText>Loading audit logs...</ThemedText>
        </View>
      ) : logs.length === 0 ? (
        <View style={styles.centered}>
          <Feather name="file-text" size={48} color={theme.textSecondary} />
          <Spacer height={Spacing.md} />
          <ThemedText style={{ color: theme.textSecondary }}>
            No audit logs found
          </ThemedText>
        </View>
      ) : (
        <FlatList
          data={logs}
          keyExtractor={(item) => item.id}
          renderItem={renderAuditLog}
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
  filterSection: {
    gap: Spacing.xs,
  },
  filterButtons: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.xs,
  },
  filterButton: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.xs,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  list: {
    gap: Spacing.md,
  },
  logCard: {
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.sm,
  },
  logHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  logInfo: {
    flex: 1,
    gap: Spacing.xs,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  actionText: {
    fontWeight: "600",
  },
  expandedContent: {
    marginTop: Spacing.md,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: "rgba(0,0,0,0.1)",
  },
  changesSection: {
    gap: Spacing.sm,
  },
  sectionTitle: {
    fontWeight: "600",
    marginBottom: Spacing.xs,
  },
  fieldRow: {
    marginBottom: Spacing.sm,
  },
  fieldLabel: {
    fontWeight: "500",
    marginBottom: Spacing.xs,
  },
  fieldValue: {
    marginLeft: Spacing.sm,
  },
  changeItem: {
    marginBottom: Spacing.md,
    paddingBottom: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0,0,0,0.05)",
  },
  changeValues: {
    flexDirection: "row",
    gap: Spacing.md,
    marginTop: Spacing.xs,
  },
  oldValue: {
    flex: 1,
  },
  newValue: {
    flex: 1,
  },
  changeLabel: {
    fontWeight: "500",
    fontSize: 11,
    marginBottom: Spacing.xs,
  },
});
