const fs = require('fs');
let content = fs.readFileSync('screens/DashboardScreen.tsx', 'utf8');

content = content.replace(
  /\{isCheckedIn && \!isCheckedOut && trackingHealth\.warning \? \(/,
  '{isCheckedIn && !isCheckedOut && trackingHealth.warning && Platform.OS !== "web" ? ('
);

fs.writeFileSync('screens/DashboardScreen.tsx', content);
console.log('Fixed Location Tracking pill visibility for web');
