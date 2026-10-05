const fs = require('fs');
const content = fs.readFileSync('dump-postgres-202609011610.sql', 'utf-8');
const idx = content.indexOf('create or replace function public.evaluate_event_comp_off');
if (idx !== -1) {
  console.log(content.slice(idx, idx + 4000));
}
