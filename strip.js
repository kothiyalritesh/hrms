const fs = require('fs');
function replace(f) {
  let c = fs.readFileSync(f, 'utf8');
  c = c.replace(/import \* as Notifications from \"expo-notifications\";/g, '');
  c = c.replace(/import \* as Notifications from \'expo-notifications\';/g, '');
  c = c.replace(/Notifications\.cancelScheduledNotificationAsync/g, '(() => Promise.resolve())');
  c = c.replace(/Notifications\.scheduleNotificationAsync/g, '(() => Promise.resolve("dummy_id"))');
  c = c.replace(/Notifications\.requestPermissionsAsync/g, '(() => Promise.resolve({ status: "granted" }))');
  c = c.replace(/Notifications\.getPermissionsAsync/g, '(() => Promise.resolve({ status: "granted" }))');
  c = c.replace(/Notifications\.getExpoPushTokenAsync/g, '(() => Promise.resolve({ data: "dummy_token" }))');
  c = c.replace(/Notifications\.setNotificationHandler/g, '(() => {})');
  fs.writeFileSync(f, c);
}
replace('services/location/notification.service.ts');
replace('services/location/LocationTrackingCoordinator.ts');
replace('components/AndroidHrmsShell.tsx');
