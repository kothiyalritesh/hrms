import {
  Destination,
  JourneyRuntimeState,
  JourneyTransitionResult,
  LocationQuality,
  RouteProgress,
  TrackingLocation,
} from "@/services/location/types";

const EARTH_RADIUS_M = 6_371_000;
const MAX_RELIABLE_ACCURACY_M = 100;
const MAX_LOCATION_AGE_MS = 2 * 60 * 1000;
const MAX_PLAUSIBLE_SPEED_MPS = 70;
const INDIA_BOUNDS = {
  latitudeMin: 6.5,
  latitudeMax: 37.6,
  longitudeMin: 68,
  longitudeMax: 97.5,
};

export function haversineDistanceM(
  latitude1: number,
  longitude1: number,
  latitude2: number,
  longitude2: number,
): number {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const deltaLatitude = toRadians(latitude2 - latitude1);
  const deltaLongitude = toRadians(longitude2 - longitude1);
  const firstLatitude = toRadians(latitude1);
  const secondLatitude = toRadians(latitude2);
  const haversine =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(firstLatitude) *
      Math.cos(secondLatitude) *
      Math.sin(deltaLongitude / 2) ** 2;
  return (
    EARTH_RADIUS_M *
    2 *
    Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  );
}

export function createJourneyState(journeyId: string): JourneyRuntimeState {
  return {
    journeyId,
    status: "TRAVELLING",
    initialized: false,
    reached1km: false,
    reached500m: false,
    arrived: false,
    departed: false,
    arrivalConfirmations: 0,
    departureConfirmations: 0,
    lastReliableDistanceM: null,
    lastReliableApproachDistanceM: null,
    lastReliableLocation: null,
  };
}

export function classifyLocationQuality(
  location: TrackingLocation,
  previousReliableLocation: TrackingLocation | null,
  nowMs = Date.now(),
): LocationQuality {
  if (
    !Number.isFinite(location.latitude) ||
    !Number.isFinite(location.longitude) ||
    location.latitude < -90 ||
    location.latitude > 90 ||
    location.longitude < -180 ||
    location.longitude > 180
  ) {
    return "GPS_UNAVAILABLE";
  }
  if (location.mocked) return "MOCKED";
  if (
    location.latitude < INDIA_BOUNDS.latitudeMin ||
    location.latitude > INDIA_BOUNDS.latitudeMax ||
    location.longitude < INDIA_BOUNDS.longitudeMin ||
    location.longitude > INDIA_BOUNDS.longitudeMax
  ) {
    return "OUTSIDE_ALLOWED_REGION";
  }
  const capturedAtMs = Date.parse(location.capturedAt);
  if (
    !Number.isFinite(capturedAtMs) ||
    capturedAtMs > nowMs + 30_000 ||
    nowMs - capturedAtMs > MAX_LOCATION_AGE_MS
  ) {
    return "STALE";
  }
  if (
    location.accuracy == null ||
    location.accuracy < 0 ||
    location.accuracy > MAX_RELIABLE_ACCURACY_M
  ) {
    return "LOW_ACCURACY";
  }
  if (previousReliableLocation) {
    const elapsedSeconds =
      (capturedAtMs - Date.parse(previousReliableLocation.capturedAt)) / 1000;
    if (elapsedSeconds >= 5) {
      const travelledM = haversineDistanceM(
        previousReliableLocation.latitude,
        previousReliableLocation.longitude,
        location.latitude,
        location.longitude,
      );
      if (travelledM / elapsedSeconds > MAX_PLAUSIBLE_SPEED_MPS) {
        return "IMPOSSIBLE_SPEED";
      }
    }
  }
  return "RELIABLE";
}

