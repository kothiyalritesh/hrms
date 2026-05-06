import { supabase } from "@/lib/supabase";

export type LocationStatus = "IN_ZONE" | "OUT_OF_BOUND" | "WARNING";
export type SessionState =
  | "NO_SESSION"
  | "CHECKED_IN"
  | "ACTIVE"
  | "OUT_OF_BOUND"
  | "WARNING"
  | "RETURNED"
  | "CHECKED_OUT";

export interface LocationLog {
  id: string;
  user_id: string;
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: string;
  status: LocationStatus;
  distance_m: number;
  office_id?: string;
  session_date: string;
  address?: string;
  employee?: { name: string };
}

export interface LocationViolation {
  id: string;
  user_id: string;
  office_id?: string;
  distance_m: number;
  latitude: number;
  longitude: number;
  violated_at: string;
  resolved_at?: string;
  resolution?: string;
  session_date: string;
  escalated: boolean;
  employee?: { name: string };
  office?: { name: string };
}

export interface ComplianceReport {
  user_id: string;
  employee_name: string;
  session_date: string;
  checkin_time?: string;
  checkout_time?: string;
  total_duration_mins: number;
  time_in_zone_mins: number;
  time_out_zone_mins: number;
  violation_count: number;
  compliance_pct: number;
  gps_trail: { lat: number; lon: number; ts: string; status: string }[];
}

/** Haversine distance in metres */
export function haversineM(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

/** Reverse geocode: lat/lon → readable address string */
export async function reverseGeocode(lat: number, lon: number): Promise<string> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`,
      { headers: { "Accept-Language": "en", "User-Agent": "RealtyHRMS/1.0" } }
    );
    const data = await res.json();
    const a = data.address || {};
    const parts = [
      a.road || a.pedestrian || a.suburb,
      a.neighbourhood || a.city_district,
      a.city || a.town || a.village,
    ].filter(Boolean);
    return parts.join(", ") || data.display_name?.split(",").slice(0, 2).join(",") || `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  } catch {
    return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  }
}

