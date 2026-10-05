const fs = require('fs');
const content = fs.readFileSync('dump-postgres-202609011610.sql', 'utf-8');

function extractFuncFullRegex(name) {
  const match = content.match(new RegExp(`create or replace function public\\.${name}[\\s\\S]*?end \\$\\$`, 'i'));
  if (match) {
    console.log(`--- ${name} ---`);
    console.log(match[0].slice(-500)); // only need the end
  } else {
    console.log(`--- ${name} Not found ---`);
  }
}

extractFuncFullRegex('rpc_attendance_checkin_v3');
extractFuncFullRegex('submit_field_visit_current_location_v3');
extractFuncFullRegex('rpc_event_check_in');
