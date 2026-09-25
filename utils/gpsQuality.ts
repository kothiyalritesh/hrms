/**
 * gpsQuality.ts
 * Enterprise Visit Summary & Route Quality Intelligence Engine:
 * - Computes high-level summary metrics (Distance, Duration, Point Count, Avg Accuracy)
 * - Derives actionable Visit Summary Analytics:
 *   • Travel distance vs On-site distance
 *   • First arrival timestamp & last location timestamp
 *   • GPS gaps count (telemetry intervals > 2 minutes)
 *   • GPS quality percentage (ratio of high/acceptable fixes)
 *   • Tracking uptime percentage
 */

import { CleanedRoutePoint, haversineDistanceM } from "./routeCleanup";
import { BreadcrumbPoint } from "@/hooks/useSiteVisitBreadcrumbs";

export interface RouteQualitySummary {
  distanceKm: number;
  durationMinutes: number;
  pointCount: number;
  avgAccuracyM: number;
  hasGpsJumps: boolean;
}

export interface VisitSummaryMetrics {
  durationMinutes: number;
  travelDistanceKm: number;
  onsiteDistanceKm: number;
  totalDistanceKm: number;
  firstArrivalAt: string | null;
  lastLocationAt: string | null;
  gpsGapsCount: number;
  gpsQualityPct: number;
  trackingUptimePct: number;
  offlineMinutes: number;
  totalBreadcrumbs: number;
}

export function computeRouteQuality(points: CleanedRoutePoint[]): RouteQualitySummary {
  if (!points || points.length === 0) {
    return {
      distanceKm: 0,
      durationMinutes: 0,
      pointCount: 0,
      avgAccuracyM: 0,
      hasGpsJumps: false,
    };
  }

  let totalDistanceM = 0;
  let totalAccuracyM = 0;
  let accuracyCount = 0;
  let hasGpsJumps = false;

  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    if (pt.distance_from_prev_m) {
      totalDistanceM += pt.distance_from_prev_m;
    }
    if (pt.flagged_jump) {
      hasGpsJumps = true;
    }
    if (pt.accuracy_m != null && !isNaN(pt.accuracy_m)) {
      totalAccuracyM += pt.accuracy_m;
      accuracyCount++;
    }
  }

  const startTime = new Date(points[0].recorded_at).getTime();
  const endTime = new Date(points[points.length - 1].recorded_at).getTime();
  const durationMs = Math.max(0, endTime - startTime);
  const durationMinutes = Math.round(durationMs / 60000);

  return {
    distanceKm: Number((totalDistanceM / 1000).toFixed(2)),
    durationMinutes,
    pointCount: points.length,
    avgAccuracyM: accuracyCount > 0 ? Math.round(totalAccuracyM / accuracyCount) : 0,
    hasGpsJumps,
  };
}

/**
 * Computes enterprise-grade Visit Summary intelligence metrics from raw breadcrumbs:
 * - Distinguishes travel vs on-site distance
 * - Identifies GPS gaps (> 2 minutes without fix)
 * - Evaluates GPS fix quality ratio & tracking uptime
 */
export function computeVisitSummary(
  rawPoints: BreadcrumbPoint[],
  options: { checkinTime?: string | null } = {},
): VisitSummaryMetrics {
  if (!rawPoints || rawPoints.length === 0) {
    return {
      durationMinutes: 0,
      travelDistanceKm: 0,
      onsiteDistanceKm: 0,
      totalDistanceKm: 0,
      firstArrivalAt: null,
      lastLocationAt: null,
      gpsGapsCount: 0,
      gpsQualityPct: 100,
      trackingUptimePct: 100,
      offlineMinutes: 0,
      totalBreadcrumbs: 0,
    };
  }

  const sorted = [...rawPoints].sort(
    (a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime(),
  );

  const firstPt = sorted[0];
  const lastPt = sorted[sorted.length - 1];
  const startTime = new Date(firstPt.recorded_at).getTime();
  const endTime = new Date(lastPt.recorded_at).getTime();
  const durationMinutes = Math.max(1, Math.round((endTime - startTime) / 60000));

  let travelDistanceM = 0;
  let onsiteDistanceM = 0;
  let highQualityCount = 0;
  let gpsGapsCount = 0;
  let gapDurationMs = 0;

  const checkinTimeMs = options.checkinTime ? new Date(options.checkinTime).getTime() : null;

  for (let i = 0; i < sorted.length; i++) {
    const pt = sorted[i];

    // Quality ratio: accuracy <= 50m is considered high/acceptable quality
    if (pt.accuracy_m != null && pt.accuracy_m <= 50 && pt.quality_status !== "MOCKED") {
      highQualityCount++;
    }

    if (i > 0) {
      const prev = sorted[i - 1];
      const prevTime = new Date(prev.recorded_at).getTime();
      const currTime = new Date(pt.recorded_at).getTime();
      const deltaSec = Math.max(0, (currTime - prevTime) / 1000);

      // Distance calculation
      const dist = haversineDistanceM(prev.latitude, prev.longitude, pt.latitude, pt.longitude);
      const isPostArrival = checkinTimeMs ? currTime >= checkinTimeMs : false;

      if (isPostArrival) {
        onsiteDistanceM += dist;
      } else {
        travelDistanceM += dist;
      }

      // GPS Gap Detection: silence > 120 seconds (2 minutes)
      if (deltaSec > 120) {
        gpsGapsCount++;
        gapDurationMs += (currTime - prevTime);
      }
    }
  }

  const totalDistanceM = travelDistanceM + onsiteDistanceM;
  const gpsQualityPct = Number(((highQualityCount / sorted.length) * 100).toFixed(1));
  const totalDurationMs = Math.max(1000, endTime - startTime);
  const trackingUptimePct = Number(
    Math.max(0, Math.min(100, 100 - (gapDurationMs / totalDurationMs) * 100)).toFixed(1),
  );
  const offlineMinutes = Math.round(gapDurationMs / 60000);

  return {
    durationMinutes,
    travelDistanceKm: Number((travelDistanceM / 1000).toFixed(2)),
    onsiteDistanceKm: Number((onsiteDistanceM / 1000).toFixed(2)),
    totalDistanceKm: Number((totalDistanceM / 1000).toFixed(2)),
    firstArrivalAt: options.checkinTime || null,
    lastLocationAt: lastPt.recorded_at,
    gpsGapsCount,
    gpsQualityPct,
    trackingUptimePct,
    offlineMinutes,
    totalBreadcrumbs: sorted.length,
  };
}
