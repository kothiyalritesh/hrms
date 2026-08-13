import { supabase } from "@/lib/supabase";
import { BusinessClockService } from "@/services/business-clock.service";
import {
  AttendanceRecord,
  Task,
  LeaveRequest,
  Notification,
  Project,
} from "@/utils/storage";

export const SupabaseService = {
  // Attendance operations
  attendance: {
    async getAll(userId: string): Promise<AttendanceRecord[]> {
      const { data, error } = await supabase
        .from("attendance")
        .select("*")
        .eq("user_id", userId)
        .order("date", { ascending: false });

      if (error) throw error;
      return data || [];
    },

    async add(record: AttendanceRecord & { user_id: string }): Promise<void> {
      const { error } = await supabase.from("attendance").insert([record]);

      if (error) throw error;
    },

    async getTodayRecord(userId: string): Promise<AttendanceRecord | null> {
      const today = await BusinessClockService.getDate(true);
      const { data, error } = await supabase
        .from("attendance")
        .select("*")
        .eq("user_id", userId)
        .eq("date", today)
        .single();

      if (error && error.code !== "PGRST116") throw error;
      return data || null;
    },
  },

  // Tasks operations
  tasks: {
    async getByStatus(userId: string, status: Task["status"]): Promise<Task[]> {
      const { data, error } = await supabase
        .from("tasks")
        .select("*")
        .eq("assigned_to", userId)
        .eq("status", status)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data || [];
    },
  },

  // Notifications operations
  notifications: {
    async getUnreadCount(userId: string): Promise<number> {
      const { count, error } = await supabase
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("read", false);

      if (error) throw error;
      return count || 0;
    },
  },

  // Auth operations
  auth: {
    async signIn(email: string, password: string) {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;
      return data;
    },

    async getCurrentUser() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      return user;
    },
  },
};
