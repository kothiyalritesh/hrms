import {
  addBusinessDays,
  businessDateUtcRange,
  businessMonthStart,
  businessTimestampParts,
  formatBusinessDate,
  getBusinessDateIST,
  isBusinessDate,
  isDueDateOverdue,
  isTimestampAtOrAfterBusinessCutoff,
  parseDatabaseTimestamp,
} from "@/utils/businessDate";

describe("businessDate", () => {
  it("validates real calendar dates without using the device timezone", () => {
    expect(isBusinessDate("2028-02-29")).toBe(true);
    expect(isBusinessDate("2027-02-29")).toBe(false);
    expect(isBusinessDate("2026-04-31")).toBe(false);
  });

  it("moves across month and year boundaries as date-only values", () => {
    expect(addBusinessDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addBusinessDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("derives the IST business date of an instant, not the UTC date", () => {
    expect(getBusinessDateIST(new Date("2026-08-05T20:00:00Z"))).toBe("2026-08-06");
    expect(getBusinessDateIST(new Date("2026-08-05T18:29:59Z"))).toBe("2026-08-05");
  });

  it("finds business month starts across year boundaries", () => {
    expect(businessMonthStart("2026-10-06")).toBe("2026-10-01");
    expect(businessMonthStart("2026-01-31", -2)).toBe("2025-11-01");
    expect(businessMonthStart("2026-12-15", 1)).toBe("2027-01-01");
  });

  it("keeps tasks current through their full due date", () => {
    expect(isDueDateOverdue("2026-08-04", "2026-08-04")).toBe(false);
    expect(isDueDateOverdue("2026-08-04", "2026-08-05")).toBe(true);
    expect(isDueDateOverdue("2026-08-05", "2026-08-04")).toBe(false);
  });

  it("builds exact IST business-day boundaries for timestamp queries", () => {
    expect(businessDateUtcRange("2026-07-31")).toEqual({
      start: "2026-07-30T18:30:00.000Z",
      end: "2026-07-31T18:30:00.000Z",
    });
  });

  it("formats a business date without UTC/local conversion", () => {
    expect(formatBusinessDate("2026-07-29")).toBe("29 Jul 2026");
  });

  it("assigns UTC midnight records to the correct IST business date", () => {
    expect(businessTimestampParts("2026-07-28T20:15:00Z")).toMatchObject({
      date: "2026-07-29",
      hour: 1,
      minute: 45,
    });
  });

  it("does not append a second timezone to offset timestamps", () => {
    expect(
      parseDatabaseTimestamp("2026-07-29T01:45:00+05:30").toISOString(),
    ).toBe("2026-07-28T20:15:00.000Z");
  });

  it("fails closed instead of guessing the timezone of official timestamps", () => {
    expect(() => parseDatabaseTimestamp("2026-07-29T01:45:00")).toThrow(
      "DATABASE_TIMESTAMP_TIMEZONE_REQUIRED",
    );
  });

  it("marks timestamps at or after 10:32 IST as late", () => {
    expect(
      isTimestampAtOrAfterBusinessCutoff(
        "2026-07-31T10:31:59+05:30",
        10,
        32,
      ),
    ).toBe(false);
    expect(
      isTimestampAtOrAfterBusinessCutoff(
        "2026-07-31T10:32:00+05:30",
        10,
        32,
      ),
    ).toBe(true);
    expect(
      isTimestampAtOrAfterBusinessCutoff(
        "2026-07-31T10:32:01+05:30",
        10,
        32,
      ),
    ).toBe(true);
  });
});

describe("IST correction inputs", () => {
  const { formatIstDateTimeInput, parseIstDateTimeInput } = require("../businessDate");

  it("shows UTC database timestamps as IST", () => {
    expect(formatIstDateTimeInput("2026-10-06T04:52:21.76359+00:00")).toBe("2026-10-06 10:22");
    expect(formatIstDateTimeInput(null)).toBe("");
  });

  it("parses HH:MM on the record's business date as IST", () => {
    expect(parseIstDateTimeInput("10:16", "2026-10-06")?.toISOString()).toBe("2026-10-06T04:46:00.000Z");
    expect(parseIstDateTimeInput("2026-10-06 18:30", "2026-10-01")?.toISOString()).toBe("2026-10-06T13:00:00.000Z");
    expect(parseIstDateTimeInput("2026-10-06T10:00:00+05:30", "2026-10-06")?.toISOString()).toBe("2026-10-06T04:30:00.000Z");
    expect(parseIstDateTimeInput("  ", "2026-10-06")).toBeNull();
  });

  it("rejects invalid times", () => {
    expect(() => parseIstDateTimeInput("25:00", "2026-10-06")).toThrow();
    expect(() => parseIstDateTimeInput("ten", "2026-10-06")).toThrow();
  });
});
