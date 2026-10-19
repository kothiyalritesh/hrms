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

export type GpsQualityStatus = "HIGH" | "MEDIUM" | "LOW" | "STALE" | "UNKNOWN" | string;
export type TrackingHealthStatus = "ACTIVE" | "DELAYED" | "STALE" | "COMPLETED" | string;
export type TrackingTelemetrySource = "GPS" | "NETWORK" | "FUSED" | "MOCK" | string;

export interface SiteVisitObserverVisit {
  visit_id: string;
  status: string;
  location_name: string | null;
  project_name: string | null;
  checkin_time: string | null;
  checkout_time: string | null;
  visit_type: string | null;
  destination_lat: number | null;
  destination_lon: number | null;
  client_name: string | null;
  client_phone: string | null;
  radius_m?: number | null;
  verification_status?: "PENDING" | "APPROVED" | "REJECTED" | "NEEDS_INFORMATION" | "FLAGGED" | null;
  risk_flags?: string[];
  reviewer_notes?: string | null;
  reviewed_at?: string | null;
  evidence_photo_path?: string | null;
  checkout_notes?: string | null;
  checkout_distance_m?: number | null;
  arrived_at?: string | null;
  departed_at?: string | null;
  auto_closed?: boolean;
  last_ping_at?: string | null;
}

export interface SiteVisitObserverEmployee {
  employee_id: string;
  name: string;
  employee_no: string | null;
  role: string | null;
  department: string | null;
  office_name: string | null;
  tracking: {
    status: string;
    signal_status: string;
    tracking_health: TrackingHealthStatus;
    gps_quality: GpsQualityStatus;
    latitude: number | null;
    longitude: number | null;
    accuracy: number | null;
    battery_level: number | null;
    speed_mps: number | null;
    source: TrackingTelemetrySource | null;
    last_location_at: string | null;
    last_uploaded_at: string | null;
    pending_ping_count: number;
    updated_at: string | null;
  };
  visits: SiteVisitObserverVisit[];
  flagged_count?: number;
  latest_lat: number | null;
  latest_lon: number | null;
  tracking_status: string;
  updated_at: string | null;
}

export interface SiteVisitObserverSummary {
  total_visits: number;
  in_transit: number;
  at_site: number;
  completed: number;
  signal_lost: number;
  missed?: number;
  flagged?: number;
  to_review?: number;
}

export interface SiteVisitObserverData {
  date: string;
  mode: "LIVE" | "HISTORICAL";
  is_live: boolean;
  summary: SiteVisitObserverSummary;
  employees: SiteVisitObserverEmployee[];
}
