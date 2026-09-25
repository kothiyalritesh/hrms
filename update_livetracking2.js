const fs = require('fs');
let content = fs.readFileSync('screens/admin/LiveTrackingScreen.tsx', 'utf8');

content = content.replace(
  /const \[empRes.*Promise\.all\(\[\s+supabase\.from\("employee_live_status"\)\.select\("\*"\)\s+\.order\("user_id"\)\.limit\(1000\),/m,
  'const [alertRes, meetRes, officeRes, attRes, pingRes, canonicalRes] = await Promise.all(['
);

content = content.replace(
  /if \(empRes\.error && canonicalRes\.error\) throw empRes\.error;/,
  'if (canonicalRes.error) throw canonicalRes.error;'
);

const newBlock =     const liveEmployeeRows: any[] = ((canonicalRes.data ?? []) as CanonicalAttendanceDay[])
      .filter((row) => row.official_first_in)
      .map((row) => {
        const ping = pingMap.get(row.user_id);
        const rawStatus = String(row.latest_tracking_status || "").toUpperCase();
        const validStatus = Object.prototype.hasOwnProperty.call(STATUS_CONFIG, rawStatus)
          ? (rawStatus as TrackStatus)
          : null;
        const status: TrackStatus = row.official_last_out
          ? "CHECKED_OUT"
          : !ping
            ? "CHECKIN_ONLY"
            : validStatus ?? "GREEN";
        
        // Use the actual punch office if available, otherwise fallback to assigned office
        const punchOfficeId = attMap.get(row.user_id)?.office_id || row.office_id;
            
        return {
          user_id: row.user_id,
          name: row.employee_name,
          employee_number: row.employee_number,
          role: row.role || "Employee",
          office_id: punchOfficeId,
          latitude: ping?.latitude ?? null,
          longitude: ping?.longitude ?? null,
          distance_from_base: row.distance_from_office_m ?? null,
          status,
          gps_available: status !== "RED_GPS_OFF",
          recorded_at: ping?.recorded_at ?? row.official_first_in,
          attendance_checkin: row.official_first_in,
          attendance_checkout: row.official_last_out,
          checkin_time: row.official_first_in,
          checkout_time: row.official_last_out,
          last_visit_location: row.active_field_visit_name,
          last_visit_checkin: row.field_visit_first_in,
          last_visit_checkout: row.field_visit_checkout,
          geo_fence_radius: 500,
          has_location_data: Boolean(ping),
          has_gps_ping: Boolean(ping),
        };
      });

    if (liveEmployeeRows.length) {;

content = content.replace(
  /const fallbackEmployees: any\[\] = empRes\.error[\s\S]*?: \[\];\s+if \(empRes\.error\) \{\s+void reportNonFatalError\("live_tracking\.employee_view", empRes\.error\);\s+\}\s+const liveEmployeeRows = \(empRes\.data \?\? fallbackEmployees\) as any\[\];\s+if \(liveEmployeeRows\.length \|\| !empRes\.error\) \{/m,
  newBlock
);

fs.writeFileSync('screens/admin/LiveTrackingScreen.tsx', content);
console.log('Replaced');
