const fs = require('fs');
let content = fs.readFileSync('screens/ProfileScreen.tsx', 'utf8');

if (!content.includes('title="Attendance History"')) {
  content = content.replace(
    '<MenuItem\n              icon="calendar"\n              title="Leave History"\n              subtitle="View leave applications"\n              onPress={() => navigation.navigate("LeaveScreen")}\n            />',
    '<MenuItem\n              icon="calendar"\n              title="Leave History"\n              subtitle="View leave applications"\n              onPress={() => navigation.navigate("LeaveScreen")}\n            />\n            <MenuItem\n              icon="clock"\n              title="Attendance History"\n              subtitle="View days present, off, and leaves"\n              onPress={() => navigation.navigate("Attendance")}\n            />'
  );
  fs.writeFileSync('screens/ProfileScreen.tsx', content);
  console.log('Added Attendance History to ProfileScreen');
}
