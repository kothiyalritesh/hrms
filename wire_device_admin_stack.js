const fs = require('fs');
let content = fs.readFileSync('navigation/AdminStackNavigator.tsx', 'utf8');

if (!content.includes('AdminDeviceSessions')) {
  // Add to AdminStackParamList
  content = content.replace(
    'NotificationManagement: undefined;',
    'NotificationManagement: undefined;\n  AdminDeviceSessions: undefined;'
  );

  // Add lazy screen import
  content = content.replace(
    'const NotificationManagementScreen = lazyScreen(() => import("@/screens/admin/NotificationManagementScreen"));',
    'const NotificationManagementScreen = lazyScreen(() => import("@/screens/admin/NotificationManagementScreen"));\nconst AdminDeviceSessionsScreen = lazyScreen(() => import("@/screens/admin/AdminDeviceSessionsScreen"));'
  );

  // Add Screen to navigator
  content = content.replace(
    '<Stack.Screen\n        name="NotificationManagement"\n        component={NotificationManagementScreen}\n        options={{ title: "Push Notifications" }}\n      />',
    '<Stack.Screen\n        name="NotificationManagement"\n        component={NotificationManagementScreen}\n        options={{ title: "Push Notifications" }}\n      />\n      <Stack.Screen\n        name="AdminDeviceSessions"\n        component={AdminDeviceSessionsScreen}\n        options={{ title: "Duplicate Devices" }}\n      />'
  );

  fs.writeFileSync('navigation/AdminStackNavigator.tsx', content);
  console.log('Added AdminDeviceSessions to AdminStackNavigator.tsx');
}
