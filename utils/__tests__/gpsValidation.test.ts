import {
  GPSValidationError,
  hasValidCoordinates,
  validateGPS,
  type GPSCoords,
} from "@/utils/gps";

const reading = (overrides: Partial<GPSCoords> = {}): GPSCoords => ({
  latitude: 0,
  longitude: 0,
  accuracy: 20,
  capturedAt: "2026-08-03T06:30:00.000Z",
  provider: "gps",
  mocked: false,
  ...overrides,
});

describe("GPS validation", () => {
  it("accepts valid zero latitude and longitude", () => {
    expect(hasValidCoordinates(reading())).toBe(true);
    expect(
      validateGPS(reading(), { now: Date.parse("2026-08-03T06:31:00.000Z") }),
    ).toMatchObject({ latitude: 0, longitude: 0 });
  });

  it("rejects out-of-range and non-finite coordinates", () => {
    expect(hasValidCoordinates(reading({ latitude: 91 }))).toBe(false);
    expect(hasValidCoordinates(reading({ longitude: Number.NaN }))).toBe(false);
  });

  it("rejects stale, mocked and poor-accuracy fixes with typed errors", () => {
    const now = Date.parse("2026-08-03T06:33:00.000Z");
    for (const value of [
      reading(),
      reading({ capturedAt: "2026-08-03T06:32:30.000Z", mocked: true }),
      reading({ capturedAt: "2026-08-03T06:32:30.000Z", accuracy: 101 }),
    ]) {
      expect(() => validateGPS(value, { now })).toThrow(GPSValidationError);
    }
  });

  it("reports a practical accuracy limit when accuracy is missing", () => {
    expect(() =>
      validateGPS(reading({ accuracy: undefined }), {
        now: Date.parse("2026-08-03T06:31:00.000Z"),
      }),
    ).toThrow("GPS accuracy must be 100 metres or better");
  });
});
