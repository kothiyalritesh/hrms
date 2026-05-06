import { supabase } from "@/lib/supabase";

interface AttendanceReportRow {
  date: string;
  employee_name: string;
  employee_id: string;
  phone: string;
  office: string;
  punch_in_time: string;
  punch_out_time: string;
  working_hours: number;
  is_late: boolean;
  late_minutes: number;
  is_overtime: boolean;
  overtime_minutes: number;
  status: string;
  is_on_duty: boolean;
  is_sunday: boolean;
  is_leave: boolean;
  leave_type?: string;
}

export const AttendanceReportService = {
  /**
   * Format time for display
   */
  formatTime(isoTime?: string): string {
    if (!isoTime) return "—";
    return new Date(isoTime).toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  },

  /**
   * Format date for display
   */
  formatDate(dateStr: string): string {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-IN", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  },

  /**
   * Get attendance data for daily report
   */
  async getDailyReport(date: string, officeId?: string): Promise<AttendanceReportRow[]> {
    let query = supabase
      .from("admin_attendance_export")
      .select("*")
      .eq("date", date);

    if (officeId) {
      query = query.eq("office_id", officeId);
    }

    const { data, error } = await query.order("employee_name");

    if (error) throw error;

    return (data || []).map((row: any) => ({
      date: row.date,
      employee_name: row.employee_name,
      employee_id: row.employee_number || row.user_id,
      phone: row.phone,
      office: row.office_location,
      punch_in_time: this.formatTime(row.punch_in_time),
      punch_out_time: this.formatTime(row.punch_out_time),
      working_hours: row.working_hours || 0,
      is_late: row.is_late,
      late_minutes: row.late_minutes || 0,
      is_overtime: row.is_overtime,
      overtime_minutes: row.overtime_minutes || 0,
      status: row.status,
      is_on_duty: row.is_on_duty,
      is_sunday: row.is_sunday,
      is_leave: row.is_leave,
      leave_type: row.leave_type,
    }));
  },

  /**
   * Get attendance data for weekly report
   */
  async getWeeklyReport(startDate: string, endDate: string, officeId?: string): Promise<AttendanceReportRow[]> {
    let query = supabase
      .from("admin_attendance_export")
      .select("*")
      .gte("date", startDate)
      .lte("date", endDate);

    if (officeId) {
      query = query.eq("office_id", officeId);
    }

    const { data, error } = await query.order("date", { ascending: false }).order("employee_name");

    if (error) throw error;

    return (data || []).map((row: any) => ({
      date: row.date,
      employee_name: row.employee_name,
      employee_id: row.employee_number || row.user_id,
      phone: row.phone,
      office: row.office_location,
      punch_in_time: this.formatTime(row.punch_in_time),
      punch_out_time: this.formatTime(row.punch_out_time),
      working_hours: row.working_hours || 0,
      is_late: row.is_late,
      late_minutes: row.late_minutes || 0,
      is_overtime: row.is_overtime,
      overtime_minutes: row.overtime_minutes || 0,
      status: row.status,
      is_on_duty: row.is_on_duty,
      is_sunday: row.is_sunday,
      is_leave: row.is_leave,
      leave_type: row.leave_type,
    }));
  },

  /**
   * Get attendance data for monthly report
   */
  async getMonthlyReport(month: number, year: number, officeId?: string) {
    const { data, error } = await supabase
      .from("monthly_attendance_report")
      .select("*")
      .eq("month", month)
      .eq("year", year)
      .order("employee_name");

    if (error) throw error;

    let results = data || [];

    if (officeId) {
      results = results.filter((r: any) => r.office_name === officeId);
    }

    return results;
  },

  /**
   * Generate CSV for daily report
   */
  async generateDailyCSV(date: string, officeId?: string): Promise<string> {
    const records = await this.getDailyReport(date, officeId);

    const headers = [
      "Date",
      "Employee Name",
      "Employee ID",
      "Phone",
      "Office",
      "Check In",
      "Check Out",
      "Duration",
      "Status",
      "Late",
      "Late Minutes",
      "Overtime",
      "Overtime Minutes",
      "On Duty",
      "Sunday",
      "Leave",
      "Leave Type",
      "Distance from Office (m)",
      "Warning",
    ];

    const rows = records.map((r) => [
      this.formatDate(r.date),
      r.employee_name,
      r.employee_id,
      r.phone,
      r.office,
      r.punch_in_time,
      r.punch_out_time,
      r.working_hours.toFixed(2),
      r.status.charAt(0).toUpperCase() + r.status.slice(1),
      r.is_late ? "Yes" : "No",
      r.late_minutes,
      r.is_overtime ? "Yes" : "No",
      r.overtime_minutes,
      r.is_on_duty ? "Yes" : "No",
      r.is_sunday ? "Yes" : "No",
      r.is_leave ? "Yes" : "No",
      r.leave_type || "",
      "—",
      r.is_late ? `Late by ${r.late_minutes} minutes` : "",
    ]);

    return this.arrayToCSV(headers, rows);
  },

  /**
   * Generate CSV for weekly report
   */
  async generateWeeklyCSV(startDate: string, endDate: string, officeId?: string): Promise<string> {
    const records = await this.getWeeklyReport(startDate, endDate, officeId);

    const headers = [
      "Date",
      "Employee Name",
      "Employee ID",
      "Phone",
      "Office",
      "Check In",
      "Check Out",
      "Duration",
      "Status",
      "Late",
      "Late Minutes",
      "Overtime",
      "Overtime Minutes",
      "On Duty",
      "Sunday",
      "Leave",
      "Leave Type",
      "Distance from Office (m)",
      "Warning",
    ];

    const rows = records.map((r) => [
      this.formatDate(r.date),
      r.employee_name,
      r.employee_id,
      r.phone,
      r.office,
      r.punch_in_time,
      r.punch_out_time,
      r.working_hours.toFixed(2),
      r.status.charAt(0).toUpperCase() + r.status.slice(1),
      r.is_late ? "Yes" : "No",
      r.late_minutes,
      r.is_overtime ? "Yes" : "No",
      r.overtime_minutes,
      r.is_on_duty ? "Yes" : "No",
      r.is_sunday ? "Yes" : "No",
      r.is_leave ? "Yes" : "No",
      r.leave_type || "",
      "—",
      r.is_late ? `Late by ${r.late_minutes} minutes` : "",
    ]);

    return this.arrayToCSV(headers, rows);
  },

  /**
   * Generate CSV for monthly report
   */
  async generateMonthlyCSV(month: number, year: number, officeId?: string): Promise<string> {
    const records = await this.getMonthlyReport(month, year, officeId);

    const headers = [
      "Employee Name",
      "Employee ID",
      "Phone",
      "Office",
      "Present Days",
      "Late Days",
      "Absent Days",
      "On Duty Days",
      "Leave Days",
      "Sunday Days",
      "Holiday Days",
      "Total Working Hours",
      "Total Overtime Hours",
      "Attendance %",
    ];

    const rows = records.map((r: any) => [
      r.employee_name,
      r.employee_number,
      r.phone,
      r.office_name,
      r.present_days,
      r.late_days,
      r.absent_days,
      r.on_duty_days,
      r.leave_days,
      r.sunday_count || 0,
      r.holiday_count || 0,
      r.total_working_hours.toFixed(2),
      r.total_overtime_hours.toFixed(2),
      r.attendance_percentage?.toFixed(2) || "0",
    ]);

    return this.arrayToCSV(headers, rows);
  },

  /**
   * Generate CSV for last month report
   */
  async generateLastMonthCSV(officeId?: string): Promise<string> {
    const today = new Date();
    const lastMonth = today.getMonth() === 0 ? 12 : today.getMonth();
    const lastYear = today.getMonth() === 0 ? today.getFullYear() - 1 : today.getFullYear();

    return this.generateMonthlyCSV(lastMonth, lastYear, officeId);
  },

  /**
   * Generate CSV for this month report
   */
  async generateThisMonthCSV(officeId?: string): Promise<string> {
    const today = new Date();
    return this.generateMonthlyCSV(today.getMonth() + 1, today.getFullYear(), officeId);
  },

  /**
   * Convert array to CSV string
   */
  arrayToCSV(headers: string[], rows: any[][]): string {
    const escapedHeaders = headers.map((h) => `"${h.replace(/"/g, '""')}"`).join(",");
    const escapedRows = rows.map((row) =>
      row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
    );

    return [escapedHeaders, ...escapedRows].join("\n");
  },

  /**
   * Download CSV file (browser)
   */
  downloadCSV(csv: string, filename: string) {
    if (typeof window === "undefined") return;

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  },

  /**
   * Get summary statistics for a date range
   */
  async getSummaryStats(startDate: string, endDate: string, officeId?: string) {
    let query = supabase
      .from("admin_attendance_export")
      .select("*")
      .gte("date", startDate)
      .lte("date", endDate);

    if (officeId) {
      query = query.eq("office_id", officeId);
    }

    const { data } = await query;

    const records = data || [];

    return {
      total_records: records.length,
      present_count: records.filter((r: any) => r.status === "present").length,
      late_count: records.filter((r: any) => r.is_late).length,
      absent_count: records.filter((r: any) => r.status === "absent").length,
      on_duty_count: records.filter((r: any) => r.is_on_duty).length,
      leave_count: records.filter((r: any) => r.is_leave).length,
      overtime_count: records.filter((r: any) => r.is_overtime).length,
      total_working_hours: records.reduce((sum: number, r: any) => sum + (r.working_hours || 0), 0),
      total_overtime_hours: records.reduce((sum: number, r: any) => sum + (r.overtime_minutes || 0), 0) / 60,
      average_working_hours: records.length > 0
        ? records.reduce((sum: number, r: any) => sum + (r.working_hours || 0), 0) / records.length
        : 0,
    };
  },
};
