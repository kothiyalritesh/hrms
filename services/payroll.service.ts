import { supabase } from "@/lib/supabase";

export interface SalaryStructure {
  id: string;
  user_id: string;
  effective_from: string;
  ctc: number;
  basic: number;
  hra: number;
  special_allowance: number;
  transport_allowance: number;
  medical_allowance: number;
  pf_employee: number;
  pf_employer: number;
  esi_employee: number;
  esi_employer: number;
  professional_tax: number;
  tds: number;
  gross_salary: number;
  net_salary: number;
  is_active: boolean;
}

export interface PayrollRun {
  id: string;
  month: number;
  year: number;
  status: "draft" | "processing" | "completed" | "paid";
  total_employees: number;
  total_gross: number;
  total_net: number;
  run_at?: string;
  paid_at?: string;
}

export interface Payslip {
  id: string;
  payroll_run_id: string;
  user_id: string;
  month: number;
  year: number;
  basic: number;
  hra: number;
  special_allowance: number;
  transport_allowance: number;
  medical_allowance: number;
  gross_salary: number;
  pf_deduction: number;
  esi_deduction: number;
  pt_deduction: number;
  tds_deduction: number;
  other_deductions: number;
  total_deductions: number;
  net_salary: number;
  working_days: number;
  present_days: number;
  lop_days: number;
  status: "generated" | "paid";
  paid_on?: string;
  employee?: { name: string; employee_number: string; role: string };
}

/** Compute salary components from CTC using standard Indian formulas */
export function computeSalaryComponents(ctc: number) {
  const monthly = ctc / 12;
  const basic = Math.round(monthly * 0.4);
  const hra = Math.round(basic * 0.4);
  const transport = 1600;
  const medical = 1250;
  const pf_employee = Math.min(1800, Math.round(basic * 0.12));
  const pf_employer = pf_employee;
  const esi_employee = monthly <= 21000 ? Math.round(monthly * 0.0075) : 0;
  const esi_employer = monthly <= 21000 ? Math.round(monthly * 0.0325) : 0;
  const pt = basic > 15000 ? 200 : basic > 10000 ? 150 : 0;
  const special = Math.round(monthly - basic - hra - transport - medical - pf_employee);
  const gross = basic + hra + transport + medical + Math.max(0, special);
  const total_deductions = pf_employee + esi_employee + pt;
  const net = gross - total_deductions;
  return {
    basic, hra,
    special_allowance: Math.max(0, special),
    transport_allowance: transport,
    medical_allowance: medical,
    pf_employee, pf_employer,
    esi_employee, esi_employer,
    professional_tax: pt,
    tds: 0,
    gross_salary: gross,
    net_salary: net,
  };
}

