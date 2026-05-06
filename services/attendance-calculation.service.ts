import { supabase } from "@/lib/supabase";

const OFFICE_START = 10.5; // 10:30 AM
const OFFICE_END = 18.5; // 6:30 PM
const OVERTIME_START = 18.75; // 6:45 PM
const GRACE_PERIOD_MINUTES = 5;

interface AttendanceData {
  user_id: string;
  date: string;
  punch_in_time?: string;
  punch_out_time?: string;
  office_id?: string;
  office_name?: string;
}

interface CalculatedAttendance {
  user_id: string;
  date: string;
  punch_in_time?: string;
  punch_out_time?: string;
  working_hours: number;
  is_late: boolean;
  late_minutes: number;
  is_overtime: boolean;
  overtime_minutes: number;
  is_on_duty: boolean;
  is_sunday: boolean;
  is_holiday: boolean;
  is_leave: boolean;
  leave_type?: string;
  is_absent: boolean;
  status: "present" | "late" | "absent" | "on_duty" | "leave" | "holiday" | "sunday";
  office_id?: string;
  office_name?: string;
}

export const AttendanceCalculationService = {
  /**
   * Convert time string (HH:MM) to decimal hours
   */
  timeToDecimal(timeStr: string): number {
    const [hours, minutes] = timeStr.split(":").map(Number);
    return hours + minutes / 60;
  },

  /**
   * Get day of week (0 = Sunday, 6 = Saturday)
   */
  getDayOfWeek(dateStr: string): number {
    return new Date(dateStr + "T00:00:00").getDay();
  },

  /**
   * Check if date is Sunday
   */
  isSunday(dateStr: string): boolean {
    return this.getDayOfWeek(dateStr) === 0;
  },

  /**
   * Check if employee is on leave for the date
   */
  async isOnLeave(userId: string, dateStr: string): Promise<{ isLeave: boolean; leaveType?: string }> {
    const { data } = await supabase
      .from("leaves")
      .select("type")
      .eq("user_id", userId)
      .gte("start_date", dateStr)
      .lte("end_date", dateStr)
      .eq("status", "approved")
      .maybeSingle();

    return { isLeave: !!data, leaveType: data?.type };
  },

  /**
   * Check if employee has on-duty event for the date
   */
  async isOnDuty(userId: string, dateStr: string): Promise<boolean> {
    const { data } = await supabase
      .from("on_duty_events")
      .select("id")
      .eq("user_id", userId)
      .eq("event_date", dateStr)
      .eq("status", "approved")
      .maybeSingle();

    return !!data;
  },

  /**
   * Calculate working hours between punch in and out
   */
  calculateWorkingHours(punchInTime: string, punchOutTime: string): number {
    const inTime = new Date(punchInTime);
    const outTime = new Date(punchOutTime);
    const diffMs = outTime.getTime() - inTime.getTime();
    return Math.round((diffMs / (1000 * 60 * 60)) * 100) / 100; // Round to 2 decimals
  },

  /**
   * Check if punch in is late (after 10:30 AM + grace period)
   */
  isLate(punchInTime: string): { isLate: boolean; lateMinutes: number } {
    const inTime = new Date(punchInTime);
    const hours = inTime.getHours();
    const minutes = inTime.getMinutes();
    const timeDecimal = hours + minutes / 60;

    const lateThreshold = OFFICE_START + GRACE_PERIOD_MINUTES / 60;

    if (timeDecimal > lateThreshold) {
      const lateMinutes = Math.round((timeDecimal - lateThreshold) * 60);
      return { isLate: true, lateMinutes };
    }

    return { isLate: false, lateMinutes: 0 };
  },

  /**
   * Check if punch out is overtime (after 6:45 PM)
   */
  isOvertime(punchOutTime: string): { isOvertime: boolean; overtimeMinutes: number } {
    const outTime = new Date(punchOutTime);
    const hours = outTime.getHours();
    const minutes = outTime.getMinutes();
    const timeDecimal = hours + minutes / 60;

    if (timeDecimal > OVERTIME_START) {
      const overtimeMinutes = Math.round((timeDecimal - OFFICE_END) * 60);
      return { isOvertime: true, overtimeMinutes: Math.max(0, overtimeMinutes) };
    }

    return { isOvertime: false, overtimeMinutes: 0 };
  },

  /**
   * Calculate complete attendance for a date
   */
  async calculateAttendance(data: AttendanceData): Promise<CalculatedAttendance> {
    const { user_id, date, punch_in_time, punch_out_time, office_id, office_name } = data;

    // Check leave status
    const { isLeave, leaveType } = await this.isOnLeave(user_id, date);

    // Check on-duty status
    const onDuty = await this.isOnDuty(user_id, date);

    // Check if Sunday
    const sunday = this.isSunday(date);

    // If on leave, return leave status
    if (isLeave) {
      return {
        user_id,
        date,
        working_hours: 0,
        is_late: false,
        late_minutes: 0,
        is_overtime: false,
        overtime_minutes: 0,
        is_on_duty: false,
        is_sunday: sunday,
        is_holiday: false,
        is_leave: true,
        leave_type: leaveType,
        is_absent: false,
        status: "leave",
        office_id,
        office_name,
      };
    }

    // If on-duty event, return on-duty status
    if (onDuty) {
      return {
        user_id,
        date,
        working_hours: 8, // Assume full day
        is_late: false,
        late_minutes: 0,
        is_overtime: false,
        overtime_minutes: 0,
        is_on_duty: true,
        is_sunday: sunday,
        is_holiday: false,
        is_leave: false,
        is_absent: false,
        status: "on_duty",
        office_id,
        office_name,
      };
    }

    // If Sunday and no punch, credit comp-off
    if (sunday && !punch_in_time) {
      return {
        user_id,
        date,
        working_hours: 0,
        is_late: false,
        late_minutes: 0,
        is_overtime: false,
        overtime_minutes: 0,
        is_on_duty: false,
        is_sunday: true,
        is_holiday: false,
        is_leave: false,
        is_absent: false,
        status: "sunday",
        office_id,
        office_name,
      };
    }

    // If no punch in, mark absent
    if (!punch_in_time) {
      return {
        user_id,
        date,
        working_hours: 0,
        is_late: false,
        late_minutes: 0,
        is_overtime: false,
        overtime_minutes: 0,
        is_on_duty: false,
        is_sunday: sunday,
        is_holiday: false,
        is_leave: false,
        is_absent: true,
        status: "absent",
        office_id,
        office_name,
      };
    }

    // Calculate late status
    const { isLate, lateMinutes } = this.isLate(punch_in_time);

    // Calculate working hours and overtime
    let workingHours = 0;
    let isOvertime = false;
    let overtimeMinutes = 0;

    if (punch_out_time) {
      workingHours = this.calculateWorkingHours(punch_in_time, punch_out_time);
      const ot = this.isOvertime(punch_out_time);
      isOvertime = ot.isOvertime;
      overtimeMinutes = ot.overtimeMinutes;
    }

    // Determine status
    let status: "present" | "late" | "absent" | "on_duty" | "leave" | "holiday" | "sunday" = "present";
    if (isLate) status = "late";
    if (!punch_out_time) status = "absent";

    return {
      user_id,
      date,
      punch_in_time,
      punch_out_time,
      working_hours,
      is_late: isLate,
      late_minutes: lateMinutes,
      is_overtime: isOvertime,
      overtime_minutes: overtimeMinutes,
      is_on_duty: false,
      is_sunday: sunday,
      is_holiday: false,
      is_leave: false,
      is_absent: !punch_out_time,
      status,
      office_id,
      office_name,
    };
  },

  /**
   * Process attendance for a date range and save to summary table
   */
  async processAttendanceRange(startDate: string, endDate: string, userId?: string) {
    try {
      // Fetch attendance logs for the range
      let query = supabase
        .from("attendance_logs")
        .select("*")
        .gte("date", startDate)
        .lte("date", endDate);

      if (userId) {
        query = query.eq("user_id", userId);
      }

      const { data: logs, error } = await query;

      if (error) throw error;

      // Group by user and date
      const grouped: Record<string, Record<string, any>> = {};
      for (const log of logs || []) {
        if (!grouped[log.user_id]) grouped[log.user_id] = {};
        grouped[log.user_id][log.date] = log;
      }

      // Calculate attendance for each user-date combination
      const summaries: any[] = [];

      for (const [uid, dates] of Object.entries(grouped)) {
        for (const [date, log] of Object.entries(dates)) {
          const calculated = await this.calculateAttendance({
            user_id: uid,
            date,
            punch_in_time: log.checkin_time,
            punch_out_time: log.checkout_time,
            office_id: log.office_id,
            office_name: log.office_name,
          });

          summaries.push({
            user_id: calculated.user_id,
            date: calculated.date,
            punch_in_time: calculated.punch_in_time,
            punch_out_time: calculated.punch_out_time,
            working_hours: calculated.working_hours,
            is_late: calculated.is_late,
            late_minutes: calculated.late_minutes,
            is_overtime: calculated.is_overtime,
            overtime_minutes: calculated.overtime_minutes,
            is_on_duty: calculated.is_on_duty,
            is_sunday: calculated.is_sunday,
            is_holiday: calculated.is_holiday,
            is_leave: calculated.is_leave,
            leave_type: calculated.leave_type,
            is_absent: calculated.is_absent,
            status: calculated.status,
            office_id: calculated.office_id,
            office_name: calculated.office_name,
          });
        }
      }

      // Upsert into attendance_summary
      if (summaries.length > 0) {
        const { error: upsertError } = await supabase
          .from("attendance_summary")
          .upsert(summaries, { onConflict: "user_id,date" });

        if (upsertError) throw upsertError;
      }

      return { success: true, processed: summaries.length };
    } catch (error) {
      console.error("Error processing attendance:", error);
      throw error;
    }
  },

  /**
   * Credit comp-off for Sunday work
   */
  async creditSundayCompOff(userId: string, dateStr: string) {
    try {
      // Check if already credited
      const { data: existing } = await supabase
        .from("compoff_credits")
        .select("id")
        .eq("user_id", userId)
        .eq("credit_date", dateStr)
        .eq("reason", "sunday_work")
        .maybeSingle();

      if (existing) return; // Already credited

      // Insert comp-off credit
      await supabase.from("compoff_credits").insert({
        user_id: userId,
        credit_date: dateStr,
        reason: "sunday_work",
        compoff_days: 1,
      });
    } catch (error) {
      console.error("Error crediting Sunday comp-off:", error);
    }
  },

  /**
   * Credit overtime comp-off
   */
  async creditOvertimeCompOff(userId: string, dateStr: string, overtimeMinutes: number) {
    try {
      if (overtimeMinutes < 60) return; // Only credit if >= 1 hour

      const compoffDays = Math.round((overtimeMinutes / 480) * 100) / 100; // 480 min = 1 day

      // Check if already credited
      const { data: existing } = await supabase
        .from("compoff_credits")
        .select("id")
        .eq("user_id", userId)
        .eq("credit_date", dateStr)
        .eq("reason", "overtime")
        .maybeSingle();

      if (existing) return;

      await supabase.from("compoff_credits").insert({
        user_id: userId,
        credit_date: dateStr,
        reason: "overtime",
        compoff_days: compoffDays,
      });
    } catch (error) {
      console.error("Error crediting overtime comp-off:", error);
    }
  },

  /**
   * Get available comp-off balance for a user
   */
  async getCompOffBalance(userId: string): Promise<number> {
    const { data: credits } = await supabase
      .from("compoff_credits")
      .select("compoff_days")
      .eq("user_id", userId)
      .eq("status", "active");

    const { data: usage } = await supabase
      .from("compoff_usage")
      .select("compoff_days_used");

    const totalCredits = (credits || []).reduce((sum, c) => sum + c.compoff_days, 0);
    const totalUsed = (usage || []).reduce((sum, u) => sum + u.compoff_days_used, 0);

    return totalCredits - totalUsed;
  },

  /**
   * Use comp-off for a leave
   */
  async useCompOffForLeave(userId: string, leaveId: string, daysToUse: number) {
    try {
      // Get available comp-off credits
      const { data: credits } = await supabase
        .from("compoff_credits")
        .select("*")
        .eq("user_id", userId)
        .eq("status", "active")
        .order("credit_date", { ascending: true });

      let remaining = daysToUse;
      const usageRecords: any[] = [];

      for (const credit of credits || []) {
        if (remaining <= 0) break;

        const daysUsed = Math.min(remaining, credit.compoff_days);
        usageRecords.push({
          user_id: userId,
          leave_id: leaveId,
          compoff_credit_id: credit.id,
          usage_date: new Date().toISOString().split("T")[0],
          compoff_days_used: daysUsed,
        });

        remaining -= daysUsed;
      }

      if (usageRecords.length > 0) {
        await supabase.from("compoff_usage").insert(usageRecords);
      }

      return { success: true, used: daysToUse - remaining };
    } catch (error) {
      console.error("Error using comp-off:", error);
      throw error;
    }
  },
};
