/**
 * ObserverDetailDrawer.tsx
 * Bottom drawer for selected employee and site visit details (v3):
 * - Employee profile, Department, Employee Number
 * - Orthogonal Badges:
 *   • Tracking Health: Live (<15s), Delayed (15-60s), Stale (>60s), Offline
 *   • GPS Quality: High (<=20m), Acceptable (20-50m), Weak (>50m), Invalid (>100m/mock)
 * - Telemetry Grid: Source, Last Fix vs Last Upload, Accuracy, Speed
 * - Visit Summary Scorecard: Duration, Travel vs On-Site distance, Uptime %, Quality %, GPS gaps
 * - Chronological today's visits list
 */

import React from "react";
import { View, StyleSheet, TouchableOpacity, ScrollView, Platform } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, Spacing } from "@/constants/theme";
import {
  GpsQualityStatus,
  SiteVisitObserverEmployee,
  SiteVisitObserverVisit,
  TrackingHealthStatus,
} from "@/types/location-database";
import { RouteQualitySummary, VisitSummaryMetrics } from "@/utils/gpsQuality";
import { toTitleCase, formatFieldVisitTime } from "@/utils/format";

export interface ObserverDetailDrawerProps {
  employee: SiteVisitObserverEmployee | null;
  selectedVisit: SiteVisitObserverVisit | null;
  onSelectVisit: (visit: SiteVisitObserverVisit) => void;
  onClose: () => void;
  routeQuality: RouteQualitySummary | null;
  visitSummary?: VisitSummaryMetrics | null;
}

export function computeTrackingHealth(
  lastUploadedAt?: string | null,
  pendingCount?: number,
  isTampered?: boolean,
): TrackingHealthStatus {
  if (isTampered) return "TAMPERED";
  if (pendingCount && pendingCount > 0) return "OFFLINE";
  if (!lastUploadedAt) return "STALE";
  const ageSeconds = (Date.now() - new Date(lastUploadedAt).getTime()) / 1000;
  if (ageSeconds > 60) return "STALE";
  if (ageSeconds > 15) return "DELAYED";
  return "ACTIVE";
}

export function computeGpsQuality(accuracy?: number | null): GpsQualityStatus {
  if (accuracy == null || isNaN(accuracy)) return "INVALID";
  if (accuracy <= 20) return "HIGH";
  if (accuracy <= 50) return "ACCEPTABLE";
  if (accuracy <= 100) return "WEAK";
  return "INVALID";
}

