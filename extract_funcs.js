const fs = require('fs');
const content = fs.readFileSync('dump-postgres-202609011610.sql', 'utf-8');

function extractFunc(name) {
  const match = content.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}[\\s\\S]*?\\$\\$`, 'i'));
  if (match) {
    console.log(`--- ${name} ---`);
    console.log(match[0]);
  } else {
    console.log(`--- ${name} Not found ---`);
  }
}

extractFunc('rpc_attendance_checkin_v3');
extractFunc('submit_field_visit_current_location_v3');
extractFunc('rpc_event_check_in');
