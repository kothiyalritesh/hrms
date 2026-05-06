import { supabase } from "@/lib/supabase";

export const NotificationService = {
  getUnreadCount(userId: string) {
    return supabase
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("read", false);
  },
};
