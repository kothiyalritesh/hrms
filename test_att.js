const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envFile = fs.readFileSync('.env', 'utf-8');
const supabaseUrl = envFile.match(/EXPO_PUBLIC_SUPABASE_URL=(.*)/)[1].trim();
const supabaseKey = envFile.match(/EXPO_PUBLIC_SUPABASE_ANON_KEY=(.*)/)[1].trim();
const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  const { data, error } = await supabase.from('attendance_logs').select('*');
  console.log("ATTENDANCE LOGS:", data?.length);
  if (data?.length > 0) {
    console.log("FIRST LOG:", data[0].checkin_source, data[0].attendance_type);
  }
}

test();
