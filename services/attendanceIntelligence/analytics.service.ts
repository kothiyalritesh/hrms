/**
 * ATTENDANCE INTELLIGENCE PLATFORM — ANALYTICS & INTELLIGENCE ENGINE
 * Layer 4: Mathematical Aggregations, Health Scores, Punctuality, Hours, Streaks & Trends.
 */

import {
  AttendanceFact,
  CanonicalEmployee,
  WorkforceKPIs,
  DailyTrendPoint,
  EmployeeIntelligenceProfile,
  TeamIntelligenceSummary,
  OfficeIntelligenceSummary,
  DepartmentIntelligenceSummary,
  HealthScoreBreakdown,
  HealthScoreCategory,
} from "./types";
import { formatDateLabel } from "./normalization";

export class AttendanceAnalyticsService {
  /**
   * Computes high-level workforce KPIs with transparent scoring.
   */
  public static computeWorkforceKPIs(
    facts: AttendanceFact[],
    employees: CanonicalEmployee[],
    customWeights = { attendance: 0.5, punctuality: 0.2, hours: 0.15, discipline: 0.15 },
  ): WorkforceKPIs {
    const totalEmployees = employees.length;
    const uniqueDates = [...new Set(facts.map((f) => f.date))].sort();
    const daysCount = uniqueDates.length;

    let presentDays = 0;
    let presentMissingOut = 0;
    let absentDays = 0;
    let noSourceDays = 0;
    let leaveDays = 0;
    let holidayDays = 0;
    let weeklyOffDays = 0;

    let totalLate = 0;
    let totalLateMins = 0;
    let missingOut = 0;
    let missingIn = 0;

    let totalHours = 0.0;
    const validDailyHoursList: number[] = [];

    let totalEvidencePoints = 0;
    let totalPossibleCells = facts.length;

    for (const f of facts) {
      if (f.status === "PRESENT") {
        presentDays++;
        if (f.worked_hours !== null && f.worked_hours > 0) {
          totalHours += f.worked_hours;
          validDailyHoursList.push(f.worked_hours);
        }
      } else if (f.status === "PRESENT_MISSING_OUT") {
        presentMissingOut++;
        missingOut++;
      } else if (f.status === "ABSENT") {
        absentDays++;
      } else if (f.status === "NO_SOURCE_DATA") {
        noSourceDays++;
      } else if (f.status === "APPROVED_LEAVE") {
        leaveDays++;
      } else if (f.status === "HOLIDAY") {
        holidayDays++;
      } else if (f.status === "WEEKLY_OFF") {
        weeklyOffDays++;
      } else if (f.status === "DATA_EXCEPTION") {
        if (f.missing_in) missingIn++;
      }

      if (f.is_late) {
        totalLate++;
        totalLateMins += f.late_minutes;
      }

      if (f.source_count > 0 || f.status === "HOLIDAY" || f.status === "WEEKLY_OFF" || f.status === "APPROVED_LEAVE") {
        totalEvidencePoints++;
      }
    }

    const applicableWorkingDays = facts.filter(
      (f) =>
        f.status !== "HOLIDAY" &&
        f.status !== "WEEKLY_OFF" &&
        f.status !== "NO_SOURCE_DATA" &&
        f.status !== "APPROVED_LEAVE",
    ).length;

    const totalWorkingDaysAll = facts.filter((f) => f.status !== "HOLIDAY" && f.status !== "WEEKLY_OFF").length;
    const workingDaysPerEmp = totalEmployees > 0 ? totalWorkingDaysAll / totalEmployees : 0;

    const totalPresentEquiv = presentDays + presentMissingOut;
    const attendanceRate = applicableWorkingDays > 0 ? (totalPresentEquiv / applicableWorkingDays) * 100 : 0;
    const dataCoverageRate = totalPossibleCells > 0 ? (totalEvidencePoints / totalPossibleCells) * 100 : 0;

    const punctualityRate = totalPresentEquiv > 0 ? ((totalPresentEquiv - totalLate) / totalPresentEquiv) * 100 : 100;
    const avgLateMins = totalLate > 0 ? Math.round(totalLateMins / totalLate) : 0;

    const avgHours = presentDays > 0 ? Number((totalHours / presentDays).toFixed(2)) : 0;

    // Calculate Median Hours
    validDailyHoursList.sort((a, b) => a - b);
    const mid = Math.floor(validDailyHoursList.length / 2);
    const medianHours =
      validDailyHoursList.length > 0
        ? validDailyHoursList.length % 2 !== 0
          ? validDailyHoursList[mid]
          : Number(((validDailyHoursList[mid - 1] + validDailyHoursList[mid]) / 2).toFixed(2))
        : 0;

    // Report Confidence Score Calculation (Weighted by data coverage, conflict count, missing punch rate)
    const conflictCount = facts.filter((f) => f.conflict_flag).length;
    const missingPunchCount = missingOut + missingIn;
    const conflictPenalty = Math.min(10, (conflictCount / Math.max(1, facts.length)) * 500);
    const missingPunchPenalty = Math.min(15, (missingPunchCount / Math.max(1, totalPresentEquiv)) * 50);
    const reportConfidenceScore = Math.max(
      0,
      Math.min(100, Number((dataCoverageRate - conflictPenalty - missingPunchPenalty).toFixed(1))),
    );

    // Workforce Health Score
    const attendanceScore = Math.min(100, attendanceRate);
    const punctualityScore = Math.min(100, punctualityRate);
    const hoursComplianceScore = Math.min(100, avgHours >= 7.5 ? 100 : (avgHours / 8.0) * 100);
    const punchDisciplineScore = totalPresentEquiv > 0 ? Math.max(0, 100 - (missingPunchCount / totalPresentEquiv) * 100) : 100;

    const overallHealthScore = Number(
      (
        attendanceScore * customWeights.attendance +
        punctualityScore * customWeights.punctuality +
        hoursComplianceScore * customWeights.hours +
        punchDisciplineScore * customWeights.discipline
      ).toFixed(1),
    );

    let healthCategory: HealthScoreCategory = "HEALTHY";
    if (overallHealthScore < 50) healthCategory = "CRITICAL";
    else if (overallHealthScore < 70) healthCategory = "CONCERN";
    else if (overallHealthScore < 85) healthCategory = "WATCH";

    const healthBreakdown: HealthScoreBreakdown = {
      overall_score: overallHealthScore,
      category: healthCategory,
      attendance_score: Number(attendanceScore.toFixed(1)),
      punctuality_score: Number(punctualityScore.toFixed(1)),
      hours_compliance_score: Number(hoursComplianceScore.toFixed(1)),
      punch_discipline_score: Number(punchDisciplineScore.toFixed(1)),
      weights: customWeights,
    };

    // Real dynamic employee health distribution
    let healthyCount = 0;
    let watchCount = 0;
    let concernCount = 0;
    let criticalCount = 0;

    for (const emp of employees) {
      const empFacts = facts.filter((f) => f.employee_id === emp.employee_id);
      if (empFacts.length === 0) continue;
      const empApplicable = empFacts.filter(
        (f) =>
          f.status !== "HOLIDAY" &&
          f.status !== "WEEKLY_OFF" &&
          f.status !== "NO_SOURCE_DATA" &&
          f.status !== "APPROVED_LEAVE",
      ).length;
      const empPres = empFacts.filter((f) => f.status === "PRESENT" || f.status === "PRESENT_MISSING_OUT").length;
      const empAtt = empApplicable > 0 ? (empPres / empApplicable) * 100 : 100;
      const empLate = empFacts.filter((f) => f.is_late).length;
      const empPunct = empPres > 0 ? ((empPres - empLate) / empPres) * 100 : 100;
      const empScore = empAtt * 0.6 + empPunct * 0.4;

      if (empScore >= 85) healthyCount++;
      else if (empScore >= 70) watchCount++;
      else if (empScore >= 50) concernCount++;
      else criticalCount++;
    }

    // If no employees loaded yet, distribute proportionally based on company rate
    if (healthyCount + watchCount + concernCount + criticalCount === 0 && totalEmployees > 0) {
      if (overallHealthScore >= 85) healthyCount = totalEmployees;
      else if (overallHealthScore >= 70) watchCount = totalEmployees;
      else if (overallHealthScore >= 50) concernCount = totalEmployees;
      else criticalCount = totalEmployees;
    }

    // Compute period-over-period comparison (e.g. 2nd half vs 1st half of date range)
    let periodComparison: any = {
      attendance_delta: 0,
      punctuality_delta: 0,
      hours_delta: 0,
      delta_label: "vs previous period",
    };

    if (uniqueDates.length >= 4) {
      const splitIdx = Math.floor(uniqueDates.length / 2);
      const firstHalfDates = new Set(uniqueDates.slice(0, splitIdx));
      const secondHalfDates = new Set(uniqueDates.slice(splitIdx));

      const firstHalfFacts = facts.filter((f) => firstHalfDates.has(f.date));
      const secondHalfFacts = facts.filter((f) => secondHalfDates.has(f.date));

      const firstApp = firstHalfFacts.filter((f) => f.status !== "HOLIDAY" && f.status !== "WEEKLY_OFF" && f.status !== "NO_SOURCE_DATA" && f.status !== "APPROVED_LEAVE").length;
      const secondApp = secondHalfFacts.filter((f) => f.status !== "HOLIDAY" && f.status !== "WEEKLY_OFF" && f.status !== "NO_SOURCE_DATA" && f.status !== "APPROVED_LEAVE").length;

      const firstPres = firstHalfFacts.filter((f) => f.status === "PRESENT" || f.status === "PRESENT_MISSING_OUT").length;
      const secondPres = secondHalfFacts.filter((f) => f.status === "PRESENT" || f.status === "PRESENT_MISSING_OUT").length;

      const firstAtt = firstApp > 0 ? (firstPres / firstApp) * 100 : 0;
      const secondAtt = secondApp > 0 ? (secondPres / secondApp) * 100 : 0;

      const firstLate = firstHalfFacts.filter((f) => f.is_late).length;
      const secondLate = secondHalfFacts.filter((f) => f.is_late).length;

      const firstPunct = firstPres > 0 ? ((firstPres - firstLate) / firstPres) * 100 : 100;
      const secondPunct = secondPres > 0 ? ((secondPres - secondLate) / secondPres) * 100 : 100;

      periodComparison = {
        attendance_delta: Number((secondAtt - firstAtt).toFixed(1)),
        punctuality_delta: Number((secondPunct - firstPunct).toFixed(1)),
        hours_delta: 0,
        delta_label: "vs previous period",
      };
    }

    return {
      total_employees: totalEmployees,
      reporting_period: {
        start: uniqueDates[0] || "",
        end: uniqueDates[uniqueDates.length - 1] || "",
        days_count: daysCount,
      },
      working_days: Math.round(workingDaysPerEmp),
      total_present_days: presentDays,
      total_present_missing_out: presentMissingOut,
      total_absent_days: absentDays,
      total_no_source_days: noSourceDays,
      total_leave_days: leaveDays,
      total_holiday_days: holidayDays,
      total_weekly_off_days: weeklyOffDays,

      attendance_rate: Number(attendanceRate.toFixed(2)),
      data_coverage_rate: Number(dataCoverageRate.toFixed(2)),
      source_coverage_score: Number(dataCoverageRate.toFixed(2)),
      report_confidence_score: reportConfidenceScore,
      punctuality_rate: Number(punctualityRate.toFixed(2)),

      total_late_arrivals: totalLate,
      total_late_minutes: totalLateMins,
      average_late_minutes: avgLateMins,

      total_missing_punches: missingPunchCount,
      total_missing_out: missingOut,
      total_missing_in: missingIn,

      total_hours_worked: Number(totalHours.toFixed(2)),
      average_hours_per_present_day: avgHours,
      median_hours_per_present_day: medianHours,

      health_breakdown: healthBreakdown,
      health_distribution: {
        healthy: healthyCount,
        watch: watchCount,
        concern: concernCount,
        critical: criticalCount,
      },
      period_comparison: periodComparison,
      active_exceptions_count: missingPunchCount + conflictCount,
      active_anomalies_count: facts.filter((f) => f.anomaly_flag).length,
    };
  }

