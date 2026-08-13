import { supabase } from "@/lib/supabase";

export const TaskService = {
  getPending(userId: string, limit: number = 3) {
    return supabase
      .from("tasks")
      .select("*")
      .eq("assigned_to", userId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(limit);
  },
};
