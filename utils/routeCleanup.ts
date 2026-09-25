/**
 * routeCleanup.ts
 * Enterprise-grade location cleaning & filtering engine (v3):
 * - Orthogonal GPS accuracy classification (HIGH <= 20m, ACCEPTABLE 20-50m, WEAK 50-100m, INVALID > 100m)
 * - Excludes mocked GPS points from visual route polyline
 * - Filters invalid / out-of-bounds coordinates (0,0 or null)
 * - Strict GPS accuracy filtering for route polyline (rejects points > 100m)
 * - Removes consecutive duplicate coordinates (< 1m)
 * - Context-aware impossible jump filtering (35 km/h for pedestrian site, 100 km/h for vehicle/township, 150 km/h in transit)
 * - Preserves recorded_at timestamps, accuracy, source, and tracking status
 */

import { BreadcrumbPoint } from "@/hooks/useSiteVisitBreadcrumbs";
import { GpsQualityStatus } from "@/types/location-database";

export interface CleanedRoutePoint extends BreadcrumbPoint {
  flagged_jump?: boolean;
  distance_from_prev_m?: number;
  gps_quality?: GpsQualityStatus;
}

export interface RouteCleanupOptions {
  maxAccuracyM?: number;
  rejectJumps?: boolean;
  isAtSite?: boolean;
  isVehicleSite?: boolean;
}

export function haversineDistanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function classifyGpsQuality(
  accuracy_m: number | null | undefined,
): GpsQualityStatus {
  if (accuracy_m == null || isNaN(accuracy_m)) return "INVALID";
  if (accuracy_m <= 20) return "HIGH";
  if (accuracy_m <= 50) return "ACCEPTABLE";
  if (accuracy_m <= 100) return "WEAK";
  return "INVALID";
}

// Backward compatibility alias
export const classifyGpsAccuracy = (acc: number | null | undefined): "HIGH" | "ACCEPTABLE" | "LOW" | "REJECT" => {
  const q = classifyGpsQuality(acc);
  if (q === "HIGH") return "HIGH";
  if (q === "ACCEPTABLE") return "ACCEPTABLE";
  if (q === "WEAK") return "LOW";
  return "REJECT";
};

export function cleanRouteBreadcrumbs(
  rawPoints: BreadcrumbPoint[],
  options: RouteCleanupOptions = {},
): CleanedRoutePoint[] {
  if (!rawPoints || rawPoints.length === 0) return [];

  const maxAccuracy = options.maxAccuracyM ?? 100;
  const rejectJumps = options.rejectJumps ?? false;
  const maxAllowedSpeedKmH = options.isAtSite
    ? (options.isVehicleSite ? 100 : 35)
    : 150;

  const cleaned: CleanedRoutePoint[] = [];

  for (const pt of rawPoints) {
    // 1. Exclude mocked locations
    if ((pt as any).mocked === true || pt.quality_status === "MOCKED") {
      continue;
    }

    // 2. Validate coordinate bounds
    if (
      pt.latitude == null ||
      pt.longitude == null ||
      isNaN(pt.latitude) ||
      isNaN(pt.longitude) ||
      (Math.abs(pt.latitude) < 0.001 && Math.abs(pt.longitude) < 0.001) ||
      pt.latitude < -90 ||
      pt.latitude > 90 ||
      pt.longitude < -180 ||
      pt.longitude > 180
    ) {
      continue;
    }

    // 3. Reject bad accuracy points (> 100m) from route polyline
    const gpsQuality = classifyGpsQuality(pt.accuracy_m);
    if (pt.accuracy_m != null && pt.accuracy_m > maxAccuracy) {
      continue;
    }

    // 4. Duplicate removal & jump detection
    if (cleaned.length > 0) {
      const prev = cleaned[cleaned.length - 1];
      const dist = haversineDistanceM(prev.latitude, prev.longitude, pt.latitude, pt.longitude);
      if (dist < 1) {
        // Less than 1 meter difference; skip duplicate ping
        continue;
      }

      // Check for impossible speed jumps
      const prevTime = new Date(prev.recorded_at).getTime();
      const currTime = new Date(pt.recorded_at).getTime();
      const deltaSec = Math.max(0.5, Math.abs(currTime - prevTime) / 1000);
      const speedKmH = (dist / deltaSec) * 3.6;
      const isJump = speedKmH > maxAllowedSpeedKmH;

      if (isJump && rejectJumps) {
        // Skip teleportation / cell-tower jump point from polyline
        continue;
      }

      const item: CleanedRoutePoint = {
        ...pt,
        distance_from_prev_m: Math.round(dist),
        flagged_jump: isJump,
        gps_quality: gpsQuality,
      };
      cleaned.push(item);
    } else {
      cleaned.push({
        ...pt,
        distance_from_prev_m: 0,
        flagged_jump: false,
        gps_quality: gpsQuality,
      });
    }
  }

  return cleaned;
}
