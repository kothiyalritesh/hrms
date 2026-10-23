import fs from "fs";
import path from "path";

jest.mock("@/lib/supabase", () => ({ supabase: { rpc: jest.fn() } }));

import {
  currentPlace,
  dayProblems,
  daySources,
  keyEvents,
  type DayEvent,
} from "@/services/attendance-day-events.service";

const read = (relativePath: string) =>
  fs.readFileSync(path.resolve(__dirname, "..", relativePath), "utf8").replace(/\r\n/g, "\n");

const ev = (at: string, type: string, title: string, place: string | null, source: string, verified = true, detail: string | null = null): DayEvent =>
  ({ at: `2026-10-22T${at}:00+05:30`, type, title, place, source, verified, detail });

// Viral, 22 Oct: site check-in in the morning, out, office punch after lunch.
const viral: DayEvent[] = [
  ev("11:02", "CHECK_IN", "Day started", "Nimbus Arista", "FIELD_VISIT"),
  ev("11:02", "SITE_IN", "Site check-in", "Nimbus Arista", "SITE"),
  ev("11:27", "GPS_GAP", "No location for 53 min", null, "GPS", false, "12:21"),
  ev("11:28", "SITE_OUT", "Site check-out", "Nimbus Arista", "SITE"),
  ev("13:15", "BIO_PUNCH", "Biometric punch", "Noida 136", "BIOMETRIC", true, "CEXJ203660057"),
];

describe("one story per employee-day", () => {
  test("all sources of the day are named on the card", () => {
    expect(daySources(viral)).toEqual(["Bio", "Site"]);
    expect(daySources([ev("09:30", "CHECK_IN", "Day started", "Noida 136", "APP"), ev("10:53", "BIO_PUNCH", "Biometric punch", "Noida 136", "BIOMETRIC")]))
      .toEqual(["App", "Bio"]);
  });

  test("the strip tells the day: site in, site out, office punch", () => {
    expect(keyEvents(viral).map((e) => e.type)).toEqual(["CHECK_IN", "SITE_IN", "SITE_OUT", "BIO_PUNCH"]);
  });

  test("now = the last place the evidence shows", () => {
    expect(currentPlace(viral)).toMatchObject({ text: "Noida 136", confirmed: true });
    expect(currentPlace(viral.slice(0, 4))).toMatchObject({ text: "Left Nimbus Arista", confirmed: false });
  });

  test("an unlinked machine never counts as a confirmed office", () => {
    const unlinked = [ev("13:15", "BIO_PUNCH", "Biometric punch", "Device CEXJ203660057 (office not linked)", "BIOMETRIC", false)];
    expect(currentPlace(unlinked)).toMatchObject({ confirmed: false });
    expect(dayProblems(unlinked)).toContain("Biometric machine not linked to an office");
  });

  test("problems: location gaps, leaving a site without checking out, not back in the office area", () => {
    expect(dayProblems(viral)).toEqual(["No location for 53 min"]);
    expect(dayProblems([ev("12:50", "SITE_LEFT", "Left the site (GPS)", "Tower B", "GPS")]))
      .toEqual(["Left Tower B without checking out"]);
    expect(dayProblems([ev("15:00", "OFFICE_EXIT", "Left the office area", "Noida 136", "GPS")]))
      .toEqual(["Left the office area, not back yet"]);
  });

  test("repeated punches at the same office are one chip, a change of office is another", () => {
    const punches = [
      ev("10:00", "BIO_PUNCH", "Biometric punch", "Noida 136", "BIOMETRIC"),
      ev("10:01", "BIO_PUNCH", "Biometric punch", "Noida 136", "BIOMETRIC"),
      ev("16:00", "BIO_PUNCH", "Biometric punch", "Sector 63", "BIOMETRIC"),
    ];
    expect(keyEvents(punches).map((e) => e.place)).toEqual(["Noida 136", "Sector 63"]);
  });
});

describe("Attendance Control shows the whole day for everyone", () => {
  const screen = read("screens/admin/AttendanceControlScreenNew.tsx");

  test("one card per person with the day story; filters instead of source sections", () => {
    expect(screen).toContain("return visible.map((item) => renderPresentCard(item));");
    expect(screen).toContain("<DayStory");
    expect(screen).not.toContain("renderBothSection");
    expect(screen).toContain('{ key: "PROBLEMS", label: "Needs attention" }');
  });

  test("the Timeline window gets the same story", () => {
    expect(screen).toContain("events={timelineEvents}");
    expect(read("components/LocationTimelineModal.tsx")).toContain("<DayEventList events={events} />");
    expect(read("components/LocationTimelineModal.web.tsx")).toContain("<DayEventList events={events} />");
  });

  test("the server returns every source, scoped like attendance", () => {
    const sql = read("supabase/migrations/20261022120000_attendance_day_events.sql");
    for (const type of ["'BIO_PUNCH'", "'SITE_IN'", "'SITE_LEFT'", "'SITE_OUT'", "'OFFICE_EXIT'", "'EVENT_IN'", "'REGULARIZED'", "'GPS_GAP'"]) {
      expect(sql).toContain(type);
    }
    expect(sql).toContain("UNION SELECT public.authorized_user_ids('attendance.view')");
  });
});
