import { validateBiometricSyncRange } from "../biometricSyncRequest";

describe("biometric sync date range", () => {
  const businessDate = "2026-07-31";

  it("accepts a real, inclusive 31-day range ending today", () => {
    expect(
      validateBiometricSyncRange({
        fromDate: "2026-07-01",
        toDate: "2026-07-31",
        businessDate,
      }),
    ).toMatchObject({ inclusiveDays: 31 });
  });

  it("rejects invalid, reversed, future and over-limit ranges", () => {
    expect(() =>
      validateBiometricSyncRange({
        fromDate: "2026-02-30",
        toDate: businessDate,
        businessDate,
      }),
    ).toThrow("YYYY-MM-DD");
    expect(() =>
      validateBiometricSyncRange({
        fromDate: "2026-07-31",
        toDate: "2026-07-01",
        businessDate,
      }),
    ).toThrow("cannot be after");
    expect(() =>
      validateBiometricSyncRange({
        fromDate: businessDate,
        toDate: "2026-08-01",
        businessDate,
      }),
    ).toThrow("Future");
    expect(() =>
      validateBiometricSyncRange({
        fromDate: "2026-06-30",
        toDate: businessDate,
        businessDate,
      }),
    ).toThrow("31 calendar days");
  });
});
