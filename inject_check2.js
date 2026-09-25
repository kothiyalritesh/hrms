const fs = require('fs');
const file = 'd:/download/RealtyHRM-fixed/RealtyHRM-fixed/screens/reports/AttendanceRegisterReportScreen.tsx';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  'const data = await CanonicalAttendanceService.list(start, end);',
  'const {data:d1} = await supabase.from("smartoffice_device_logs").select("id").limit(1);\n      const {data:d2} = await supabase.from("biometric_device_punches").select("id").limit(1);\n      console.log("SMARTOFFICE LOGS:", d1?.length, "BIOMETRIC PUNCHES:", d2?.length);\n      const data = await CanonicalAttendanceService.list(start, end);'
);
fs.writeFileSync(file, content, 'utf8');
console.log("Injected table check in Report");