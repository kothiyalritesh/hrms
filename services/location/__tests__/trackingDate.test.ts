import {
  getTrackingDateIST,
  isDestinationForToday,
} from "@/services/location/trackingDate";
import { Destination } from "@/services/location/types";

const destination: Destination = {
  fieldVisitId: "visit-1",
  journeyId: "visit-1",
  visitDate: "2026-07-25",
  name: "Project site",
  latitude: 28.6139,
  longitude: 77.209,
  arrivalRadiusM: 100,
};

describe("trackingDate", () => {
  it("uses the IST calendar date across the UTC day boundary", () => {
    expect(getTrackingDateIST(new Date("2026-07-24T20:00:00.000Z"))).toBe(
      "2026-07-25",
    );
  });

  it("accepts only a destination belonging to the current IST date", () => {
    const now = new Date("2026-07-25T06:00:00.000Z");
    expect(isDestinationForToday(destination, now)).toBe(true);
    expect(
      isDestinationForToday({ ...destination, visitDate: "2026-07-24" }, now),
    ).toBe(false);
  });

  it("rejects legacy cached destinations that have no visit date", () => {
    const legacyDestination = {
      fieldVisitId: destination.fieldVisitId,
      journeyId: destination.journeyId,
      name: destination.name,
      latitude: destination.latitude,
      longitude: destination.longitude,
      arrivalRadiusM: destination.arrivalRadiusM,
    } as Destination;
    expect(
      isDestinationForToday(
        legacyDestination,
        new Date("2026-07-25T06:00:00.000Z"),
      ),
    ).toBe(false);
  });
});
