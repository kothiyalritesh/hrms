import { isLateCheckin } from "../canonical-attendance.service";

jest.mock("@/lib/supabase", () => ({ supabase: {} }));

describe("isLateCheckin (late from 10:33 IST)", () => {
  it("uses IST and is inclusive at the threshold", () => {
    expect(isLateCheckin("2026-10-06T05:02:59Z", "10:33:00")).toBe(false); // 10:32:59 IST
    expect(isLateCheckin("2026-10-06T05:03:00Z", "10:33:00")).toBe(true);  // 10:33:00 IST
    expect(isLateCheckin("2026-10-06T05:02:30Z", null)).toBe(false); // 10:32:30 IST, default 10:33
    expect(isLateCheckin("2026-10-06T05:03:00Z", null)).toBe(true);  // 10:33:00 IST, default 10:33
  });

  it("accepts HH:MM policy times and handles missing check-in", () => {
    expect(isLateCheckin("2026-10-06T05:31:00Z", "11:00")).toBe(true); // 11:01 IST
    expect(isLateCheckin(null, "10:33:00")).toBe(false);
  });
});