export const LocationService = {
  /** Log a heartbeat ping from the user's device */
  async logHeartbeat(params: {
    userId: string;
    latitude: number;
    longitude: number;
    accuracy: number;
    officeId: string;
    officeLat: number;
    officeLon: number;
    officeRadius: number;
    minsOutside?: number;
  }): Promise<{ status: LocationStatus; distanceM: number }> {
    const distanceM = haversineM(
      params.officeLat, params.officeLon,
      params.latitude, params.longitude
    );

    // Apply fuzzy tolerance: ignore GPS drift ±30m
    const effectiveRadius = params.officeRadius + 30;
    const isOutside = distanceM > effectiveRadius;

    // WARNING = outside AND has been outside ≥5 min
    const minsOut = params.minsOutside ?? 0;
    const status: LocationStatus = !isOutside
      ? "IN_ZONE"
      : minsOut >= 5
      ? "WARNING"
      : "OUT_OF_BOUND";

    const today = new Date().toISOString().split("T")[0];

    // Reverse geocode only when outside zone or moved significantly — avoids Nominatim rate limit
    let address: string | undefined;
    if (isOutside) {
      try {
        address = await reverseGeocode(params.latitude, params.longitude);
      } catch { /* ignore */ }
    }

    await supabase.from("user_location_logs").insert({
      user_id: params.userId,
      latitude: params.latitude,
      longitude: params.longitude,
      accuracy: params.accuracy,
      timestamp: new Date().toISOString(),
      status,
      distance_m: distanceM,
      office_id: params.officeId,
      session_date: today,
      address,
    });

    // Keep one unresolved violation event open while the user remains outside.
    if (isOutside) {
      const { data: openViolation } = await supabase
        .from("location_violations")
        .select("id")
        .eq("user_id", params.userId)
        .eq("session_date", today)
        .is("resolved_at", null)
        .maybeSingle();

      if (openViolation?.id) {
        await supabase
          .from("location_violations")
          .update({
            distance_m: distanceM,
            latitude: params.latitude,
            longitude: params.longitude,
          })
          .eq("id", openViolation.id);
      } else {
        await supabase.from("location_violations").insert({
          user_id: params.userId,
          office_id: params.officeId,
          distance_m: distanceM,
          latitude: params.latitude,
          longitude: params.longitude,
          violated_at: new Date().toISOString(),
          session_date: today,
        });
      }
    }

    return { status, distanceM };
  },

  /** Derive the high-level session lifecycle state for a user */
  async getSessionState(userId: string): Promise<SessionState> {
    const today = new Date().toISOString().split("T")[0];
    const [attRes, violationRes, latestLogRes] = await Promise.all([
      supabase
        .from("attendance_logs")
        .select("checkin_time, checkout_time")
        .eq("user_id", userId)
        .eq("date", today)
        .maybeSingle(),
      supabase
        .from("location_violations")
        .select("escalated")
        .eq("user_id", userId)
        .eq("session_date", today)
        .is("resolved_at", null)
        .maybeSingle(),
      supabase
        .from("user_location_logs")
        .select("status")
        .eq("user_id", userId)
        .eq("session_date", today)
        .order("timestamp", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const att = attRes.data;
    if (!att?.checkin_time) return "NO_SESSION";
    if (att.checkout_time) return "CHECKED_OUT";

    const openViolation = violationRes.data;
    if (openViolation) return openViolation.escalated ? "WARNING" : "OUT_OF_BOUND";

    const latestStatus = latestLogRes.data?.status;
    return latestStatus === "IN_ZONE" ? "ACTIVE" : "RETURNED";
  },

  /** Mark the active warning as acknowledged while keeping it open for return/escalation. */
  async acknowledgeViolation(userId: string) {
    const today = new Date().toISOString().split("T")[0];
    await supabase
      .from("location_violations")
      .update({ resolution: "acknowledged" })
      .eq("user_id", userId)
      .eq("session_date", today)
      .is("resolved_at", null);
  },

  /** Resolve a violation (user returned or checked out) */
  async resolveViolation(
    userId: string,
    resolution: "returned" | "checked_out"
  ) {
    const today = new Date().toISOString().split("T")[0];
    await supabase
      .from("location_violations")
      .update({ resolved_at: new Date().toISOString(), resolution })
      .eq("user_id", userId)
      .eq("session_date", today)
      .is("resolved_at", null);
  },

  /** Get today's live location for all active users (admin)
   * Falls back to attendance_logs so checked-in employees always appear
   * even before their first GPS heartbeat fires.
   */
  async getLiveLocations(): Promise<LocationLog[]> {
    const today = new Date().toISOString().split("T")[0];

    // 1. All employees checked in today
    const { data: checkedIn } = await supabase
      .from("attendance_logs")
      .select("user_id, checkin_time, checkin_location, office_id, profiles:user_id(name)")
      .eq("date", today)
      .not("checkin_time", "is", null);

    if (!checkedIn || checkedIn.length === 0) return [];

    // 2. Latest GPS ping per user
    const { data: gpsPings } = await supabase
      .from("user_location_logs")
      .select("*, employee:user_id(name)")
      .eq("session_date", today)
      .order("timestamp", { ascending: false })
      .limit(500);

    // Deduplicate GPS pings — keep only latest per user
    const latestPing = new Map<string, any>();
    for (const ping of gpsPings || []) {
      if (!latestPing.has(ping.user_id)) latestPing.set(ping.user_id, ping);
    }

    // 3. Merge: every checked-in employee gets a row
    return checkedIn.map((att: any) => {
      const ping = latestPing.get(att.user_id);
      if (ping) return ping as LocationLog;

      // No GPS ping yet — synthesise a row from check-in location
      const loc = att.checkin_location as { latitude: number; longitude: number } | null;
      return {
        id: `att-${att.user_id}`,
        user_id: att.user_id,
        latitude: loc?.latitude ?? 0,
        longitude: loc?.longitude ?? 0,
        accuracy: 0,
        timestamp: att.checkin_time,
        status: "IN_ZONE" as const,
        distance_m: 0,
        office_id: att.office_id,
        session_date: today,
        address: undefined,
        employee: { name: (att.profiles as any)?.name || "Unknown" },
        _noGps: true,
      } as any;
    });
  },

  /** Get GPS trail for a user on a specific date */
  async getGPSTrail(userId: string, date: string): Promise<LocationLog[]> {
    const { data } = await supabase
      .from("user_location_logs")
      .select("*")
      .eq("user_id", userId)
      .eq("session_date", date)
      .order("timestamp", { ascending: true });
    return (data || []) as LocationLog[];
  },

  /** Get violations for a date range */
  async getViolations(params: {
    date?: string;
    userId?: string;
  }): Promise<LocationViolation[]> {
    const date = params.date || new Date().toISOString().split("T")[0];
    let q = supabase
      .from("location_violations")
      .select("*, employee:user_id(name), office:office_id(name)")
      .eq("session_date", date)
      .order("violated_at", { ascending: false });
    if (params.userId) q = q.eq("user_id", params.userId);
    const { data } = await q;
    return (data || []) as LocationViolation[];
  },

  /** Generate compliance report for a user on a date */
  async getComplianceReport(userId: string, date: string): Promise<ComplianceReport | null> {
    const [logsRes, attRes, profileRes] = await Promise.all([
      supabase.from("user_location_logs").select("*").eq("user_id", userId).eq("session_date", date).order("timestamp", { ascending: true }),
      supabase.from("attendance_logs").select("checkin_time, checkout_time").eq("user_id", userId).eq("date", date).maybeSingle(),
      supabase.from("profiles").select("name").eq("id", userId).single(),
    ]);

    const logs = (logsRes.data || []) as LocationLog[];
    const att = attRes.data;
    const name = profileRes.data?.name || "Unknown";

    if (logs.length === 0) return null;

    const checkinTime = att?.checkin_time;
    const checkoutTime = att?.checkout_time;

    // Calculate time in/out zone from consecutive log pairs
    let inZoneMins = 0;
    let outZoneMins = 0;
    for (let i = 0; i < logs.length - 1; i++) {
      const gap = (new Date(logs[i + 1].timestamp).getTime() - new Date(logs[i].timestamp).getTime()) / 60000;
      if (logs[i].status === "IN_ZONE") inZoneMins += gap;
      else outZoneMins += gap;
    }

    const totalMins = inZoneMins + outZoneMins;
    const violationCount = logs.filter((l) => l.status === "OUT_OF_BOUND" || l.status === "WARNING").length;
    const compliancePct = totalMins > 0 ? Math.round((inZoneMins / totalMins) * 100) : 100;

    return {
      user_id: userId,
      employee_name: name,
      session_date: date,
      checkin_time: checkinTime,
      checkout_time: checkoutTime,
      total_duration_mins: Math.round(totalMins),
      time_in_zone_mins: Math.round(inZoneMins),
      time_out_zone_mins: Math.round(outZoneMins),
      violation_count: violationCount,
      compliance_pct: compliancePct,
      gps_trail: logs.map((l) => ({
        lat: l.latitude,
        lon: l.longitude,
        ts: l.timestamp,
        status: l.status,
      })),
    };
  },

  /** Get compliance reports for all employees on a date */
  async getAllComplianceReports(date: string): Promise<ComplianceReport[]> {
    const { data: users } = await supabase
      .from("user_location_logs")
      .select("user_id")
      .eq("session_date", date);

    if (!users) return [];
    const uniqueIds = [...new Set(users.map((u: any) => u.user_id))];
    const reports = await Promise.all(uniqueIds.map((id) => LocationService.getComplianceReport(id, date)));
    return reports.filter(Boolean) as ComplianceReport[];
  },

  /** Export compliance report as printable HTML (open in browser → Print → Save as PDF) */
  exportHTML(reports: ComplianceReport[], date: string): string {
    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const fmt = (v?: string) =>
      v ? new Date(v).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";
    const rows = reports
      .map(
        (r) =>
          `<tr>
            <td>${esc(r.employee_name)}</td><td>${esc(r.session_date)}</td>
            <td>${fmt(r.checkin_time)}</td><td>${fmt(r.checkout_time)}</td>
            <td>${r.total_duration_mins} min</td><td>${r.time_in_zone_mins} min</td>
            <td>${r.time_out_zone_mins} min</td><td>${r.violation_count}</td>
            <td style="color:${r.compliance_pct >= 90 ? "#10B981" : "#F59E0B"};font-weight:700">${r.compliance_pct}%</td>
          </tr>`,
      )
      .join("");
    return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<title>Location Compliance — ${date}</title>
<style>
  body{font-family:Arial,sans-serif;padding:24px;color:#111}
  h1{font-size:20px;margin-bottom:4px}
  p{color:#6B7280;font-size:13px;margin-bottom:20px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{background:#60045d;color:#fff;padding:8px 10px;text-align:left}
  td{padding:7px 10px;border-bottom:1px solid #E5E7EB}
  tr:nth-child(even) td{background:#FAF5FA}
  @media print{body{padding:0}}
</style></head><body>
<h1>📍 Location Compliance Report</h1>
<p>Date: ${date} &nbsp;|&nbsp; Generated: ${new Date().toLocaleString()}</p>
<table><thead><tr>
  <th>Employee</th><th>Date</th><th>Check In</th><th>Check Out</th>
  <th>Total</th><th>In Zone</th><th>Out Zone</th><th>Violations</th><th>Compliance</th>
</tr></thead><tbody>${rows}</tbody></table>
</body></html>`;
  },

  /** Export compliance report as CSV string */
  exportCSV(reports: ComplianceReport[]): string {
    const headers = [
      "Employee", "Date", "Check In", "Check Out",
      "Total (mins)", "In Zone (mins)", "Out Zone (mins)",
      "Violations", "Compliance %",
    ];
    const rows = reports.map((r) => [
      r.employee_name,
      r.session_date,
      r.checkin_time ? new Date(r.checkin_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—",
      r.checkout_time ? new Date(r.checkout_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—",
      r.total_duration_mins,
      r.time_in_zone_mins,
      r.time_out_zone_mins,
      r.violation_count,
      `${r.compliance_pct}%`,
    ].map((v) => `"${v}"`).join(","));
    return [headers.join(","), ...rows].join("\n");
  },
};