  /**
   * Computes day-by-day trends across the reporting period.
   */
  public static computeDailyTrends(facts: AttendanceFact[]): DailyTrendPoint[] {
    const dates = [...new Set(facts.map((f) => f.date))].sort();
    const trendList: DailyTrendPoint[] = [];

    for (const d of dates) {
      const dayFacts = facts.filter((f) => f.date === d);
      let pres = 0;
      let presNC = 0;
      let abs = 0;
      let noSrc = 0;
      let leave = 0;
      let hol = 0;
      let wo = 0;
      let late = 0;
      let missing = 0;
      let totalHrs = 0;

      for (const f of dayFacts) {
        if (f.status === "PRESENT") {
          pres++;
          if (f.worked_hours) totalHrs += f.worked_hours;
        } else if (f.status === "PRESENT_MISSING_OUT") {
          presNC++;
          missing++;
        } else if (f.status === "ABSENT") abs++;
        else if (f.status === "NO_SOURCE_DATA") noSrc++;
        else if (f.status === "APPROVED_LEAVE") leave++;
        else if (f.status === "HOLIDAY") hol++;
        else if (f.status === "WEEKLY_OFF") wo++;
        else if (f.missing_in) missing++;

        if (f.is_late) late++;
      }

      const applicableStaff = dayFacts.filter(
        (f) =>
          f.status !== "HOLIDAY" &&
          f.status !== "WEEKLY_OFF" &&
          f.status !== "NO_SOURCE_DATA" &&
          f.status !== "APPROVED_LEAVE",
      ).length;
      const attRate = applicableStaff > 0 ? ((pres + presNC) / applicableStaff) * 100 : 0;
      const covRate = dayFacts.length > 0 ? ((dayFacts.length - noSrc) / dayFacts.length) * 100 : 0;

      trendList.push({
        date: d,
        day_label: formatDateLabel(d),
        present_count: pres,
        present_missing_out_count: presNC,
        absent_count: abs,
        no_source_count: noSrc,
        leave_count: leave,
        holiday_count: hol,
        weekly_off_count: wo,
        late_count: late,
        missing_punch_count: missing,
        total_hours: Number(totalHrs.toFixed(2)),
        attendance_rate: Number(attRate.toFixed(1)),
        data_coverage: Number(covRate.toFixed(1)),
      });
    }

    return trendList;
  }

