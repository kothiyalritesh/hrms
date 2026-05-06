import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { ScreenScrollView } from "@/components/ScreenScrollView";
import { ThemedText } from "@/components/ThemedText";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, Colors, Spacing } from "@/constants/theme";
import Spacer from "@/components/Spacer";
import {
  ComplianceReport,
  LocationLog,
  LocationService,
  LocationViolation,
} from "@/services/location.service";

type StatusFilter = "ALL" | "IN_ZONE" | "OUT_OF_BOUND" | "WARNING";

const statusMeta: Record<
  "IN_ZONE" | "OUT_OF_BOUND" | "WARNING",
  { label: string; color: string; icon: keyof typeof Feather.glyphMap }
> = {
  IN_ZONE: { label: "In Zone", color: Colors.light.success, icon: "check-circle" },
  OUT_OF_BOUND: { label: "Out of Bound", color: Colors.light.error, icon: "alert-triangle" },
  WARNING: { label: "Warning Active", color: Colors.light.warning, icon: "alert-circle" },
};

function formatTime(value?: string) {
  if (!value) return "-";
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function downloadCSV(csv: string, fileName: string) {
  if (Platform.OS === "web" && typeof document !== "undefined") {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
    return;
  }

  Alert.alert("Report Ready", "CSV export is available on web. The report data is shown below.");
}

export default function LocationComplianceScreen() {
  const { theme } = useTheme();
  const [refreshing, setRefreshing] = useState(false);
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [liveLocations, setLiveLocations] = useState<LocationLog[]>([]);
  const [violations, setViolations] = useState<LocationViolation[]>([]);
  const [reports, setReports] = useState<ComplianceReport[]>([]);

  const loadData = useCallback(async () => {
    try {
      const [live, violationRows, reportRows] = await Promise.all([
        LocationService.getLiveLocations(),
        LocationService.getViolations({ date }),
        LocationService.getAllComplianceReports(date),
      ]);
      setLiveLocations(live);
      setViolations(violationRows);
      setReports(reportRows);
    } catch (e) {
      console.warn("[LocationCompliance] loadData error:", e);
    }
  }, [date]);

  useFocusEffect(
    useCallback(() => {
      loadData();
      const timer = setInterval(loadData, 60_000);
      return () => clearInterval(timer);
    }, [loadData]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const filteredLiveLocations = useMemo(() => {
    if (statusFilter === "ALL") return liveLocations;
    return liveLocations.filter((location) => location.status === statusFilter);
  }, [liveLocations, statusFilter]);

  const summary = useMemo(
    () => ({
      active: liveLocations.length,
      inZone: liveLocations.filter((location) => location.status === "IN_ZONE").length,
      out: liveLocations.filter((location) => location.status === "OUT_OF_BOUND").length,
      warnings: violations.filter((violation) => !violation.resolved_at).length,
    }),
    [liveLocations, violations],
  );

  const mapBounds = useMemo(() => {
    if (filteredLiveLocations.length === 0) return null;
    const lats = filteredLiveLocations.map((location) => location.latitude);
    const lons = filteredLiveLocations.map((location) => location.longitude);
    return {
      minLat: Math.min(...lats),
      maxLat: Math.max(...lats),
      minLon: Math.min(...lons),
      maxLon: Math.max(...lons),
    };
  }, [filteredLiveLocations]);

  const markerPosition = (location: LocationLog): { left: string; top: string } => {
    if (!mapBounds) return { left: "50%", top: "50%" };
    const latRange = Math.max(mapBounds.maxLat - mapBounds.minLat, 0.0005);
    const lonRange = Math.max(mapBounds.maxLon - mapBounds.minLon, 0.0005);
    const left = 8 + ((location.longitude - mapBounds.minLon) / lonRange) * 84;
    const top = 92 - ((location.latitude - mapBounds.minLat) / latRange) * 84;
    return { left: `${Math.max(0, Math.min(100, left))}%`, top: `${Math.max(0, Math.min(100, top))}%` };
  };

  const handleExport = () => {
    const csv = LocationService.exportCSV(reports);
    downloadCSV(csv, `location-compliance-${date}.csv`);
  };

  const handleExportPDF = () => {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const html = LocationService.exportHTML(reports, date);
      const win = window.open("", "_blank");
      if (win) {
        win.document.write(html);
        win.document.close();
        win.print();
      }
      return;
    }
    Alert.alert("PDF Export", "PDF export is available on web. Use Export CSV on mobile.");
  };

  return (
    <ScreenScrollView
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />
      }
    >
      <View style={styles.header}>
        <View>
          <ThemedText type="h2">Location Compliance</ThemedText>
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            Live geo-fence monitoring · auto-refreshes every 60s
          </ThemedText>
        </View>
        <View style={styles.exportButtons}>
          <Button onPress={handleExportPDF} variant="outline" style={styles.exportButton}>
            Export PDF
          </Button>
          <Button onPress={handleExport} variant="outline" style={styles.exportButton}>
            Export CSV
          </Button>
        </View>
      </View>

      <Spacer height={Spacing.lg} />

      <View style={styles.summaryGrid}>
        <SummaryTile label="Active" value={summary.active} color={Colors.light.info} icon="radio" />
        <SummaryTile label="In Zone" value={summary.inZone} color={Colors.light.success} icon="check-circle" />
        <SummaryTile label="Out" value={summary.out} color={Colors.light.error} icon="alert-triangle" />
        <SummaryTile label="Warnings" value={summary.warnings} color={Colors.light.warning} icon="alert-circle" />
      </View>

      <Spacer height={Spacing.lg} />

      <View style={[styles.filterPanel, { backgroundColor: theme.backgroundDefault }]}>
        <View style={styles.dateRow}>
          <Feather name="calendar" size={18} color={theme.textSecondary} />
          <TextInput
            value={date}
            onChangeText={setDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={theme.textSecondary}
            style={[styles.dateInput, { color: theme.text, borderColor: theme.border }]}
          />
        </View>
        <View style={styles.statusTabs}>
          {(["ALL", "IN_ZONE", "OUT_OF_BOUND", "WARNING"] as StatusFilter[]).map((status) => {
            const selected = statusFilter === status;
            const label = status === "ALL" ? "All" : statusMeta[status].label;
            return (
              <Pressable
                key={status}
                onPress={() => setStatusFilter(status)}
                style={[
                  styles.statusTab,
                  {
                    backgroundColor: selected ? theme.primary : theme.backgroundSecondary,
                  },
                ]}
              >
                <ThemedText type="caption" style={{ color: selected ? "#FFFFFF" : theme.text }}>
                  {label}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
      </View>

      <Spacer height={Spacing.lg} />

      <View style={[styles.mapPanel, { backgroundColor: theme.backgroundDefault }]}>
        <View style={styles.sectionTitleRow}>
          <ThemedText type="h3">Live Map</ThemedText>
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            {filteredLiveLocations.length} markers
          </ThemedText>
        </View>
        <View style={[styles.mapSurface, { backgroundColor: theme.backgroundSecondary }]}>
          {filteredLiveLocations.length === 0 ? (
            <View style={styles.emptyState}>
              <Feather name="map-pin" size={28} color={theme.textSecondary} />
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                No live pings for this filter
              </ThemedText>
            </View>
          ) : (
            filteredLiveLocations.map((location) => {
              const meta = statusMeta[location.status];
              return (
                <View
                  key={location.id}
                  style={[
                    styles.mapMarker,
                    markerPosition(location),
                    { backgroundColor: meta.color },
                  ]}
                >
                  <Feather name={meta.icon} size={13} color="#FFFFFF" />
                </View>
              );
            })
          )}
        </View>
      </View>

      <Spacer height={Spacing.lg} />

      <ThemedText type="h3">Active Users</ThemedText>
      <Spacer height={Spacing.sm} />
      {filteredLiveLocations.map((location) => {
        const meta = statusMeta[location.status];
        return (
          <View key={location.id} style={[styles.rowCard, { backgroundColor: theme.backgroundDefault }]}>
            <View style={[styles.statusIcon, { backgroundColor: meta.color + "22" }]}>
              <Feather name={meta.icon} size={18} color={meta.color} />
            </View>
            <View style={styles.rowBody}>
              <ThemedText type="body" style={styles.rowTitle}>
                {location.employee?.name || "Unknown User"}
              </ThemedText>
              <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                {meta.label} · {location.distance_m}m from zone · {formatTime(location.timestamp)}
              </ThemedText>
              {location.address ? (
                <ThemedText type="caption" style={{ color: theme.textSecondary }} numberOfLines={1}>
                  📍 {location.address}
                </ThemedText>
              ) : null}
            </View>
            <View style={[styles.stateBadge, { backgroundColor: meta.color + "22" }]}>
              <ThemedText type="caption" style={{ color: meta.color, fontWeight: "700" }}>
                {location.status === "IN_ZONE" ? "ACTIVE" : location.status}
              </ThemedText>
            </View>
          </View>
        );
      })}

      <Spacer height={Spacing.lg} />

      <ThemedText type="h3">Daily Compliance Report</ThemedText>
      <Spacer height={Spacing.sm} />
      {reports.map((report) => (
        <View key={`${report.user_id}-${report.session_date}`} style={[styles.reportCard, { backgroundColor: theme.backgroundDefault }]}>
          <View style={styles.reportHeader}>
            <ThemedText type="body" style={styles.rowTitle}>
              {report.employee_name}
            </ThemedText>
            <ThemedText type="h4" style={{ color: report.compliance_pct >= 90 ? Colors.light.success : Colors.light.warning }}>
              {report.compliance_pct}%
            </ThemedText>
          </View>
          <View style={styles.reportGrid}>
            <ReportMetric label="Check In" value={formatTime(report.checkin_time)} />
            <ReportMetric label="Check Out" value={formatTime(report.checkout_time)} />
            <ReportMetric label="Inside" value={`${report.time_in_zone_mins}m`} />
            <ReportMetric label="Outside" value={`${report.time_out_zone_mins}m`} />
            <ReportMetric label="Duration" value={`${report.total_duration_mins}m`} />
            <ReportMetric label="Violations" value={String(report.violation_count)} />
          </View>
        </View>
      ))}

      <Spacer height={Spacing.lg} />

      <ThemedText type="h3">Violation Trail</ThemedText>
      <Spacer height={Spacing.sm} />
      {violations.map((violation) => (
        <View key={violation.id} style={[styles.rowCard, { backgroundColor: theme.backgroundDefault }]}>
          <View style={[styles.statusIcon, { backgroundColor: Colors.light.errorBg }]}>
            <Feather name="alert-triangle" size={18} color={Colors.light.error} />
          </View>
          <View style={styles.rowBody}>
            <ThemedText type="body" style={styles.rowTitle}>
              {violation.employee?.name || "Unknown User"}
            </ThemedText>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              {violation.distance_m}m from {violation.office?.name || "assigned office"} | {formatTime(violation.violated_at)}
            </ThemedText>
          </View>
          <ThemedText type="caption" style={{ color: violation.resolved_at ? Colors.light.success : Colors.light.error }}>
            {violation.resolved_at ? "Resolved" : violation.escalated ? "Escalated" : "Open"}
          </ThemedText>
        </View>
      ))}
      <Spacer height={Spacing["2xl"]} />
    </ScreenScrollView>
  );
}

function SummaryTile({
  label,
  value,
  color,
  icon,
}: {
  label: string;
  value: number;
  color: string;
  icon: keyof typeof Feather.glyphMap;
}) {
  const { theme } = useTheme();

  return (
    <View style={[styles.summaryTile, { backgroundColor: theme.backgroundDefault }]}>
      <View style={[styles.statusIcon, { backgroundColor: color + "22" }]}>
        <Feather name={icon} size={17} color={color} />
      </View>
      <ThemedText type="h3">{value}</ThemedText>
      <ThemedText type="caption" style={{ color: theme.textSecondary }}>
        {label}
      </ThemedText>
    </View>
  );
}

function ReportMetric({ label, value }: { label: string; value: string }) {
  const { theme } = useTheme();

  return (
    <View style={styles.reportMetric}>
      <ThemedText type="caption" style={{ color: theme.textSecondary }}>
        {label}
      </ThemedText>
      <ThemedText type="small" style={styles.rowTitle}>
        {value}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: Spacing.md,
    alignItems: "center",
  },
  exportButtons: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  exportButton: {
    paddingHorizontal: Spacing.md,
  },
  summaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.md,
  },
  summaryTile: {
    flex: 1,
    minWidth: 140,
    padding: Spacing.lg,
    borderRadius: BorderRadius.md,
    gap: Spacing.xs,
  },
  filterPanel: {
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    gap: Spacing.md,
  },
  dateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  dateInput: {
    height: 42,
    minWidth: 150,
    borderWidth: 1,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
  },
  statusTabs: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  statusTab: {
    height: 34,
    justifyContent: "center",
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.full,
  },
  mapPanel: {
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    gap: Spacing.md,
  },
  sectionTitleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  mapSurface: {
    height: 260,
    borderRadius: BorderRadius.sm,
    overflow: "hidden",
    position: "relative" as const,
  },
  mapMarker: {
    position: "absolute",
    width: 30,
    height: 30,
    marginLeft: -15,
    marginTop: -15,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#FFFFFF",
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
  },
  rowCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.sm,
  },
  statusIcon: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontWeight: "700",
  },
  reportCard: {
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.sm,
    gap: Spacing.md,
  },
  reportHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  reportGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  reportMetric: {
    width: "31%",
    minWidth: 96,
    gap: 2,
  },
  stateBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: BorderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
});
