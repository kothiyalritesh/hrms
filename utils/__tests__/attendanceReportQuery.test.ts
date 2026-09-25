import { parseAttendanceReportQuery } from "../attendanceReportQuery";

describe("attendance smart report query", () => {
  const today = "2026-08-17";

  it("parses a team, date range and late exception", () => {
    expect(
      parseAttendanceReportQuery(
        "Marketing team report from 3-Aug to 16 Aug who were late",
        today,
      ),
    ).toMatchObject({
      start: "2026-08-03",
      end: "2026-08-16",
      section: "Exceptions",
      filters: { team: "Marketing", status: "LATE" },
    });
  });

  it("supports relative periods, office and source", () => {
    expect(
      parseAttendanceReportQuery(
        "Biometric attendance for Lucknow office last month",
        today,
      ),
    ).toMatchObject({
      start: "2026-07-01",
      end: "2026-07-31",
      filters: { office: "Lucknow", source: "BIOMETRIC" },
    });
  });

  it("normalizes a reversed explicit date range", () => {
    expect(
      parseAttendanceReportQuery("absent from 16 Aug to 3 Aug", today),
    ).toMatchObject({
      start: "2026-08-03",
      end: "2026-08-16",
      filters: { status: "ABSENT" },
    });
  });

  it("warns instead of inventing an unrecognised period", () => {
    const result = parseAttendanceReportQuery("show all late employees", today);
    expect(result.filters.status).toBe("LATE");
    expect(result.start).toBeUndefined();
    expect(result.warnings).toContain(
      "No date was recognised; the current report period will be used.",
    );
  });

  it("combines manager, role and reconciliation filters", () => {
    expect(
      parseAttendanceReportQuery(
        "Sales managers under Ankit Mavi with multiple sources this month",
        today,
      ),
    ).toMatchObject({
      start: "2026-08-01",
      end: "2026-08-17",
      section: "Reconciliation",
      filters: {
        head: "Ankit Mavi",
        role: "Sales Manager",
        source: "MULTIPLE",
      },
    });
  });

  it("finds source-sync and biometric-mapping exceptions", () => {
    expect(
      parseAttendanceReportQuery("attendance not synced today", today),
    ).toMatchObject({ filters: { status: "DATA_NOT_SYNCED" } });
    expect(
      parseAttendanceReportQuery("show unmapped employees today", today),
    ).toMatchObject({ filters: { status: "MAPPING_REQUIRED" } });
  });
});
