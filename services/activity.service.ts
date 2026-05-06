import { supabase } from "@/lib/supabase";
import {
  ActivityLog,
  ActivityAnalysis,
  ActivityAnalysisService,
} from "./activity-analysis.service";

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
        ...analysis,
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from("activity_logs")
        .insert([activityData])
        .select()
        .single();

      if (error) {
        console.error("[createActivity] Error:", error);
      }
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
      limit?: number;
      activityType?: string;
    },
  ): Promise<{ data: ActivityLog[] | null; error: any }> {
    try {
      let query = supabase
        .from("activity_logs")
        .select("*")
        .eq("user_id", userId)
        .order("timestamp", { ascending: false });

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
      
      if (error) {
        console.error("[getUserActivities] Error fetching activities:", error);
        return { data: [], error };
      }
      
      return { data: data || [], error: null };
    } catch (err) {
      console.error("[getUserActivities] Exception:", err);
      return { data: [], error: err };
    }
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
        .single();

      if (existingActivity) {
        const updatedActivity = { ...existingActivity, ...updates } as ActivityLog;
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
    const targetDate = options?.date || new Date().toISOString().split("T")[0];

    try {
      // 1. Get all active employees
      const { data: employees, error: empError } = await supabase
        .from("profiles")
        .select("id, name, employee_number, role, office_id, offices(name)")
        .eq("is_active", true)
        .order("name", { ascending: true });

      if (empError) return { data: null, error: empError };
      if (!employees || employees.length === 0) return { data: [], error: null };

      // 2. Get attendance for the date — fetch ALL, filter in JS to avoid .in() URL limits
      const { data: allAttendance, error: attError } = await supabase
        .from("attendance_logs")
        .select("*")
        .eq("date", targetDate);

      if (attError) console.error("[getDailyEmployeeLogs] attendance error:", attError);

      // 3. Get activity logs for the date — fetch ALL, filter in JS
      const { data: allActivities } = await supabase
        .from("activity_logs")
        .select("*")
        .gte("timestamp", `${targetDate}T00:00:00+05:30`)
        .lte("timestamp", `${targetDate}T23:59:59+05:30`)
        .order("timestamp", { ascending: true });

      // 4. Build lookup maps keyed by user_id
      const attMap: Record<string, any> = {};
      (allAttendance || []).forEach((a: any) => { attMap[a.user_id] = a; });

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
      const result = employees.map((emp: any) => {
        const att = attMap[emp.id] ?? null; // null if no record for this date
        const acts = actMap[emp.id] || [];
        const billable = acts.filter((a: any) => a.is_billable).length;

        let status = "ABSENT";
        if (att && att.checkin_time) {
          const h = new Date(att.checkin_time).getHours();
          status = h >= 10 ? "LATE" : "PRESENT";
        }

        return {
          user_id: emp.id,
          employee_name: emp.name,
          employee_number: emp.employee_number,
          role: emp.role,
          office_name: (emp as any).offices?.name || "",
          work_date: targetDate,
          checkin_time: att?.checkin_time || null,
          checkout_time: att?.checkout_time || null,
          attendance_status: status,
          attendance_type: att?.attendance_type || null,
          attendance_warning: att?.warning || null,
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
    const totalActivities = data.length;
    const billableActivities = (data as any[]).filter(
      (a) => a.is_billable_activity,
    ).length;
    const lowQualityEntries = (data as any[]).filter(
      (a) => a.flag === "LOW_QUALITY_ENTRY",
    ).length;
    const averageConfidence =
      data.reduce((sum: number, a: any) => sum + (a.confidence_score || 0), 0) /
      totalActivities;

    // Activity breakdown
    const activityBreakdown: Record<string, number> = {};
    data.forEach((activity: any) => {
      const type = activity.activity_type || "OTHER";
      activityBreakdown[type] = (activityBreakdown[type] || 0) + 1;
    });

    // Top clients
    const clientCounts: Record<string, number> = {};
    data.forEach((activity: any) => {
      const client = activity.client_name || activity.company_name;
      if (client) {
        clientCounts[client] = (clientCounts[client] || 0) + 1;
      }
    });

    const topClients = Object.entries(clientCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));

    return {
      totalActivities,
      billableActivities,
      activityBreakdown,
      lowQualityEntries,
      averageConfidence: Math.round(averageConfidence),
      topClients,
    };
  },
};
