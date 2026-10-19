import React, { useState, useCallback } from "react";
import { StyleSheet, View, FlatList, Pressable } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { useFocusEffect } from "@react-navigation/native";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, BorderRadius } from "@/constants/theme";
import { ReportState, reportErrorMessage } from "@/components/reports/ReportUI";
import { formatIstDateTime } from "@/utils/exportWorkbook";
import Spacer from "@/components/Spacer";
import { supabase } from "@/lib/supabase";
import { PaginationControls } from "@/components/PaginationControls";

const PAGE_SIZE = 50;

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

export default function AuditLogsScreen() {
  const { theme } = useTheme();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadAuditLogs = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
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
          performed_at,
          profiles(name)
        `, { count: "exact" },
        )
        .order("performed_at", { ascending: false })
        .order("id");
    if (filter !== "all") query = query.eq("table_name", filter);
    const from = page * PAGE_SIZE;
    const { data, error, count } = await query.range(from, from + PAGE_SIZE - 1);

    if (error) {
      console.error("Error loading audit logs:", error);
      setLogs([]);
      setTotal(0);
      setLoadError(reportErrorMessage(error));
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
          user_name: log.profiles?.name,
        })) || [];
      setLogs(formattedData);
      setTotal(count ?? 0);
    }
    setLoading(false);
  }, [filter, page]);

  useFocusEffect(
    useCallback(() => {
      loadAuditLogs();
    }, [loadAuditLogs]),
  );

  const getActionColor = (action: string) => {
    switch (action.toLowerCase()) {
      case "insert":
      case "create":
        return theme.success;
      case "update":
      case "modify":
        return theme.warning;
      case "delete":
      case "remove":
        return theme.error;
      default:
        return theme.info;
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

  const renderAuditLog = ({ item }: { item: AuditLog }) => (
    <View
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
              {item.action.toUpperCase()}
            </ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              on {item.table_name}
            </ThemedText>
          </View>

          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            Record ID: {item.record_id}
          </ThemedText>

          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            By: {item.user_name || "System"} ·{" "}
            {formatIstDateTime(item.performed_at)} IST
          </ThemedText>

          {item.old_values && (
            <View style={styles.valuesSection}>
              <ThemedText
                type="caption"
                style={[styles.valuesLabel, { color: theme.error }]}
              >
                Old Values:
              </ThemedText>
              <ThemedText
                type="caption"
                numberOfLines={10}
                style={[styles.valuesText, { color: theme.textSecondary }]}
              >
                {JSON.stringify(item.old_values, null, 2)}
              </ThemedText>
            </View>
          )}

          {item.new_values && (
            <View style={styles.valuesSection}>
              <ThemedText
                type="caption"
                style={[styles.valuesLabel, { color: theme.success }]}
              >
                New Values:
              </ThemedText>
              <ThemedText
                type="caption"
                numberOfLines={10}
                style={[styles.valuesText, { color: theme.textSecondary }]}
              >
                {JSON.stringify(item.new_values, null, 2)}
              </ThemedText>
            </View>
          )}
        </View>
      </View>
    </View>
  );

  const filterOptions = [
    { label: "All Tables", value: "all" },
    { label: "Attendance", value: "attendance_logs" },
    { label: "Leaves", value: "leaves" },
    { label: "Users", value: "profiles" },
    { label: "Tasks", value: "tasks" },
  ];

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      <View style={styles.header}>
        <ThemedText type="caption" style={{ color: theme.textSecondary }}>
          Read-only system activity log. Times are in IST.
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
                      ? theme.primary
                      : theme.backgroundDefault,
                },
              ]}
              onPress={() => { setPage(0); setFilter(option.value); }}
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
      <PaginationControls page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />

      {loading ? (
        <ReportState kind="loading" title="Loading audit logs…" />
      ) : loadError ? (
        <ReportState kind="error" title="Could not load audit logs" message={loadError} onRetry={() => void loadAuditLogs()} />
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
  summaryCard: { padding: 16, borderRadius: 12, borderWidth: 1, minWidth: 140, marginRight: 12 },
  list: {
    gap: Spacing.md,
  },
  logCard: {
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
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
  valuesSection: {
    marginTop: Spacing.xs,
    gap: Spacing.xs,
  },
  valuesLabel: {
    fontWeight: "600",
  },
  valuesText: {
    fontFamily: "monospace",
    fontSize: 11,
  },
});

