import { supabase } from "@/lib/supabase";
import { BusinessClockService } from "@/services/business-clock.service";
import { syncTrackingDestination } from "@/services/location/attendanceTrackingLifecycle";
import { businessDateUtcRange } from "@/utils/businessDate";
import { firstRpcRow } from "@/utils/supabaseRpc";
import * as Crypto from "expo-crypto";
import { hasValidCoordinates } from "@/utils/gps";

export interface FieldVisit {
  id: string;
  user_id: string;
  /** Verification child rows point back to the stop they visually replace. */
  source_field_visit_id?: string;
  activity_log_id?: string;
  predefined_site_id?: string; // set when user picks from dropdown
  visit_type: "site" | "meeting" | "office" | "others";
  location_name: string;
  location_address?: string;
  destination_coords?: { latitude: number; longitude: number };
  checkin_radius_m?: number; // 100 for predefined sites, 500 for offices
  meeting_type?: "client" | "channel_partner";
  contact_name?: string;
  contact_phone?: string;
  company_name?: string;
  project_name?: string;
  notes?: string;
  checkin_time?: string;
  checkin_location?: { latitude: number; longitude: number };
  checkout_time?: string;
  checkout_location?: { latitude: number; longitude: number };
  checkout_notes?: string;
  status: "PENDING" | "CHECKED_IN" | "COMPLETED" | "MISSED" | "IN_TRANSIT";
  date: string;
  created_at: string;
  origin_lat?: number;
  origin_lon?: number;
  origin_name?: string;
  selected_site_id?: string;
  selected_site_latitude?: number;
  selected_site_longitude?: number;
  selected_site_radius_metres?: number;
  selected_site_distance_metres?: number;
  location_match_status?:
    | "MATCHED"
    | "MISMATCHED"
    | "CURRENT_LOCATION_MARKED"
    | "LOW_ACCURACY"
    | "MOCK_LOCATION_FLAGGED";
  actual_latitude?: number;
  actual_longitude?: number;
  actual_location_accuracy_metres?: number;
  actual_location_address?: string;
  actual_location_name?: string;
  location_mismatch_reason?: string;
  visit_purpose?: string;
  evidence_photo_added?: boolean;
  verification_status?:
    | "PENDING"
    | "APPROVED"
    | "REJECTED"
    | "NEEDS_INFORMATION"
    | "FLAGGED";
  journey_status?: import("@/services/location/types").JourneyStatus;
  tracking_started_at?: string;
  approach_1km_notified_at?: string;
  approach_500m_notified_at?: string;
  arrived_at?: string;
  departed_at?: string;
  last_distance_m?: number;
  last_distance_at?: string;
  reviewer_notes?: string;
}

/**
 * A current-location submission is stored as a separate, server-protected row
 * for review and audit purposes. In the employee workflow it is still the same
 * stop, so render the submission in place of its source instead of counting and
 * displaying both records as separate visits.
 */
export function collapseCurrentLocationSubmissions(
  visits: FieldVisit[],
): FieldVisit[] {
  const latestSubmissionBySource = new Map<string, string>();
  for (const visit of visits) {
    if (visit.source_field_visit_id) {
      // Both employee queries are ordered oldest-first, so the final child for
      // a source is its latest verification submission.
      latestSubmissionBySource.set(visit.source_field_visit_id, visit.id);
    }
  }

  return visits.filter((visit) => {
    if (latestSubmissionBySource.has(visit.id)) return false;
    if (!visit.source_field_visit_id) return true;
    return (
      latestSubmissionBySource.get(visit.source_field_visit_id) === visit.id
    );
  });
}

function confirmedVisitMutation(
  data: unknown,
  expected: {
    visitId?: string;
    status: FieldVisit["status"];
    timestamp?: "checkin_time" | "checkout_time";
  },
) {
  const response = firstRpcRow<any>(data);
  const visit = response?.visit;
  if (response?.success === false) {
    throw new Error(
      response.message || "The field visit action was rejected by the server.",
    );
  }
  if (
    response?.success !== true ||
    !visit?.id ||
    (expected.visitId && visit.id !== expected.visitId) ||
    visit.status !== expected.status ||
    (expected.timestamp && !visit[expected.timestamp])
  ) {
    throw new Error(
      `The server did not confirm field visit ${expected.status}.`,
    );
  }
  return visit as FieldVisit;
}

