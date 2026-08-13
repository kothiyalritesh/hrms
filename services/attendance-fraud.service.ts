import { supabase } from "@/lib/supabase";

export interface AttendanceLocationEvidence {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  mocked?: boolean;
  developerMode?: boolean;
  ipLatitude?: number | null;
  ipLongitude?: number | null;
}

export const AttendanceFraudService = {
  async analyze(params: {
    userId: string;
    attendanceId: string;
    eventType: "CHECKIN" | "CHECKOUT";
    location: AttendanceLocationEvidence;
    officeDistance?: number | null;
  }) {
    const { data, error } = await supabase.rpc("rpc_analyze_attendance_fraud", {
      p_user_id: params.userId,
      p_attendance_id: params.attendanceId,
      p_event_type: params.eventType,
      p_latitude: params.location.latitude,
      p_longitude: params.location.longitude,
      p_accuracy_m: params.location.accuracy ?? null,
      p_is_mocked: params.location.mocked ?? false,
      p_developer_mode: params.location.developerMode ?? false,
      p_ip_latitude: params.location.ipLatitude ?? null,
      p_ip_longitude: params.location.ipLongitude ?? null,
      p_office_distance_m: params.officeDistance ?? null,
    });
    if (error) throw error;
    return data;
  },
};
