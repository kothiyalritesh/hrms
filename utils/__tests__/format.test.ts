import { formatDate, formatTime } from "@/utils/format";

describe("shared date formatting", () => {
  it("preserves a date-only business calendar value", () => {
    expect(formatDate("2026-07-31")).toBe("31 Jul 2026");
  });

  it("formats official timestamps carrying an explicit timezone", () => {
    expect(formatTime("2026-07-31T10:15:00+05:30")).toMatch(/10:15/);
  });

  it("fails closed for offset-less official timestamps", () => {
    expect(formatTime("2026-07-31T10:15:00", "INVALID")).toBe("INVALID");
  });
});
