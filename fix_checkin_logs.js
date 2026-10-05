const fs = require('fs');
let content = fs.readFileSync('screens/admin/CheckInLogsScreen.tsx', 'utf8');

content = content.replace(
  /\.in\("status", \["CHECKED_IN", "CHECKED_OUT"\]\)/g,
  '.not("checkin_time", "is", null)'
);

fs.writeFileSync('screens/admin/CheckInLogsScreen.tsx', content);
console.log('Fixed CheckInLogsScreen query filter');