export const PayrollService = {
  async getSalaryStructure(userId: string): Promise<SalaryStructure | null> {
    const { data } = await supabase
      .from("salary_structures")
      .select("*")
      .eq("user_id", userId)
      .eq("is_active", true)
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data;
  },

  async saveSalaryStructure(userId: string, ctc: number, effectiveFrom: string, createdBy: string) {
    // Deactivate old structure
    await supabase.from("salary_structures").update({ is_active: false }).eq("user_id", userId);
    const components = computeSalaryComponents(ctc);
    return supabase.from("salary_structures").insert({
      user_id: userId,
      effective_from: effectiveFrom,
      ctc,
      ...components,
      is_active: true,
      created_by: createdBy,
    }).select().single();
  },

  async getPayrollRuns(): Promise<PayrollRun[]> {
    const { data } = await supabase
      .from("payroll_runs")
      .select("*")
      .order("year", { ascending: false })
      .order("month", { ascending: false });
    return data || [];
  },

  async runPayroll(month: number, year: number, runBy: string) {
    // 1. Create or get payroll run
    const { data: run, error: runError } = await supabase
      .from("payroll_runs")
      .upsert({ month, year, status: "processing", run_by: runBy, run_at: new Date().toISOString() }, { onConflict: "month,year" })
      .select().single();
    if (runError) throw runError;

    // 2. Get all active employees with salary structures
    const { data: employees } = await supabase
      .from("profiles")
      .select("id, name")
      .eq("is_active", true)
      .eq("lifecycle_status", "active");

    if (!employees?.length) throw new Error("No active employees found.");

    // 3. Get attendance for the month to calculate LOP
    const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
    const endDate = new Date(year, month, 0).toISOString().split("T")[0];
    const { data: attendance } = await supabase
      .from("attendance_logs")
      .select("user_id, date")
      .gte("date", startDate)
      .lte("date", endDate);

    const workingDays = 26;
    const attendanceMap: Record<string, number> = {};
    (attendance || []).forEach((a: any) => {
      attendanceMap[a.user_id] = (attendanceMap[a.user_id] || 0) + 1;
    });

    // 4. Generate payslips
    const payslips = [];
    let totalGross = 0, totalNet = 0;

    for (const emp of employees) {
      const struct = await PayrollService.getSalaryStructure(emp.id);
      if (!struct) continue;

      const presentDays = attendanceMap[emp.id] || workingDays;
      const lopDays = Math.max(0, workingDays - presentDays);
      const lopFactor = (workingDays - lopDays) / workingDays;

      const gross = Math.round(struct.gross_salary * lopFactor);
      const pf = Math.round(struct.pf_employee * lopFactor);
      const esi = Math.round(struct.esi_employee * lopFactor);
      const pt = struct.professional_tax;
      const totalDed = pf + esi + pt + struct.tds;
      const net = gross - totalDed;

      totalGross += gross;
      totalNet += net;

      payslips.push({
        payroll_run_id: run.id,
        user_id: emp.id,
        month, year,
        basic: Math.round(struct.basic * lopFactor),
        hra: Math.round(struct.hra * lopFactor),
        special_allowance: Math.round(struct.special_allowance * lopFactor),
        transport_allowance: Math.round(struct.transport_allowance * lopFactor),
        medical_allowance: Math.round(struct.medical_allowance * lopFactor),
        gross_salary: gross,
        pf_deduction: pf,
        esi_deduction: esi,
        pt_deduction: pt,
        tds_deduction: struct.tds,
        other_deductions: 0,
        total_deductions: totalDed,
        net_salary: net,
        working_days: workingDays,
        present_days: presentDays,
        lop_days: lopDays,
        status: "generated",
      });
    }

    // 5. Insert payslips (upsert to allow re-runs)
    if (payslips.length > 0) {
      await supabase.from("payslips").upsert(payslips, { onConflict: "payroll_run_id,user_id" });
    }

    // 6. Update run totals
    await supabase.from("payroll_runs").update({
      status: "completed",
      total_employees: payslips.length,
      total_gross: totalGross,
      total_net: totalNet,
    }).eq("id", run.id);

    return { success: true, employeesProcessed: payslips.length, totalNet };
  },

  async getPayslipsForRun(runId: string): Promise<Payslip[]> {
    const { data } = await supabase
      .from("payslips")
      .select("*, employee:user_id(name, employee_number, role)")
      .eq("payroll_run_id", runId)
      .order("created_at");
    return data || [];
  },

  async getUserPayslips(userId: string): Promise<Payslip[]> {
    const { data } = await supabase
      .from("payslips")
      .select("*")
      .eq("user_id", userId)
      .order("year", { ascending: false })
      .order("month", { ascending: false });
    return data || [];
  },

  async markAsPaid(runId: string) {
    const today = new Date().toISOString().split("T")[0];
    await supabase.from("payslips").update({ status: "paid", paid_on: today }).eq("payroll_run_id", runId);
    return supabase.from("payroll_runs").update({ status: "paid", paid_at: new Date().toISOString() }).eq("id", runId);
  },
};
