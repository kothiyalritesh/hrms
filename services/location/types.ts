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
  /** null while travelling to a field visit before any check-in. */
  attendanceId: string | null;
  trackingSessionId: string | null;
  baseLatitude: number | null;
  baseLongitude: number | null;
  officeRadiusM: number;
  destination: Destination | null;
  journeyState: JourneyRuntimeState | null;
  routeProgress: RouteProgress | null;
  /** Last RELIABLE fix (accuracy ≤ 100 m, fresh). */
  lastSuccessfulLocationAt: string | null;
  /**
   * Last fix of any accuracy with valid coordinates (e.g. LOW_ACCURACY
   * indoors). Proves the native service is delivering fixes.
   */
  lastFixAt?: string | null;
  lastAccuracyM: number | null;
  trackingStartedAt: string;
  /** Difference between the server clock and device Date.now(). */
  serverClockOffsetMs?: number;
  trackingMode: "ATTENDANCE" | "DISTANT" | "FAR" | "NEAR" | "ARRIVED";
  /** Options the running native service was started with (see trackingOptionsKey). */
  appliedOptionsKey?: string;
  /** Last fix actually sent to the server (stationary throttle). */
  lastSentAt?: string | null;
  lastSentLatitude?: number | null;
  lastSentLongitude?: number | null;
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
  /** A location-tracking problem only (never notification permission). */
  warning: string | null;
  warningCode: TrackingWarningCode | null;
  /** Notification permission advice; not a tracking problem. */
  notificationHint: string | null;
  /** The employee is checked in or travelling to a visit, so tracking should run. */
  trackingExpected: boolean;
}

export type TrackingWarningCode =
  | "LOCATION_DENIED"
  | "APPROXIMATE"
  | "BACKGROUND_DENIED"
  | "GPS_OFF"
  | "TASK_NOT_RUNNING"
  | "STALE";

export interface OfflineLocationPing {
  config: Pick<ActiveTrackingConfig, "attendanceId" | "trackingSessionId"> & {
    fieldVisitId: string | null;
  };
  location: TrackingLocation;
  qualityStatus: LocationQuality;
}
