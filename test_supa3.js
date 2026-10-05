const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envFile = fs.readFileSync('.env', 'utf-8');
const supabaseUrl = envFile.match(/EXPO_PUBLIC_SUPABASE_URL=(.*)/)[1].trim();
const supabaseKey = envFile.match(/EXPO_PUBLIC_SUPABASE_ANON_KEY=(.*)/)[1].trim();

const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  const req = await fetch(`${supabaseUrl}/rest/v1/v_attendance_daily_canonical`, {
    method: 'OPTIONS',
    headers: { apikey: supabaseKey }
  });
  const text = await req.text();
  console.log("SCHEMA:", text);
}

test();
