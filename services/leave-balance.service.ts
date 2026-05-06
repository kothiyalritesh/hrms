import { supabase } from "@/lib/supabase";

export interface LeaveBalance {
  id: string;
  user_id: string;
  year: number;
  sick_total: number;
  sick_used: number;
  casual_total: number;
  casual_used: number;
  earned_total: number;
  earned_used: number;
  wfh_total: number;
  wfh_used: number;
}

export const LeaveBalanceService = {
  async getOrCreate(userId: string, year?: number): Promise<LeaveBalance> {
    const y = year || new Date().getFullYear();
    const { data: existing } = await supabase
      .from("leave_balances")
      .select("*")
      .eq("user_id", userId)
      .eq("year", y)
      .maybeSingle();

    if (existing) return existing;

    // Auto-initialize balance for the year with explicit defaults
    const { data: created, error: createError } = await supabase
      .from("leave_balances")
      .insert({
        user_id: userId,
        year: y,
        sick_total: 12,
        sick_used: 0,
        casual_total: 12,
        casual_used: 0,
        earned_total: 15,
        earned_used: 0,
        wfh_total: 24,
        wfh_used: 0,
      })
      .select()
      .single();
    if (createError) console.error("[LeaveBalance] create error:", createError);
    return created!;
  },

  async updateOnApproval(leaveId: string) {
    try {
      const { data: leave, error: leaveError } = await supabase
        .from("leaves")
        .select("user_id, type, start_date, end_date")
        .eq("id", leaveId)
        .single();
      if (leaveError || !leave) {
        console.error("updateOnApproval: leave not found");
        return;
      }

      const days = Math.ceil(
        (new Date(leave.end_date).getTime() - new Date(leave.start_date).getTime()) / 86400000
      ) + 1;
      const year = new Date(leave.start_date).getFullYear();
      const balance = await LeaveBalanceService.getOrCreate(leave.user_id, year);

      const fieldMap: Record<string, string> = {
        sick: "sick_used", casual: "casual_used",
        earned: "earned_used", wfh: "wfh_used",
      };
      const field = fieldMap[leave.type];
      if (!field) {
        console.error("updateOnApproval: unknown leave type");
        return;
      }

      const newUsed = (balance as any)[field] + days;
      const { error: updateError } = await supabase
        .from("leave_balances")
        .update({ [field]: newUsed, updated_at: new Date().toISOString() })
        .eq("id", balance.id);
      
      if (updateError) {
        console.error("updateOnApproval: failed to update balance");
      } else {
        console.log(`✅ Leave balance updated: ${field} for user`);
      }
    } catch (e) {
      console.error("updateOnApproval exception:", e);
    }
  },

  async updateOnRejection(leaveId: string) {
    // Reverse the balance if it was previously approved
    const { data: leave } = await supabase
      .from("leaves")
      .select("user_id, type, start_date, end_date, status")
      .eq("id", leaveId)
      .single();
    if (!leave || leave.status !== "approved") return;

    const days = Math.ceil(
      (new Date(leave.end_date).getTime() - new Date(leave.start_date).getTime()) / 86400000
    ) + 1;
    const year = new Date(leave.start_date).getFullYear();
    const balance = await LeaveBalanceService.getOrCreate(leave.user_id, year);

    const fieldMap: Record<string, string> = {
      sick: "sick_used", casual: "casual_used",
      earned: "earned_used", wfh: "wfh_used",
    };
    const field = fieldMap[leave.type];
    if (!field) return;

    const newUsed = Math.max(0, (balance as any)[field] - days);
    await supabase
      .from("leave_balances")
      .update({ [field]: newUsed, updated_at: new Date().toISOString() })
      .eq("id", balance.id);
  },

  remaining(balance: LeaveBalance) {
    return {
      sick: Math.max(0, balance.sick_total - balance.sick_used),
      casual: Math.max(0, balance.casual_total - balance.casual_used),
      earned: Math.max(0, balance.earned_total - balance.earned_used),
      wfh: Math.max(0, balance.wfh_total - balance.wfh_used),
    };
  },
};
