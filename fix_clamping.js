const fs = require('fs');

const file1 = 'd:/download/RealtyHRM-fixed/RealtyHRM-fixed/screens/reports/AttendanceRegisterReportScreen.tsx';
let content1 = fs.readFileSync(file1, 'utf8');

// Use proper local timezone date extraction for the last day of the month
content1 = content1.replace(
  'const end = new Date(year, month, 0).toISOString().slice(0, 10);',
  'const lastDay = new Date(year, month, 0);\n    const end = `${lastDay.getFullYear()}-${String(lastDay.getMonth()+1).padStart(2,"0")}-${String(lastDay.getDate()).padStart(2,"0")}`;'
);

// We already added clamping above:
// 'const [start, endRaw] = monthRange(year, month);\n      const today = new Date().toISOString().slice(0, 10);\n      const end = endRaw > today ? today : endRaw;'
// Let's improve the clamping to use IST properly!
content1 = content1.replace(
  'const today = new Date().toISOString().slice(0, 10);',
  'const today = new Date(new Date().getTime() + 5.5 * 3600000).toISOString().slice(0, 10); // naive IST for clamping'
);

fs.writeFileSync(file1, content1, 'utf8');

// Undo the TVDisplayScreen test!
const tvFile = 'd:/download/RealtyHRM-fixed/RealtyHRM-fixed/screens/admin/TVDisplayScreen.tsx';
let tvContent = fs.readFileSync(tvFile, 'utf8');
tvContent = tvContent.replace(
  'const today = "2026-09-17"; // hardcoded yesterday for testing',
  'const today = todayIST();'
);
fs.writeFileSync(tvFile, tvContent, 'utf8');

// Revert canonical-attendance.service.ts
const srvFile = 'd:/download/RealtyHRM-fixed/RealtyHRM-fixed/services/canonical-attendance.service.ts';
let srvContent = fs.readFileSync(srvFile, 'utf8');
srvContent = srvContent.replace(
  'alert("RPC CALLED WITH: start=" + start + " end=" + end); console.log("Calling rpc_admin_attendance_daily_v3 with", {start, end, offset, maximum});',
  ''
);
fs.writeFileSync(srvFile, srvContent, 'utf8');
console.log("Fixed report screens & reverted debug");