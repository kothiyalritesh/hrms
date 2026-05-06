import { supabase } from "@/lib/supabase";

interface DeletedAttendanceRecord {
  backup_id: string;
  original_id: string;
  user_id: string;
  employee_name: string;
  date: string;
  checkin_time: string;
  checkout_time: string;
  status: string;
  deleted_at: string;
  deleted_by_name: string;
  deletion_reason: string;
  backup_created_at: string;
}

interface RestoreResult {
  success: boolean;
  message: string;
  restored_id?: string;
}

export const AttendanceRecoveryService = {
  /**
   * Get all deleted attendance records
   */
  async getDeletedAttendance(
    userId?: string,
    startDate?: string,
    endDate?: string
  ): Promise<DeletedAttendanceRecord[]> {
    try {
      const { data, error } = await supabase
        .rpc("get_deleted_attendance", {
          p_user_id: userId || null,
          p_start_date: startDate || null,
          p_end_date: endDate || null,
        });

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error("Error fetching deleted attendance:", error);
      throw error;
    }
  },

  /**
   * Get deleted attendance for a specific user
   */
  async getUserDeletedAttendance(userId: string): Promise<DeletedAttendanceRecord[]> {
    return this.getDeletedAttendance(userId);
  },

  /**
   * Get deleted attendance for a date range
   */
  async getDeletedAttendanceByDateRange(
    startDate: string,
    endDate: string
  ): Promise<DeletedAttendanceRecord[]> {
    return this.getDeletedAttendance(undefined, startDate, endDate);
  },

  /**
   * Restore a deleted attendance record
   */
  async restoreAttendance(
    backupId: string,
    restoredBy: string,
    reason: string = "Manual restoration"
  ): Promise<RestoreResult> {
    try {
      const { data, error } = await supabase
        .rpc("restore_attendance", {
          p_backup_id: backupId,
          p_restored_by: restoredBy,
          p_reason: reason,
        });

      if (error) throw error;

      if (data && data.length > 0) {
        const result = data[0];
        return {
          success: result.success,
          message: result.message,
          restored_id: result.restored_id,
        };
      }

      return { success: false, message: "No response from restore function" };
    } catch (error) {
      console.error("Error restoring attendance:", error);
      throw error;
    }
  },

  /**
   * Restore multiple deleted attendance records
   */
  async restoreMultipleAttendance(
    backupIds: string[],
    restoredBy: string,
    reason: string = "Batch restoration"
  ): Promise<RestoreResult[]> {
    const results: RestoreResult[] = [];

    for (const backupId of backupIds) {
      try {
        const result = await this.restoreAttendance(backupId, restoredBy, reason);
        results.push(result);
      } catch (error) {
        results.push({
          success: false,
          message: `Failed to restore ${backupId}: ${error}`,
        });
      }
    }

    return results;
  },

  /**
   * Soft delete an attendance record (instead of hard delete)
   */
  async softDeleteAttendance(
    attendanceId: string,
    deletedBy: string,
    reason: string = "Manual deletion"
  ): Promise<RestoreResult> {
    try {
      const { data, error } = await supabase
        .rpc("soft_delete_attendance", {
          p_attendance_id: attendanceId,
          p_deleted_by: deletedBy,
          p_reason: reason,
        });

      if (error) throw error;

      if (data && data.length > 0) {
        const result = data[0];
        return {
          success: result.success,
          message: result.message,
          restored_id: result.backup_id,
        };
      }

      return { success: false, message: "No response from delete function" };
    } catch (error) {
      console.error("Error soft deleting attendance:", error);
      throw error;
    }
  },

  /**
   * Get attendance audit log for a record
   */
  async getAttendanceAuditLog(attendanceId: string) {
    try {
      const { data, error } = await supabase
        .from("attendance_audit_log")
        .select("*")
        .eq("attendance_id", attendanceId)
        .order("performed_at", { ascending: false });

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error("Error fetching audit log:", error);
      throw error;
    }
  },

  /**
   * Get audit log for a user
   */
  async getUserAuditLog(userId: string) {
    try {
      const { data, error } = await supabase
        .from("attendance_audit_log")
        .select("*")
        .eq("user_id", userId)
        .order("performed_at", { ascending: false });

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error("Error fetching user audit log:", error);
      throw error;
    }
  },

  /**
   * Get all deleted attendance from view
   */
  async getDeletedAttendanceView() {
    try {
      const { data, error } = await supabase
        .from("deleted_attendance_view")
        .select("*")
        .order("deleted_at", { ascending: false });

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error("Error fetching deleted attendance view:", error);
      throw error;
    }
  },

  /**
   * Get backup details
   */
  async getBackupDetails(backupId: string) {
    try {
      const { data, error } = await supabase
        .from("attendance_logs_backup")
        .select("*")
        .eq("id", backupId)
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error("Error fetching backup details:", error);
      throw error;
    }
  },

  /**
   * Get all backups for a user
   */
  async getUserBackups(userId: string) {
    try {
      const { data, error } = await supabase
        .from("attendance_logs_backup")
        .select("*")
        .eq("user_id", userId)
        .order("backup_created_at", { ascending: false });

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error("Error fetching user backups:", error);
      throw error;
    }
  },

  /**
   * Get restoration history
   */
  async getRestorationHistory() {
    try {
      const { data, error } = await supabase
        .from("attendance_audit_log")
        .select("*")
        .eq("action", "RESTORE")
        .order("performed_at", { ascending: false });

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error("Error fetching restoration history:", error);
      throw error;
    }
  },

  /**
   * Get deletion history
   */
  async getDeletionHistory() {
    try {
      const { data, error } = await supabase
        .from("attendance_audit_log")
        .select("*")
        .eq("action", "DELETE")
        .order("performed_at", { ascending: false });

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error("Error fetching deletion history:", error);
      throw error;
    }
  },

  /**
   * Get summary of deleted records
   */
  async getDeletedAttendanceSummary() {
    try {
      const { data, error } = await supabase
        .from("deleted_attendance_view")
        .select("*");

      if (error) throw error;

      const records = data || [];
      return {
        total_deleted: records.length,
        by_employee: records.reduce((acc: any, r: any) => {
          if (!acc[r.employee_name]) {
            acc[r.employee_name] = 0;
          }
          acc[r.employee_name]++;
          return acc;
        }, {}),
        by_reason: records.reduce((acc: any, r: any) => {
          const reason = r.deletion_reason || "Unknown";
          if (!acc[reason]) {
            acc[reason] = 0;
          }
          acc[reason]++;
          return acc;
        }, {}),
        records,
      };
    } catch (error) {
      console.error("Error getting deleted attendance summary:", error);
      throw error;
    }
  },

  /**
   * Export deleted attendance as CSV
   */
  async exportDeletedAttendanceCSV(): Promise<string> {
    try {
      const records = await this.getDeletedAttendanceView();

      const headers = [
        "Employee Name",
        "Employee Number",
        "Date",
        "Punch In",
        "Punch Out",
        "Status",
        "Deleted At",
        "Deleted By",
        "Deletion Reason",
        "Backup Created At",
      ];

      const rows = records.map((r: any) => [
        r.employee_name,
        r.employee_number,
        r.date,
        r.checkin_time ? new Date(r.checkin_time).toLocaleString("en-IN") : "",
        r.checkout_time ? new Date(r.checkout_time).toLocaleString("en-IN") : "",
        r.status,
        new Date(r.deleted_at).toLocaleString("en-IN"),
        r.deleted_by_name,
        r.deletion_reason,
        new Date(r.backup_created_at).toLocaleString("en-IN"),
      ]);

      const csv = [
        headers.map((h) => `"${h}"`).join(","),
        ...rows.map((row) =>
          row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
        ),
      ].join("\n");

      return csv;
    } catch (error) {
      console.error("Error exporting deleted attendance:", error);
      throw error;
    }
  },

  /**
   * Check if a record is soft deleted
   */
  async isRecordDeleted(attendanceId: string): Promise<boolean> {
    try {
      const { data, error } = await supabase
        .from("attendance_logs")
        .select("deleted_at")
        .eq("id", attendanceId)
        .single();

      if (error) throw error;
      return data?.deleted_at !== null;
    } catch (error) {
      console.error("Error checking if record is deleted:", error);
      return false;
    }
  },

  /**
   * Get recovery statistics
   */
  async getRecoveryStatistics() {
    try {
      const deletedCount = await supabase
        .from("deleted_attendance_view")
        .select("*", { count: "exact", head: true });

      const restoredCount = await supabase
        .from("attendance_logs_backup")
        .select("*", { count: "exact", head: true })
        .not("backup_restored_at", "is", null);

      const auditCount = await supabase
        .from("attendance_audit_log")
        .select("*", { count: "exact", head: true });

      return {
        total_deleted_records: deletedCount.count || 0,
        total_restored_records: restoredCount.count || 0,
        total_audit_entries: auditCount.count || 0,
        recovery_rate:
          deletedCount.count && restoredCount.count
            ? ((restoredCount.count / (deletedCount.count + restoredCount.count)) * 100).toFixed(2)
            : "0",
      };
    } catch (error) {
      console.error("Error getting recovery statistics:", error);
      throw error;
    }
  },
};