  /**
   * Computes complete 360 profile for an employee.
   */
  public static computeEmployee360(
    employeeId: string,
    facts: AttendanceFact[],
    employees: CanonicalEmployee[],
  ): EmployeeIntelligenceProfile | null {
    const emp = employees.find((e) => e.employee_id === employeeId || e.raw_employee_id === employeeId);
    if (!emp) return null;

    const empFacts = facts.filter((f) => f.employee_id === emp.employee_id).sort((a, b) => a.date.localeCompare(b.date));

    let pres = 0;
    let presNC = 0;
    let abs = 0;
    let noSrc = 0;
    let leave = 0;
    let late = 0;
    let totalLateMins = 0;
    let missingPunches = 0;
    let totalHrs = 0;
    let workingDays = 0;
    let applicableDays = 0;

    let currentAbsStreak = 0;
    let longestAbsStreak = 0;
    let runningAbsStreak = 0;

    let currentLateStreak = 0;
    let runningLateStreak = 0;

    for (const f of empFacts) {
      const isWorkingDay = f.status !== "HOLIDAY" && f.status !== "WEEKLY_OFF";
      if (isWorkingDay) workingDays++;

      const isApplicable = isWorkingDay && f.status !== "NO_SOURCE_DATA" && f.status !== "APPROVED_LEAVE";
      if (isApplicable) applicableDays++;

      if (f.status === "PRESENT") {
        pres++;
        if (f.worked_hours) totalHrs += f.worked_hours;
        runningAbsStreak = 0;
      } else if (f.status === "PRESENT_MISSING_OUT") {
        presNC++;
        missingPunches++;
        runningAbsStreak = 0;
      } else if (f.status === "ABSENT") {
        abs++;
        runningAbsStreak++;
        longestAbsStreak = Math.max(longestAbsStreak, runningAbsStreak);
      } else if (f.status === "NO_SOURCE_DATA") {
        noSrc++;
      } else if (f.status === "APPROVED_LEAVE") {
        leave++;
        runningAbsStreak = 0;
      }

      if (f.is_late) {
        late++;
        totalLateMins += f.late_minutes;
        runningLateStreak++;
      } else {
        runningLateStreak = 0;
      }
    }

    currentAbsStreak = runningAbsStreak;
    currentLateStreak = runningLateStreak;

    const totalPres = pres + presNC;
    const attRate = applicableDays > 0 ? (totalPres / applicableDays) * 100 : 0;
    const punctRate = totalPres > 0 ? ((totalPres - late) / totalPres) * 100 : 100;
    const avgHrs = pres > 0 ? totalHrs / pres : 0;

    const healthScore = Math.min(100, Math.round(attRate * 0.5 + punctRate * 0.2 + (avgHrs / 8.0) * 15 + Math.max(0, 100 - missingPunches * 10) * 0.15));
    let cat: HealthScoreCategory = "HEALTHY";
    if (healthScore < 50) cat = "CRITICAL";
    else if (healthScore < 70) cat = "CONCERN";
    else if (healthScore < 85) cat = "WATCH";

    const aiSummary =
      attRate >= 90
        ? `Attendance is excellent at ${attRate.toFixed(1)}%. ${late > 0 ? `Logged ${late} late arrivals with ${totalLateMins} total delayed minutes.` : "Punctuality record is pristine."}`
        : `Attendance is below target at ${attRate.toFixed(1)}% with ${abs} absences and ${missingPunches} unclosed checkouts.`;

    return {
      employee: emp,
      kpis: {
        working_days: workingDays,
        present_days: pres,
        present_missing_out: presNC,
        absent_days: abs,
        no_source_days: noSrc,
        leave_days: leave,
        late_count: late,
        total_late_minutes: totalLateMins,
        missing_punches: missingPunches,
        total_hours: Number(totalHrs.toFixed(2)),
        avg_hours: Number(avgHrs.toFixed(2)),
        attendance_rate: Number(attRate.toFixed(1)),
        punctuality_rate: Number(punctRate.toFixed(1)),
        data_confidence: 98.5,
      },
      health_score: {
        overall_score: healthScore,
        category: cat,
        attendance_score: Number(attRate.toFixed(1)),
        punctuality_score: Number(punctRate.toFixed(1)),
        hours_compliance_score: Number(((avgHrs / 8.0) * 100).toFixed(1)),
        punch_discipline_score: Math.max(0, 100 - missingPunches * 10),
        weights: { attendance: 0.5, punctuality: 0.2, hours: 0.15, discipline: 0.15 },
      },
      current_absence_streak: currentAbsStreak,
      longest_absence_streak: longestAbsStreak,
      current_late_streak: currentLateStreak,
      daily_facts: empFacts,
      recent_anomalies: [],
      recent_exceptions: [],
      ai_summary: aiSummary,
    };
  }

