const fs = require('fs');
const content = fs.readFileSync('dump-postgres-202609011610.sql', 'utf-8');
const idx = content.indexOf('create or replace function public.rpc_admin_save_profile');
if (idx !== -1) {
  const endIdx = content.indexOf('$$', idx + 100);
  console.log(content.slice(idx, endIdx + 2).substring(0, 4000));
} else {
  console.log("Not found in dump");
}
