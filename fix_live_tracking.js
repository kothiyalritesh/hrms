const fs = require('fs');
const file = 'd:/download/RealtyHRM-fixed/RealtyHRM-fixed/screens/admin/LiveTrackingScreen.tsx';
let content = fs.readFileSync(file, 'utf8');

const regex = /supabase\.from\(\"employee_live_status\"\)\.select\(\"\*\"\)\s*\.order\(\"user_id\"\)\.limit\(1000\),/;
content = content.replace(regex, 'Promise.resolve({ data: null, error: new Error("Legacy view removed") }),');

fs.writeFileSync(file, content, 'utf8');
console.log('Fixed LiveTrackingScreen');