import { supabase } from "@/lib/supabase";

interface DailyAttendanceDetail {
  date: string;
  day_name: string;
  punch_in_time: string;
  punch_out_time: string;
  working_hours: number;
  status: string;
  is_late: boolean;
  late_minutes: number;
  is_overtime: boolean;
  overtime_minutes: number;
  is_on_duty: boolean;
  is_sunday: boolean;
  is_leave: boolean;
  leave_type?: string;
}

interface MonthlyReportSummary {
  employee_name: string;
  employee_id: string;
  phone: string;
  office: string;
  month: number;
  year: number;
  present_days: number;
  late_days: number;
  absent_days: number;
  on_duty_days: number;
  leave_days: number;
  sunday_days: number;
  holiday_days: number;
  total_working_hours: number;
  total_overtime_hours: number;
  attendance_percentage: number;
  daily_details: DailyAttendanceDetail[];
}

export const EmployeeMonthlyReportService = {
  async getEmployeeMonthlyReport(
    userId: string,
    month: number,
    year: number
  ): Promise<MonthlyReportSummary> {
    try {
      const { data: empData, error: empError } = await supabase
        .from("profiles")
        .select("id, name, phone, office_id")
        .eq("id", userId)
        .single();

      if (empError || !empData) {
        console.error("Employee fetch error:", empError);
        throw new Error("Employee not found");
      }

      console.log("Employee data:", empData);

      const { data: officeData } = await supabase
        .from("offices")
        .select("name")
        .eq("id", empData.office_id)
        .single();

      console.log("Office data:", officeData);

      const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const endDate = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

      console.log("Fetching attendance from", startDate, "to", endDate);

      const { data: dailyData, error: dailyError } = await supabase
        .from("attendance_logs")
        .select("*")
        .eq("user_id", userId)
        .gte("date", startDate)
        .lte("date", endDate)
        .order("date", { ascending: true });

      console.log("Daily data error:", dailyError);
      console.log("Daily data count:", dailyData?.length);
      console.log("Daily data sample:", dailyData?.[0]);

      const daily = (dailyData || []).map((d: any) => {
        let workingHours = 0;
        if (d.checkin_time && d.checkout_time) {
          const checkin = new Date(d.checkin_time);
          const checkout = new Date(d.checkout_time);
          workingHours = (checkout.getTime() - checkin.getTime()) / (1000 * 60 * 60);
        }

        const isLate = d.checkin_time
          ? d.checkin_time.substring(11, 16) > "10:30"
          : false;

        let lateMinutes = 0;
        if (isLate && d.checkin_time) {
          const checkinTime = new Date(d.checkin_time);
          const lateThreshold = new Date(d.date + "T10:35:00");
          lateMinutes = Math.round(
            (checkinTime.getTime() - lateThreshold.getTime()) / (1000 * 60)
          );
        }

        const isOvertime = d.checkout_time
          ? new Date(d.checkout_time).getHours() > 18 ||
            (new Date(d.checkout_time).getHours() === 18 &&
              new Date(d.checkout_time).getMinutes() > 45)
          : false;

        let overtimeMinutes = 0;
        if (isOvertime && d.checkout_time) {
          const checkoutTime = new Date(d.checkout_time);
          const overtimeThreshold = new Date(d.date + "T18:45:00");
          overtimeMinutes = Math.round(
            (checkoutTime.getTime() - overtimeThreshold.getTime()) / (1000 * 60)
          );
        }

        const dateObj = new Date(d.date + "T00:00:00");
        const isSunday = dateObj.getDay() === 0;

        return {
          date: d.date,
          day_name: dateObj.toLocaleDateString("en-IN", { weekday: "short" }),
          punch_in_time: d.checkin_time
            ? d.checkin_time.substring(11, 16)
            : "—",
          punch_out_time: d.checkout_time
            ? d.checkout_time.substring(11, 16)
            : "—",
          working_hours: workingHours,
          status:
            d.status === "CHECKED_OUT"
              ? "present"
              : d.status === "CHECKED_IN"
              ? "present"
              : "absent",
          is_late: isLate,
          late_minutes: lateMinutes,
          is_overtime: isOvertime,
          overtime_minutes: overtimeMinutes,
          is_on_duty: d.attendance_type === "ON_DUTY",
          is_sunday: isSunday,
          is_leave: false,
          leave_type: null,
        };
      });

      console.log("Processed daily data:", daily);

      const summary = {
        present_days: daily.filter((d) => d.status === "present").length,
        late_days: daily.filter((d) => d.is_late).length,
        absent_days: daily.filter((d) => d.status === "absent").length,
        on_duty_days: daily.filter((d) => d.is_on_duty).length,
        leave_days: daily.filter((d) => d.is_leave).length,
        sunday_days: daily.filter((d) => d.is_sunday).length,
        holiday_days: 0,
        total_working_hours: daily.reduce((sum, d) => sum + d.working_hours, 0),
        total_overtime_hours: daily.reduce(
          (sum, d) => sum + d.overtime_minutes / 60,
          0
        ),
        attendance_percentage:
          daily.length > 0
            ? (daily.filter((d) => d.status === "present").length /
                daily.length) *
              100
            : 0,
      };

      console.log("Summary:", summary);

      return {
        employee_name: empData.name,
        employee_id: empData.id,
        phone: empData.phone || "—",
        office: officeData?.name || "—",
        month,
        year,
        ...summary,
        daily_details: daily,
      };
    } catch (error: any) {
      console.error("Error in getEmployeeMonthlyReport:", error);
      throw error;
    }
  },

  async generateEmployeeMonthlyCSV(
    userId: string,
    month: number,
    year: number
  ): Promise<string> {
    const report = await this.getEmployeeMonthlyReport(userId, month, year);

    const summaryHeaders = [
      "Employee Name",
      "Employee ID",
      "Phone",
      "Office",
      "Month",
      "Year",
    ];
    const summaryRow = [
      report.employee_name,
      report.employee_id,
      report.phone,
      report.office,
      month,
      year,
    ];

    const statsHeaders = [
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
    const statsRow = [
      report.present_days,
      report.late_days,
      report.absent_days,
      report.on_duty_days,
      report.leave_days,
      report.sunday_days,
      report.holiday_days,
      report.total_working_hours.toFixed(2),
      report.total_overtime_hours.toFixed(2),
      report.attendance_percentage.toFixed(2),
    ];

    const dailyHeaders = [
      "Date",
      "Day",
      "Check In",
      "Check Out",
      "Duration (hrs)",
      "Status",
      "Late",
      "Late Minutes",
      "Overtime",
      "Overtime Minutes",
      "On Duty",
      "Sunday",
      "Leave",
      "Leave Type",
    ];

    const dailyRows = report.daily_details.map((d) => [
      d.date,
      d.day_name,
      d.punch_in_time,
      d.punch_out_time,
      d.working_hours.toFixed(2),
      d.status.charAt(0).toUpperCase() + d.status.slice(1),
      d.is_late ? "Yes" : "No",
      d.late_minutes,
      d.is_overtime ? "Yes" : "No",
      d.overtime_minutes,
      d.is_on_duty ? "Yes" : "No",
      d.is_sunday ? "Yes" : "No",
      d.is_leave ? "Yes" : "No",
      d.leave_type || "",
    ]);

    const csv: string[] = [];

    csv.push(this.escapeLine(summaryHeaders));
    csv.push(this.escapeLine(summaryRow));
    csv.push("");

    csv.push(this.escapeLine(statsHeaders));
    csv.push(this.escapeLine(statsRow));
    csv.push("");

    csv.push(this.escapeLine(dailyHeaders));
    dailyRows.forEach((row) => csv.push(this.escapeLine(row)));

    return csv.join("\n");
  },

  escapeLine(row: any[]): string {
    return row
      .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
      .join(",");
  },

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

  async getAvailableMonths(
    userId: string
  ): Promise<{ month: number; year: number }[]> {
    try {
      console.log("[SERVICE] Fetching available months for user:", userId);

      const { data: dailyData, error } = await supabase
        .from("attendance_logs")
        .select("date")
        .eq("user_id", userId)
        .order("date", { ascending: false });

      console.log("[SERVICE] Query error:", error?.message);
      console.log("[SERVICE] Query returned", dailyData?.length, "records");

      if (dailyData && dailyData.length > 0) {
        console.log("[SERVICE] Sample dates:", dailyData.slice(0, 3).map((d: any) => d.date));

        const months = new Map<string, { month: number; year: number }>();
        dailyData.forEach((d: any) => {
          const date = new Date(d.date + "T00:00:00");
          const month = date.getMonth() + 1;
          const year = date.getFullYear();
          const key = `${year}-${month}`;
          months.set(key, { month, year });
        });

        const result = Array.from(months.values()).sort((a, b) => {
          if (a.year !== b.year) return b.year - a.year;
          return b.month - a.month;
        });

        console.log("[SERVICE] Unique months found:", result);
        return result;
      }

      console.log("[SERVICE] No attendance data found");
      return [];
    } catch (error) {
      console.error("[SERVICE] Error getting available months:", error);
      return [];
    }
  },
};
