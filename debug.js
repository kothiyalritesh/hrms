const fs = require('fs');
const file = 'd:/download/RealtyHRM-fixed/RealtyHRM-fixed/screens/reports/AttendanceRegisterReportScreen.tsx';
let content = fs.readFileSync(file, 'utf8');

// I will add a log
content = content.replace(
  'const {data:d1} = await supabase.from("smartoffice_device_logs").select("id").limit(1);',
  '// removed log'
);
content = content.replace(
  'console.log("SMARTOFFICE LOGS:", d1?.length, "BIOMETRIC PUNCHES:", d2?.length);',
  ''
);
content = content.replace(
  'const data = await CanonicalAttendanceService.list(start, end);',
  'const data = await CanonicalAttendanceService.list(start, end);\n      console.log("FIRST ROW SOURCE:", data[0]?.first_in_source, "NAME:", data[0]?.employee_name, data[0]?.canonical_status);'
);

fs.writeFileSync(file, content, 'utf8');
console.log("Added debug log");