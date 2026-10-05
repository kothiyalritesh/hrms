const fs = require('fs');
const content = fs.readFileSync('dump-postgres-202609011610.sql', 'utf-8');
const idx = content.indexOf('CREATE OR REPLACE FUNCTION public.rpc_admin_attendance_daily_v3');
if (idx !== -1) {
  console.log(content.slice(idx, idx + 2500));
} else {
  console.log('Not found in dump');
}
