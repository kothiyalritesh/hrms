import { supabase } from "@/lib/supabase";
import { BusinessClockService } from "@/services/business-clock.service";
import { reportNonFatalError } from "@/utils/operationalErrors";
import * as Crypto from "expo-crypto";
import type { GPSCoords } from "@/utils/gps";

/**
 * Returns today's date in IST (Asia/Kolkata, UTC+5:30) as YYYY-MM-DD.
 * Using new Date().toISOString() returns UTC date, which causes a mismatch
 * after midnight IST but before 05:30 UTC — making getToday() return no record
 * and showing the Check In button again to already-checked-in employees.
 */
/** Haversine distance in metres between two GPS points */
export function distanceMetres(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
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
  ) {
    super("GEO_FENCE_BLOCKED");
    this.name = "GeoFenceError";
  }
}

export class EarlyCheckoutError extends Error {
  public readonly workedMinutes: number;
  public readonly requiredMinimum: number;
  public readonly attendanceId: string;

  constructor(
    workedMinutes: number,
    requiredMinimum: number,
    attendanceId: string,
  ) {
    super("EARLY_CHECKOUT");
    this.name = "EarlyCheckoutError";
    this.workedMinutes = workedMinutes;
    this.requiredMinimum = requiredMinimum;
    this.attendanceId = attendanceId;
  }
}

export class NoActiveSessionError extends Error {
  constructor() {
    super("NO_ACTIVE_SESSION");
    this.name = "NoActiveSessionError";
  }
}

export interface AttendancePolicy {
  min_work_duration_minutes: number;
  earliest_checkout_time: string;
  auto_close_time: string;
  allow_night_shift: boolean;
  require_early_checkout_reason: boolean;
  undo_checkout_minutes: number;
  office_id: string | null;
  office_name: string | null;
  late_checkin_time: string;
  checkin_reminder_time: string;
  checkout_reminder_time: string;
}

export interface CheckoutResult {
  success: boolean;
  id?: string;
  attendance_id?: string;
  checkin_time?: string;
  effective_checkin_time?: string;
  app_checkin_time?: string;
  biometric_checkin_time?: string;
  checkout_time?: string;
  worked_minutes?: number;
  status?: string;
  is_early?: boolean;
  early_reason?: string | null;
  undo_token?: string;
  undo_expires_at?: string;
  message?: string;
  error?: string;
  matched_checkout_office_id?: string | null;
  matched_checkout_office_name?: string | null;
  matched_checkout_distance_meters?: number | null;
  idempotent?: boolean;
  attendance?: Record<string, unknown>;
  attendance_state?: "CHECKED_OUT";
}

export interface CheckinResult {
  success: boolean;
  existing?: boolean;
  id?: string;
  checkin_time?: string;
  status?: string;
  message?: string;
  warning?: boolean;
  error?: string;
  automatic_site_visit_id?: string | null;
  automatic_site_name?: string | null;
  automatic_site_distance_metres?: number | null;
  side_effects_committed?: boolean;
}

export interface OfficeLocation {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  attendance_radius?: number | null;
  allowed_radius_meters?: number | null;
}

export interface NearestOfficeMatch {
  office: OfficeLocation;
  distanceMetres: number;
}

export function effectiveOfficeRadius(office: OfficeLocation): number {
  const configured = office.allowed_radius_meters ?? office.attendance_radius;
  const radius = Number(configured);
  if (!Number.isFinite(radius) || radius < 10 || radius > 1_000) {
    throw new Error(
      "Attendance radius is not configured for your office. Contact HR.",
    );
  }
  return radius;
}

function normalizeRpcResult<T>(data: unknown): T {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") {
    throw new Error("The attendance server returned an invalid response.");
  }
  return row as T;
}