export function advanceJourney(
  currentState: JourneyRuntimeState,
  destination: Destination,
  location: TrackingLocation,
  nowMs = Date.now(),
  routeProgress: RouteProgress | null = null,
): JourneyTransitionResult {
  const state =
    currentState.journeyId === destination.journeyId
      ? { ...currentState }
      : createJourneyState(destination.journeyId);
  const quality = classifyLocationQuality(
    location,
    state.lastReliableLocation,
    nowMs,
  );
  if (quality !== "RELIABLE") {
    return { state, quality, distanceM: null, events: [] };
  }

  const distanceM = haversineDistanceM(
    location.latitude,
    location.longitude,
    destination.latitude,
    destination.longitude,
  );
  const previousDistance = state.lastReliableDistanceM;
  const approachDistanceM =
    routeProgress?.destinationJourneyId === destination.journeyId
      ? routeProgress.distanceM
      : distanceM;
  const previousApproachDistance =
    state.lastReliableApproachDistanceM ?? previousDistance;
  const routeDurationSeconds =
    routeProgress?.destinationJourneyId === destination.journeyId
      ? routeProgress.durationSeconds
      : null;
  const isWithin1km =
    approachDistanceM <= 1_000 ||
    (routeDurationSeconds != null && routeDurationSeconds <= 5 * 60);
  const isAboutToArrive =
    approachDistanceM <= 500 ||
    (routeDurationSeconds != null && routeDurationSeconds <= 3 * 60);
  const events: JourneyTransitionResult["events"] = [];
  const wasInitialized = state.initialized;
  const arrivalAccuracyLimit = Math.max(
    50,
    Math.min(destination.arrivalRadiusM, 100),
  );
  const isArrivalQuality =
    location.accuracy != null && location.accuracy <= arrivalAccuracyLimit;

  if (!wasInitialized) {
    state.initialized = true;
    if (distanceM <= destination.arrivalRadiusM) {
      state.reached1km = true;
      state.reached500m = true;
      state.arrivalConfirmations = isArrivalQuality ? 1 : 0;
      state.status = "ARRIVAL_PENDING_CONFIRMATION";
    } else if (isAboutToArrive) {
      state.reached1km = true;
      state.reached500m = true;
      state.status = "APPROACHING_500M";
      events.push("ENTERED_500M");
    } else if (isWithin1km) {
      state.reached1km = true;
      state.status = "APPROACHING_1KM";
      events.push("ENTERED_1KM");
    }
  } else if (!state.arrived) {
    if (
      !state.reached500m &&
      previousApproachDistance != null &&
      (previousApproachDistance > 600 ||
        (routeDurationSeconds != null && routeDurationSeconds <= 3 * 60)) &&
      isAboutToArrive
    ) {
      state.reached1km = true;
      state.reached500m = true;
      state.status = "APPROACHING_500M";
      events.push("ENTERED_500M");
    } else if (
      !state.reached1km &&
      previousApproachDistance != null &&
      (previousApproachDistance > 1_100 ||
        (routeDurationSeconds != null && routeDurationSeconds <= 5 * 60)) &&
      isWithin1km
    ) {
      state.reached1km = true;
      state.status = "APPROACHING_1KM";
      events.push("ENTERED_1KM");
    }
  }

  if (
    !state.arrived &&
    distanceM <= destination.arrivalRadiusM &&
    isArrivalQuality
  ) {
    if (wasInitialized) {
      state.reached1km = true;
      state.reached500m = true;
      state.arrivalConfirmations += 1;
      state.status = "ARRIVAL_PENDING_CONFIRMATION";
      if (state.arrivalConfirmations >= 2) {
        state.arrived = true;
        state.status = "ARRIVED";
        events.length = 0;
        events.push("ARRIVED");
      }
    }
  } else if (!state.arrived) {
    state.arrivalConfirmations = 0;
  }

  const departureBoundaryM = destination.arrivalRadiusM + 100;
  if (state.arrived && !state.departed && distanceM > departureBoundaryM) {
    state.departureConfirmations += 1;
    if (state.departureConfirmations >= 2) {
      state.departed = true;
      state.status = "DEPARTED";
      events.push("DEPARTED");
    }
  } else if (state.arrived && !state.departed) {
    state.departureConfirmations = 0;
  }

  state.lastReliableDistanceM = distanceM;
  state.lastReliableApproachDistanceM = approachDistanceM;
  state.lastReliableLocation = location;
  return { state, quality, distanceM, events };
}
