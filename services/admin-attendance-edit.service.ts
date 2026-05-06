import { supabase } from "@/lib/supabase";

export const AdminAttendanceEditService = {
  async getAllAttendance(limit: number = 500): Promise<any[]> {
    try {
      console.log("[ADMIN SERVICE] Fetching all attendance records, limit:", limit);
      
      const { data: attendanceData, error: attendanceError } = await supabase
        .from("attendance_logs")
        .select("*")
        .order("date", { ascending: false })
        .limit(limit);

      if (attendanceError) {
        console.error("[ADMIN SERVICE] Attendance query error:", attendanceError);
        throw attendanceError;
      }

      console.log("[ADMIN SERVICE] Attendance records fetched:", attendanceData?.length);

      if (!attendanceData || attendanceData.length === 0) {
        return [];
      }

      const userIds = [...new Set(attendanceData.map((a: any) => a.user_id))];
      console.log("[ADMIN SERVICE] Unique users:", userIds.length);

      const { data: profilesData, error: profilesError } = await supabase
        .from("profiles")
        .select("id, name, phone, office_id")
        .in("id", userIds);

      if (profilesError) {
        console.warn("[ADMIN SERVICE] Profiles query error (non-critical):", profilesError);
      }

      const profileMap = new Map();
      profilesData?.forEach((p: any) => {
        profileMap.set(p.id, p);
      });

      const merged = attendanceData.map((a: any) => {
        let isLate = false;
        if (a.checkin_time) {
          const timeStr = a.checkin_time.substring(11, 16);
          const [hours, minutes] = timeStr.split(":").map(Number);
          isLate = hours > 10 || (hours === 10 && minutes >= 31);
        }
        
        return {
          ...a,
          is_late: isLate,
          admin_edited: false,
          profiles: profileMap.get(a.user_id) || { id: a.user_id, name: "Unknown", phone: "—" },
        };
      });

      console.log("[ADMIN SERVICE] Merged records:", merged.length);
      return merged;
    } catch (error) {
      console.error("[ADMIN SERVICE] Error fetching all attendance:", error);
      throw error;
    }
  },

  async getAttendanceByDateRange(startDate: string, endDate: string): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from("attendance_logs")
        .select("*")
        .gte("date", startDate)
        .lte("date", endDate)
        .order("date", { ascending: false });

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error("Error fetching attendance by date range:", error);
      throw error;
    }
  },

  async getAttendanceByEmployee(userId: string): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from("attendance_logs")
        .select("*")
        .eq("user_id", userId)
        .order("date", { ascending: false });

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error("Error fetching attendance by employee:", error);
      throw error;
    }
  },



  async getAttendanceById(attendanceId: string): Promise<any> {
    try {
      const { data, error } = await supabase
        .from("attendance_logs")
        .select("*")
        .eq("id", attendanceId)
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error("Error fetching attendance:", error);
      throw error;
    }
  },

  async editCheckInTime(
    attendanceId: string,
    newCheckInTime: string,
    reason: string
  ): Promise<any> {
    try {
      console.log("[ADMIN SERVICE] editCheckInTime called");
      console.log("[ADMIN SERVICE] attendanceId:", attendanceId);
      console.log("[ADMIN SERVICE] newCheckInTime:", newCheckInTime);
      console.log("[ADMIN SERVICE] reason:", reason);

      const { data, error } = await supabase
        .from("attendance_logs")
        .update({ checkin_time: newCheckInTime })
        .eq("id", attendanceId)
        .select();

      console.log("[ADMIN SERVICE] Supabase response error:", error);
      console.log("[ADMIN SERVICE] Supabase response data:", data);

      if (error) {
        console.error("[ADMIN SERVICE] Update error:", error);
        throw new Error(error.message || "Failed to update attendance");
      }

      console.log("[ADMIN SERVICE] Update successful");
      
      // Verify the update was saved
      const { data: verifyData, error: verifyError } = await supabase
        .from("attendance_logs")
        .select("id, checkin_time")
        .eq("id", attendanceId)
        .single();
      
      console.log("[ADMIN SERVICE] Verification - checkin_time in DB:", verifyData?.checkin_time);
      console.log("[ADMIN SERVICE] Verification - matches sent time:", verifyData?.checkin_time === newCheckInTime);
      
      return data?.[0] || data;
    } catch (error: any) {
      console.error("[ADMIN SERVICE] Error updating check-in time:", error);
      throw error;
    }
  },

  async markAsOnTime(attendanceId: string, reason: string): Promise<any> {
    try {
      const attendance = await this.getAttendanceById(attendanceId);
      if (!attendance) throw new Error("Attendance record not found");

      const date = attendance.date;
      const onTimeCheckIn = `${date}T10:30:00`;

      const { data, error } = await supabase
        .from("attendance_logs")
        .update({ checkin_time: onTimeCheckIn })
        .eq("id", attendanceId)
        .select();

      if (error) throw error;

      console.log("[SYSTEM_ADMIN] Marked as on-time:", {
        attendanceId,
        onTimeCheckIn,
        reason,
      });

      return data?.[0] || data;
    } catch (error) {
      console.error("Error marking as on-time:", error);
      throw error;
    }
  },

  async bulkMarkAsOnTime(attendanceIds: string[], reason: string): Promise<any> {
    try {
      const results = [];
      for (const id of attendanceIds) {
        const result = await this.markAsOnTime(id, reason);
        results.push(result);
      }
      return results;
    } catch (error) {
      console.error("Error in bulk mark as on-time:", error);
      throw error;
    }
  },

  async getEditHistory(attendanceId: string): Promise<any> {
    try {
      const { data, error } = await supabase
        .from("attendance_logs")
        .select("id, date, checkin_time")
        .eq("id", attendanceId)
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error("Error fetching edit history:", error);
      throw error;
    }
  },
};
