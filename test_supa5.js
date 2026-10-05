const fs = require('fs');
const envFile = fs.readFileSync('.env', 'utf-8');
const supabaseUrl = envFile.match(/EXPO_PUBLIC_SUPABASE_URL=(.*)/)[1].trim();
const supabaseKey = envFile.match(/EXPO_PUBLIC_SUPABASE_ANON_KEY=(.*)/)[1].trim();

async function test() {
  const req = await fetch(`${supabaseUrl}/rest/v1/?apikey=${supabaseKey}`);
  const json = await req.json();
  const defs = json.definitions || json.components?.schemas || {};
  const view = defs['v_attendance_daily_canonical'];
  if (view) {
    console.log("COLUMNS:", Object.keys(view.properties).join(", "));
  } else {
    console.log("View not found in swagger.");
  }
}

test();
