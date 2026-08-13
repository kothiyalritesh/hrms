import { parseIndiaCalendarDate } from "../indiaCalendarDate";

describe("parseIndiaCalendarDate", () => {
  it("preserves India-local calendar dates without a UTC shift", () => {
    expect(parseIndiaCalendarDate("29/07/2026")).toBe("2026-07-29");
    expect(parseIndiaCalendarDate("29-Jul-2026")).toBe("2026-07-29");
    expect(parseIndiaCalendarDate("2026-07-29")).toBe("2026-07-29");
  });

  it("rejects ambiguous and invalid values", () => {
    expect(parseIndiaCalendarDate("July 29, 2026")).toBeNull();
    expect(parseIndiaCalendarDate("31/02/2026")).toBeNull();
  });
});

