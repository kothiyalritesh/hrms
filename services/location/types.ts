export type JourneyStatus =
  | "NO_DESTINATION"
  | "TRAVELLING"
  | "APPROACHING_1KM"
  | "APPROACHING_500M"
  | "ARRIVAL_PENDING_CONFIRMATION"
  | "ARRIVED"
  | "SITE_CHECKED_IN"
  | "DEPARTED"
  | "COMPLETED"
  | "CANCELLED";

export type LocationQuality =
  | "RELIABLE"
  | "LOW_ACCURACY"
  | "STALE"
  | "MOCKED"
  | "IMPOSSIBLE_SPEED"
  | "OUTSIDE_ALLOWED_REGION"
  | "GPS_UNAVAILABLE";

export type JourneyEventType =
  | "ENTERED_1KM"
  | "ENTERED_500M"
  | "ARRIVED"
  | "DEPARTED";

export interface Destination {
  fieldVisitId: string;
  journeyId: string;
  visitDate: string;
  name: string;
  latitude: number;
  longitude: number;
  arrivalRadiusM: number;
}

export interface TrackingLocation {
  clientEventId: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  altitude: number | null;
  heading: number | null;
  speed: number | null;
  mocked: boolean;
  capturedAt: string;
}

export interface JourneyRuntimeState {
  journeyId: string;
  status: JourneyStatus;
  initialized: boolean;
  reached1km: boolean;
  reached500m: boolean;
  arrived: boolean;
  departed: boolean;
  arrivalConfirmations: number;
  departureConfirmations: number;
  lastReliableDistanceM: number | null;
  lastReliableApproachDistanceM: number | null;
  lastReliableLocation: TrackingLocation | null;
}

export interface RouteProgress {
  destinationJourneyId: string;
  distanceM: number;
  durationSeconds: number;
  calculatedAt: string;
  originLatitude: number;
  originLongitude: number;
}

export interface DrivingRoute extends RouteProgress {
  encodedPolyline: string | null;
}

export interface JourneyTransitionResult {
  state: JourneyRuntimeState;
  quality: LocationQuality;
  distanceM: number | null;
  events: JourneyEventType[];
}

export interface ActiveTrackingConfig {
  userId: string;
  userName: string;
  attendanceId: string;
  trackingSessionId: string | null;
  baseLatitude: number | null;
  baseLongitude: number | null;
  officeId: string | null;
  officeRadiusM: number;
  destination: Destination | null;
  journeyState: JourneyRuntimeState | null;
  routeProgress: RouteProgress | null;
  lastSuccessfulLocationAt: string | null;
  lastAccuracyM: number | null;
  trackingStartedAt: string;
  /** Difference between the server clock and device Date.now(). */
  serverClockOffsetMs?: number;
  trackingMode: "ATTENDANCE" | "DISTANT" | "FAR" | "NEAR" | "ARRIVED";
}

export interface TrackingHealth {
  platformSupported: boolean;
  notificationsGranted: boolean;
  foregroundLocationGranted: boolean;
  preciseLocationGranted: boolean;
  backgroundLocationGranted: boolean;
  locationServicesEnabled: boolean;
  nativeTaskRegistered: boolean;
  nativeTaskActive: boolean;
  trackingActive: boolean;
  activeAttendanceId: string | null;
  activeDestinationName: string | null;
  journeyStatus: JourneyStatus;
  routeDistanceM: number | null;
  routeDurationSeconds: number | null;
  routeUpdatedAt: string | null;
  lastLocationAt: string | null;
  lastAccuracyM: number | null;
  warning: string | null;
}

export interface OfflineLocationPing {
  config: Pick<ActiveTrackingConfig, "attendanceId" | "trackingSessionId"> & {
    fieldVisitId: string | null;
  };
  location: TrackingLocation;
  qualityStatus: LocationQuality;
}
