import { supabase } from "@/lib/supabase";
import { GeofenceViolationService } from "./geofence-violation.service";

interface PerformanceMetrics {
  user_id: string;
  month: number;
  year: number;
  total_working_days: number;
  present_days: number;
  late_days: number;
  absent_days: number;
  on_duty_days: number;
  leave_days: number;
  total_working_hours: number;
  total_overtime_hours: number;
  punctuality_score: number;
  consistency_score: number;
  compliance_score: number;
  compliance_penalty: number;
  adjusted_overall_score: number;
}

interface TopPerformer {
  rank: number;
  user_id: string;
  employee_name: string;
  employee_number: string;
  phone: string;
  office_name: string;
  present_days: number;
  late_days: number;
  absent_days: number;
  total_working_hours: number;
  total_overtime_hours: number;
  punctuality_score: number;
  consistency_score: number;
  overall_score: number;
}

export const PerformanceService = {
  /**
   * Calculate punctuality score (0-100)
   * 100 = no late marks, decreases with each late
   */
  calculatePunctualityScore(presentDays: number, lateDays: number): number {
    if (presentDays === 0) return 100;
    const latePercentage = (lateDays / (presentDays + lateDays)) * 100;
    return Math.max(0, 100 - latePercentage);
  },

  /**
   * Calculate consistency score (0-100)
   * Based on attendance percentage and no unannounced absences
   */
  calculateConsistencyScore(presentDays: number, lateDays: number, absentDays: number, onDutyDays: number): number {
    const totalWorkDays = presentDays + lateDays + absentDays + onDutyDays;
    if (totalWorkDays === 0) return 100;

    const attendancePercentage = ((presentDays + lateDays + onDutyDays) / totalWorkDays) * 100;
    const absencePercentage = (absentDays / totalWorkDays) * 100;

    // Consistency = attendance % - (absence % * 2)
    return Math.max(0, Math.min(100, attendancePercentage - absencePercentage * 2));
  },

  /**
   * Calculate overall performance score (weighted)
   * Punctuality: 50%, Consistency: 30%, Working Hours: 20%
   * Then apply compliance penalty
   */
  calculateOverallScore(
    punctualityScore: number,
    consistencyScore: number,
    totalWorkingHours: number,
    compliancePenalty: number = 0,
    expectedHours: number = 200 // ~8 hours/day * 25 days
  ): number {
    const hoursScore = Math.min(100, (totalWorkingHours / expectedHours) * 100);
    const baseScore = punctualityScore * 0.5 + consistencyScore * 0.3 + hoursScore * 0.2;
    return Math.max(0, baseScore - compliancePenalty);
  },

  /**
   * Calculate metrics for a user for a specific month
   */
  async calculateMonthlyMetrics(userId: string, month: number, year: number): Promise<PerformanceMetrics> {
    const { data: summary } = await supabase
      .from("attendance_summary")
      .select("*")
      .eq("user_id", userId)
      .gte("date", `${year}-${String(month).padStart(2, "0")}-01`)
      .lte("date", `${year}-${String(month).padStart(2, "0")}-31`);

    const records = summary || [];

    const presentDays = records.filter((r) => r.status === "present").length;
    const lateDays = records.filter((r) => r.status === "late").length;
    const absentDays = records.filter((r) => r.status === "absent").length;
    const onDutyDays = records.filter((r) => r.status === "on_duty").length;
    const leaveDays = records.filter((r) => r.status === "leave").length;

    const totalWorkingHours = records.reduce((sum, r) => sum + (r.working_hours || 0), 0);
    const totalOvertimeHours = records.reduce((sum, r) => sum + (r.overtime_minutes || 0), 0) / 60;

    const punctualityScore = this.calculatePunctualityScore(presentDays, lateDays);
    const consistencyScore = this.calculateConsistencyScore(presentDays, lateDays, absentDays, onDutyDays);

    // Get compliance status and calculate penalty
    const compliance = await GeofenceViolationService.getComplianceStatus(userId);
    const compliancePenalty = compliance
      ? GeofenceViolationService.calculateCompliancePenalty(compliance.compliance_score, compliance.status)
      : 0;

    const adjustedOverallScore = this.calculateOverallScore(
      punctualityScore,
      consistencyScore,
      totalWorkingHours,
      compliancePenalty
    );

    return {
      user_id: userId,
      month,
      year,
      total_working_days: presentDays + lateDays + absentDays + onDutyDays,
      present_days: presentDays,
      late_days: lateDays,
      absent_days: absentDays,
      on_duty_days: onDutyDays,
      leave_days: leaveDays,
      total_working_hours: Math.round(totalWorkingHours * 100) / 100,
      total_overtime_hours: Math.round(totalOvertimeHours * 100) / 100,
      punctuality_score: Math.round(punctualityScore * 100) / 100,
      consistency_score: Math.round(consistencyScore * 100) / 100,
      compliance_score: compliance?.compliance_score || 100,
      compliance_penalty: compliancePenalty,
      adjusted_overall_score: Math.round(adjustedOverallScore * 100) / 100,
    };
  },

  /**
   * Calculate and save metrics for all active employees for a month
   */
  async calculateAllMonthlyMetrics(month: number, year: number) {
    try {
      // Get all active employees
      const { data: employees } = await supabase
        .from("profiles")
        .select("id")
        .eq("is_active", true);

      if (!employees) return { success: false, processed: 0 };

      const metricsToSave: any[] = [];

      for (const emp of employees) {
        const metrics = await this.calculateMonthlyMetrics(emp.id, month, year);
        metricsToSave.push({
          user_id: metrics.user_id,
          month: metrics.month,
          year: metrics.year,
          total_working_days: metrics.total_working_days,
          present_days: metrics.present_days,
          late_days: metrics.late_days,
          absent_days: metrics.absent_days,
          on_duty_days: metrics.on_duty_days,
          leave_days: metrics.leave_days,
          total_working_hours: metrics.total_working_hours,
          total_overtime_hours: metrics.total_overtime_hours,
          punctuality_score: metrics.punctuality_score,
          consistency_score: metrics.consistency_score,
          compliance_score: metrics.compliance_score,
          compliance_penalty: metrics.compliance_penalty,
          adjusted_overall_score: metrics.adjusted_overall_score,
        });
      }

      // Upsert metrics
      if (metricsToSave.length > 0) {
        const { error } = await supabase
          .from("performance_metrics")
          .upsert(metricsToSave, { onConflict: "user_id,month,year" });

        if (error) throw error;
      }

      return { success: true, processed: metricsToSave.length };
    } catch (error) {
      console.error("Error calculating monthly metrics:", error);
      throw error;
    }
  },,

  /**
   * Get top 3 performers for a month
   */
  async getTopPerformers(month: number, year: number): Promise<TopPerformer[]> {
    try {
      const { data, error } = await supabase
        .from("performance_leaderboard")
        .select("*")
        .eq("month", month)
        .eq("year", year)
        .order("rank", { ascending: true })
        .limit(3);

      if (error) throw error;

      return (data || []).map((row: any) => ({
        rank: row.rank,
        user_id: row.user_id,
        employee_name: row.employee_name,
        employee_number: row.employee_number,
        phone: row.phone,
        office_name: row.office_name,
        present_days: row.present_days,
        late_days: row.late_days,
        absent_days: row.absent_days,
        total_working_hours: row.total_working_hours,
        total_overtime_hours: row.total_overtime_hours,
        punctuality_score: row.punctuality_score,
        consistency_score: row.consistency_score,
        overall_score: row.overall_score,
      }));
    } catch (error) {
      console.error("Error fetching top performers:", error);
      throw error;
    }
  },

  /**
   * Get performance leaderboard for a month (all employees ranked)
   */
  async getLeaderboard(month: number, year: number, limit: number = 50) {
    try {
      const { data, error } = await supabase
        .from("performance_leaderboard")
        .select("*")
        .eq("month", month)
        .eq("year", year)
        .order("rank", { ascending: true })
        .limit(limit);

      if (error) throw error;

      return data || [];
    } catch (error) {
      console.error("Error fetching leaderboard:", error);
      throw error;
    }
  },

  /**
   * Get employee performance history (last 6 months)
   */
  async getEmployeePerformanceHistory(userId: string, months: number = 6) {
    try {
      const today = new Date();
      const startMonth = today.getMonth() - months + 1;
      const startYear = today.getFullYear();

      const { data, error } = await supabase
        .from("performance_metrics")
        .select("*")
        .eq("user_id", userId)
        .gte("year", startYear)
        .order("year", { ascending: false })
        .order("month", { ascending: false })
        .limit(months);

      if (error) throw error;

      return data || [];
    } catch (error) {
      console.error("Error fetching performance history:", error);
      throw error;
    }
  },

  /**
   * Get department-wise performance summary
   */
  async getDepartmentPerformance(month: number, year: number) {
    try {
      const { data, error } = await supabase
        .from("performance_leaderboard")
        .select("*")
        .eq("month", month)
        .eq("year", year)
        .order("rank", { ascending: true });

      if (error) throw error;

      // Group by office
      const byOffice: Record<string, any[]> = {};
      for (const emp of data || []) {
        if (!byOffice[emp.office_name]) byOffice[emp.office_name] = [];
        byOffice[emp.office_name].push(emp);
      }

      return byOffice;
    } catch (error) {
      console.error("Error fetching department performance:", error);
      throw error;
    }
  },
};
