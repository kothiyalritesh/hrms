import { supabase } from "@/lib/supabase";
import { BusinessClockService } from "@/services/business-clock.service";

export type LeaveType = "sick" | "casual" | "earned" | "wfh" | "comp_off";
export type LeaveStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface LeaveApplication {
  id: string;
  user_id: string;
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  reason: string;
  status: LeaveStatus;
  requested_days: number;
  is_half_day: boolean;
  half_day_period?: "FIRST_HALF" | "SECOND_HALF" | null;
  rejection_reason?: string | null;
  review_notes?: string | null;
  reviewed_at?: string | null;
  applied_on?: string;
  created_at: string;
}

export interface LeaveBalance {
  sick: number;
  casual: number;
  earned: number;
  comp_off: number;
}

export interface LeaveRpcResult {
  success: boolean;
  error?: string;
  message?: string;
  id?: string;
  status?: LeaveStatus;
  requested_days?: number;
  available_balance?: number;
}

const emptyBalance: LeaveBalance = {
  sick: 0,
  casual: 0,
  earned: 0,
  comp_off: 0,
};

export const LeaveService = {
  async getBusinessDate(): Promise<string> {
    return BusinessClockService.getDate();
  },
  async getBalance(userId: string): Promise<LeaveBalance> {
    const { data, error } = await supabase
      .from("leave_balance")
      .select("sick,casual,earned,comp_off")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return { ...emptyBalance, ...(data ?? {}) } as LeaveBalance;
  },

  async submitLeave(
    userId: string,
    leaveData: {
      type: LeaveType;
      startDate: string;
      endDate: string;
      reason: string;
      isHalfDay?: boolean;
      halfDayPeriod?: "FIRST_HALF" | "SECOND_HALF";
    },
  ): Promise<LeaveRpcResult> {
    const { data, error } = await supabase.rpc("rpc_submit_leave_request", {
      p_user_id: userId,
      p_leave_type: leaveData.type,
      p_start_date: leaveData.startDate,
      p_end_date: leaveData.endDate,
      p_reason: leaveData.reason.trim(),
      p_is_half_day: leaveData.isHalfDay ?? false,
      p_half_day_period: leaveData.isHalfDay ? leaveData.halfDayPeriod : null,
    });
    if (error)
      return { success: false, error: error.code, message: error.message };
    return (Array.isArray(data) ? data[0] : data) as LeaveRpcResult;
  },

  async getUserLeaves(userId: string): Promise<LeaveApplication[]> {
    const { data, error } = await supabase
      .from("leave_requests")
      .select(
        "id,user_id,leave_type,start_date,end_date,reason,status,requested_days,is_half_day,half_day_period,rejection_reason,review_notes,reviewed_at,applied_on,created_at",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as LeaveApplication[];
  },

  async cancel(requestId: string, userId: string): Promise<LeaveRpcResult> {
    const { data, error } = await supabase.rpc("rpc_cancel_leave_request", {
      p_request_id: requestId,
      p_user_id: userId,
    });
    if (error)
      return { success: false, error: error.code, message: error.message };
    return (Array.isArray(data) ? data[0] : data) as LeaveRpcResult;
  },

  async getCalendar(userId: string, fromDate: string, toDate: string) {
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("office_id")
      .eq("id", userId)
      .maybeSingle();
    if (profileError) throw profileError;

    const holidayQuery = supabase
      .from("holiday_calendar")
      .select("id,holiday_date,name,is_optional,office_id")
      .gte("holiday_date", fromDate)
      .lte("holiday_date", toDate)
      .order("holiday_date");
    const rulesQuery = supabase
      .from("weekly_off_rules")
      .select("id,weekday,week_of_month,user_id,office_id")
      .eq("is_active", true);

    const [
      { data: holidays, error: holidayError },
      { data: rules, error: rulesError },
    ] = await Promise.all([holidayQuery, rulesQuery]);
    if (holidayError) throw holidayError;
    if (rulesError) throw rulesError;
    const officeId = profile?.office_id ?? null;
    return {
      holidays: (holidays ?? []).filter(
        (h: any) => h.office_id === null || h.office_id === officeId,
      ),
      weeklyOffs: (rules ?? []).filter(
        (r: any) =>
          r.user_id === userId || (!r.user_id && r.office_id === officeId),
      ),
    };
  },

  async review(
    requestId: string,
    adminId: string,
    approve: boolean,
    notes?: string,
  ): Promise<LeaveRpcResult> {
    const { data, error } = await supabase.rpc("rpc_review_leave_request", {
      p_request_id: requestId,
      p_admin_id: adminId,
      p_approve: approve,
      p_notes: notes?.trim() || null,
    });
    if (error)
      return { success: false, error: error.code, message: error.message };
    return (Array.isArray(data) ? data[0] : data) as LeaveRpcResult;
  },
};
