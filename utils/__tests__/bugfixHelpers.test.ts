import { gpsFailureMessage } from "@/utils/gps";
import { formatMinutes, minutesAfterIst, formatIstTime } from "@/utils/exportWorkbook";

jest.mock("@/utils/browserFileDownload", () => ({ downloadBrowserBytes: jest.fn() }));

describe("gpsFailureMessage", () => {
  it("names the actual cause", () => {
    expect(gpsFailureMessage("PERMISSION_DENIED")).toMatch(/permission is off/i);
    expect(gpsFailureMessage("SERVICES_OFF")).toMatch(/turned off/i);
    expect(gpsFailureMessage("TIMEOUT")).toMatch(/took too long/i);
    expect(gpsFailureMessage("POSITION_UNAVAILABLE")).toMatch(/GPS signal/i);
    expect(gpsFailureMessage("OUT_OF_REGION")).toMatch(/fake-GPS/i);
  });

  it("falls back to a general message", () => {
    expect(gpsFailureMessage(null)).toMatch(/could not be read/i);
  });
});

describe("export helpers", () => {
  it("counts minutes late in IST for zoned and zone-less timestamps", () => {
    // 10:45 IST, threshold 10:33 -> 12 minutes
    expect(minutesAfterIst("2026-10-09T05:15:00Z", "10:33")).toBe(12);
    // zone-less values are IST wall clock, never UTC
    expect(minutesAfterIst("2026-10-09 10:45:00", "10:33")).toBe(12);
    expect(minutesAfterIst("2026-10-09T04:00:00Z", "10:33")).toBe(0);
    expect(minutesAfterIst(null, "10:33")).toBe(0);
  });

  it("formats IST time and durations", () => {
    expect(formatIstTime("2026-10-09T05:15:00Z")).toMatch(/10:45/);
    expect(formatIstTime(null)).toBe("");
    expect(formatMinutes(125)).toBe("2h 5m");
    expect(formatMinutes(45)).toBe("45m");
    expect(formatMinutes(null)).toBe("");
  });
});
