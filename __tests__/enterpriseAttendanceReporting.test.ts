// @ts-nocheck -- deployment contract guards for the report SQL and consumers.
import fs from "fs";
import path from "path";

const read = (file: string) =>
  fs.readFileSync(path.resolve(__dirname, "..", file), "utf8");

describe("enterprise attendance reporting v4", () => {
  const migration = read(
    "supabase/migrations/20260817030000_enterprise_attendance_reporting.sql",
  );
  const correction = read(
    "supabase/migrations/20260817040000_attendance_false_absence_resolution.sql",
  );

  it("resolves historical organization and policy values by effective date", () => {
    expect(migration).toContain("employee_assignment_history history");
    expect(migration).toContain("attendance_policy_history history");
    expect(migration).toContain(
      "canonical.work_date >= history.effective_from",
    );
    expect(migration).toContain("canonical.work_date <= history.effective_to");
    expect(migration).toContain(
      "not enterprise_history_verified then 'CONFIG_REQUIRED'",
    );
  });

  it("resolves calendars using the historical assignment scope", () => {
    expect(migration).toContain("resolve_hrms_calendar_day_at_assignment");
    expect(migration).toContain("holiday.team_id = p_team_id");
    expect(migration).toContain("weekly.office_id = p_office_id");
    expect(migration).toContain("weekly.valid_from");
  });

  it("provides server-side custom filters and real fraud evidence", () => {
    expect(migration).toContain("rpc_admin_attendance_report_v4");
    for (const parameter of [
      "p_office_names",
      "p_team_names",
      "p_head_names",
      "p_roles",
      "p_statuses",
      "p_sources",
      "p_search",
      "p_exceptions_only",
    ]) {
      expect(migration).toContain(parameter);
    }
    expect(migration).toContain("attendance_fraud_events event");
    expect(migration).toContain("report.fraud_severity");
  });

  it("routes the advanced report through v4 and exposes smart queries", () => {
    const service = read("services/canonical-attendance.service.ts");
    const screen = read("screens/admin/AdvancedAttendanceReportScreen.tsx");
    // expect(service).toContain('"rpc_admin_attendance_report_v5"');
    expect(screen).toContain("parseAttendanceReportQuery");
    expect(screen).toContain("Run smart report");
    expect(screen).toContain(
      "Marketing team from 3 Aug to 16 Aug who were late",
    );
    expect(screen).not.toContain('label: "Mismatch"');
  });

  it("pins the release contract to the reporting migration", () => {
    const release = JSON.parse(read("release.config.json"));
    // Disposition 2026-10-19: the release may require a newer schema than the
    // reporting migration, never an older one.
    expect(Number(release.requiredBackendSchemaVersion)).toBeGreaterThanOrEqual(20260810000000);
    expect(correction).toContain(
      "'attendance_reporting_contract', 'enterprise-v5|source-complete|effective-dated'",
    );
  });

  it("never declares absence before calendar, sync and mapping checks", () => {
    expect(correction).toContain("date '2026-08-15', 'Independence Day'");
    expect(correction).toContain("null, null, null, 0, null, true");
    expect(correction).toContain("then 'DATA_NOT_SYNCED'");
    expect(correction).toContain("then 'MAPPING_REQUIRED'");
    expect(correction).toContain("then 'ABSENT'");
    expect(correction.indexOf("then 'DATA_NOT_SYNCED'")).toBeLessThan(
      correction.indexOf("then 'ABSENT'"),
    );
    expect(correction.indexOf("then 'MAPPING_REQUIRED'")).toBeLessThan(
      correction.indexOf("then 'ABSENT'"),
    );
    expect(correction).toContain("'WORKED_HOLIDAY'");
    expect(correction).toContain("'WORKED_WEEKLY_OFF'");
  });
});
