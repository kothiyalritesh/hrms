const fs = require('fs');
let content = fs.readFileSync('screens/admin/AttendanceControlScreenNew.tsx', 'utf8');

content = content.replace(
  /CanonicalAttendanceService\.list\(s, e\),/g,
  `CanonicalAttendanceService.list(s, e),
        fetchAllPages<any>((from, to) =>
          supabase.from("attendance_logs").select("user_id, date, office_id")
            .gte("date", s).lte("date", e).order("user_id").order("id").range(from, to)
        ),`
);

content = content.replace(
  /const \[canonicalRows, offRes, empRes\] = await Promise\.all\(\[/g,
  'const [canonicalRows, attLogRes, offRes, empRes] = await Promise.all(['
);

content = content.replace(
  /const deviceRes = await fetchAllPages<any>\(\(from, to\) =>/g,
  `const attOfficeMap = new Map<string, string>();
      for (const a of (attLogRes?.data || [])) {
        attOfficeMap.set(a.user_id + '_' + a.date, a.office_id);
      }
      
      const deviceRes = await fetchAllPages<any>((from, to) =>`
);

content = content.replace(
  /office_name: r\.office_name \?\? '',/g,
  `office_name: r.office_name ?? '',
        punch_office_id: attOfficeMap.get(r.user_id + '_' + r.work_date) || r.office_id,`
);

content = content.replace(
  /setOffices\(offRes\.data \|\| \[\]\);/g,
  `setOffices(offRes.data || []);
      const officeNameMap = new Map((offRes.data || []).map(o => [o.id, o.name]));
      data = data.map(r => {
        if (r.punch_office_id && r.punch_office_id !== r.office_id) {
          r.office_name = officeNameMap.get(r.punch_office_id) || r.office_name;
          r.office_id = r.punch_office_id;
        }
        return r;
      });`
);

fs.writeFileSync('screens/admin/AttendanceControlScreenNew.tsx', content);
console.log('Replaced');
