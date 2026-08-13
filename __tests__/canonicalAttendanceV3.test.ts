// @ts-nocheck -- source-level integration contract guards.
import fs from "fs";
import path from "path";
import {
  formatHrmsDateTime,
  formatHrmsTime,
  getBusinessDateIST,
  parseHrmsTimestamp,
} from "../utils/attendanceTimestamp";

const read = (file: string) =>
  fs.readFileSync(path.resolve(__dirname, "..", file), "utf8");

describe("canonical attendance v3", () => {
  const attendanceMigration = read(
    "supabase/migrations/20260806010000_canonical_attendance_calendar_tracking.sql",
  );
  const leaveMigration = read(
    "supabase/migrations/20260806020000_leave_ledger_and_comp_off.sql",
  );

  it("treats offset-less legacy timestamps as IST without shifting them", () => {
    expect(formatHrmsTime("2026-08-06T10:15:00")).toMatch(/10:15/);
    expect(parseHrmsTimestamp("2026-08-06T10:15:00").toISOString()).toBe(
      "2026-08-06T04:45:00.000Z",
    );
    expect(formatHrmsDateTime("2026-08-06T10:15:00+05:30")).toContain(
      "10:15",
    );
  });

  it("uses the IST business date around UTC midnight", () => {
    expect(getBusinessDateIST("2026-08-05T20:00:00Z")).toBe("2026-08-06");
    expect(getBusinessDateIST("2026-08-05T17:00:00Z")).toBe("2026-08-05");
  });

  it("keeps the required first-in and checkout precedence in SQL", () => {
    expect(attendanceMigration).toContain(
      "least(app_first_in,biometric_first_in,field_visit_first_in)",
    );
    expect(attendanceMigration).toContain(
      "when approved_regularization_checkout is not null then approved_regularization_checkout",
    );
    expect(attendanceMigration).toContain(
      "coalesce(attendance.biometric_last_punch,biometric.last_punch) biometric_last_punch_evidence",
    );
    expect(attendanceMigration).not.toContain(
      "coalesce(biometric.last_punch,attendance.checkout_time)",
    );
  });

  it("routes the core admin consumers through the canonical service", () => {
    for (const file of [
      "screens/admin/AdvancedAttendanceReportScreen.tsx",
      "screens/admin/AttendanceControlScreenNew.tsx",
      "screens/admin/TVDisplayScreen.tsx",
      "services/activity.service.ts",
    ]) {
      expect(read(file)).toContain("CanonicalAttendanceService");
    }
    expect(read("navigation/ReportsStackNavigator.tsx")).toContain(
      "ReportsHub",
    );
  });

  it("uses immutable leave transactions and no direct balance write in UI", () => {
    expect(leaveMigration).toContain("create table if not exists public.leave_transactions");
    expect(leaveMigration).toContain("rpc_admin_adjust_leave_balance");
    expect(leaveMigration).toContain("monthly_accrual");
    expect(leaveMigration).toContain("comp_off_earnings");
    const screen = read("screens/admin/LeaveBalanceScreen.tsx");
    expect(screen).toContain("rpc_admin_adjust_leave_balance");
    expect(screen).not.toMatch(/from\(["']leave_balances?["']\)[\s\S]{0,120}\.update\(/);
  });
});
