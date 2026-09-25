const fs = require('fs');
const file = 'd:/download/RealtyHRM-fixed/RealtyHRM-fixed/services/canonical-attendance.service.ts';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  'const { data, error } = await supabase.rpc(',
  'console.log("Calling rpc_admin_attendance_daily_v3 with", {start, end, offset, maximum});\n      const { data, error } = await supabase.rpc('
);
content = content.replace(
  'if (error) throw error;',
  'if (error) { console.error("RPC ERROR:", error); throw error; }'
);
fs.writeFileSync(file, content, 'utf8');