const fs = require('fs');
let content = fs.readFileSync('App.tsx', 'utf8');

// Clean up incorrect Stack.Screen from App.tsx
if (content.includes('AdminDeviceSessionsScreen = lazyScreen')) {
  content = content.replace(
    /const AdminDeviceSessionsScreen = lazyScreen\(\(\) => import\("@\/screens\/admin\/AdminDeviceSessionsScreen"\)\);\n/g,
    ''
  );
  content = content.replace(
    /      <Stack\.Screen\n        name="AdminDeviceSessions"\n        component=\{AdminDeviceSessionsScreen\}\n        options=\{\{ title: "Duplicate Devices" \}\}\n      \/>/g,
    ''
  );
  fs.writeFileSync('App.tsx', content);
  console.log('Cleaned up App.tsx');
}