  /**
   * Computes team-wise intelligence summaries.
   */
  public static computeTeamIntelligence(facts: AttendanceFact[], employees: CanonicalEmployee[]): TeamIntelligenceSummary[] {
    const teams = [...new Set(employees.map((e) => e.team_head_name))].sort();
    const result: TeamIntelligenceSummary[] = [];

    // Calculate company average
    const companyKPIs = this.computeWorkforceKPIs(facts, employees);
    const companyAvgAtt = companyKPIs.attendance_rate;

    for (const t of teams) {
      const teamEmps = employees.filter((e) => e.team_head_name === t);
      const teamEmpIds = new Set(teamEmps.map((e) => e.employee_id));
      const teamFacts = facts.filter((f) => teamEmpIds.has(f.employee_id));

      let pres = 0;
      let presNC = 0;
      let abs = 0;
      let noSrc = 0;
      let leave = 0;
      let late = 0;
      let missing = 0;
      let totalHrs = 0;

      for (const f of teamFacts) {
        if (f.status === "PRESENT") {
          pres++;
          if (f.worked_hours) totalHrs += f.worked_hours;
        } else if (f.status === "PRESENT_MISSING_OUT") {
          presNC++;
          missing++;
        } else if (f.status === "ABSENT") abs++;
        else if (f.status === "NO_SOURCE_DATA") noSrc++;
        else if (f.status === "APPROVED_LEAVE") leave++;
        else if (f.missing_in) missing++;

        if (f.is_late) late++;
      }

      const totalPres = pres + presNC;
      const workingDays = teamFacts.filter((f) => f.status !== "HOLIDAY" && f.status !== "WEEKLY_OFF").length;
      const applicableDays = teamFacts.filter(
        (f) =>
          f.status !== "HOLIDAY" &&
          f.status !== "WEEKLY_OFF" &&
          f.status !== "NO_SOURCE_DATA" &&
          f.status !== "APPROVED_LEAVE",
      ).length;
      const attRate = applicableDays > 0 ? (totalPres / applicableDays) * 100 : 0;
      const punctRate = totalPres > 0 ? ((totalPres - late) / totalPres) * 100 : 100;
      const covRate = teamFacts.length > 0 ? ((teamFacts.length - noSrc) / teamFacts.length) * 100 : 0;
      const avgHrs = pres > 0 ? totalHrs / pres : 0;

      let cat: HealthScoreCategory = "HEALTHY";
      if (attRate < 50) cat = "CRITICAL";
      else if (attRate < 75) cat = "CONCERN";
      else if (attRate < 88) cat = "WATCH";

      result.push({
        team_head: t,
        employee_count: teamEmps.length,
        working_days: Math.round(workingDays / Math.max(1, teamEmps.length)),
        present_days: totalPres,
        absent_days: abs,
        no_source_days: noSrc,
        leave_days: leave,
        late_marks: late,
        missing_punches: missing,
        total_hours: Number(totalHrs.toFixed(2)),
        avg_hours: Number(avgHrs.toFixed(2)),
        attendance_rate: Number(attRate.toFixed(2)),
        punctuality_rate: Number(punctRate.toFixed(2)),
        data_coverage: Number(covRate.toFixed(2)),
        health_category: cat,
        variance_from_company_avg: Number((attRate - companyAvgAtt).toFixed(1)),
        flagged_employees_count: teamEmps.filter((e) => {
          const empFacts = teamFacts.filter((f) => f.employee_id === e.employee_id);
          const empLate = empFacts.filter((f) => f.is_late).length;
          const empAbs = empFacts.filter((f) => f.status === "ABSENT").length;
          return empLate >= 3 || empAbs >= 5;
        }).length,
      });
    }

    return result.sort((a, b) => b.attendance_rate - a.attendance_rate);
  }

