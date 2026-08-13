import { supabase } from "@/lib/supabase";
import { BusinessClockService } from "@/services/business-clock.service";
import { fetchAllPages } from "@/utils/supabasePagination";
import * as Crypto from "expo-crypto";
import type { GPSCoords } from "@/utils/gps";

export interface Event {
  id: string;
  title: string;
  description?: string;
  event_date: string;
  start_time: string;
  end_time: string;
  address: string;
  latitude: number;
  longitude: number;
  photo_url?: string;
  checkin_radius_m?: number;
  comp_off_enabled?: boolean;
  comp_off_team?: string;
  comp_off_days?: number;
  created_by?: string;
  created_at?: string;
  status?: "ACTIVE" | "CANCELLED" | "COMPLETED";
  audience_scope?: "LEGACY_ALL" | "ALL_EMPLOYEES" | "SELECTED";
  event_late_grace_minutes?: number;
  participant_count?: number;
  attendance_count?: number;
  on_time_count?: number;
  late_count?: number;
  comp_off_eligible_count?: number;
  assigned_team_names?: string[];
  assigned_departments?: string[];
}

export interface EventAttendee {
  id: string;
  user_id: string;
  name: string;
  role: string;
  checkin_time: string;
  distance_metres: number;
  checkout_time?: string | null;
  checkout_distance_metres?: number | null;
  arrival_status?: "ON_TIME" | "LATE" | null;
  late_minutes?: number | null;
  comp_off_eligible_days?: number;
}

export interface EventAttendanceAction extends Event {
  userCheckInTime: string | null;
  userCheckOutTime: string | null;
}

export interface EventAnnouncement {
  eventId: string;
  announcedAt: string;
  acknowledgedAt: string | null;
  event: Event;
}

export interface CreateEventParams {
  title: string;
  description?: string;
  event_date: string;
  start_time: string;
  end_time: string;
  address: string;
  latitude: number;
  longitude: number;
  photo_url?: string;
  checkin_radius_m?: number;
  comp_off_enabled?: boolean;
  comp_off_team?: string;
  comp_off_days?: number;
  created_by: string;
  event_late_grace_minutes?: number;
  audience: EventAudienceSelection;
  idempotency_key?: string;
}

export interface EventAudienceEmployee {
  id: string;
  name: string;
  employee_number?: string | null;
  department?: string | null;
  team_id?: string | null;
  team_name?: string | null;
}

export interface EventAudienceTeam {
  id: string;
  name: string;
  member_count: number;
}

export interface EventAudienceDepartment {
  name: string;
  member_count: number;
}

export interface EventAudienceOptions {
  employees: EventAudienceEmployee[];
  teams: EventAudienceTeam[];
  departments: EventAudienceDepartment[];
}

export interface EventAudienceSelection {
  allEmployees: boolean;
  employeeIds: string[];
  teamIds: string[];
  departments: string[];
}

export interface EventCheckInResult {
  alreadyCheckedIn: boolean;
  distanceMetres: number;
  compOffCredited: boolean;
  compOffEligibleDays: number;
  arrivalStatus: "ON_TIME" | "LATE";
  lateMinutes: number;
  message: string;
}

export interface EventCheckOutResult {
  alreadyCheckedOut: boolean;
  checkOutTime: string;
  distanceMetres: number;
  message: string;
}

