import {
  attendanceTimestampParts,
  parseAttendanceTimestamp,
} from "@/utils/attendanceTimestamp";

describe("parseAttendanceTimestamp", () => {
  it("interprets legacy offset-less attendance timestamps as India time", () => {
    expect(
      parseAttendanceTimestamp("2026-07-31 09:45:00").toISOString(),
    ).toBe("2026-07-31T04:15:00.000Z");
  });

  it("preserves explicit database timezone offsets", () => {
    expect(
      parseAttendanceTimestamp("2026-07-31T09:45:00+05:30").toISOString(),
    ).toBe("2026-07-31T04:15:00.000Z");
  });

  it("formats legacy timestamps into stable India business-time parts", () => {
    expect(attendanceTimestampParts("2026-07-31 09:45:06")).toEqual({
      date: "2026-07-31",
      hour: 9,
      minute: 45,
      second: 6,
      time: "09:45:06",
    });
  });

  it("rejects malformed attendance timestamps", () => {
    expect(() => parseAttendanceTimestamp("31 July at 9:45")).toThrow(
      "INVALID_ATTENDANCE_TIMESTAMP",
    );
  });
});