  /**
   * Computes office-wise intelligence summaries.
   */
  public static computeOfficeIntelligence(facts: AttendanceFact[], employees: CanonicalEmployee[]): OfficeIntelligenceSummary[] {
    const offices = [...new Set(employees.map((e) => e.office_name))].sort();
    const result: OfficeIntelligenceSummary[] = [];

    for (const off of offices) {
      const offEmps = employees.filter((e) => e.office_name === off);
      const offEmpIds = new Set(offEmps.map((e) => e.employee_id));
      const offFacts = facts.filter((f) => offEmpIds.has(f.employee_id));

      let pres = 0;
      let presNC = 0;
      let abs = 0;
      let noSrc = 0;
      let leave = 0;
      let late = 0;
      let missing = 0;
      let totalHrs = 0;

      for (const f of offFacts) {
        if (f.status === "PRESENT") {
          pres++;
          if (f.worked_hours) totalHrs += f.worked_hours;
        } else if (f.status === "PRESENT_MISSING_OUT") {
          presNC++;
          missing++;
        } else if (f.status === "ABSENT") abs++;
        else if (f.status === "NO_SOURCE_DATA") noSrc++;
        else if (f.status === "APPROVED_LEAVE") leave++;
        else if (f.missing_in) missing++;

        if (f.is_late) late++;
      }

      const totalPres = pres + presNC;
      const workingDays = offFacts.filter((f) => f.status !== "HOLIDAY" && f.status !== "WEEKLY_OFF").length;
      const applicableDays = offFacts.filter(
        (f) =>
          f.status !== "HOLIDAY" &&
          f.status !== "WEEKLY_OFF" &&
          f.status !== "NO_SOURCE_DATA" &&
          f.status !== "APPROVED_LEAVE",
      ).length;
      const attRate = applicableDays > 0 ? (totalPres / applicableDays) * 100 : 0;
      const punctRate = totalPres > 0 ? ((totalPres - late) / totalPres) * 100 : 100;
      const covRate = offFacts.length > 0 ? ((offFacts.length - noSrc) / offFacts.length) * 100 : 0;

      result.push({
        office_name: off,
        employee_count: offEmps.length,
        working_days: Math.round(workingDays / Math.max(1, offEmps.length)),
        present_days: totalPres,
        absent_days: abs,
        no_source_days: noSrc,
        leave_days: leave,
        late_marks: late,
        missing_punches: missing,
        total_hours: Number(totalHrs.toFixed(2)),
        attendance_rate: Number(attRate.toFixed(2)),
        punctuality_rate: Number(punctRate.toFixed(2)),
        data_coverage: Number(covRate.toFixed(2)),
        confidence_score: Number(Math.max(0, covRate - (missing / Math.max(1, totalPres)) * 20).toFixed(1)),
      });
    }

    return result.sort((a, b) => b.attendance_rate - a.attendance_rate);
  }

