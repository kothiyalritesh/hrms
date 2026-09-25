const fs = require('fs');
let content = fs.readFileSync('screens/admin/AdminDashboardScreen.tsx', 'utf8');

if (!content.includes('AdminDeviceSessions')) {
  content = content.replace(
    '<ActionCard\n              icon="map"\n              label="In Transit Monitor"\n              desc="Track employee commutes"\n              accent="#F59E0B"\n              onPress={() => navigation.navigate("InTransit")}\n            />',
    `<ActionCard
              icon="map"
              label="In Transit Monitor"
              desc="Track employee commutes"
              accent="#F59E0B"
              onPress={() => navigation.navigate("InTransit")}
            />
            <ActionCard
              icon="smartphone"
              label="Duplicate Devices"
              desc="Detect buddy punching"
              accent="#EF4444"
              onPress={() => navigation.navigate("AdminDeviceSessions")}
            />`
  );
  fs.writeFileSync('screens/admin/AdminDashboardScreen.tsx', content);
  console.log('Added to AdminDashboardScreen');
}
