import {
  parseFieldVisitTimestamp,
  formatFieldVisitTime,
  formatFieldVisitDateTime,
} from "@/utils/format";

describe("Field Visit IST Timestamp Normalization", () => {
  describe("parseFieldVisitTimestamp", () => {
    it("interprets naive SQL UTC timestamps from Postgres now() as UTC instants", () => {
      const parsed = parseFieldVisitTimestamp("2026-09-15 07:44:00");
      expect(parsed).not.toBeNull();
      expect(parsed?.toISOString()).toBe("2026-09-15T07:44:00.000Z");
    });

    it("interprets naive ISO strings without timezone as UTC instants", () => {
      const parsed = parseFieldVisitTimestamp("2026-09-15T07:44:00");
      expect(parsed).not.toBeNull();
      expect(parsed?.toISOString()).toBe("2026-09-15T07:44:00.000Z");
    });

    it("handles microsecond precision in naive timestamps", () => {
      const parsed = parseFieldVisitTimestamp("2026-09-15T07:44:00.123456");
      expect(parsed).not.toBeNull();
      expect(parsed?.toISOString()).toBe("2026-09-15T07:44:00.123Z");
    });

    it("preserves explicit UTC 'Z' suffix", () => {
      const parsed = parseFieldVisitTimestamp("2026-09-15T07:44:00Z");
      expect(parsed).not.toBeNull();
      expect(parsed?.toISOString()).toBe("2026-09-15T07:44:00.000Z");
    });

    it("preserves explicit +05:30 IST offset", () => {
      const parsed = parseFieldVisitTimestamp("2026-09-15T13:14:00+05:30");
      expect(parsed).not.toBeNull();
      expect(parsed?.toISOString()).toBe("2026-09-15T07:44:00.000Z");
    });

    it("handles Date objects and epoch milliseconds", () => {
      const d = new Date("2026-09-15T07:44:00Z");
      expect(parseFieldVisitTimestamp(d)?.getTime()).toBe(d.getTime());
      expect(parseFieldVisitTimestamp(d.getTime())?.getTime()).toBe(d.getTime());
    });

    it("returns null for null, undefined, and empty string", () => {
      expect(parseFieldVisitTimestamp(null)).toBeNull();
      expect(parseFieldVisitTimestamp(undefined)).toBeNull();
      expect(parseFieldVisitTimestamp("   ")).toBeNull();
      expect(parseFieldVisitTimestamp("invalid-date")).toBeNull();
    });
  });

  describe("formatFieldVisitTime", () => {
    it("formats naive SQL check-in time accurately in IST", () => {
      // 07:44 UTC + 5:30 = 13:14 (01:14 PM IST)
      const formatted = formatFieldVisitTime("2026-09-15 07:44:00");
      expect(formatted).toMatch(/01:14\s*PM/i);
    });

    it("formats ISO check-in time with 'Z' accurately in IST", () => {
      const formatted = formatFieldVisitTime("2026-09-15T07:44:00Z");
      expect(formatted).toMatch(/01:14\s*PM/i);
    });

    it("formats zoned check-in time with '+05:30' accurately in IST", () => {
      const formatted = formatFieldVisitTime("2026-09-15T13:14:00+05:30");
      expect(formatted).toMatch(/01:14\s*PM/i);
    });

    it("returns fallback for missing time", () => {
      expect(formatFieldVisitTime(null)).toBe("—");
      expect(formatFieldVisitTime(undefined, "No check-in")).toBe("No check-in");
    });
  });

  describe("formatFieldVisitDateTime", () => {
    it("formats date and time accurately in IST", () => {
      const formatted = formatFieldVisitDateTime("2026-09-15 07:44:00");
      expect(formatted).toMatch(/15\s+Sep[t]?\s+2026/i);
      expect(formatted).toMatch(/01:14\s*PM/i);
    });

    it("returns fallback for missing date-time", () => {
      expect(formatFieldVisitDateTime(null)).toBe("—");
    });
  });
});
