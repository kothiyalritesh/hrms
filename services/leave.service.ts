import { supabase } from "@/lib/supabase";

export const LeaveService = {
  getBalance(userId: string) {
    return supabase
      .from("leave_balance")
      .select("sick, casual, earned")
      .eq("user_id", userId)
      .single();
  },

  submitLeave(
    userId: string,
    leaveData: {
      type: "sick" | "casual" | "earned" | "wfh";
      startDate: string;
      endDate: string;
      reason: string;
    },
  ) {
    return supabase
      .from("leave_requests")
      .insert({
        user_id: userId,
        leave_type: leaveData.type,
        start_date: leaveData.startDate,
        end_date: leaveData.endDate,
        reason: leaveData.reason,
        status: "pending",
        applied_on: new Date().toISOString(),
      })
      .select()
      .single();
  },

  getUserLeaves(userId: string) {
    return supabase
      .from("leave_requests")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
  },
};
