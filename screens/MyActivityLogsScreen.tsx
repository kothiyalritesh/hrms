import React, { useState, useCallback } from "react";
import {
  View, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, ActivityIndicator,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { supabase } from "@/lib/supabase";
import Feather from "@expo/vector-icons/Feather";
import { ThemedText } from "@/components/ThemedText";
import { formatDate } from "@/utils/format";
import { PageHeader } from "@/components/PageHeader";
import { useTheme } from "@/hooks/useTheme";
import Spacer from "@/components/Spacer";
import { useAuth } from "@/contexts/AuthContext";
import { Spacing, BorderRadius } from "@/constants/theme";
import { PaginationControls } from "@/components/PaginationControls";

const PRIMARY = "#6D1B6D";
const PAGE_SIZE = 25;

const CATEGORIES = ["All", "Attendance", "Leave", "Field Visit"];

const CATEGORY_COLORS: Record<string, string> = {
  attendance: "#10B981",
  leave:       "#F59E0B",
  field_visit: "#3B82F6",
};

const CATEGORY_ICONS: Record<string, string> = {
  attendance: "clock",
  leave:       "calendar",
  field_visit: "map-pin",
};

function formatTimeIST(isoString?: string) {
  if (!isoString) return "";
  return new Date(isoString).toLocaleTimeString("en-IN", {
    hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata",
  });
}

export default function MyActivityLogsScreen() {
  const { theme } = useTheme();
  const { user } = useAuth();

  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState("All");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const loadLogs = useCallback(async (requestedPage = 0, currentFilter = filter) => {
    if (!user?.id) return;
    setError(null);
    try {
      const dbFilter =
        currentFilter === "All" ? "all" :
        currentFilter === "Field Visit" ? "field_visit" :
        currentFilter.toLowerCase();

      const { data, error: rpcError } = await supabase.rpc("rpc_my_unified_activity_log", {
        p_category: dbFilter,
        p_limit:    PAGE_SIZE,
        p_offset:   requestedPage * PAGE_SIZE,
      });

      if (rpcError) throw rpcError;

      const rows = Array.isArray(data) ? data : [];
      setLogs(rows);
      setTotal(
        rows.length < PAGE_SIZE
          ? requestedPage * PAGE_SIZE + rows.length
          : (requestedPage + 2) * PAGE_SIZE,
      );
      setPage(requestedPage);
      setFilter(currentFilter);
    } catch (err: any) {
      setError(err?.message || "Failed to load activity logs.");
      setLogs([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id, filter]);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    void loadLogs(0, filter);
  }, [user?.id]));

  const onRefresh = () => {
    setRefreshing(true);
    void loadLogs(page, filter);
  };

  // Group by IST date
  const grouped: Record<string, any[]> = {};
  for (const log of logs) {
    if (!log.log_time) continue;
    const d = new Date(log.log_time);
    const key = d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); // YYYY-MM-DD
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(log);
  }
  const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  return (
    <View style={{ flex: 1, backgroundColor: theme.backgroundRoot }}>
      <PageHeader
        title="My Activity"
        subtitle="Timeline of your actions across the system"
      />

      {/* Filter chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterScroll}
      >
        {CATEGORIES.map((c) => {
          const isActive = filter === c;
          return (
            <TouchableOpacity
              key={c}
              onPress={() => {
                setLoading(true);
                void loadLogs(0, c);
              }}
              style={[
                styles.filterChip,
                {
                  backgroundColor: isActive ? PRIMARY : theme.backgroundDefault,
                  borderColor: isActive ? PRIMARY : theme.border,
                },
              ]}
            >
              <ThemedText
                style={{
                  color: isActive ? "#fff" : theme.textSecondary,
                  fontWeight: "600",
                  fontSize: 13,
                }}
              >
                {c}
              </ThemedText>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={PRIMARY} />
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Feather name="alert-circle" size={36} color="#EF4444" />
          <Spacer height={12} />
          <ThemedText style={{ color: "#EF4444", textAlign: "center", marginHorizontal: 32 }}>
            {error}
          </ThemedText>
          <TouchableOpacity
            style={[styles.retryBtn, { backgroundColor: PRIMARY }]}
            onPress={() => { setLoading(true); void loadLogs(0, filter); }}
          >
            <ThemedText style={{ color: "#fff", fontWeight: "700" }}>Retry</ThemedText>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={PRIMARY} />
          }
          showsVerticalScrollIndicator={false}
        >
          {sortedDates.length === 0 ? (
            <View style={[styles.empty, { backgroundColor: theme.backgroundDefault }]}>
              <Feather name="activity" size={44} color={theme.textSecondary} />
              <Spacer height={Spacing.md} />
              <ThemedText style={{ color: theme.text, fontWeight: "700", textAlign: "center", fontSize: 15 }}>
                No activities found
              </ThemedText>
              <ThemedText style={{ color: theme.textSecondary, textAlign: "center", marginTop: 6, lineHeight: 20, fontSize: 13 }}>
                {filter === "All"
                  ? "Your check-ins, field visits and leave requests will appear here."
                  : `No ${filter.toLowerCase()} activity yet.`}
              </ThemedText>
            </View>
          ) : (
            sortedDates.map((dateKey) => {
              const dayLogs = grouped[dateKey];
              const displayDate = formatDate(new Date(dateKey + "T12:00:00"));
              return (
                <View key={dateKey} style={styles.dateGroup}>
                  {/* Date header */}
                  <View style={styles.dateHeader}>
                    <View style={[styles.dateLine, { backgroundColor: theme.border }]} />
                    <View style={[styles.datePill, { backgroundColor: PRIMARY + "15", borderColor: PRIMARY + "30" }]}>
                      <ThemedText style={{ fontSize: 12, fontWeight: "700", color: PRIMARY }}>
                        {displayDate}
                      </ThemedText>
                      <View style={[styles.countDot, { backgroundColor: PRIMARY }]}>
                        <ThemedText style={{ fontSize: 10, color: "#fff", fontWeight: "700" }}>
                          {dayLogs.length}
                        </ThemedText>
                      </View>
                    </View>
                    <View style={[styles.dateLine, { backgroundColor: theme.border }]} />
                  </View>

                  {/* Log cards */}
                  {dayLogs.map((log) => {
                    const color = CATEGORY_COLORS[log.category] || "#9CA3AF";
                    const icon = CATEGORY_ICONS[log.category] || "activity";
                    const isExpanded = expandedId === log.id;
                    return (
                      <TouchableOpacity
                        key={log.id}
                        style={[styles.logCard, { backgroundColor: theme.backgroundDefault, borderColor: theme.border }]}
                        onPress={() => setExpandedId(isExpanded ? null : log.id)}
                        activeOpacity={0.8}
                      >
                        {/* Icon */}
                        <View style={[styles.iconWrap, { backgroundColor: color + "18" }]}>
                          <Feather name={icon as any} size={16} color={color} />
                        </View>

                        {/* Content */}
                        <View style={styles.logBody}>
                          <View style={styles.logTitleRow}>
                            <ThemedText
                              style={{ flex: 1, fontSize: 14, fontWeight: "600", color: theme.text }}
                              numberOfLines={isExpanded ? undefined : 1}
                            >
                              {log.title}
                            </ThemedText>
                            <ThemedText style={{ fontSize: 12, color: theme.textSecondary, marginLeft: 8 }}>
                              {formatTimeIST(log.log_time)}
                            </ThemedText>
                          </View>

                          <View style={styles.logMeta}>
                            <View style={[styles.typePill, { backgroundColor: color + "18" }]}>
                              <ThemedText style={{ color, fontWeight: "700", fontSize: 10, textTransform: "capitalize" }}>
                                {(log.category || "other").replace(/_/g, " ")}
                              </ThemedText>
                            </View>
                            {!isExpanded && log.description ? (
                              <ThemedText
                                style={{ fontSize: 12, color: theme.textSecondary, flex: 1 }}
                                numberOfLines={1}
                              >
                                {log.description}
                              </ThemedText>
                            ) : null}
                            <Feather
                              name={isExpanded ? "chevron-up" : "chevron-down"}
                              size={14}
                              color={theme.textSecondary}
                            />
                          </View>

                          {isExpanded && log.description ? (
                            <View style={[styles.expanded, { borderTopColor: theme.border }]}>
                              <ThemedText style={{ color: theme.textSecondary, lineHeight: 20, fontSize: 13 }}>
                                {log.description}
                              </ThemedText>
                            </View>
                          ) : null}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              );
            })
          )}

          <PaginationControls
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            onPageChange={(nextPage) => {
              setLoading(true);
              void loadLogs(nextPage, filter);
            }}
          />
          <Spacer height={60} />
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  centered:     { flex: 1, justifyContent: "center", alignItems: "center" },
  filterScroll: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, gap: 8 },
  filterChip:   { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  scroll:       { flex: 1 },
  content:      { padding: Spacing.lg, paddingBottom: 60 },
  empty:        { alignItems: "center", padding: 40, borderRadius: BorderRadius.lg, marginTop: Spacing.xl },
  retryBtn:     { marginTop: 16, paddingHorizontal: 24, paddingVertical: 10, borderRadius: 8 },
  dateGroup:    { marginBottom: Spacing.xl },
  dateHeader:   { flexDirection: "row", alignItems: "center", marginBottom: Spacing.md, gap: 8 },
  dateLine:     { flex: 1, height: 1 },
  datePill:     { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1 },
  countDot:     { width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  logCard:      { flexDirection: "row", borderRadius: BorderRadius.md, marginBottom: Spacing.sm, borderWidth: 1, overflow: "hidden" },
  iconWrap:     { width: 48, alignItems: "center", justifyContent: "center" },
  logBody:      { flex: 1, padding: Spacing.md },
  logTitleRow:  { flexDirection: "row", alignItems: "center", marginBottom: 6 },
  logMeta:      { flexDirection: "row", alignItems: "center", gap: 8 },
  typePill:     { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  expanded:     { marginTop: Spacing.md, paddingTop: Spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
});
