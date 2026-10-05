const fs = require('fs');
const content = fs.readFileSync('dump-postgres-202609011610.sql', 'utf-8');
const idx = content.indexOf('create or replace function public.rpc_get_my_monthly_attendance(p_month date)');
if (idx !== -1) {
  console.log(content.slice(idx, idx + 2500));
}
