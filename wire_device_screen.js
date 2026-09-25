const fs = require('fs');
let content = fs.readFileSync('App.tsx', 'utf8');

if (!content.includes('AdminDeviceSessions')) {
  // 1. Add import
  content = content.replace(
    'const NotificationManagementScreen = lazyScreen(() =>',
    'const AdminDeviceSessionsScreen = lazyScreen(() => import("@/screens/admin/AdminDeviceSessionsScreen"));\nconst NotificationManagementScreen = lazyScreen(() =>'
  );

  // 2. Add route in Stack
  content = content.replace(
    '<Stack.Screen\n        name="NotificationManagement"\n        component={NotificationManagementScreen}\n        options={{ title: "Notification Management" }}\n      />',
    '<Stack.Screen\n        name="NotificationManagement"\n        component={NotificationManagementScreen}\n        options={{ title: "Notification Management" }}\n      />\n      <Stack.Screen\n        name="AdminDeviceSessions"\n        component={AdminDeviceSessionsScreen}\n        options={{ title: "Duplicate Devices" }}\n      />'
  );

  // 3. Add to linking config
  content = content.replace(
    'NotificationManagement: "notifications",',
    'NotificationManagement: "notifications",\n                AdminDeviceSessions: "duplicate-devices",'
  );

  fs.writeFileSync('App.tsx', content);
  console.log('Added AdminDeviceSessions to App.tsx');
}
