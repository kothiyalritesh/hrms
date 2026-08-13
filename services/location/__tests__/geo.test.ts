import {
  advanceJourney,
  classifyLocationQuality,
  createJourneyState,
  haversineDistanceM,
} from "@/services/location/geo";
import { Destination, TrackingLocation } from "@/services/location/types";

const destination: Destination = {
  fieldVisitId: "visit-1",
  journeyId: "journey-1",
  visitDate: "2026-07-25",
  name: "Test Site",
  latitude: 28.6139,
  longitude: 77.209,
  arrivalRadiusM: 100,
};

function locationAtDistance(
  distanceM: number,
  overrides: Partial<TrackingLocation> = {},
): TrackingLocation {
  return {
    clientEventId: `event-${distanceM}-${Math.random()}`,
    latitude: destination.latitude + distanceM / 111_320,
    longitude: destination.longitude,
    accuracy: 15,
    altitude: null,
    heading: null,
    speed: null,
    mocked: false,
    capturedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("location geometry and journey state", () => {
  test("calculates Haversine distance", () => {
    const distance = haversineDistanceM(28.6139, 77.209, 28.6148, 77.209);
    expect(distance).toBeGreaterThan(95);
    expect(distance).toBeLessThan(105);
  });

  test("fires the 1 km threshold once with hysteresis", () => {
    let state = createJourneyState(destination.journeyId);
    state = advanceJourney(state, destination, locationAtDistance(1_200)).state;
    const entered = advanceJourney(state, destination, locationAtDistance(990));
    expect(entered.events).toEqual(["ENTERED_1KM"]);
    const repeated = advanceJourney(
      entered.state,
      destination,
      locationAtDistance(1_200),
    );
    const reentered = advanceJourney(
      repeated.state,
      destination,
      locationAtDistance(990),
    );
    expect(reentered.events).not.toContain("ENTERED_1KM");
  });

  test("fires the 500 m threshold once and satisfies 1 km", () => {
    let state = createJourneyState(destination.journeyId);
    state = advanceJourney(state, destination, locationAtDistance(700)).state;
    const result = advanceJourney(state, destination, locationAtDistance(490));
    expect(result.events).toEqual(["ENTERED_500M"]);
    expect(result.state.reached1km).toBe(true);
    expect(result.state.reached500m).toBe(true);
  });

  test("uses traffic-aware ETA for the about-to-arrive alert", () => {
    let state = createJourneyState(destination.journeyId);
    state = advanceJourney(
      state,
      destination,
      locationAtDistance(2_000),
      Date.now(),
      {
        destinationJourneyId: destination.journeyId,
        distanceM: 2_500,
        durationSeconds: 420,
        calculatedAt: new Date().toISOString(),
        originLatitude: destination.latitude,
        originLongitude: destination.longitude,
      },
    ).state;
    const result = advanceJourney(
      state,
      destination,
      locationAtDistance(1_500),
      Date.now(),
      {
        destinationJourneyId: destination.journeyId,
        distanceM: 1_100,
        durationSeconds: 175,
        calculatedAt: new Date().toISOString(),
        originLatitude: destination.latitude,
        originLongitude: destination.longitude,
      },
    );
    expect(result.events).toEqual(["ENTERED_500M"]);
    expect(result.state.status).toBe("APPROACHING_500M");
  });

  test("requires two reliable arrival readings", () => {
    let state = createJourneyState(destination.journeyId);
    const first = advanceJourney(state, destination, locationAtDistance(80));
    expect(first.events).toEqual([]);
    expect(first.state.status).toBe("ARRIVAL_PENDING_CONFIRMATION");
    const second = advanceJourney(
      first.state,
      destination,
      locationAtDistance(70),
    );
    expect(second.events).toEqual(["ARRIVED"]);
    expect(second.state.arrived).toBe(true);
  });

  test("uses departure hysteresis and two readings", () => {
    let state = createJourneyState(destination.journeyId);
    state = advanceJourney(state, destination, locationAtDistance(70)).state;
    state = advanceJourney(state, destination, locationAtDistance(60)).state;
    const firstOutside = advanceJourney(
      state,
      destination,
      locationAtDistance(220),
    );
    expect(firstOutside.events).toEqual([]);
    const secondOutside = advanceJourney(
      firstOutside.state,
      destination,
      locationAtDistance(230),
    );
    expect(secondOutside.events).toContain("DEPARTED");
  });

  test("journey starting inside 500 m sends only 500 m", () => {
    const result = advanceJourney(
      createJourneyState(destination.journeyId),
      destination,
      locationAtDistance(450),
    );
    expect(result.events).toEqual(["ENTERED_500M"]);
  });

  test("destination change resets threshold state", () => {
    const oldState = {
      ...createJourneyState("old"),
      initialized: true,
      reached1km: true,
    };
    const result = advanceJourney(
      oldState,
      destination,
      locationAtDistance(450),
    );
    expect(result.state.journeyId).toBe(destination.journeyId);
    expect(result.events).toEqual(["ENTERED_500M"]);
  });

  test("rejects low accuracy and mocked readings", () => {
    expect(
      classifyLocationQuality(locationAtDistance(100, { accuracy: 500 }), null),
    ).toBe("LOW_ACCURACY");
    expect(
      classifyLocationQuality(locationAtDistance(100, { mocked: true }), null),
    ).toBe("MOCKED");
  });
});
