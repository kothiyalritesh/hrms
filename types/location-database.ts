import { JourneyStatus, LocationQuality } from "@/services/location/types";

export interface TrackingSessionRow {
  id: string;
  user_id: string;
  attendance_log_id: string;
  started_at: string;
  stopped_at: string | null;
  status: "ACTIVE" | "STOPPED" | "INTERRUPTED";
  start_reason: string;
  stop_reason: string | null;
  last_location_at: string | null;
  last_accuracy_m: number | null;
  native_task_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface JourneyEventRow {
  id: string;
  tracking_session_id: string | null;
  attendance_log_id: string | null;
  field_visit_id: string | null;
  user_id: string;
  event_type:
    | "JOURNEY_STARTED"
    | "ENTERED_1KM"
    | "ENTERED_500M"
    | "ARRIVED"
    | "SITE_CHECKED_IN"
    | "DEPARTED"
    | "COMPLETED"
    | "GPS_OFF"
    | "PERMISSION_REVOKED"
    | "LOCATION_STALE";
  distance_m: number | null;
  latitude: number | null;
  longitude: number | null;
  accuracy_m: number | null;
  occurred_at: string;
  client_event_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface DevicePushTokenRow {
  id: string;
  user_id: string;
  token: string;
  platform: "android" | "ios";
  device_id: string;
  app_version: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
}

export interface LocationTrackingAdditions {
  tracking_session_id: string | null;
  field_visit_id: string | null;
  altitude: number | null;
  heading: number | null;
  speed: number | null;
  mocked: boolean;
  provider: string | null;
  client_event_id: string | null;
  sync_source: "NATIVE" | "OFFLINE_SYNC";
  quality_status: LocationQuality;
  received_at: string;
}

export interface FieldVisitJourneyAdditions {
  journey_status: JourneyStatus;
  tracking_started_at: string | null;
  approach_1km_notified_at: string | null;
  approach_500m_notified_at: string | null;
  arrived_at: string | null;
  departed_at: string | null;
  last_distance_m: number | null;
  last_distance_at: string | null;
  arrival_confirmation_count: number;
  departure_confirmation_count: number;
}
