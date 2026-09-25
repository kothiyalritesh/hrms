const fs = require('fs');
const file = 'd:/download/RealtyHRM-fixed/RealtyHRM-fixed/services/canonical-attendance.service.ts';
let content = fs.readFileSync(file, 'utf8');
content = content.replace(
  'console.log("Calling rpc_admin_attendance_daily_v3 with", {start, end, offset, maximum});',
  'alert("RPC CALLED WITH: start=" + start + " end=" + end); console.log("Calling rpc_admin_attendance_daily_v3 with", {start, end, offset, maximum});'
);
fs.writeFileSync(file, content, 'utf8');