export const EventService = {
  /** Fetch today's and upcoming events */
  async getUpcomingEvents(): Promise<Event[]> {
    const today = await BusinessClockService.getDate(true);
    const { data, error } = await fetchAllPages<Event>((from, to) =>
      supabase
        .from("events")
        .select("*")
        .gte("event_date", today)
        .order("event_date", { ascending: true })
        .order("start_time", { ascending: true })
        .order("id")
        .range(from, to),
    );
    if (error) throw error;
    return data ?? [];
  },

  /** Event messages assigned to an employee, including their acknowledgement. */
  async getAnnouncements(userId: string): Promise<EventAnnouncement[]> {
    const today = await BusinessClockService.getDate(true);
    const { data, error } = await fetchAllPages<any>((from, to) =>
      supabase
        .from("event_announcements")
        .select("event_id, announced_at, acknowledged_at, events:event_id(*)")
        .eq("user_id", userId)
        .gte("events.event_date", today)
        .order("announced_at", { ascending: false })
        .order("event_id")
        .range(from, to),
    );
    if (error) throw error;
    return (data ?? [])
      .map((row: any) => ({
        eventId: row.event_id,
        announcedAt: row.announced_at,
        acknowledgedAt: row.acknowledged_at ?? null,
        event: Array.isArray(row.events) ? row.events[0] : row.events,
      }))
      .filter((row: EventAnnouncement) => !!row.event);
  },

  async acknowledgeEvent(eventId: string, userId: string): Promise<string> {
    const { data, error } = await supabase.rpc("rpc_acknowledge_event", {
      p_event_id: eventId,
      p_user_id: userId,
    });
    if (error) throw error;
    const result = Array.isArray(data) ? data[0] : data;
    if (!result?.success) {
      throw new Error(result?.message || "Unable to acknowledge this event.");
    }
    if (!result.acknowledged_at) {
      throw new Error("Server did not return an acknowledgement timestamp.");
    }
    return result.acknowledged_at;
  },

  /** Events that can be checked in to on the current IST calendar date. */
  async getEventsAvailableForCheckIn(userId: string): Promise<Event[]> {
    const today = await BusinessClockService.getDate(true);
    const { data, error } = await fetchAllPages<any>((from, to) =>
      supabase
        .from("event_participants")
        .select("events:event_id!inner(*)")
        .eq("employee_id", userId)
        .eq("events.event_date", today)
        .order("event_id")
        .range(from, to),
    );
    if (error) throw error;
    return (data ?? [])
      .map((row: any) =>
        Array.isArray(row.events) ? row.events[0] : row.events,
      )
      .filter(Boolean)
      .sort((a: Event, b: Event) => a.start_time.localeCompare(b.start_time));
  },

  /** Today's events with the employee's check-in/check-out state. */
  async getEventsAvailableForAttendance(
    userId: string,
  ): Promise<EventAttendanceAction[]> {
    const events = await this.getEventsAvailableForCheckIn(userId);
    if (!events.length) return [];
    const { data, error } = await fetchAllPages<any>((from, to) =>
      supabase.from("event_checkins")
        .select("id, event_id, checkin_time, checkout_time")
        .eq("user_id", userId)
        .in("event_id", events.map((event) => event.id))
        .order("event_id")
        .order("id")
        .range(from, to),
    );
    if (error) throw error;
    const attendanceByEvent = new Map<string, any>(
      (data ?? []).map((row: any) => [row.event_id, row]),
    );
    return events.map((event) => {
      const attendance = attendanceByEvent.get(event.id);
      return {
        ...event,
        userCheckInTime: attendance?.checkin_time ?? null,
        userCheckOutTime: attendance?.checkout_time ?? null,
      };
    });
  },

  /** Fetch all events (admin view) */
  async getAllEvents(): Promise<Event[]> {
    const { data, error } = await fetchAllPages<Event>((from, to) =>
      supabase
        .from("event_admin_summary")
        .select("*")
        .order("event_date", { ascending: false })
        .order("id")
        .range(from, to),
    );
    if (error) throw error;
    return data ?? [];
  },

  async getAudienceOptions(): Promise<EventAudienceOptions> {
    const { data, error } = await supabase.rpc(
      "rpc_admin_event_audience_options",
    );
    if (error) throw error;
    const result = Array.isArray(data) ? data[0] : data;
    return {
      employees: result?.employees ?? [],
      teams: result?.teams ?? [],
      departments: result?.departments ?? [],
    };
  },

  async createEvent(params: CreateEventParams): Promise<Event> {
    const { audience, idempotency_key, ...eventValues } = params;
    const { data, error } = await supabase.rpc("rpc_admin_create_event", {
      p_values: {
        ...eventValues,
        idempotency_key: idempotency_key ?? Crypto.randomUUID(),
      },
      p_employee_ids: audience.employeeIds,
      p_team_ids: audience.teamIds,
      p_departments: audience.departments,
      p_all_employees: audience.allEmployees,
    });
    if (error) throw error;
    const result = Array.isArray(data) ? data[0] : data;
    if (!result?.success || !result.event?.id) {
      throw new Error(result?.message || "Event creation was not confirmed.");
    }
    return result.event as Event;
  },

  async deleteEvent(eventId: string): Promise<void> {
    const { error } = await supabase.rpc("rpc_admin_delete_event", {
      p_event_id: eventId,
    });
    if (error) throw error;
  },

  /** Fetch all check-ins for an event with attendee profile info */
  async getEventAttendees(eventId: string): Promise<EventAttendee[]> {
    const { data, error } = await fetchAllPages<any>((from, to) =>
      supabase.from("event_checkins")
        .select(
          "id, checkin_time, distance_metres, checkout_time, checkout_distance_metres, arrival_status, late_minutes, comp_off_eligible_days, user_id, profiles(name, role)",
        )
        .eq("event_id", eventId)
        .order("checkin_time", { ascending: true })
        .order("id")
        .range(from, to),
    );
    if (error) throw error;
    return (data ?? []).map((row: any) => ({
      id: row.id,
      user_id: row.user_id,
      name: row.profiles?.name ?? "Unknown",
      role: row.profiles?.role ?? "",
      checkin_time: row.checkin_time,
      distance_metres: row.distance_metres,
      checkout_time: row.checkout_time ?? null,
      checkout_distance_metres: row.checkout_distance_metres ?? null,
      arrival_status: row.arrival_status ?? null,
      late_minutes: row.late_minutes ?? null,
      comp_off_eligible_days: Number(row.comp_off_eligible_days) || 0,
    }));
  },

  /** Check if user already checked in to this event */
  async hasCheckedIn(eventId: string, userId: string): Promise<boolean> {
    const { data } = await supabase
      .from("event_checkins")
      .select("id")
      .eq("event_id", eventId)
      .eq("user_id", userId)
      .maybeSingle();
    return !!data;
  },

  /** Server-validated, date-scoped and geofenced event check-in. */
  async checkInToEvent({
    eventId,
    location,
  }: {
    eventId: string;
    location: GPSCoords;
  }): Promise<EventCheckInResult> {
    const { data, error } = await supabase.rpc("rpc_event_check_in_v2", {
      p_event_id: eventId,
      p_location: {
        latitude: location.latitude,
        longitude: location.longitude,
        accuracy: location.accuracy,
        captured_at: location.capturedAt,
        provider: location.provider,
        mocked: location.mocked ?? false,
      },
    });
    if (error) throw error;
    const result = Array.isArray(data) ? data[0] : data;
    if (!result?.success) {
      throw new Error(result?.message || "Event check-in failed.");
    }
    return {
      alreadyCheckedIn: result.already_checked_in === true,
      distanceMetres: Number(result.distance_metres) || 0,
      compOffCredited: result.comp_off_credited === true,
      compOffEligibleDays: Number(result.comp_off_eligible_days) || 0,
      arrivalStatus: result.arrival_status === "LATE" ? "LATE" : "ON_TIME",
      lateMinutes: Number(result.late_minutes) || 0,
      message: result.message || "Event check-in completed.",
    };
  },

  /** Explicit event checkout while the employee is still inside the venue. */
  async checkOutFromEvent({
    eventId,
    location,
  }: {
    eventId: string;
    location: GPSCoords;
  }): Promise<EventCheckOutResult> {
    const { data, error } = await supabase.rpc("rpc_event_check_out_v2", {
      p_event_id: eventId,
      p_location: {
        latitude: location.latitude,
        longitude: location.longitude,
        accuracy: location.accuracy,
        captured_at: location.capturedAt,
        provider: location.provider,
        mocked: location.mocked ?? false,
      },
    });
    if (error) throw error;
    const result = Array.isArray(data) ? data[0] : data;
    if (!result?.success) {
      throw new Error(result?.message || "Event check-out failed.");
    }
    if (!result.checkout_time) {
      throw new Error(
        "Event check-out was not confirmed with a server timestamp.",
      );
    }
    return {
      alreadyCheckedOut: result.already_checked_out === true,
      checkOutTime: result.checkout_time,
      distanceMetres: Number(result.distance_metres) || 0,
      message: result.message || "Event check-out completed.",
    };
  },
};
