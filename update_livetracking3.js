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

const newBlock = '    const liveEmployeeRows: any[] = ((canonicalRes.data ?? []) as CanonicalAttendanceDay[])\n' +
  '      .filter((row) => row.official_first_in)\n' +
  '      .map((row) => {\n' +
  '        const ping = pingMap.get(row.user_id);\n' +
  '        const rawStatus = String(row.latest_tracking_status || "").toUpperCase();\n' +
  '        const validStatus = Object.prototype.hasOwnProperty.call(STATUS_CONFIG, rawStatus)\n' +
  '          ? (rawStatus as TrackStatus)\n' +
  '          : null;\n' +
  '        const status: TrackStatus = row.official_last_out\n' +
  '          ? "CHECKED_OUT"\n' +
  '          : !ping\n' +
  '            ? "CHECKIN_ONLY"\n' +
  '            : validStatus ?? "GREEN";\n' +
  '        \n' +
  '        // Use the actual punch office if available, otherwise fallback to assigned office\n' +
  '        const punchOfficeId = attMap.get(row.user_id)?.office_id || row.office_id;\n' +
  '            \n' +
  '        return {\n' +
  '          user_id: row.user_id,\n' +
  '          name: row.employee_name,\n' +
  '          employee_number: row.employee_number,\n' +
  '          role: row.role || "Employee",\n' +
  '          office_id: punchOfficeId,\n' +
  '          latitude: ping?.latitude ?? null,\n' +
  '          longitude: ping?.longitude ?? null,\n' +
  '          distance_from_base: row.distance_from_office_m ?? null,\n' +
  '          status,\n' +
  '          gps_available: status !== "RED_GPS_OFF",\n' +
  '          recorded_at: ping?.recorded_at ?? row.official_first_in,\n' +
  '          attendance_checkin: row.official_first_in,\n' +
  '          attendance_checkout: row.official_last_out,\n' +
  '          checkin_time: row.official_first_in,\n' +
  '          checkout_time: row.official_last_out,\n' +
  '          last_visit_location: row.active_field_visit_name,\n' +
  '          last_visit_checkin: row.field_visit_first_in,\n' +
  '          last_visit_checkout: row.field_visit_checkout,\n' +
  '          geo_fence_radius: 500,\n' +
  '          has_location_data: Boolean(ping),\n' +
  '          has_gps_ping: Boolean(ping),\n' +
  '        };\n' +
  '      });\n' +
  '\n' +
  '    if (liveEmployeeRows.length) {';

content = content.replace(
  /const fallbackEmployees: any\[\] = empRes\.error[\s\S]*?: \[\];\s+if \(empRes\.error\) \{\s+void reportNonFatalError\("live_tracking\.employee_view", empRes\.error\);\s+\}\s+const liveEmployeeRows = \(empRes\.data \?\? fallbackEmployees\) as any\[\];\s+if \(liveEmployeeRows\.length \|\| !empRes\.error\) \{/m,
  newBlock
);

fs.writeFileSync('screens/admin/LiveTrackingScreen.tsx', content);
console.log('Replaced');
