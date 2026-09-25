const fs = require('fs');
const mock = 'const Notifications = { requestPermissionsAsync: async () => ({ status: \"granted\" }), getPermissionsAsync: async () => ({ status: \"granted\" }), getExpoPushTokenAsync: async () => ({ data: \"dummy_token\" }), cancelScheduledNotificationAsync: async () => {}, scheduleNotificationAsync: async () => \"dummy_id\", setNotificationHandler: () => {} };';
function replaceInFile(file) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(/import \\* as Notifications from [\'"]expo-notifications[\'"];/g, mock);
  fs.writeFileSync(file, content);
}
replaceInFile('services/location/notification.service.ts');
replaceInFile('components/AndroidHrmsShell.tsx');
replaceInFile('services/location/LocationTrackingCoordinator.ts');
console.log('Mocked');