export const AttendanceService = {
  async getReminderSchedule(): Promise<{
    checkin_time: string;
    checkout_time: string;
    late_checkin_time: string;
    earliest_checkout_time: string;
    auto_close_time: string;
    min_work_duration_minutes: number;
    timezone: string;
    office_id: string;
  }> {
    const { data, error } = await supabase.rpc(
      "get_attendance_reminder_schedule",
    );
    if (error) throw new Error(`Reminder policy unavailable: ${error.message}`);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.checkin_time || !row?.checkout_time) {
      throw new Error("Attendance reminder policy is not configured.");
    }
    return row;
  },

  async getActiveOffices(): Promise<OfficeLocation[]> {
    const { data, error } = await supabase
      .from("offices")
      .select(
        "id, name, latitude, longitude, attendance_radius, allowed_radius_meters",
      )
      .eq("is_active", true);

    if (error) throw error;
    return (data || []) as OfficeLocation[];
  },

  async getAllowedOffices(userId: string): Promise<OfficeLocation[]> {
    // Employee profile rows are protected by RLS in production. A direct
    // browser SELECT can therefore look like a missing office even when the
    // authoritative profile has one. Resolve the employee's active office
    // through the ownership-checked SECURITY DEFINER policy RPC instead.
    const { data: policyData, error: policyError } = await supabase.rpc(
      "get_attendance_policy",
      { p_user_id: userId },
    );
    if (policyError) {
      throw new Error(
        `Your assigned office could not be verified: ${policyError.message}`,
      );
    }
    const policy = Array.isArray(policyData) ? policyData[0] : policyData;
    if (!policy?.office_id) {
      throw new Error(
        "No active attendance policy is configured for your assigned office.",
      );
    }
    const { data, error } = await supabase
      .from("offices")
      .select(
        "id, name, latitude, longitude, attendance_radius, allowed_radius_meters",
      )
      .eq("id", policy.office_id)
      .eq("is_active", true)
      .maybeSingle();
    if (error) throw error;
    if (!data)
      throw new Error("Your assigned office is inactive or unavailable.");
    return [data as OfficeLocation];
  },

  findNearestOffice(
    offices: OfficeLocation[],
    location: { latitude: number; longitude: number },
  ): NearestOfficeMatch | null {
    let nearest: NearestOfficeMatch | null = null;

    for (const office of offices) {
      if (office.latitude == null || office.longitude == null) continue;
      const distance = Math.round(
        distanceMetres(
          location.latitude,
          location.longitude,
          office.latitude,
          office.longitude,
        ),
      );

      if (!nearest || distance < nearest.distanceMetres) {
        nearest = {
          office,
          distanceMetres: distance,
        };
      }
    }

    return nearest;
  },

  async getToday(userId: string) {
    // Use IST date to avoid UTC/IST midnight mismatch
    const today = await BusinessClockService.getDate();
    const { data, error } = await supabase
      .from("attendance_logs")
      .select("*")
      .eq("user_id", userId)
      .eq("date", today)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return { data };
  },

  /**
   * Returns the most recent open (CHECKED_IN) record from a PREVIOUS day,
   * if any. Used to warn the UI that a stale session exists so the checkout
   * button is never shown as active when there is no today check-in.
   */
  async getStalePreviousDaySession(userId: string) {
    const today = await BusinessClockService.getDate();
    const { data, error } = await supabase
      .from("attendance_logs")
      .select("id, date, checkin_time, status")
      .eq("user_id", userId)
      .in("status", ["CHECKED_IN", "CHECKOUT_REQUESTED"])
      .is("checkout_time", null)
      .lt("date", today)
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data ?? null;
  },

  /**
   * Get attendance policy for the user's office
   */
  async getPolicy(userId: string): Promise<AttendancePolicy> {
    const { data, error } = await supabase.rpc("get_attendance_policy", {
      p_user_id: userId,
    });

    if (error) {
      throw new Error(
        `Attendance policy could not be verified: ${error.message}`,
      );
    }
    const policy = Array.isArray(data) ? data[0] : data;
    if (!policy) {
      throw new Error(
        "Attendance policy is not configured for your assigned office.",
      );
    }
    return policy as AttendancePolicy;
  },

  /**
   * Protected check-in using RPC.
   * Auto-closes previous day's forgotten checkouts.
   * Prevents duplicate check-ins.
   */
  async rpcCheckIn(params: {
    userId: string;
    officeId: string;
    location: {
      latitude: number;
      longitude: number;
      accuracy?: number | null;
      mocked?: boolean;
      capturedAt?: string;
    };
    distance: number;
  }): Promise<CheckinResult> {
    const { data, error } = await supabase.rpc("rpc_attendance_checkin_v3", {
      p_office_id: params.officeId,
      p_location: params.location,
    });

    if (error) {
      return {
        success: false,
        error: error.message,
        message: "Check-in failed: " + error.message,
      };
    }

    return normalizeRpcResult<CheckinResult>(data);
  },

  /**
   * Protected checkout using RPC.
   * Validates minimum work duration, earliest checkout time.
   * Returns early checkout error if conditions not met.
   * Generates undo token for 5-minute undo window.
   */
  async rpcCheckOut(params: {
    userId: string;
    attendanceId?: string;
    location?:
      | GPSCoords
      | {
          latitude: number;
          longitude: number;
          accuracy?: number | null;
          mocked?: boolean;
        };
    // matched nearest office/location at checkout time (saved by DB RPC)
    matchedOfficeId?: string | null;
    matchedOfficeName?: string | null;
    matchedDistanceMeters?: number | null;
    reason?: string;
    idempotencyKey?: string;
  }): Promise<CheckoutResult> {
    const idempotencyKey = params.idempotencyKey ?? Crypto.randomUUID();
    const checkoutLocation = params.location
      ? {
          latitude: params.location.latitude,
          longitude: params.location.longitude,
          accuracy: params.location.accuracy ?? null,
          captured_at:
            "capturedAt" in params.location
              ? params.location.capturedAt
              : undefined,
          provider:
            "provider" in params.location ? params.location.provider : undefined,
          mocked: params.location.mocked ?? false,
        }
      : null;
    const { data, error } = await supabase.rpc(
      "rpc_attendance_checkout_reconciled",
      {
        p_user_id: params.userId,
        p_attendance_id: params.attendanceId ?? null,
        p_checkout_location: checkoutLocation,
        p_checkout_reason: params.reason ?? "GOING_HOME",
        p_idempotency_key: idempotencyKey,
      },
    );

    if (error) {
      return {
        success: false,
        error: error.message,
        message: "Checkout failed: " + error.message,
      };
    }

    const result = normalizeRpcResult<CheckoutResult>(data);
    if (result.success && !result.checkout_time) {
      return {
        success: false,
        error: "CHECKOUT_NOT_COMMITTED",
        message:
          "The server did not confirm a committed checkout timestamp. Your attendance is still shown as active.",
      };
    }
    return result;
  },

  /**
   * Undo checkout within the time limit (default 5 minutes)
   */
  async undoCheckout(params: {
    userId: string;
    attendanceId: string;
    undoToken: string;
  }): Promise<{ success: boolean; message: string; error?: string }> {
    const { data, error } = await supabase.rpc("rpc_attendance_undo_checkout", {
      p_user_id: params.userId,
      p_attendance_id: params.attendanceId,
      p_undo_token: params.undoToken,
    });

    if (error) {
      return {
        success: false,
        error: error.message,
        message: "Failed to undo checkout: " + error.message,
      };
    }

    return normalizeRpcResult<{
      success: boolean;
      message: string;
      error?: string;
    }>(data);
  },

  /**
   * Admin correction of attendance records
   */
  async adminCorrectAttendance(params: {
    adminId: string;
    attendanceId: string;
    newCheckin?: string;
    newCheckout?: string;
    newStatus?: string;
    reason: string;
  }): Promise<{ success: boolean; message: string; error?: string }> {
    const { data, error } = await supabase.rpc("rpc_admin_correct_attendance", {
      p_admin_id: params.adminId,
      p_attendance_id: params.attendanceId,
      p_new_checkin: params.newCheckin ?? null,
      p_new_checkout: params.newCheckout ?? null,
      p_new_status: params.newStatus ?? null,
      p_reason: params.reason,
    });

    if (error) {
      return {
        success: false,
        error: error.message,
        message: "Failed to correct attendance: " + error.message,
      };
    }

    return normalizeRpcResult<{
      success: boolean;
      message: string;
      error?: string;
    }>(data);
  },

  /**
   * Get audit logs for an attendance record
   */
  async getAuditLogs(attendanceId: string) {
    const { data, error } = await supabase
      .from("attendance_audit_logs")
      .select("*")
      .eq("attendance_id", attendanceId)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return { data: data || [] };
  },

  /**
   * Get all attendance policies (admin)
   */
  async getAllPolicies() {
    const { data, error } = await supabase
      .from("attendance_policies")
      .select("*, offices(name)")
      .order("created_at", { ascending: false });

    if (error) throw error;
    return { data: data || [] };
  },

  /**
   * Update attendance policy (admin)
   */
  async updatePolicy(policyId: string, updates: Record<string, any>) {
    const { data, error } = await supabase.rpc(
      "rpc_admin_mutate_configuration",
      {
        p_entity: "ATTENDANCE_POLICY",
        p_action: "UPDATE",
        p_id: policyId,
        p_values: updates,
      },
    );

    if (error) throw error;
    const response = normalizeRpcResult<any>(data);
    if (response.success !== true || response.id !== policyId) {
      throw new Error(
        "The server did not confirm the attendance policy update.",
      );
    }
    return { data: response };
  },

  // ── Legacy methods (kept for backward compatibility) ──────────────

  async checkOut({
    userId,
    location,
  }: {
    userId: string;
    location?: { latitude: number; longitude: number };
  }) {
    const data = await this.rpcCheckOut({ userId, location });
    if (!data.success) throw new Error(data.message || data.error);
    return { data };
  },

  async officeCheckIn({
    userId,
    location,
  }: {
    userId: string;
    office?: any;
    location: {
      latitude: number;
      longitude: number;
      accuracy?: number | null;
      mocked?: boolean;
    } | null;
    distance?: number;
  }) {
    if (!location) throw new Error("GPS location is required to check in.");
    if (location.mocked) {
      throw new Error("Disable mock-location apps before checking in.");
    }
    const accuracy = Math.max(0, Number(location.accuracy) || 0);
    if (accuracy > 100) {
      throw new Error(
        `GPS accuracy is too low (±${Math.round(accuracy)}m). Move outdoors and try again.`,
      );
    }
    const offices = await this.getAllowedOffices(userId);
    const nearest = this.findNearestOffice(offices, location);

    if (!nearest) {
      throw new Error("No office location found. Please contact admin.");
    }

    const radius = effectiveOfficeRadius(nearest.office);
    if (nearest.distanceMetres + accuracy > radius) {
      throw new GeoFenceError(
        nearest.distanceMetres + accuracy,
        radius,
        nearest.office.name,
      );
    }

    const result = await this.rpcCheckIn({
      userId,
      officeId: nearest.office.id,
      location,
      distance: nearest.distanceMetres,
    });
    if (!result.success && !result.existing) {
      throw new Error(result.message || result.error || "Check-in failed.");
    }
    if (!result.checkin_time) {
      const confirmed = await this.getToday(userId);
      if (!confirmed.data?.checkin_time) {
        throw new Error(
          "The server did not confirm the committed check-in timestamp.",
        );
      }
      result.checkin_time = confirmed.data.checkin_time;
    }

    return {
      result,
      office: nearest.office,
      distanceMetres: nearest.distanceMetres,
      radiusMetres: radius,
    };
  },

  async updateAllAttendanceWarnings() {
    try {
      const { data, error } = await supabase.rpc(
        "rpc_recalculate_attendance_warnings",
      );
      if (error) return { success: false, error: error.message };
      const result = normalizeRpcResult<{
        success?: boolean;
        updated_count?: number;
        evaluated_count?: number;
        message?: string;
      }>(data);
      if (
        result.success !== true ||
        !Number.isFinite(Number(result.updated_count)) ||
        !Number.isFinite(Number(result.evaluated_count))
      ) {
        return {
          success: false,
          error:
            result.message ||
            "The server did not confirm attendance warning updates.",
        };
      }
      return {
        success: true,
        updated: Number(result.updated_count),
        evaluated: Number(result.evaluated_count),
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },
};
