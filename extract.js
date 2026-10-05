const fs = require('fs');
const content = fs.readFileSync('dump-postgres-202609011610.sql', 'utf-8');
const lines = content.split('\n');
const idx = lines.findIndex(l => l.includes('create or replace function public.leave_working_days'));
if (idx !== -1) {
  console.log(lines.slice(idx, idx + 20).join('\n'));
}
