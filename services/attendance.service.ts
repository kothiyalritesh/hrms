import { supabase } from "@/lib/supabase";
import { GeofenceViolationService, GEOFENCE_CONFIG } from "./geofence-violation.service";

/** Haversine distance in metres between two GPS points */
function distanceMetres(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export class GeoFenceError extends Error {
  constructor(
    public readonly distanceMetres: number,
    public readonly radiusMetres: number,
    public readonly officeName: string,
    public readonly violationType: "warning" | "violation" = "violation"
  ) {
    super("GEO_FENCE_BLOCKED");
    this.name = "GeoFenceError";
  }
}

export const AttendanceService = {
  async getToday(userId: string) {
    const today = new Date().toISOString().split("T")[0];
    const { data, error } = await supabase
      .from("attendance_logs")
      .select("*")
      .eq("user_id", userId)
      .eq("date", today)
      .maybeSingle();

    if (error) throw error;
    return { data };
  },

  async checkOut({
    userId,
    location,
  }: {
    userId: string;
    location?: { latitude: number; longitude: number };
  }) {
    const today = new Date().toISOString().slice(0, 10);
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const istTimeString = `${today}T${hours}:${minutes}:${seconds}Z`;

    const { data, error } = await supabase
      .from("attendance_logs")
      .update({
        checkout_time: istTimeString,
        checkout_location: location ?? null,
        status: "CHECKED_OUT",
      })
      .eq("user_id", userId)
      .eq("date", today)
      .eq("status", "CHECKED_IN")
      .select()
      .single();

    if (error) throw error;
    return { data };
  },

  async officeCheckIn({
    userId,
    office,
    location,
    distance,
  }: {
    userId: string;
    office: any;
    location: any;
    distance: number;
  }) {
    if (!location) {
      throw new Error("GPS location is required to check in.");
    }

    const { data: allOffices } = await supabase
      .from("offices")
      .select("id, name, latitude, longitude, attendance_radius")
      .eq("is_active", true);

    let nearestOffice: any = null;
    let nearestDistance = Infinity;

    for (const o of allOffices || []) {
      if (o.latitude == null || o.longitude == null) continue;
      const d = distanceMetres(o.latitude, o.longitude, location.latitude, location.longitude);
      if (d < nearestDistance) {
        nearestDistance = d;
        nearestOffice = o;
      }
    }

    if (!nearestOffice) {
      nearestOffice = office;
      nearestDistance = distance;
    }

    const today = new Date().toISOString().slice(0, 10);
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const istTimeString = `${today}T${hours}:${minutes}:${seconds}Z`;

    // Check geofence violation
    const violationType = GeofenceViolationService.getViolationType(
      nearestDistance,
      GEOFENCE_CONFIG.SAFE_RADIUS,
      GEOFENCE_CONFIG.WARNING_RADIUS
    );

    // Record violation if applicable
    if (violationType !== "safe") {
      await GeofenceViolationService.recordViolation(
        userId,
        nearestOffice.id,
        nearestOffice.name,
        nearestDistance,
        istTimeString
      );

      // Notify manager
      await GeofenceViolationService.notifyManagerOfViolation(
        userId,
        nearestOffice.name,
        Math.round(nearestDistance),
        violationType
      ).catch(() => {});

      // Hard violation blocks check-in
      if (violationType === "violation") {
        throw new GeoFenceError(nearestDistance, GEOFENCE_CONFIG.SAFE_RADIUS, nearestOffice.name, "violation");
      }
    }

    await supabase
      .from("attendance_logs")
      .delete()
      .eq("user_id", userId)
      .eq("date", today);

    const { error } = await supabase
      .from("attendance_logs")
      .insert([{
        user_id: userId,
        date: today,
        attendance_type: "OFFICE",
        office_id: nearestOffice.id,
        checkin_location: location,
        distance_from_office: Math.round(nearestDistance),
        geofence_violation_type: violationType,
        status: "CHECKED_IN",
        checkin_time: istTimeString,
      }]);

    if (error) throw new Error(error.message);

    await supabase
      .from("profiles")
      .update({ office_id: nearestOffice.id })
      .eq("id", userId);

    try {
      const { triggerLocationMonitorStart } = await import("@/hooks/useGlobalLocationMonitor");
      triggerLocationMonitorStart?.();
    } catch { /* ignore if not mounted yet */ }
  },
};
