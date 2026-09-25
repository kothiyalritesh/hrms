const fs = require('fs');

const screens = [
  'd:/download/RealtyHRM-fixed/RealtyHRM-fixed/screens/reports/LateArrivalReportScreen.tsx',
  'd:/download/RealtyHRM-fixed/RealtyHRM-fixed/screens/reports/OvertimeReportScreen.tsx',
  'd:/download/RealtyHRM-fixed/RealtyHRM-fixed/screens/reports/AbsenceReportScreen.tsx',
  'd:/download/RealtyHRM-fixed/RealtyHRM-fixed/screens/reports/LeaveReportScreen.tsx'
];

for (const s of screens) {
  if (!fs.existsSync(s)) continue;
  let code = fs.readFileSync(s, 'utf8');
  
  // replace: const data = await CanonicalAttendanceService.list(fromDate, toDate);
  // or toIso(fromDate)
  code = code.replace(
    'const data = await CanonicalAttendanceService.list(toIso(fromDate), toIso(toDate));',
    'const endRaw = toIso(toDate);\n      const today = new Date(new Date().getTime() + 5.5 * 3600000).toISOString().slice(0, 10);\n      const end = endRaw > today ? today : endRaw;\n      const data = await CanonicalAttendanceService.list(toIso(fromDate), end);'
  );
  
  // What if it's: const data = await CanonicalAttendanceService.list(fromDate, toDate);
  // where fromDate is string?
  code = code.replace(
    'const data = await CanonicalAttendanceService.list(fromDate, toDate);',
    'const endRaw = toDate;\n      const today = new Date(new Date().getTime() + 5.5 * 3600000).toISOString().slice(0, 10);\n      const end = endRaw > today ? today : endRaw;\n      const data = await CanonicalAttendanceService.list(fromDate, end);'
  );
  
  fs.writeFileSync(s, code, 'utf8');
}
console.log("Patched other report screens");