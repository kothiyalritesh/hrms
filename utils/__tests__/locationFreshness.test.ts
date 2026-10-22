import {
  describeAge,
  fmtDistance,
  freshnessOf,
  freshnessOfTimestamp,
  minutesAgo,
  movementText,
} from "@/utils/locationFreshness";

describe("location freshness (one rule for every location screen)", () => {
  const now = Date.parse("2026-10-08T09:00:00Z");

  test("LIVE <= 5 min, RECENT <= 15 min, STALE after, NONE without a fix", () => {
    expect(freshnessOf(0)).toBe("LIVE");
    expect(freshnessOf(5)).toBe("LIVE");
    expect(freshnessOf(5.1)).toBe("RECENT");
    expect(freshnessOf(15)).toBe("RECENT");
    expect(freshnessOf(15.1)).toBe("STALE");
    expect(freshnessOf(null)).toBe("NONE");
  });

  test("ages are computed from zoned timestamps only", () => {
    expect(minutesAgo("2026-10-08T08:50:00Z", now)).toBe(10);
    expect(minutesAgo("2026-10-08T14:20:00+05:30", now)).toBe(10);
    // A zone-less value cannot be trusted (IST or UTC?): unknown, not "live".
    expect(minutesAgo("2026-10-08T08:50:00", now)).toBeNull();
    expect(freshnessOfTimestamp("2026-10-08T08:50:00", now)).toBe("NONE");
    expect(freshnessOfTimestamp("2026-10-08T08:58:00Z", now)).toBe("LIVE");
  });

  test("human labels", () => {
    expect(describeAge(0.4)).toBe("just now");
    expect(describeAge(12)).toBe("12 min ago");
    expect(describeAge(125)).toBe("2h 5m ago");
    expect(movementText(0.2)).toBe("Not moving");
    expect(movementText(10)).toBe("Moving · 36 km/h");
    expect(movementText(null)).toBeNull();
    expect(fmtDistance(42.4)).toBe("42 m");
    expect(fmtDistance(2345)).toBe("2.3 km");
  });
});