export const FieldVisitService = {
  async createVisit(params: {
    userId: string;
    activityLogId?: string;
    predefinedSiteId?: string;
    visitType: "site" | "meeting" | "office" | "others";
    locationName: string;
    locationAddress?: string;
    destinationCoords?: { latitude: number; longitude: number };
    checkinRadiusM?: number;
    meetingType?: "client" | "channel_partner";
    contactName?: string;
    contactPhone?: string;
    companyName?: string;
    projectName?: string;
    notes?: string;
    googlePlaceId?: string;
    locationSource?:
      | "GOOGLE_PLACE"
      | "MAP_PIN"
      | "CURRENT_LOCATION"
      | "PREDEFINED_SITE"
      | "MANUAL_COORDINATES";
    idempotencyKey?: string;
  }): Promise<{ data: FieldVisit | null; error: any }> {
    const VALID_VISIT_TYPES = ["site", "meeting", "office", "others"] as const;
    const safeVisitType = VALID_VISIT_TYPES.includes(params.visitType as any)
      ? params.visitType
      : "others";

    if (
      !params.destinationCoords ||
      !hasValidCoordinates(params.destinationCoords)
    ) {
      return {
        data: null,
        error: new Error(
          "Confirm a valid destination pin before starting the field visit.",
        ),
      };
    }

    // Get origin coordinates for In Transit calculation
    const today = await BusinessClockService.getDate(true);
    let originLat: number | null = null;
    let originLng: number | null = null;
    let originName: string | null = null;

    try {
      const { supabase } = await import("@/lib/supabase");

      // Priority 1: Last GPS ping from location_tracking
      const range = businessDateUtcRange(today);
      const { data: lastPing, error: lastPingError } = await supabase
        .from("location_tracking")
        .select("latitude, longitude")
        .eq("user_id", params.userId)
        .gte("recorded_at", range.start)
        .lt("recorded_at", range.end)
        .order("recorded_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastPingError) throw lastPingError;

      if (
        lastPing &&
        hasValidCoordinates({
          latitude: Number(lastPing.latitude),
          longitude: Number(lastPing.longitude),
        })
      ) {
        originLat = lastPing.latitude;
        originLng = lastPing.longitude;
        originName = "Current Location";
      } else {
        // Priority 2: Office check-in location from attendance_logs
        const { data: attendance } = await supabase
          .from("attendance_logs")
          .select("checkin_location, offices(name)")
          .eq("user_id", params.userId)
          .eq("date", today)
          .maybeSingle();

        if (
          attendance?.checkin_location &&
          hasValidCoordinates(attendance.checkin_location)
        ) {
          originLat = attendance.checkin_location.latitude;
          originLng = attendance.checkin_location.longitude;
          originName = attendance.offices?.name || "Office";
        }
      }
    } catch (err) {
      console.warn("Failed to get origin coordinates for transit:", err);
    }

    // ── Build the insert payload ───────────────────────────────────────────────
    // All these columns exist in the original create_field_visits.sql schema.
    // dest_lat/dest_lon are the ONLY columns that don't exist until the migration
    // is run — so we exclude them here and read coords from destination_coords JSONB
    // or predefined_sites table at check-in time instead.
    const fullPayload: Record<string, any> = {
      user_id: params.userId,
      visit_type: safeVisitType,
      location_name: params.locationName,
      status: "PENDING",
      date: today,
      activity_log_id: params.activityLogId ?? null,
      predefined_site_id: params.predefinedSiteId ?? null,
      location_address: params.locationAddress ?? null,
      destination_coords: params.destinationCoords ?? null, // JSONB — always works
      checkin_radius_m: params.checkinRadiusM ?? null,
      meeting_type: params.meetingType ?? null,
      contact_name: params.contactName ?? null,
      contact_phone: params.contactPhone ?? null,
      company_name: params.companyName ?? null,
      project_name: params.projectName ?? null,
      notes: params.notes ?? null,
      origin_lat: originLat,
      origin_lon: originLng,
      origin_name: originName,
      google_place_id: params.googlePlaceId ?? null,
      location_source:
        params.locationSource ??
        (params.predefinedSiteId ? "PREDEFINED_SITE" : "MAP_PIN"),
      employee_notes: params.notes ?? null,
      idempotency_key: params.idempotencyKey ?? Crypto.randomUUID(),
    };

    const { data: rpcData, error } = await supabase.rpc(
      "rpc_mutate_own_field_visit",
      { p_action: "CREATE", p_visit_id: null, p_values: fullPayload },
    );
    const result = Array.isArray(rpcData) ? rpcData[0] : rpcData;
    if (error) return { data: null, error };
    try {
      const data = confirmedVisitMutation(result, { status: "PENDING" });
      void syncTrackingDestination(data.id);
      return { data, error: null };
    } catch (confirmationError) {
      return { data: null, error: confirmationError };
    }
  },

  async getTodayVisits(
    userId: string,
  ): Promise<{ data: FieldVisit[]; error: any }> {
    const today = await BusinessClockService.getDate(true);
    const { data, error } = await supabase
      .from("field_visits")
      .select("*")
      .eq("user_id", userId)
      .eq("date", today)
      .order("created_at", { ascending: true });
    return { data: collapseCurrentLocationSubmissions(data || []), error };
  },

  async getPendingVisits(
    userId: string,
  ): Promise<{ data: FieldVisit[]; error: any }> {
    const today = await BusinessClockService.getDate(true);
    const { data, error } = await supabase
      .from("field_visits")
      .select("*")
      .eq("user_id", userId)
      .eq("date", today)
      .in("status", ["PENDING", "CHECKED_IN"])
      .order("created_at", { ascending: true });
    return { data: collapseCurrentLocationSubmissions(data || []), error };
  },

  async checkIn(
    visitId: string,
    location: import("@/utils/gps").GPSCoords,
  ): Promise<{ data: FieldVisit | null; error: any }> {
    // Store as UTC ISO string with Z — Supabase TIMESTAMPTZ will preserve it correctly
    const { data, error } = await supabase.rpc("rpc_mutate_own_field_visit", {
      p_action: "CHECK_IN",
      p_visit_id: visitId,
      p_values: {
        latitude: location.latitude,
        longitude: location.longitude,
        accuracy: location.accuracy,
        captured_at: location.capturedAt,
        provider: location.provider,
        mocked: location.mocked ?? false,
      },
    });
    if (error) return { data: null, error };
    try {
      const confirmed = confirmedVisitMutation(data, {
        visitId,
        status: "CHECKED_IN",
        timestamp: "checkin_time",
      });
      void syncTrackingDestination(visitId);
      return { data: confirmed, error: null };
    } catch (confirmationError) {
      return { data: null, error: confirmationError };
    }
  },

  async checkInAtSelectedSite(
    visitId: string,
    location: import("@/utils/gps").GPSCoords,
  ): Promise<{ data: FieldVisit | null; error: any }> {
    const { data, error } = await supabase.rpc(
      "check_in_field_visit_at_selected_site",
      {
        p_visit_id: visitId,
        p_latitude: location.latitude,
        p_longitude: location.longitude,
        p_accuracy_metres: location.accuracy,
        p_captured_at: location.capturedAt,
        p_location_provider: location.provider,
        p_mocked_location: location.mocked ?? false,
      },
    );
    if (error) return { data: null, error };
    const response = firstRpcRow<any>(data);
    if (
      response?.success !== true ||
      response?.visit_id !== visitId ||
      response?.status !== "CHECKED_IN" ||
      !response?.checkin_time
    ) {
      return {
        data: null,
        error: new Error(
          response?.message ||
            "The server did not confirm selected-site field visit check-in.",
        ),
      };
    }
    void syncTrackingDestination(visitId);
    return {
      data: {
        id: response.visit_id,
        status: response.status,
        checkin_time: response.checkin_time,
      } as FieldVisit,
      error: null,
    };
  },

  async checkOut(
    visitId: string,
    location: import("@/utils/gps").GPSCoords,
    notes?: string,
    nearestOfficeId?: string,
    evidencePhotoPath?: string,
  ): Promise<{ data: FieldVisit | null; error: any }> {
    const { data, error } = await supabase.rpc("rpc_mutate_own_field_visit", {
      p_action: "CHECK_OUT",
      p_visit_id: visitId,
      p_values: {
        latitude: location.latitude,
        longitude: location.longitude,
        accuracy: location.accuracy,
        captured_at: location.capturedAt,
        provider: location.provider,
        mocked: location.mocked ?? false,
        notes: notes || null,
        nearest_office_id: nearestOfficeId || null,
        evidence_photo_path: evidencePhotoPath || null,
      },
    });
    if (error) return { data: null, error };
    try {
      const confirmed = confirmedVisitMutation(data, {
        visitId,
        status: "COMPLETED",
        timestamp: "checkout_time",
      });
      void syncTrackingDestination(null);
      return { data: confirmed, error: null };
    } catch (confirmationError) {
      return { data: null, error: confirmationError };
    }
  },

  async markMissed(visitId: string): Promise<{ error: any }> {
    const { data, error } = await supabase.rpc("rpc_mutate_own_field_visit", {
      p_action: "MARK_MISSED",
      p_visit_id: visitId,
      p_values: {},
    });
    if (error) return { error };
    try {
      confirmedVisitMutation(data, { visitId, status: "MISSED" });
      void syncTrackingDestination(null);
      return { error: null };
    } catch (confirmationError) {
      return { error: confirmationError };
    }
  },

  async getAllVisitsForAdmin(options?: {
    date?: string;
    userId?: string;
  }): Promise<{ data: any[]; error: any }> {
    const date = options?.date || (await BusinessClockService.getDate(true));
    let query = supabase
      .from("field_visits")
      .select(`*, profiles:user_id(name, employee_number, role)`)
      .eq("date", date)
      .order("created_at", { ascending: true });
    if (options?.userId) query = query.eq("user_id", options.userId);
    const { data, error } = await query;
    return { data: data || [], error };
  },
};
