import { supabase } from "@/lib/supabase";

// Geofence radius configuration
export const GEOFENCE_CONFIG = {
  SAFE_RADIUS: 200, // meters - no violation
  WARNING_RADIUS: 400, // meters - soft warning
  VIOLATION_RADIUS: 400, // meters - hard violation
  VIOLATION_THRESHOLD_WEEKLY: 3, // violations per week to mark non-compliant
  COMPLIANCE_PENALTY: 10, // points deducted per violation
  NON_COMPLIANT_PENALTY: 20, // additional penalty for non-compliant status
};

export type ViolationType = "safe" | "warning" | "violation";

export interface GeofenceViolation {
  id: string;
  user_id: string;
  office_id: string;
  office_name: string;
  distance_meters: number;
  violation_type: ViolationType;
  checkin_time: string;
  date: string;
  flagged: boolean;
  manager_notified: boolean;
  created_at: string;
}

export interface ComplianceStatus {
  user_id: string;
  is_compliant: boolean;
  violations_this_week: number;
  violations_this_month: number;
  total_violations: number;
  compliance_score: number; // 0-100
  last_violation_date?: string;
  non_compliant_since?: string;
  status: "compliant" | "warning" | "non_compliant";
}

export const GeofenceViolationService = {
  /**
   * Determine violation type based on distance
   */
  getViolationType(distance: number, safeRadius: number, warningRadius: number): ViolationType {
    if (distance <= safeRadius) return "safe";
    if (distance <= warningRadius) return "warning";
    return "violation";
  },

  /**
   * Record a geofence violation
   */
  async recordViolation(
    userId: string,
    officeId: string,
    officeName: string,
    distance: number,
    checkinTime: string
  ): Promise<GeofenceViolation> {
    const violationType = this.getViolationType(
      distance,
      GEOFENCE_CONFIG.SAFE_RADIUS,
      GEOFENCE_CONFIG.WARNING_RADIUS
    );

    const date = new Date().toISOString().split("T")[0];
    const shouldFlag = violationType === "violation";

    const { data, error } = await supabase
      .from("geofence_violations")
      .insert({
        user_id: userId,
        office_id: officeId,
        office_name: officeName,
        distance_meters: Math.round(distance),
        violation_type: violationType,
        checkin_time: checkinTime,
        date,
        flagged: shouldFlag,
        manager_notified: false,
      })
      .select()
      .single();

    if (error) throw error;

    // Update compliance status
    await this.updateComplianceStatus(userId);

    return data;
  },

  /**
   * Get violations for a user in the past week
   */
  async getWeeklyViolations(userId: string): Promise<GeofenceViolation[]> {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const startDate = sevenDaysAgo.toISOString().split("T")[0];

    const { data, error } = await supabase
      .from("geofence_violations")
      .select("*")
      .eq("user_id", userId)
      .eq("violation_type", "violation")
      .gte("date", startDate)
      .order("date", { ascending: false });

    if (error) throw error;
    return data || [];
  },

  /**
   * Get violations for a user in the current month
   */
  async getMonthlyViolations(userId: string): Promise<GeofenceViolation[]> {
    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    const startDate = firstDay.toISOString().split("T")[0];

    const { data, error } = await supabase
      .from("geofence_violations")
      .select("*")
      .eq("user_id", userId)
      .eq("violation_type", "violation")
      .gte("date", startDate)
      .order("date", { ascending: false });

    if (error) throw error;
    return data || [];
  },

  /**
   * Update compliance status based on violations
   */
  async updateComplianceStatus(userId: string): Promise<ComplianceStatus> {
    const weeklyViolations = await this.getWeeklyViolations(userId);
    const monthlyViolations = await this.getMonthlyViolations(userId);

    const { data: allViolations } = await supabase
      .from("geofence_violations")
      .select("*")
      .eq("user_id", userId)
      .eq("violation_type", "violation");

    const totalViolations = (allViolations || []).length;
    const isNonCompliant = weeklyViolations.length >= GEOFENCE_CONFIG.VIOLATION_THRESHOLD_WEEKLY;

    // Calculate compliance score (0-100)
    // Base: 100, -10 per violation (capped at 0)
    const complianceScore = Math.max(0, 100 - totalViolations * GEOFENCE_CONFIG.COMPLIANCE_PENALTY);

    const lastViolation = weeklyViolations[0];
    const status = isNonCompliant ? "non_compliant" : weeklyViolations.length > 0 ? "warning" : "compliant";

    const { data, error } = await supabase
      .from("compliance_status")
      .upsert(
        {
          user_id: userId,
          is_compliant: !isNonCompliant,
          violations_this_week: weeklyViolations.length,
          violations_this_month: monthlyViolations.length,
          total_violations: totalViolations,
          compliance_score: complianceScore,
          last_violation_date: lastViolation?.date,
          non_compliant_since: isNonCompliant ? new Date().toISOString() : null,
          status,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      )
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  /**
   * Get compliance status for a user
   */
  async getComplianceStatus(userId: string): Promise<ComplianceStatus | null> {
    const { data, error } = await supabase
      .from("compliance_status")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) throw error;
    return data;
  },

  /**
   * Notify manager of violation
   */
  async notifyManagerOfViolation(
    userId: string,
    officeName: string,
    distance: number,
    violationType: ViolationType
  ) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("name, reporting_manager_id")
      .eq("id", userId)
      .single();

    if (!profile?.reporting_manager_id) return;

    const messages: Record<ViolationType, string> = {
      safe: "",
      warning: `⚠️ ${profile.name} checked in ${distance}m away from ${officeName} (Warning Zone)`,
      violation: `🚨 ${profile.name} checked in ${distance}m away from ${officeName} (VIOLATION)`,
    };

    if (!messages[violationType]) return;

    await supabase.from("notifications").insert({
      user_id: profile.reporting_manager_id,
      title: violationType === "violation" ? "🚨 Geofence Violation" : "⚠️ Geofence Warning",
      message: messages[violationType],
      type: "geofence_violation",
      metadata: { violation_type: violationType, distance, office_name: officeName },
    });

    // Mark as notified
    await supabase
      .from("geofence_violations")
      .update({ manager_notified: true })
      .eq("user_id", userId)
      .eq("office_name", officeName)
      .gte("date", new Date().toISOString().split("T")[0]);
  },

  /**
   * Get all violations for admin (with filters)
   */
  async getAllViolations(options?: {
    userId?: string;
    startDate?: string;
    endDate?: string;
    violationType?: ViolationType;
    flaggedOnly?: boolean;
  }): Promise<GeofenceViolation[]> {
    let query = supabase
      .from("geofence_violations")
      .select("*")
      .order("date", { ascending: false });

    if (options?.userId) query = query.eq("user_id", options.userId);
    if (options?.startDate) query = query.gte("date", options.startDate);
    if (options?.endDate) query = query.lte("date", options.endDate);
    if (options?.violationType) query = query.eq("violation_type", options.violationType);
    if (options?.flaggedOnly) query = query.eq("flagged", true);

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },

  /**
   * Get non-compliant employees
   */
  async getNonCompliantEmployees(): Promise<
    Array<{
      user_id: string;
      employee_name: string;
      employee_number: string;
      office_name: string;
      violations_this_week: number;
      violations_this_month: number;
      compliance_score: number;
      status: string;
    }>
  > {
    const { data, error } = await supabase
      .from("compliance_status")
      .select(
        `
        user_id,
        violations_this_week,
        violations_this_month,
        compliance_score,
        status,
        profiles:user_id(name, employee_number, office_id, offices(name))
      `
      )
      .eq("status", "non_compliant")
      .order("violations_this_week", { ascending: false });

    if (error) throw error;

    return (data || []).map((item: any) => ({
      user_id: item.user_id,
      employee_name: item.profiles?.name,
      employee_number: item.profiles?.employee_number,
      office_name: item.profiles?.offices?.name,
      violations_this_week: item.violations_this_week,
      violations_this_month: item.violations_this_month,
      compliance_score: item.compliance_score,
      status: item.status,
    }));
  },

  /**
   * Get compliance analytics
   */
  async getComplianceAnalytics(officeId?: string): Promise<{
    totalEmployees: number;
    compliantEmployees: number;
    warningEmployees: number;
    nonCompliantEmployees: number;
    complianceRate: number;
    averageComplianceScore: number;
    totalViolationsThisWeek: number;
    totalViolationsThisMonth: number;
  }> {
    let query = supabase.from("compliance_status").select("*");

    if (officeId) {
      query = query.eq("profiles.office_id", officeId);
    }

    const { data } = await query;
    const statuses = data || [];

    const compliant = statuses.filter((s: any) => s.status === "compliant").length;
    const warning = statuses.filter((s: any) => s.status === "warning").length;
    const nonCompliant = statuses.filter((s: any) => s.status === "non_compliant").length;
    const total = statuses.length;

    const avgScore =
      total > 0
        ? Math.round(
            statuses.reduce((sum: number, s: any) => sum + (s.compliance_score || 0), 0) / total
          )
        : 100;

    const weeklyViolations = statuses.reduce((sum: number, s: any) => sum + (s.violations_this_week || 0), 0);
    const monthlyViolations = statuses.reduce((sum: number, s: any) => sum + (s.violations_this_month || 0), 0);

    return {
      totalEmployees: total,
      compliantEmployees: compliant,
      warningEmployees: warning,
      nonCompliantEmployees: nonCompliant,
      complianceRate: total > 0 ? Math.round((compliant / total) * 100) : 100,
      averageComplianceScore: avgScore,
      totalViolationsThisWeek: weeklyViolations,
      totalViolationsThisMonth: monthlyViolations,
    };
  },

  /**
   * Apply compliance penalty to performance score
   */
  calculateCompliancePenalty(complianceScore: number, status: string): number {
    if (status === "non_compliant") {
      return GEOFENCE_CONFIG.NON_COMPLIANT_PENALTY;
    }
    if (status === "warning") {
      return Math.round((100 - complianceScore) * 0.5); // 50% of compliance deficit
    }
    return 0;
  },

  /**
   * Clear old violations (older than 90 days)
   */
  async clearOldViolations() {
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const cutoffDate = ninetyDaysAgo.toISOString().split("T")[0];

    const { error } = await supabase
      .from("geofence_violations")
      .delete()
      .lt("date", cutoffDate);

    if (error) throw error;
  },
};
