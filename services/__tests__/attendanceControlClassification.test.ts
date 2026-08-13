import {
  attendanceEmptyStateCopy,
  classifyAttendanceEvidence,
} from "../attendance-control.classification";

describe("Attendance Control evidence classification", () => {
  test("does not classify an empty employee-day as App or Active", () => {
    expect(classifyAttendanceEvidence({ checkin_time: null }, 0)).toBe(
      "NO_ATTENDANCE",
    );
    expect(attendanceEmptyStateCopy("ABSENT").label).toBe("Absent");
  });

  test("separates app, biometric, and combined evidence", () => {
    expect(
      classifyAttendanceEvidence({ app_checkin_time: "2026-08-06T10:00:00+05:30" }),
    ).toBe("APP_ONLY");
    expect(
      classifyAttendanceEvidence({ biometric_first_in: "2026-08-06T09:58:00+05:30" }),
    ).toBe("BIOMETRIC_ONLY");
    expect(
      classifyAttendanceEvidence(
        { app_checkin_time: "2026-08-06T10:00:00+05:30" },
        1,
      ),
    ).toBe("BOTH");
  });

  test("keeps verified field-visit-only attendance out of the app bucket", () => {
    expect(
      classifyAttendanceEvidence({ checkin_time: "2026-08-06T09:30:00+05:30" }),
    ).toBe("OTHER_ATTENDANCE");
  });
});