export default function ObserverDetailDrawer({
  employee,
  selectedVisit,
  onSelectVisit,
  onClose,
  routeQuality,
  visitSummary,
}: ObserverDetailDrawerProps) {
  const { theme } = useTheme();

  if (!employee) return null;

  const tracking = employee.tracking || ({} as any);
  const trackingStatus = tracking.status || "AT_SITE";

  const isTampered =
    tracking.quality_status === "MOCKED" ||
    tracking.quality_status === "IMPOSSIBLE_SPEED" ||
    Boolean(tracking.mocked) ||
    Boolean(routeQuality?.hasGpsJumps);

  // Orthogonal evaluation: Tracking Health vs GPS Quality
  const healthStatus: TrackingHealthStatus =
    tracking.tracking_health ||
    computeTrackingHealth(tracking.last_uploaded_at || tracking.updated_at, tracking.pending_ping_count);
    computeTrackingHealth(
      tracking.last_uploaded_at || tracking.updated_at,
      tracking.pending_ping_count,
      isTampered,
    );

  const gpsQuality: GpsQualityStatus =
    tracking.gps_quality || computeGpsQuality(tracking.accuracy);

  // Status badge
  const getStatusBadge = () => {
    switch (trackingStatus) {
      case "AT_SITE":
        return { label: "At Site", color: "#10B981", bg: "#ECFDF5", icon: "check-circle" };
      case "IN_TRANSIT":
        return { label: "In Transit", color: "#6366F1", bg: "#EEF2FF", icon: "navigation" };
      case "SIGNAL_LOST":
        return { label: "Signal Lost", color: "#EF4444", bg: "#FEF2F2", icon: "alert-triangle" };
      default:
        return { label: "Completed", color: "#4B5563", bg: "#F3F4F6", icon: "flag" };
    }
  };

  // Tracking Health Badge (Device / Network connection status)
  const getHealthBadge = () => {
    switch (healthStatus) {
      case "TAMPERED":
        return {
          label: "⚠️ Tampered / Mock GPS",
          color: "#DC2626",
          bg: "#FEF2F2",
          dot: "#DC2626",
        };
      case "ACTIVE":
        return { label: "Live", color: "#10B981", bg: "#ECFDF5", dot: "#10B981" };
      case "DELAYED":
        return { label: "Delayed (15-60s)", color: "#F59E0B", bg: "#FFFBEB", dot: "#F59E0B" };
      case "OFFLINE":
        return {
          label: `Offline (${tracking.pending_ping_count || 1} queued)`,
          color: "#8B5CF6",
          bg: "#F5F3FF",
          dot: "#8B5CF6",
        };
      case "STALE":
      default:
        return { label: "Stale (>60s)", color: "#EF4444", bg: "#FEF2F2", dot: "#EF4444" };
    }
  };

  // GPS Quality Badge (Hardware satellite accuracy)
  const getGpsBadge = () => {
    const accStr = tracking.accuracy != null ? ` ±${Math.round(tracking.accuracy)}m` : "";
    switch (gpsQuality) {
      case "HIGH":
        return { label: `GPS High${accStr}`, color: "#10B981", bg: "#ECFDF5" };
      case "ACCEPTABLE":
        return { label: `GPS Acceptable${accStr}`, color: "#3B82F6", bg: "#EFF6FF" };
      case "WEAK":
        return { label: `GPS Weak${accStr}`, color: "#F97316", bg: "#FFF7ED" };
      case "INVALID":
      default:
        return { label: `GPS Invalid${accStr}`, color: "#EF4444", bg: "#FEF2F2" };
    }
  };

  const formatSource = (src?: string | null) => {
    if (!src) return "Foreground";
    if (src === "background") return "Background";
    if (src === "web") return "Web PWA";
    return "Foreground";
  };

  const statusBadge = getStatusBadge();
  const healthBadge = getHealthBadge();
  const gpsBadge = getGpsBadge();

  const formatTime = (ts?: string | null) => {
    if (!ts) return "—";
    try {
      return new Date(ts).toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      });
    } catch {
      return ts;
    }
  };

  return (
    <View style={[s.container, { backgroundColor: theme.backgroundDefault, borderTopColor: theme.border }]}>
      {/* Top Header with Profile and Orthogonal Badges */}
      <View style={s.drawerHeader}>
        <View style={{ flex: 1 }}>
          <View style={s.nameRow}>
            <ThemedText type="h4">{toTitleCase(employee.name)}</ThemedText>
            <View style={[s.statusPill, { backgroundColor: statusBadge.bg, borderColor: statusBadge.color }]}>
              <Feather name={statusBadge.icon as any} size={11} color={statusBadge.color} />
              <ThemedText style={[s.statusPillText, { color: statusBadge.color }]}>
                {statusBadge.label}
              </ThemedText>
            </View>
            <View style={[s.healthPill, { backgroundColor: healthBadge.bg, borderColor: healthBadge.color }]}>
              <View style={[s.healthDot, { backgroundColor: healthBadge.dot }]} />
              <ThemedText style={[s.healthPillText, { color: healthBadge.color }]}>
                {healthBadge.label}
              </ThemedText>
            </View>
            <View style={[s.healthPill, { backgroundColor: gpsBadge.bg, borderColor: gpsBadge.color }]}>
              <Feather name="navigation" size={10} color={gpsBadge.color} />
              <ThemedText style={[s.healthPillText, { color: gpsBadge.color }]}>
                {gpsBadge.label}
              </ThemedText>
            </View>
          </View>
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            {employee.employee_no ?? ""} · {employee.department ?? "Field Operations"} · {employee.office_name ?? ""}
          </ThemedText>
        </View>

        <TouchableOpacity style={s.closeBtn} onPress={onClose}>
          <Feather name="x" size={18} color={theme.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Real-time GPS Telemetry Grid */}
      <View style={[s.telemetryRow, { backgroundColor: theme.backgroundRoot }]}>
        <View style={s.telemetryItem}>
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            Telemetry Source
          </ThemedText>
          <ThemedText style={[s.telemetryValue, { color: "#6366F1" }]}>
            {formatSource(tracking.source)}
          </ThemedText>
        </View>

        <View style={s.telemetryItem}>
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            GPS Accuracy
          </ThemedText>
          <ThemedText style={s.telemetryValue}>
            {tracking.accuracy != null ? `±${Math.round(tracking.accuracy)}m` : "—"}
          </ThemedText>
        </View>

        <View style={s.telemetryItem}>
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            Last GPS Fix
          </ThemedText>
          <ThemedText style={s.telemetryValue}>
            {formatTime(tracking.last_location_at || tracking.updated_at)}
          </ThemedText>
        </View>

        <View style={s.telemetryItem}>
          <ThemedText type="caption" style={{ color: theme.textSecondary }}>
            Last Upload
          </ThemedText>
          <ThemedText style={s.telemetryValue}>
            {formatTime(tracking.last_uploaded_at || tracking.updated_at)}
          </ThemedText>
        </View>

        {tracking.speed_mps != null && (
          <View style={s.telemetryItem}>
            <ThemedText type="caption" style={{ color: theme.textSecondary }}>
              Speed
            </ThemedText>
            <ThemedText style={s.telemetryValue}>
              {`${(tracking.speed_mps * 3.6).toFixed(0)} km/h`}
            </ThemedText>
          </View>
        )}
      </View>

      {/* Visit Summary Intelligence Layer (Section 7) */}
      {selectedVisit && (visitSummary || (routeQuality && routeQuality.pointCount > 0)) && (
        <View style={[s.routeQualityBox, { borderColor: "#8B5CF6", backgroundColor: "#FAF5FF" }]}>
          <View style={s.routeQualityTitle}>
            <Feather name="bar-chart-2" size={13} color="#7C3AED" />
            <ThemedText style={s.routeQualityHeading}>Visit Summary Intelligence</ThemedText>
          </View>
          <View style={s.routeQualityGrid}>
            <ThemedText style={s.routeMetric}>
              Duration: <ThemedText style={s.routeMetricVal}>
                {visitSummary ? `${visitSummary.durationMinutes} min` : `${routeQuality?.durationMinutes} min`}
              </ThemedText>
            </ThemedText>
            <ThemedText style={s.routeMetric}>
              Travel: <ThemedText style={s.routeMetricVal}>
                {visitSummary ? `${visitSummary.travelDistanceKm} km` : `${routeQuality?.distanceKm} km`}
              </ThemedText>
            </ThemedText>
            {visitSummary && (
              <ThemedText style={s.routeMetric}>
                On-Site: <ThemedText style={s.routeMetricVal}>{visitSummary.onsiteDistanceKm} km</ThemedText>
              </ThemedText>
            )}
            <ThemedText style={s.routeMetric}>
              Uptime: <ThemedText style={s.routeMetricVal}>
                {visitSummary ? `${visitSummary.trackingUptimePct}%` : "100%"}
              </ThemedText>
            </ThemedText>
            <ThemedText style={s.routeMetric}>
              GPS Quality: <ThemedText style={s.routeMetricVal}>
                {visitSummary ? `${visitSummary.gpsQualityPct}%` : `${routeQuality?.avgAccuracyM}m avg`}
              </ThemedText>
            </ThemedText>
            {visitSummary && visitSummary.gpsGapsCount > 0 && (
              <ThemedText style={s.routeMetric}>
                Gaps: <ThemedText style={[s.routeMetricVal, { color: "#EF4444" }]}>
                  {visitSummary.gpsGapsCount}
                </ThemedText>
              </ThemedText>
            )}
          </View>
        </View>
      )}

      {/* Chronological Visits List */}
      <View style={s.visitsSection}>
        <ThemedText type="caption" style={[s.sectionTitle, { color: theme.textSecondary }]}>
          TODAY'S FIELD VISITS ({employee.visits.length})
        </ThemedText>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.visitsList}>
          {employee.visits.map((v) => {
            const isVisitSelected = selectedVisit?.visit_id === v.visit_id;
            return (
              <TouchableOpacity
                key={`drawer-v-${v.visit_id}`}
                style={[
                  s.visitCard,
                  { backgroundColor: theme.backgroundRoot, borderColor: theme.border },
                  isVisitSelected && { borderColor: "#7C3AED", backgroundColor: "#F5F3FF", borderWidth: 2 },
                ]}
                onPress={() => onSelectVisit(v)}
              >
                <ThemedText style={s.visitProject}>
                  {v.project_name || v.location_name || "Site Visit"}
                </ThemedText>
                {v.client_name && (
                  <ThemedText type="caption" style={{ color: theme.textSecondary }}>
                    Client: {v.client_name}
                  </ThemedText>
                )}
                <View style={s.visitMetaRow}>
                  <ThemedText type="caption" style={s.visitStatusText}>
                    {v.status}
                  </ThemedText>
                  {v.checkin_time && (
                    <ThemedText type="caption" style={{ color: "#10B981" }}>
                      In: {new Date(v.checkin_time).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                      In: {formatFieldVisitTime(v.checkin_time)}
                    </ThemedText>
                  )}
                  {v.checkout_time && (
                    <ThemedText type="caption" style={{ color: "#6B7280" }}>
                      Out: {new Date(v.checkout_time).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                      Out: {formatFieldVisitTime(v.checkout_time)}
                    </ThemedText>
                  )}
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    borderTopWidth: Platform.OS !== "web" ? 1 : 0,
    padding: Spacing.md,
    gap: 10,
    maxHeight: Platform.OS === "web" ? "100%" : 360,
  },
  drawerHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    gap: 4,
  },
  statusPillText: {
    fontSize: 10,
    fontWeight: "700",
  },
  healthPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    gap: 4,
  },
  healthDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  healthPillText: {
    fontSize: 10,
    fontWeight: "700",
  },
  closeBtn: {
    padding: 4,
  },
  telemetryRow: {
    flexDirection: "row",
    borderRadius: BorderRadius.md,
    padding: 8,
    justifyContent: "space-around",
  },
  telemetryItem: {
    alignItems: "center",
  },
  telemetryValue: {
    fontSize: 11,
    fontWeight: "700",
    marginTop: 2,
  },
  routeQualityBox: {
    padding: 8,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    gap: 4,
  },
  routeQualityTitle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  routeQualityHeading: {
    fontSize: 11,
    fontWeight: "700",
    color: "#7C3AED",
  },
  routeQualityGrid: {
    flexDirection: "row",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 6,
  },
  routeMetric: {
    fontSize: 11,
    color: "#6B7280",
  },
  routeMetricVal: {
    fontWeight: "700",
    color: "#1F2937",
  },
  visitsSection: {
    gap: 6,
  },
  sectionTitle: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  visitsList: {
    flexGrow: 0,
  },
  visitCard: {
    padding: 8,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    marginRight: 8,
    minWidth: 140,
  },
  visitProject: {
    fontSize: 12,
    fontWeight: "700",
  },
  visitMetaRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 4,
  },
  visitStatusText: {
    fontWeight: "600",
    color: "#4B5563",
  },
});
