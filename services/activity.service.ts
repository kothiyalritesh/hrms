import { supabase } from "@/lib/supabase";
import { BusinessClockService } from "@/services/business-clock.service";
import { CanonicalAttendanceService } from "@/services/canonical-attendance.service";
import {
  ActivityLog,
  ActivityAnalysis,
  ActivityAnalysisService,
} from "./activity-analysis.service";

export function calculateAverageConfidence(
  rows: Array<{ confidence_score: number | null }>,
): number {
  if (!rows.length) return 0;
  return Math.round(
    rows.reduce((sum, row) => sum + (row.confidence_score || 0), 0) /
      rows.length,
  );
}

export const ActivityService = {
  /**
   * Create a new activity log entry
   */
  async createActivity(
    activity: Omit<ActivityLog, "id" | "created_at">,
  ): Promise<{ data: ActivityLog | null; error: any }> {
    try {
      // Analyze the activity before saving
      const analysis = ActivityAnalysisService.analyzeActivity(
        activity as ActivityLog,
      );

      const activityData = {
        user_id: activity.user_id,
        location_type: activity.locationType,
        location_name: activity.locationName,
        notes: activity.notes,
        destination: activity.destination,
        gps_coordinates: activity.gps_coordinates,
        timestamp: activity.timestamp,
        meeting_details: activity.meetingDetails ?? null,
        ...analysis,
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from("activity_logs")
        .insert([activityData])
        .select()
        .single();

      return { data, error };
    } catch (error) {
      console.error("Activity creation error:", error);
      return { data: null, error };
    }
  },

  /**
   * Get activities for a user within date range
   */
  async getUserActivities(
    userId: string,
    options?: {
      startDate?: string;
      endDate?: string;
      page?: number;
      pageSize?: number;
      activityType?: string;
    },
  ): Promise<{ data: ActivityLog[] | null; error: any; count: number }> {
    const page = Math.max(0, options?.page ?? 0);
    const pageSize = Math.min(100, Math.max(1, options?.pageSize ?? 25));
    let query = supabase
      .from("activity_logs")
      .select("*", { count: "exact" })
      .eq("user_id", userId)
      .order("timestamp", { ascending: false })
      .order("id");

    if (options?.startDate) {
      query = query.gte("timestamp", options.startDate);
    }

    if (options?.endDate) {
      query = query.lte("timestamp", options.endDate);
    }

    if (options?.activityType) {
      query = query.eq("activity_type", options.activityType);
    }

    const from = page * pageSize;
    const { data, error, count } = await query.range(from, from + pageSize - 1);
    return { data, error, count: count ?? 0 };
  },

  /**
   * Get all activities for admin analysis
   */
  async getAllActivities(options?: {
    userId?: string;
    startDate?: string;
    endDate?: string;
    activityType?: string;
    limit?: number;
  }): Promise<{ data: ActivityLog[] | null; error: any }> {
    let query = supabase
      .from("activity_logs")
      .select(
        `
        *,
        profiles:user_id (
          name,
          email,
          employee_number
        )
      `,
      )
      .order("timestamp", { ascending: false });

    if (options?.userId) {
      query = query.eq("user_id", options.userId);
    }

    if (options?.startDate) {
      query = query.gte("timestamp", options.startDate);
    }

    if (options?.endDate) {
      query = query.lte("timestamp", options.endDate);
    }

    if (options?.activityType) {
      query = query.eq("activity_type", options.activityType);
    }

    if (options?.limit) {
      query = query.limit(options.limit);
    }

    const { data, error } = await query;
    return { data, error };
  },

  /**
   * Update an activity log
   */
  async updateActivity(
    id: string,
    updates: Partial<ActivityLog>,
  ): Promise<{ data: ActivityLog | null; error: any }> {
    // If notes or other fields changed, re-analyze
    if (updates.notes || updates.locationType || updates.locationName) {
      const { data: existingActivity } = await supabase
        .from("activity_logs")
        .select("*")
        .eq("id", id)
        .maybeSingle();

      if (existingActivity) {
        const updatedActivity = { ...existingActivity, ...updates };
        const analysis =
          ActivityAnalysisService.analyzeActivity(updatedActivity);
        updates = { ...updates, ...analysis };
      }
    }

    const { data, error } = await supabase
      .from("activity_logs")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();

    return { data, error };
  },

  /**
   * Get full-day logs for all employees (admin view)
   * Returns attendance + all activity logs grouped by employee per day
   */
  async getDailyEmployeeLogs(options?: {
    date?: string;
    userId?: string;
  }): Promise<{ data: any[] | null; error: any }> {
    const targetDate =
      options?.date || (await BusinessClockService.getDate(true));

    try {
      // 1. Get all active employees
      const attendanceDays = await CanonicalAttendanceService.listDay(targetDate);
      if (attendanceDays.length === 0) return { data: [], error: null };

      // 2. Get attendance for the date — fetch ALL, filter in JS to avoid .in() URL limits

      // 3. Get activity logs for the date — fetch ALL, filter in JS
      const { data: allActivities, error: activityError } = await supabase
        .from("activity_logs")
        .select("*")
        .gte("timestamp", `${targetDate}T00:00:00+05:30`)
        .lte("timestamp", `${targetDate}T23:59:59+05:30`)
        .order("timestamp", { ascending: true });
      if (activityError) return { data: null, error: activityError };

      const actMap: Record<string, any[]> = {};
      (allActivities || []).forEach((a: any) => {
        if (!actMap[a.user_id]) actMap[a.user_id] = [];
        actMap[a.user_id].push({
          id: a.id,
          time: a.timestamp,
          timestamp: a.timestamp,
          activity_type: a.activity_type,
          summary: a.summary,
          notes: a.notes,
          location_name: a.location_name,
          client_name: a.client_name,
          company_name: a.company_name,
          meeting_purpose: a.meeting_purpose,
          meeting_details: a.meeting_details,
          confidence_score: a.confidence_score,
          is_billable: a.is_billable_activity,
          flag: a.flag,
        });
      });

      // 5. Merge — only mark PRESENT/LATE if attendance record EXISTS for this user on this date
      const result = attendanceDays.map((attendance) => {
        const acts = actMap[attendance.user_id] || [];
        const billable = acts.filter((a) => a.is_billable).length;
        const status = attendance.attendance_status;

        return {
          user_id: attendance.user_id,
          employee_name: attendance.employee_name,
          employee_number: attendance.employee_number,
          role: attendance.role,
          office_id: attendance.office_id,
          office_name: attendance.office_name || "",
          team_id: attendance.team_id,
          team_name: attendance.team_name,
          work_date: targetDate,
          checkin_time: attendance.official_first_in,
          checkout_time: attendance.official_last_out,
          first_in_source: attendance.first_in_source,
          last_out_source: attendance.last_out_source,
          attendance_status: status,
          is_late: attendance.is_late,
          attendance_type: attendance.presence_source,
          attendance_warning: attendance.warning,
          configuration_required: status === "CONFIG_REQUIRED",
          total_activities: acts.length,
          billable_activities: billable,
          activities: acts,
        };
      });

      return { data: result, error: null };
    } catch (err) {
      return { data: null, error: err };
    }
  },

  /**
   * Delete an activity log
   */
  async deleteActivity(id: string): Promise<{ error: any }> {
    const { error } = await supabase
      .from("activity_logs")
      .delete()
      .eq("id", id);

    return { error };
  },

  /**
   * Get activity analytics for dashboard
   */
  async getActivityAnalytics(options?: {
    userId?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<{
    totalActivities: number;
    billableActivities: number;
    activityBreakdown: Record<string, number>;
    lowQualityEntries: number;
    averageConfidence: number;
    topClients: Array<{ name: string; count: number }>;
  }> {
    let query = supabase
      .from("activity_logs")
      .select(
        "activity_type, confidence_score, client_name, company_name, flag, is_billable_activity",
      );

    if (options?.userId) {
      query = query.eq("user_id", options.userId);
    }

    if (options?.startDate) {
      query = query.gte("timestamp", options.startDate);
    }

    if (options?.endDate) {
      query = query.lte("timestamp", options.endDate);
    }

    const { data, error } = await query;

    if (error || !data) {
      return {
        totalActivities: 0,
        billableActivities: 0,
        activityBreakdown: {},
        lowQualityEntries: 0,
        averageConfidence: 0,
        topClients: [],
      };
    }

    // Calculate analytics
    type Row = { activity_type: string | null; confidence_score: number | null; client_name: string | null; company_name: string | null; flag: string | null; is_billable_activity: boolean | null; };

    const totalActivities = data.length;
    const billableActivities = data.filter(
      (a: Row) => a.is_billable_activity,
    ).length;
    const lowQualityEntries = data.filter(
      (a: Row) => a.flag === "LOW_QUALITY_ENTRY",
    ).length;
    const averageConfidence = calculateAverageConfidence(data);

    // Activity breakdown
    const activityBreakdown: Record<string, number> = {};
    data.forEach((activity: Row) => {
      const type = activity.activity_type || "OTHER";
      activityBreakdown[type] = (activityBreakdown[type] || 0) + 1;
    });

    // Top clients
    const clientCounts: Record<string, number> = {};
    data.forEach((activity: Row) => {
      const client = activity.client_name || activity.company_name;
      if (client) {
        clientCounts[client] = (clientCounts[client] || 0) + 1;
      }
    });

    const topClients = Object.entries(clientCounts)
      .sort(([, a], [, b]) => (b as number) - (a as number))
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));

    return {
      totalActivities,
      billableActivities,
      activityBreakdown,
      lowQualityEntries,
      averageConfidence,
      topClients,
    };
  },
};
