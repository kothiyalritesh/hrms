const fs = require('fs');
let content = fs.readFileSync('App.tsx', 'utf8');

if (!content.includes('AdminDeviceSessions: undefined')) {
  content = content.replace(
    'NotificationManagement: undefined;',
    'NotificationManagement: undefined;\n  AdminDeviceSessions: undefined;'
  );
  fs.writeFileSync('App.tsx', content);
  console.log('Added to RootStackParamList');
}