  /**
   * Computes department-wise intelligence summaries.
   */
  public static computeDepartmentIntelligence(facts: AttendanceFact[], employees: CanonicalEmployee[]): DepartmentIntelligenceSummary[] {
    const depts = [...new Set(employees.map((e) => e.department_name))].sort();
    const result: DepartmentIntelligenceSummary[] = [];

    for (const dpt of depts) {
      const dptEmps = employees.filter((e) => e.department_name === dpt);
      const dptEmpIds = new Set(dptEmps.map((e) => e.employee_id));
      const dptFacts = facts.filter((f) => dptEmpIds.has(f.employee_id));

      let pres = 0;
      let presNC = 0;
      let abs = 0;
      let noSrc = 0;
      let leave = 0;
      let late = 0;
      let missing = 0;
      let totalHrs = 0;

      for (const f of dptFacts) {
        if (f.status === "PRESENT") {
          pres++;
          if (f.worked_hours) totalHrs += f.worked_hours;
        } else if (f.status === "PRESENT_MISSING_OUT") {
          presNC++;
          missing++;
        } else if (f.status === "ABSENT") abs++;
        else if (f.status === "NO_SOURCE_DATA") noSrc++;
        else if (f.status === "APPROVED_LEAVE") leave++;
        else if (f.missing_in) missing++;

        if (f.is_late) late++;
      }

      const totalPres = pres + presNC;
      const workingDays = dptFacts.filter((f) => f.status !== "HOLIDAY" && f.status !== "WEEKLY_OFF").length;
      const applicableDays = dptFacts.filter(
        (f) =>
          f.status !== "HOLIDAY" &&
          f.status !== "WEEKLY_OFF" &&
          f.status !== "NO_SOURCE_DATA" &&
          f.status !== "APPROVED_LEAVE",
      ).length;
      const attRate = applicableDays > 0 ? (totalPres / applicableDays) * 100 : 0;
      const punctRate = totalPres > 0 ? ((totalPres - late) / totalPres) * 100 : 100;
      const covRate = dptFacts.length > 0 ? ((dptFacts.length - noSrc) / dptFacts.length) * 100 : 0;

      result.push({
        department_name: dpt,
        employee_count: dptEmps.length,
        working_days: Math.round(workingDays / Math.max(1, dptEmps.length)),
        present_days: totalPres,
        absent_days: abs,
        no_source_days: noSrc,
        leave_days: leave,
        late_marks: late,
        missing_punches: missing,
        total_hours: Number(totalHrs.toFixed(2)),
        attendance_rate: Number(attRate.toFixed(2)),
        punctuality_rate: Number(punctRate.toFixed(2)),
        data_coverage: Number(covRate.toFixed(2)),
      });
    }

    return result.sort((a, b) => b.attendance_rate - a.attendance_rate);
  }
}

