const fs = require('fs');
let content = fs.readFileSync('screens/ProfileScreen.tsx', 'utf8');

content = content.replace(
  /navigation\.navigate\("Attendance"\)/g,
  'navigation.navigate("HomeTab" as any, { screen: "AttendanceDetails" } as any)'
);

fs.writeFileSync('screens/ProfileScreen.tsx', content);
console.log('Fixed ProfileScreen navigation');
