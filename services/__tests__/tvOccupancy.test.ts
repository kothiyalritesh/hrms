import { classifyTvAttendance } from "../tv-occupancy";

describe("TV occupancy classification", () => {
  it.each(["NO_DATA", "HOLIDAY", "WEEKLY_OFF", "ON_LEAVE", "CONFIG_REQUIRED"])(
    "does not count an empty %s row as present",
    (attendance_status) => {
      expect(classifyTvAttendance({ attendance_status })).toMatchObject({
        isActivelyWorking: false,
        isInOffice: false,
      });
    },
  );

  it("counts open attendance as working and office occupancy", () => {
    expect(
      classifyTvAttendance({
        attendance_status: "PRESENT",
        official_first_in: "2026-08-06T04:30:00Z",
      }),
    ).toMatchObject({ isActivelyWorking: true, isInOffice: true });
  });

  it("keeps an active field visitor working but outside office occupancy", () => {
    expect(
      classifyTvAttendance({
        attendance_status: "FIELD_VISIT",
        official_first_in: "2026-08-06T04:30:00Z",
        active_field_visit_id: "visit-1",
      }),
    ).toMatchObject({ isActivelyWorking: true, isInOffice: false });
  });

  it("does not count checked-out attendance as current occupancy", () => {
    expect(
      classifyTvAttendance({
        attendance_status: "CHECKED_OUT",
        official_first_in: "2026-08-06T04:30:00Z",
        official_last_out: "2026-08-06T12:30:00Z",
      }),
    ).toMatchObject({ isActivelyWorking: false, isInOffice: false });
  });
});
