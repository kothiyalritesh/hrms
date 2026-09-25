const fs = require('fs');
const file = 'd:/download/RealtyHRM-fixed/RealtyHRM-fixed/screens/admin/TVDisplayScreen.tsx';
let content = fs.readFileSync(file, 'utf8');
content = content.replace('title="⚠️  Fraud / GPS Anomaly""', 'title="⚠️  Fraud / GPS Anomaly"');
content = content.replace('supabase.from("location_alerts")\n          .select("user_id, alert_type, message, distance_m")', 'supabase.from("location_alerts")\n          .select("user_id, alert_type, message, distance_m, created_at")');
fs.writeFileSync(file, content, 'utf8');
console.log('Fixed quotes and query');